#!/usr/bin/python
import socket
import sys
import time
import signal
import os
import datetime
import traceback
import configparser
import resource
import cProfile
from error.asserts import assert_user, assert_peer
from error.exceptions import SubprocessLimitException, PeerError, ServerError
from utils.sender import sendall
from utils.http_status_codes_headers import HTTPHeaders
from utils.exit_codes import ExitCodes
from utils.logger import Logger

class Server(object):
    HEADER_END_STRING = '\r\n\r\n'

    def __init__(self, opts):
        self.opts = opts
        self.headers = HTTPHeaders()
        self.exit_codes = ExitCodes()
        self.logger = Logger(opts['log_level'], { 'error': opts['error_path'] })
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1) # level, optname, value
        self.sock.bind((opts['address'], opts['port']))
        self.sock.listen(opts['request_queue_size'])
        self.env = {}
        self.max_subprocess_count = opts['subprocess_count']
        self.workers = 0
        self.timeout = opts['timeout']
        self.accepted_connections = 0
        self.response_code_count = {}
        signal.signal(signal.SIGCHLD, self.kill_children)

    def start(self):
        self.safeLog('info', 'Server PID: {}'.format(os.getpid()))
        self.safeLog('info', 'Server started on port {}'.format(opts['port']))

        while True:
            connection = None
            pid = None

            try:
                connection, client_address = self.sock.accept()
                self.safeLog('trace', self.response_code_count)
                self.accepted_connections += 1
                self.safeLog('debug', self.workers)
                if self.workers >= self.max_subprocess_count:
                    raise SubprocessLimitException('Accepted Connection, but workers were over the allowed limit')
                self.safeLog('debug', 'accepted connection: {}'.format(client_address))

                self.workers += 1
                pid = os.fork()
                if pid == 0:
                    self.handle_request(connection, client_address)
                    break
            except SubprocessLimitException as e:
                sendall(connection, self.generate_headers(503))
                self.safeLog('warn', e)
                self.log_request()
            except OSError as e:
                if e.errno not in [os.errno.EINTR, os.errno.EPIPE]:
                    self.safeLog('error', e)
            except KeyboardInterrupt:
                self.safeLog('info', 'Stopping Server...')
                raise
            except SystemExit as e:
                raise
            except BaseException as e:
                if connection:
                    sendall(connection, self.generate_headers(500))
                    self.log_request()
                self.safeLog('error', e)
            finally:
                if connection and pid != 0:
                    try:
                        self.safeLog('debug', 'Server closing sending socket')
                        connection.close()
                    except OSError as e:
                        self.safeLog('error', e)

    def handle_request(self, connection, client_address):
        request = None

        try:
            (
                self.env['memory_start'],
                self.env['cpu']
            ) = self.get_process_info()
            self.sock.close()
            assert isinstance(client_address, tuple) and len(client_address) == 2
            self.env['host'] = client_address[0]
            self.env['port'] = client_address[1]
            self.env['request_time'] = datetime.datetime.now().isoformat()
            connection.settimeout(self.timeout)
            (headers, content) = self.recv_request(connection)
            self.parse_request(headers)

            if self.env['request_method'] == 'GET':
                if self.env['whole_path'] == self.opts['status_path']:
                    self.send_status(connection)
                    return
                self.send_requested_file(connection, self.env['whole_path'])

        except (KeyboardInterrupt, RuntimeError) as e:
            pass
        except PeerError as e:
            sendall(connection, self.generate_headers(400))
        except (FileNotFoundError, IsADirectoryError) as e:
            sendall(connection, self.generate_headers(404))
        except socket.timeout as e:
            sendall(connection, self.generate_headers(408))
        except IOError as e:
            if e.errno == os.errno.EPIPE:
                self.safeLog('warn', e)
            else:
                self.safeLog('error', e)
                sendall(connection, self.generate_headers(500))
        except BaseException as e:
            self.safeLog('error', e)
            sendall(connection, self.generate_headers(500))
        finally:
            try:
                connection.close()
                (
                    self.env['memory_end'],
                    self.env['cpu']
                ) = self.get_process_info()
                self.sock.close()
                self.log_request()
                os._exit(self.exit_codes.get_exit_code(self.env.get('status_code', 0)))
            except BaseException as e:
                self.safeLog('error', e)
                sys.exit()


    def send_requested_file(self, connection, path):
        static_path = os.path.abspath('./static')
        path = os.path.abspath('./static' + path)

        if os.path.islink(path) or static_path not in path:
            raise FileNotFoundError()
        else:
            with open(path, "rb") as file:
                sendall(connection, self.generate_headers(200))
                while True:
                    content = file.read(1024)
                    if not content:
                      break
                    sendall(connection, content)

    def parse_request(self, request):
        assert isinstance(request, str)
        assert len(request) > 0

        self.env['request_first_line'] = request.splitlines()[0].rstrip('\r\n')

        tokens = self.env['request_first_line'].split()
        assert len(tokens) == 3
        (
            self.env['request_method'],    # GET
            self.env['whole_path'],        # /hello.html
            self.env['request_version']    # HTTP/1.1
        ) = tokens

    def recv_request(self, connection):
        data = connection.recv(self.opts['recv'])
        if not data:
            raise RuntimeError("socket connection broken")
        while self.HEADER_END_STRING.encode() not in data:
            chunk = connection.recv(self.opts['recv'])
            if not chunk:
                raise RuntimeError("socket connection broken")
            data += chunk
        total_length = self.parse_headers(data)

        while len(data) != total_length:
            chunk = connection.recv(self.opts['recv'])
            if not chunk:
                raise RuntimeError("socket connection broken")
            data += chunk

        #split by b'\r\n\r\n' [0] are headers [1:] is body, joining with b'\r\n\r\n'
        headers = data.split(str.encode(self.HEADER_END_STRING))[0].decode() + self.HEADER_END_STRING
        content = str.encode(self.HEADER_END_STRING).join(data.split(str.encode(self.HEADER_END_STRING))[1:])

        self.safeLog('debug', 'Request Recved')
        return (headers, content)

    def parse_headers(self, data):
        data = data.decode('UTF-8')
        assert_peer(len(data) <= self.opts['max_header_length'], 'Headers too long', 'HEADERS_TOO_LONG')
        headers_length = data.find(self.HEADER_END_STRING) + len(self.HEADER_END_STRING)
        header_dict = {}
        for header in data[:headers_length].split('\r\n'):
            if ': ' in header:
                header_tokens = header.split(': ')
                header_dict[header_tokens[0]] = header_tokens[1]
        if 'Content-Length' in header_dict:
            content_length = header_dict['Content-Length']
        else:
            content_length = 0

        self.env['headers'] = header_dict
        self.env['headers_length'] = headers_length
        self.env['content_length'] = content_length

        return headers_length + content_length

    def generate_headers(self, response_code):
        self.env['status_code'] = response_code
        self.update_status(response_code);

        header = ''
        header += self.headers.get_header(response_code)

        self.safeLog('debug', header)

        if response_code == 200:
            header += 'Content-Type: text/html\r\n'
        header += 'Date: {}\r\n'.format(time.strftime("%a, %d %b %Y %H:%M:%S", time.localtime()))
        header += 'Connection: close\r\n\r\n'
        self.response_code = response_code
        return header

    def kill_children(self, signum, frame):
        try:
            while True:
                (pid, code) = os.waitpid(-1, os.WNOHANG)
                http_code = self.exit_codes.get_status_code(int(code/256)) # getting low byte
                self.update_status(http_code);
                if pid == 0:
                    break
                self.workers -= 1
        except ServerError as e:
            self.safeLog('debug', e)
        except OSError as e:
            if e.errno != os.errno.ECHILD:
                self.safeLog('error', e)
        except BaseException as e:
            self.safeLog('error', e)

    def log_request(self):
        try:
            with open('./logs/access.log', "a+") as file:
                file.write('{} {} {} {} "{}" {} {} {} {} {}\n'.format(
                    self.env.get('host', '-'),
                    self.env.get('remote_logname', '-'),
                    self.env.get('remote_user', '-'),
                    self.env.get('request_time', '-'),
                    self.env.get('request_first_line', '-'),
                    self.env.get('status_code', '-'),
                    self.env['content_length'] if 'content_length' in self.env and self.env['content_length'] > 0 else '-',
                    self.env.get('memory_start', '-'),
                    self.env.get('memory_end', '-'),
                    self.env.get('cpu', '-')
                ))
                self.safeLog('debug', 'request logged')
        except Exception as e:
            self.safeLog('error', e)

    def update_status(self, http_code):
        if http_code not in self.response_code_count:
            self.response_code_count[http_code] = 1
        else:
            self.response_code_count[http_code] += 1

    def safeLog(self, level_str, s):
        try:
            self.logger.log(level_str, s)
        except Exception as e:
            try:
                traceback.print_exc()
            except:
                pass

    def get_process_info(self):
        content = None;
        memory = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 # converting from Kb to b
        cpu_usage = sum(resource.getrusage(resource.RUSAGE_SELF)[0:2])
        return (memory, cpu_usage)

    def send_status(self, connection):
        sendall(connection, self.generate_headers(200))
        status = ''
        status += '<p>Accepted connections: {}</p>'.format(self.accepted_connections)
        status += '<p>Responses (http code - count):</p>'
        for k, v in self.response_code_count.items():
            status += '<p>{} - {}</p>'.format(k, v)

        sendall(connection, status)

if __name__ == '__main__':
    config = configparser.ConfigParser()
    config.read('./etc/config.ini')

    port = config.getint('server', 'port')
    address = config.get('server', 'address')
    request_queue_size = config.getint('server', 'request_queue_size')
    timeout = config.getint('server', 'timeout')
    subprocess_count = config.getint('server', 'subprocess_count')
    recv = config.getint('server', 'recv')
    error_path = config.get('server', 'error_path')
    max_header_length = config.getint('server', 'max_header_length')
    log_level = config.get('server', 'log_level')
    status_path = config.get('server', 'status_path')

    opts = {
        'port': port,
        'address': address,
        'request_queue_size': request_queue_size,
        'timeout': timeout,
        'subprocess_count': subprocess_count,
        'recv': recv,
        'max_header_length': max_header_length,
        'error_path': error_path,
        'log_level': log_level,
        'status_path': status_path
    }

    Server(opts).start()

    # pr = cProfile.Profile()
    # pr.enable()
     
    # try:
    #     Server(opts).start()
    # except KeyboardInterrupt as e:
    #     pass
    # except BaseException as e:
    #     raise

    # pr.disable()
     
    # pr.print_stats(sort='time')

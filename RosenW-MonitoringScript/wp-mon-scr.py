#!/usr/bin/python
import MySQLdb
import os
import stat
import sys
import re

class WordPressMonitor(object):
    CONFIG_PATH = '/etc/wordpress/'

    def __init__(self, wp_path, domain):
        self.wp_path = wp_path
        self.domain = domain
        self.db_info = {}
        self.site_config_file = '{}config-{}.php'.format(self.CONFIG_PATH, self.domain)
        self.table_prefix = self.get_table_prefix()
        self.init_db()

        self.option_expected_dict = {
            'users_can_register': '0',
            'default_comment_status': 'closed'
        }
        self.option_actual_dict = {}

    def get_table_prefix(self):
        """Reads the configuration file etc/wordpress/config-<site>.php and extracts the value of $table_prefix

            Raises UserError when $table_prefix is not found
            Returns $table_prefix value as a String
        """
        content = self.read_whole_file(self.site_config_file)
        pattern = re.compile("""\$table_prefix\s*=\s*['"]([^'"]*?)['"];""")
        match = pattern.search(content)

        assert_user(match, 'Could not find WP Database table prefix in {}'.format(self.site_config_file))

        return match.group(1)

    def init_db(self):
        """Reads the configuration file etc/wordpress/config-<site>.php, extracts the DB_NAME, DB_USER, DB_PASSWORD and DB_HOST
            values with a regex and saves them in dict 

            Raises UserError if the regex doesnt find all the values
            Returns None
        """
        content = self.read_whole_file(self.site_config_file)

        for word in ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST']:
            pattern = re.compile("""define\(["']{}["'],\s*["']([^'"]*?)[\"']\);""".format(word))
            match = pattern.search(content)
            assert_user(match, 'Could not find {} in {}'.format(word, self.site_config_file))
            self.db_info[word] = match.group(1)

        self.db = MySQLdb.connect(
            host=self.db_info['DB_HOST'],
            user=self.db_info['DB_USER'],
            passwd=self.db_info['DB_PASSWORD'],
            db=self.db_info['DB_NAME']
        )

        self.cur = self.db.cursor()

    def start_test(self):
        """Querries the WP database, extracts option_name column value from the options table
            and asserts the expected values with the actual

            If assertion succeeds '1' is printed on stdout
            If assertion fails '0' is printed on stdout

            Actual WP settings are printed on stderr

            Returns None
        """
        has_differences = False
        for option in self.option_expected_dict:
            rows = self.execute_sql("SELECT option_value FROM {} WHERE option_name = %s".format(MySQLdb.escape_string('{}options'.format(self.table_prefix)).decode()), (option))
            assert_user(len(rows) > 0 and len(rows[0]) > 0, 'WP version not maintained')
            self.option_actual_dict[option] = rows[0][0]
            if self.option_actual_dict[option] != self.option_expected_dict[option]:
                has_differences = True

        self.db.close()

        if has_differences:
            sys.stdout.write('0')
        else:
            sys.stdout.write('1')
        
        self.print_actual()

    def execute_sql(self, sql, *args):
        try:
            self.cur.execute(sql, args)
            return self.cur.fetchall()
        except Exception as e:
            assert False, 'Could not execute query {} with params {}'.format(sql, args)

    def read_whole_file(self, path):
        try:
            with open(path, "r") as file:
                return file.read()
        except FileNotFoundError as e:
            assert_user(False, 'Could not find file {}'.format(path))

    def print_actual(self):
        """Prints actual wp config values on stderr"""
        for option in self.option_actual_dict:
            sys.stderr.write('{}: {}\n'.format(option, self.option_actual_dict[option]))

class UserError(Exception):
    def __init__(self, message):
        super().__init__(message)

def assert_user(condition, msg):
    if not condition:
        raise UserError(msg)

if __name__ == '__main__':
    try:
        assert_user(len(sys.argv) > 2, 
            """
            Please provide both wordpress installation path and domain name

            Try 'python3 <script> <wp_installation_path> <site>'
            """
        )
        WordPressMonitor(sys.argv[1], sys.argv[2]).start_test()
    except UserError as e:
        sys.stderr.write(str(e) + '\n')
        exit()

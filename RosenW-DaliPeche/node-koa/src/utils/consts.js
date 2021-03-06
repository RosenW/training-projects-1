const DEFAULT_PORT = 3001;

const MINIMUM_USERNAME_LENGTH = 3;
const MINIMUM_PASSWORD_LENGTH = 3;

const AIRPORT_API_LINK = 'http://www.airport-data.com/api/ap_info.json';
const FORECAST_API_LINK = 'https://api.openweathermap.org/data/2.5/forecast';
const FORECAST_API_KEY = '3324c849124277736f1fefdc58dfc561';

const EMAIL_VALIDATION_REGEX = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const MAX_REQUESTS_PER_HOUR = 600;
const MAX_API_KEYS_PER_USER = 5;

const MAXIMUM_CREDITS_ALLOWED = 1000000;

const CREDITS_FOR_SUCCESSFUL_REQUEST = 2;
const CREDITS_FOR_FAILED_REQUEST = 1;

const SALT_LENGTH = 10;
const SALT_ROUNDS = 10;

const MAX_REPORT_RESULTS = 10;

const API_KEY_LENGTH = 16;

const ROWS_PER_PAGE = 9;

const MAX_HTML_ROWS_WITHOUT_CONFIRMATION = 4;

const APPROVE_CREDIT_TRANSFER_BOUNDARY = 1000;

const MAXIMUM_TIME_SEARCH_INTERVAL = 31536000000; // 1 year

// credit card payment info
const MERCHANT_ID = '9mjmz4gm33rrmbd2';
const CREDIT_CARD_PUBLIC_KEY = 'yy9fyqg8m8yqdrhs';
const CREDIT_CARD_PRIVATE_KEY = '955e3451756ce5f6ab95eb47ce159245';

module.exports = {
  DEFAULT_PORT,
  MINIMUM_USERNAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  AIRPORT_API_LINK,
  FORECAST_API_LINK,
  FORECAST_API_KEY,
  MAX_REQUESTS_PER_HOUR,
  MAX_API_KEYS_PER_USER,
  EMAIL_VALIDATION_REGEX,
  CREDITS_FOR_SUCCESSFUL_REQUEST,
  CREDITS_FOR_FAILED_REQUEST,
  MAXIMUM_CREDITS_ALLOWED,
  MERCHANT_ID,
  CREDIT_CARD_PRIVATE_KEY,
  CREDIT_CARD_PUBLIC_KEY,
  SALT_LENGTH,
  SALT_ROUNDS,
  ROWS_PER_PAGE,
  APPROVE_CREDIT_TRANSFER_BOUNDARY,
  API_KEY_LENGTH,
  MAX_REPORT_RESULTS,
  MAX_HTML_ROWS_WITHOUT_CONFIRMATION,
  MAXIMUM_TIME_SEARCH_INTERVAL
};

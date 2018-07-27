const PORT = 3000;

const MINIMUM_USERNAME_LENGTH = 3;
const MINIMUM_PASSWORD_LENGTH = 3;

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

const AIRPORT_API_LINK = 'http://www.airport-data.com/api/ap_info.json';
const FORECAST_API_LINK = 'https://api.openweathermap.org/data/2.5/forecast';
const FORECAST_API_KEY = '3324c849124277736f1fefdc58dfc561';

const EMAIL_VALIDATION_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const MAX_REQUESTS_PER_HOUR = 60;
const MAX_API_KEYS_PER_USER = 5;

module.exports = {
		PORT,
		MINIMUM_USERNAME_LENGTH,
		MINIMUM_PASSWORD_LENGTH,
		ADMIN_USERNAME,
		ADMIN_PASSWORD,
		AIRPORT_API_LINK,
		FORECAST_API_LINK,
		FORECAST_API_KEY,
		MAX_REQUESTS_PER_HOUR,
		MAX_API_KEYS_PER_USER,
		EMAIL_VALIDATION_REGEX
	}

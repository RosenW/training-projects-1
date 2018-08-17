const Koa = require('koa');
const router = require('koa-router')();
const bodyParser = require('koa-bodyparser');
const { assert, assertUser } = require('./../asserts/asserts.js');
const { PeerError, UserError } = require('./../asserts/exceptions.js');
const { trace, clearTraceLog } = require('./../debug/tracer.js');
const {
  generateRandomString,
  validateEmail,
  isObject,
  isInteger,
} = require('./../utils/utils.js');
const { getForecast, generateAPIKey, deleteAPIKey } = require('./../api/api.js');
const db = require('./../database/pg_db.js');
const serve = require('koa-static');
const bcrypt = require('bcrypt');
const session = require('koa-session');
const views = require('koa-views');
const {
  PORT,
  MINIMUM_USERNAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  MAX_REQUESTS_PER_HOUR,
  MAXIMUM_CREDITS_ALLOWED,
  MERCHANT_ID,
  CREDIT_CARD_PRIVATE_KEY,
  CREDIT_CARD_PUBLIC_KEY,
  SALT_ROUNDS,
  SALT_LENGTH,
  ROWS_PER_PAGE,
} = require('./../utils/consts.js');
const braintree = require('braintree');

const gateway = braintree.connect({
  environment: braintree.Environment.Sandbox,
  merchantId: MERCHANT_ID,
  publicKey: CREDIT_CARD_PUBLIC_KEY,
  privateKey: CREDIT_CARD_PRIVATE_KEY,
});

const app = new Koa();

const server = app.listen(PORT, () => {
  console.log(`Server listening on port: ${PORT}`);
});

app.keys = ['DaliKrieTaini'];

// (cookie lifetime): (Milliseconds)
app.use(session({ maxAge: 1000 * 60 * 60 * 24 }, app));

app.use(serve(`${__dirname}/public/css`));
app.use(serve(`${__dirname}/public/js`));

app.use(views(`${__dirname}/views`, {
  extension: 'hbs',
  map: { hbs: 'handlebars' }, // marks engine for extensions
  options: {
    partials: {
      adminForm: './admin_form', // requires ./admin_form.hbs
    },
  },
}));

clearTraceLog();

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof UserError) {
      ctx.body = {
        message: err.message,
        statusCode: err.statusCode,
      };
    } else if (err instanceof PeerError) {
      ctx.body = {
        message: err.message,
        statusCode: err.statusCode,
      };
    } else {
      console.log(err);
      console.log(`Application Error: ${err.message}, Status code: ${err.statusCode}`);
      ctx.body = 'An error occured please clear your cookies and try again';
    }
  }
});

app.use(bodyParser());

// GET root
router.get('/', async (ctx, next) => {
  trace(`GET '/'`);

  await ctx.redirect('/home');
});

// GET logout
router.get('/logout', async (ctx, next) => {
  trace(`GET '/logout'`);

  ctx.session = null; // docs: "To destroy a session simply set it to null"
  await ctx.redirect('/login');
});

// GET home
router.get('/home', async (ctx, next) => {
  trace(`GET '/home'`);

  if (ctx.session.user == null) {
    ctx.redirect('/login');
    return next();
  }

  const user = (await db.query(`SELECT * FROM users WHERE username = $1`, ctx.session.user))[0];
  assert(user != null, 'cookie contained username not in database', 10);

  const keys = await db.query(`SELECT * FROM api_keys WHERE user_id = $1`, user.id);
  assert(Array.isArray(keys), 'keys expected to be array but wasnt', 15);

  await ctx.render(
    'home', {
      user: ctx.session.user,
      credits: user.credits,
      limit: MAX_REQUESTS_PER_HOUR,
      keys,
    }
  );
});

// GET login
router.get('/login', async (ctx, next) => {
  trace(`GET '/login'`);

  if (ctx.session.user != null) {
    ctx.redirect('/home');
  }

  await ctx.render('login', {
    err: ctx.query.err,
    success: ctx.query.success,
  });
});

// GET register
router.get('/register', async (ctx, next) => {
  trace(`GET '/register'`);

  if (ctx.session.user != null) {
    ctx.redirect('/home');
  }

  await ctx.render('register', { err: ctx.query.err });
});

// GET admin
router.get('/admin', async (ctx, next) => {
  trace(`GET '/admin'`);
  if (ctx.session.admin == null) {
    await ctx.render('admin_login');
    return next();
  }

  await ctx.render('admin');
});

// GET admin/users
router.get('/admin/users', async (ctx, next) => {
  trace(`GET '/admin/users'`);
  if (!ctx.session.roles.includes('superuser')) {
    await ctx.redirect('/admin');
    return next();
  }

  const username = ctx.query.username == null ? '' : ctx.query.username;
  const email = ctx.query.email == null ? '' : ctx.query.email;
  const creditsFrom = ctx.query['credits-from'] == null ? 0 : Number(ctx.query['credits-from']);
  const creditsTo = ctx.query['credits-to'] == null || Number(ctx.query['credits-to']) === 0 ? MAXIMUM_CREDITS_ALLOWED : Number(ctx.query['credits-to']);
  const dateFrom = ctx.query['date-from'] == null || isNaN(new Date(ctx.query['date-from'])) ? new Date('1970-01-01') : new Date(ctx.query['date-from']);
  const dateTo = ctx.query['date-to'] == null || isNaN(new Date(ctx.query['date-to'])) ? new Date() : new Date(ctx.query['date-to']);

  assert(typeof username === 'string', `in 'admin/user' username expected to be string, actual: ${username}`, 121);
  assert(isObject(dateFrom), `in 'admin/user' dateFrom expected to be object. actual: ${dateFrom}`, 122);
  assert(isObject(dateTo), `in 'admin/user' dateTo expected to be object. actual: ${dateTo}`, 123);
  assert(typeof email === 'string', `in 'admin/user' email expected to be string, actual: ${email}`, 124);
  assert(typeof creditsFrom === 'number', `in 'admin/user' creditsFrom expected to be number, actual: ${creditsFrom}`, 125);
  assert(typeof creditsTo === 'number', `in 'admin/user' creditsTo expected to be number, actual: ${creditsTo}`, 126);

  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);

  const users = (await db.query(`
    SELECT * FROM users
    WHERE
      LOWER(username) LIKE LOWER($1)
      AND LOWER(email) LIKE LOWER($2)
      AND (date_registered BETWEEN $3 AND $4)
      AND (credits BETWEEN $5 AND $6)
    ORDER BY id
    OFFSET $7
    LIMIT $8`,
  `%${username}%`,
  `%${email}%`,
  dateFrom,
  dateTo,
  creditsFrom,
  creditsTo,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  )).map((u) => {
    u.date_registered = u.date_registered.toISOString();
    return u;
  });

  await ctx.render('admin_users', {
    maxRequests: MAX_REQUESTS_PER_HOUR,
    users,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    username,
    email,
    creditsFrom,
    creditsTo,
    dateFrom: dateFrom.toISOString().substr(0, 10),
    dateTo: dateTo.toISOString().substr(0, 10)
  });
});

// GET admin/credits
router.get('/admin/credits', async (ctx, next) => {
  trace(`GET '/admin/credits'`);

  if (!ctx.session.roles.includes('superuser') && !ctx.session.roles.includes('accountant')) {
    await ctx.redirect('/admin');
    return next();
  }

  const username = ctx.query.username == null ? '' : ctx.query.username;
  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);
  const totalByUserSQL = `
    SELECT
      u.id,
      u.username,
      SUM(ct.credits_received) AS credits_purchased,
      SUM(ct.credits_spent) AS credits_spent,
      u.credits AS credits_remaining
    FROM users AS u
    JOIN credit_transfers AS ct
    ON ct.user_id = u.id
    WHERE LOWER(u.username) LIKE LOWER($1)
    GROUP BY (u.id, u.username, u.credits)
    ORDER BY u.id
    OFFSET $2
    LIMIT $3
  `;

  const users = await db.query(
    totalByUserSQL,
    `%${username}%`,
    0 + (ROWS_PER_PAGE * page),
    ROWS_PER_PAGE
  );

  const total = (await db.query(`
    SELECT
      SUM(credits_purchased) AS total_credits_purchased,
      SUM(credits_spent) AS total_credits_spent,
      SUM(credits_remaining) AS total_credits_remaining
    FROM (${totalByUserSQL}) AS total_by_user
    `,
  `%${username}%`,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  ))[0];

  await ctx.render('admin_credits', {
    users,
    total_credits_purchased: total.total_credits_purchased,
    total_credits_spent: total.total_credits_spent,
    total_credits_remaining: total.total_credits_remaining,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    username,
  });
});

// GET admin/cities
router.get('/admin/cities', async (ctx, next) => {
  trace(`GET '/admin/cities'`);

  if (!ctx.session.roles.includes('superuser')) {
    await ctx.redirect('/admin');
    return next();
  }

  const name = ctx.query.name == null ? '' : ctx.query.name;
  const countryCode = ctx.query['country-code'] == null ? '' : ctx.query['country-code'];

  assert(typeof name === 'string', `in 'admin/cities' name expected to be string, actual: ${name}`, 141);
  assert(typeof countryCode === 'string', `in 'admin/cities' country-code expected to be string, actual: ${countryCode}`, 142);

  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);

  const cities = (await db.query(`
    SELECT * FROM cities
    WHERE
      LOWER(name) LIKE LOWER($1)
      AND LOWER(country_code) LIKE LOWER($2)
    ORDER BY id
    OFFSET $3
    LIMIT $4`,
  `%${name}%`,
  `%${countryCode}%`,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  )).map((c) => {
    if (c.observed_at != null) c.observed_at = c.observed_at.toISOString();
    return c;
  }).sort((c1, c2) => c1.id - c2.id);

  await ctx.render('admin_cities', {
    cities,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    name,
    countryCode
  });
});

// GET admin/requests
router.get('/admin/requests', async (ctx, next) => {
  trace(`GET '/admin/requests'`);

  if (!ctx.session.roles.includes('superuser')) {
    await ctx.redirect('/admin');
    return next();
  }

  const term = ctx.query.term == null ? '' : ctx.query.term;
  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);

  const requests = (await db.query(`
    SELECT * FROM requests
    WHERE LOWER(iata_code)
    LIKE LOWER($1)
    OR LOWER(city)
    LIKE LOWER($1)
    ORDER BY id
    OFFSET $2
    LIMIT $3`,
  `%${term}%`,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  )).sort((c1, c2) => c2.call_count - c1.call_count);

  await ctx.render('admin_requests', {
    requests,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    term,
  });
});

// GET admin/approve
router.get('/admin/approve', async (ctx, next) => {
  trace(`GET '/admin/approve'`);

  if (!ctx.session.roles.includes('superuser')) {
    await ctx.redirect('/admin');
    return next();
  }

  const username = ctx.query.username == null ? '' : ctx.query.username;
  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);

  const transfers = (await db.query(`
    SELECT
      ct.id,
      u.username,
      ct.credits_received
    FROM users as u
    JOIN credit_transfers as ct
    ON ct.user_id = u.id
    WHERE LOWER(u.username)
    LIKE LOWER($1)
    AND approved = false
    ORDER BY ct.id DESC
    OFFSET $2
    LIMIT $3`,
  `%${username}%`,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  ));
  await ctx.render('admin_approve', {
    transfers,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    username,
  });
});

// GET admin/ctransfers
router.get('/admin/ctransfers', async (ctx, next) => {
  trace(`GET '/admin/ctransfers'`);

  if (!ctx.session.roles.includes('superuser') && !ctx.session.roles.includes('accountant')) {
    await ctx.redirect('/admin');
    return next();
  }

  const username = ctx.query.username == null ? '' : ctx.query.username;
  const dateFrom = ctx.query['date-from'] == null || isNaN(new Date(ctx.query['date-from'])) ? new Date('1970-01-01') : new Date(ctx.query['date-from']);
  const dateTo = ctx.query['date-to'] == null || isNaN(new Date(ctx.query['date-to'])) ? new Date() : new Date(ctx.query['date-to']);
  const event = ctx.query.event == null ? '' : ctx.query.event;

  assert(typeof username === 'string', `in 'admin/ctransfers' username expected to be string, actual: ${username}`, 131);
  assert(isObject(dateFrom), `in 'admin/ctransfers' dateFrom expected to be object. actual: ${dateFrom}`, 132);
  assert(isObject(dateTo), `in 'admin/ctransfers' dateTo expected to be object. actual: ${dateTo}`, 133);
  assert(typeof event === 'string', `in 'admin/ctransfers' event expected to be string, actual: ${event}`, 134);

  const page = !Number(ctx.query.page) || ctx.query.page < 0 ? 0 : Number(ctx.query.page);

  const transfers = (await db.query(`
      SELECT
        ct.id,
        transfer_date,
        username,
        credits_received,
        credits_spent,
        event
      FROM users as u
      JOIN credit_transfers as ct
      ON ct.user_id = u.id
      WHERE
        LOWER(username) LIKE LOWER($1)
        AND LOWER(event) LIKE LOWER($2)
        AND (date_registered BETWEEN $3 AND $4)
        AND approved = true
      ORDER BY ct.id DESC
      OFFSET $5
      LIMIT $6`,
  `%${username}%`,
  `%${event}%`,
  dateFrom,
  dateTo,
  0 + (ROWS_PER_PAGE * page),
  ROWS_PER_PAGE
  )).map((t) => {
    t.transfer_date = t.transfer_date.toISOString();
    return t;
  });

  await ctx.render('admin_transfers', {
    transfers,
    page,
    prevPage: page - 1,
    nextPage: page + 1,
    username,
    event,
    dateFrom: dateFrom.toISOString().substr(0, 10),
    dateTo: dateTo.toISOString().substr(0, 10)
  });
});

// GET buy
router.get('/buy', async (ctx, next) => {
  trace(`GET '/buy'`);

  const response = await gateway.clientToken.generate();

  await ctx.render('buy', {
    success: ctx.query.success,
    error: ctx.query.err,
    clientToken: response.clientToken,
  }
  );
});

// POST buy
router.post('/buy', async (ctx, next) => {
  trace(`POST '/buy'`);
  assert(isObject(ctx.request.body), 'Post buy has no body', 12);
  assert(ctx.request.body.total != null, 'No total in post buy', 14);
  assert(ctx.request.body.nonce != null, 'No nonce in post buy', 15);
  assert(ctx.request.body.credits != null, 'No credits in post buy', 16);

  const sale = await gateway.transaction.sale({
    amount: ctx.request.body.total,
    paymentMethodNonce: ctx.request.body.nonce,
    options: {
      submitForSettlement: true,
    },
  });

  const credits = ctx.request.body.credits;
  const user = (await db.query(`SELECT * FROM users WHERE username = $1`, ctx.session.user))[0];
  assert(isObject(user), 'User not an object', 13);

  if (!isInteger(Number(credits)) || Number(credits) <= 0) {
    ctx.body = { error: 'Credits must be a positive whole number' };
    return next();
  }

  if (Number(credits) + Number(user.credits) > MAXIMUM_CREDITS_ALLOWED) {
    ctx.body = { error: 'Maximum credits allowed is 1000000 per user' };
    return next();
  }

  if (sale.success) {
    await purchaseCredits(user, credits);
    ctx.body = {msg: `${credits} credits sent for approval`};
  } else {
    ctx.body = { error: 'Purchase unsuccessful' };
  }
});

const purchaseCredits = async (user, credits) => {
  await db.query(`
    INSERT INTO credit_transfers (
        user_id,
        credits_received,
        event,
        transfer_date,
        approved
      )
      VALUES ($1, $2, $3, $4, $5)`,
  user.id,
  credits,
  'Credit purchase',
  new Date(),
  false
  );
};

// AJAX post add credits
router.post('/addCreditsToUser', async (ctx, next) => {
  assert(isObject(ctx.request.body), 'Post /addCredits has no body', 19);

  const username = ctx.request.body.username;
  const credits = ctx.request.body.credits;

  assert(username != null, 'No username in post /addCredits', 101);
  assert(credits != null, 'No credits in post /addCredits', 102);

  if (credits > 1000000) {
    ctx.body = { err: 'Credits Must be under 1,000,000' };
  }

  await db.makeTransaction(async (client) => {
    const user = (await client.query(`SELECT * FROM users WHERE username = $1`, [ username ])).rows[0];
    await client.query(`
      UPDATE users SET credits = $1 WHERE username = $2`,
    [
      Number(user.credits) + Number(credits),
      username,
    ]
    );
    await client.query(`
      INSERT INTO credit_transfers (user_id, credits_received, event, transfer_date)
        VALUES ($1, $2, $3, $4)
    `,
    [
      user.id,
      credits,
      'Admin add',
      new Date(),
    ]
    );
  });
  ctx.body = { msg: `Successfuly added ${credits} credits to user ${username}}` };
});

// AJAX post approve transfer
router.post('/approve', async (ctx, next) => {
  assert(isObject(ctx.request.body), 'Post /approve has no body', 103);
  assert(typeof ctx.request.body.id === 'string' && Number(ctx.request.body.id), 'Post /approve body has no id', 104);

  const id = ctx.request.body.id;

  assert(id != null, 'No id in post /approve', 105);

  await db.makeTransaction(async (client) => {
    const transfer = (await client.query('SELECT * FROM credit_transfers WHERE id = $1', [ id ])).rows[0];
    assert(isObject(transfer), 'Post /approve transfer not found', 106);
    const user = (await client.query('SELECT * FROM users WHERE id = $1', [ transfer.user_id ])).rows[0];
    assert(isObject(user), 'Post /approve user not found', 107);
    await client.query(`UPDATE users SET credits = $1 WHERE id = $2`, [ Number(transfer.credits_received) + Number(user.credits), transfer.user_id ]);
    await client.query(`UPDATE credit_transfers SET approved = true WHERE id = $1`, [ transfer.id ]);
  });
  ctx.body = '';
});

// POST admin
router.post('/admin', async (ctx, next) => {
  trace(`POST '/admin'`);

  assert(isObject(ctx.request.body), 'Post /admin has no body', 108);

  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  assert(typeof ctx.request.body.username === 'string', 'Post /admin body has no username', 109);
  assert(typeof ctx.request.body.password === 'string', 'Post /admin body has no password', 110);

  const user = (await db.query(`
    SELECT u.salt, u.password FROM roles AS r
      JOIN backoffice_users_roles AS ur
      ON r.id = ur.role_id
      JOIN backoffice_users AS u
      ON u.id = ur.backoffice_user_id
      WHERE u.username = $1;
    `, username
  ))[0];
  assert(isObject(user), 'Post /admin user not found', 111);

  if (user == null) {
    await ctx.render('admin_login', { error: 'Invalid log in information' });
    return next();
  }

  const saltedPassword = password + user.salt;
  const isPassCorrect = await bcrypt.compare(saltedPassword, user.password);

  if (isPassCorrect) {
    ctx.session.admin = true;
    ctx.session.roles = (await db.query(`
      SELECT r.role FROM roles AS r
        JOIN backoffice_users_roles AS ur
        ON r.id = ur.role_id
        JOIN backoffice_users AS u
        ON u.id = ur.backoffice_user_id
        WHERE u.username = $1;
      `, username
    )).map((r) => r.role);
    assert(isObject(ctx.session.roles), 'Post /admin user has no roles', 112);
    return ctx.redirect('/admin');
  }

  await ctx.render('/admin_login', { error: 'Invalid log in information' });
});

// POST register
router.post('/register', async (ctx, next) => {
  trace(`POST '/register'`);

  assertUser(
    typeof ctx.request.body.username === 'string' &&
    typeof ctx.request.body.email === 'string' &&
    typeof ctx.request.body.password === 'string' &&
    typeof ctx.request.body['repeat-password'] === 'string',
    'Invalid information',
    20
  );

  const username = ctx.request.body.username;
  const email = ctx.request.body.email.toLowerCase();
  const password = ctx.request.body.password;
  const repeatPassword = ctx.request.body['repeat-password'];

  const salt = generateRandomString(SALT_LENGTH);

  if (!validateEmail(email)) {
    await ctx.render('register', {
      error: 'Invalid Email',
      username,
      email,
    });
    return next();
  }

  if (password !== repeatPassword) {
    await ctx.render('register', {
      error: 'Passwords must match',
      username,
      email,
    });
    return next();
  }

  if (
    password.length < MINIMUM_PASSWORD_LENGTH ||
      username.length < MINIMUM_USERNAME_LENGTH
  ) {
    await ctx.render('register', {
      error: 'username and password must be around 4 symbols',
      username,
      email,
    });
    return next();
  }

  const user = (await db.query(`SELECT * FROM users WHERE username = $1 or email = $2`, username, email))[0];

  if (user != null) {
    if (user.username === username) {
      await ctx.render('register', {
        error: 'a user with this username already exists',
        username,
        email,
      });
      return next();
    } else {
      await ctx.render('register', {
        error: 'a user with this email already exists',
        username,
        email,
      });
      return next();
    }
  }

  const saltedPassword = password + salt;
  const hash = await bcrypt.hash(saltedPassword, SALT_ROUNDS);

  db.query(
    `INSERT INTO users (date_registered, password, email, username, salt)
      VALUES ($1, $2, $3, $4, $5)`,
    new Date(),
    hash,
    email,
    username,
    salt
  );

  await ctx.render('login', { msg: 'Successfuly Registered' });
});

// POST login
router.post('/login', async (ctx, next) => {
  trace(`POST '/login'`);

  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  const user = (await db.query(`SELECT * FROM users where username = $1`, username))[0];

  if (user == null) {
    await ctx.render('login', { error: 'No user registered with given username' });
    return next();
  }

  const saltedPassword = password + user.salt;
  const isPassCorrect = await bcrypt.compare(saltedPassword, user.password);

  if (isPassCorrect) {
    ctx.session.user = user.username;
    ctx.redirect('/home');
  } else {
    await ctx.render('login', { error: 'Invalid Password' });
  }
});

// POST generate API key
router.post('/api/generateAPIKey', generateAPIKey);

// GET delete key
router.get('/api/del/:key', deleteAPIKey);

// POST forecast
router.post('/api/forecast', getForecast);

app.use(router.routes());

module.exports = server;

// // GET timer
// router.get('/timer', async (ctx, next) => {
//   trace(`GET '/timer'`);

//   const date1 = new Date();
//   const city = await db.query(`select * from cities where name = 'Houston'`);
//   const date2 = new Date();

//   console.log(city);
//   console.log(date2 - date1);

//   await ctx.redirect('/home');
// });

// (async () => {
//   const salt = generateRandomString(SALT_LENGTH);
//   const saltedPassword = 'admin' + salt;
//   const hash = await bcrypt.hash(saltedPassword, SALT_ROUNDS);
//   await db.query(`insert into backoffice_users (username, password, salt) values ('admin', $1, $2)`, hash, salt);
// })();

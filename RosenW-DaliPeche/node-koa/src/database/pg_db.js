const { Pool } = require('pg');
const { AppError } = require('./../asserts/exceptions.js');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'forecast',
  password: '1234',
  port: 5432,
});

pool.on('error', (err, client) => {
  throw new AppError(`Unexpected error on idle client: ${err}`, 17);
});

const query = async (sql, ...values) => {
  const client = await pool.connect();
  try {
    return (await client.query(sql, values)).rows;
  } catch (err) {
    throw new AppError(`Error while querying: ${err}`, 18);
  } finally {
    client.release();
  }
};

const insert = async (table, data) => {
  const wholeStatement = `
      INSERT INTO ${table} (${Object.keys(data).join(', ')})
      VALUES (${Object.values(data).map((v, index) => `$${index + 1}`).join(', ')})
    `;

  return client.query(wholeStatement, Object.values(data));
};

const del = async (table, where) => {
  const whereStatement = buildWhereStatement(Object.keys(where));
  const wholeStatement = `DELETE FROM ${table} ${whereStatement}`;

  return client.query(wholeStatement, Object.values(where));
};

const update = async (table, updateData, where) => {
  let index = 0;

  const updateStatement = Object.keys(updateData).map((key) => `${key} = $${++index}`).join(', ');
  const whereStatement = buildWhereStatement(Object.keys(where), '=', index);
  const wholeStatement = `
      UPDATE ${table}
      SET ${updateStatement}
      ${whereStatement}
    `;

  return client.query(wholeStatement, Object.values(updateData).concat(Object.values(where)));
};

const close = async () => {
  await client.end();
};

const buildWhereStatement = (whereKeys, operator = '=', index = 0) => {
  let whereStatement = '';
  let first = true;
  for (const key of whereKeys) {
    if (first) {
      whereStatement += `WHERE ${key} ${operator} $${++index}`;
      first = false;
    } else {
      whereStatement += ` AND ${key} ${operator} $${++index}`;
    }
  }
  return whereStatement;
}

async function makeTransaction (func) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('BEGIN');
    await func(client);
    // assert ?
    await client.query('COMMIT');
    console.log('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('ROLLBACK');
    throw new AppError(`Error while making a transaction: ${err}`, 19);
  } finally {
    client.release();
  }
}

module.exports = { query, makeTransaction };

require('../lib/loadEnv').loadEnv();

const { Pool } = require('pg');

function sslConfig() {
  if (String(process.env.PGSSLMODE || '').toLowerCase() === 'disable') return false;
  return { rejectUnauthorized: false };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to check Azure PostgreSQL connectivity.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(),
    max: 1,
  });

  try {
    const result = await pool.query('SELECT current_database() AS database, current_user AS user, NOW() AS time');
    const row = result.rows[0];
    console.log(JSON.stringify({
      status: 'ok',
      provider: 'azure-postgresql',
      database: row.database,
      user: row.user,
      time: row.time,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: 'error',
    provider: 'azure-postgresql',
    message: err.message,
  }, null, 2));
  process.exit(1);
});

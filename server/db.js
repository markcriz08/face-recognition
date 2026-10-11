const { Pool } = require('pg');
const path = require('path');

// Force loading the root .env file regardless of current working directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
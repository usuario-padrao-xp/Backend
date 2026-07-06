
  const { Pool } = require('pg');
  require('dotenv').config();
  
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  pool.on('error', (err) => {
    console.error('❌ Erro no pool PostgreSQL:', err.message);
  });
  
  const query = async (text, params) => {
    const start = Date.now();
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`⚠️ Query lenta (${duration}ms): ${text.substring(0, 100)}...`);
      }
      return res;
    } catch (err) {
      console.error('❌ Erro na query:', err.message);
      console.error('SQL:', text.substring(0, 200));
      throw err;
    }
  };
  
  module.exports = { query, pool };
  

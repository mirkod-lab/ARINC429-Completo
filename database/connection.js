const mysql = require('mysql2/promise');

function createPool(env = process.env) {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables de conexión MySQL: ${missing.join(', ')}`);
  }

  return mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: 'Z'
  });
}

module.exports = { createPool };

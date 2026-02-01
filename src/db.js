const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL not set. Database features will fail until configured.");
}

const sslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.DB_POOL_MAX || 1),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    })
  : null;

module.exports = { pool };

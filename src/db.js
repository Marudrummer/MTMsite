const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL not set. Database features will fail until configured.");
}

const sslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
    })
  : null;

module.exports = { pool };

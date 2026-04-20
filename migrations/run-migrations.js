// Use CommonJS imports since this is a standalone script
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', envFile) });
dotenv.config(); // fallback to .env if the above didn't set everything

const { Pool } = pg;

// Get the directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a connection pool
const pool = new Pool({
  user: process.env.VITE_DB_USER,
  host: process.env.VITE_DB_HOST,
  database: process.env.VITE_DB_NAME,
  password: process.env.VITE_DB_PASSWORD,
  port: parseInt(process.env.VITE_DB_PORT || '5432'),
  ssl: process.env.VITE_DB_SSL === 'true'
    ? true
    : (process.env.VITE_DB_SSL === 'no-verify'
      ? { rejectUnauthorized: false }
      : false)
});

export async function runMigration() {
  // Get a client from the pool
  const client = await pool.connect();

  try {
    // Get all SQL migration files in alphabetical order
    const migrationsDir = __dirname;
    const files = await fs.promises.readdir(migrationsDir);
    const sqlFiles = files
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort alphabetically to ensure correct order

    console.log(`Found ${sqlFiles.length} migration files to run:`, sqlFiles);

    // Run each migration file in order, with its own transaction
    for (const file of sqlFiles) {
      console.log(`Running migration: ${file}`);
      const sqlPath = path.join(migrationsDir, file);
      const sql = await fs.promises.readFile(sqlPath, 'utf8');

      try {
        // Start a transaction for this migration
        await client.query('BEGIN');

        // Run the migration
        await client.query(sql);

        // Commit the transaction
        await client.query('COMMIT');
        console.log(`Migration ${file} completed successfully`);
      } catch (error) {
        // Rollback this migration's transaction on error
        await client.query('ROLLBACK');
        console.error(`Migration ${file} failed:`, error);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
    return true;
  } finally {
    // Release the client back to the pool
    client.release();
  }
}

// Run directly if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration()
    .then(() => pool.end())
    .catch(err => {
      console.error('Migration script error:', err);
      pool.end();
      process.exit(1);
    });
}
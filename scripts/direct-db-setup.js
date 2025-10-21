/**
 * Direct Database Setup for GitHub Actions
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database config
const config = {
  user: 'admin',
  host: 'localhost',
  database: 'recurse_bookings_test',
  password: 'password',
  port: 5432,
  ssl: false
};

console.log('GitHub Actions Direct Database Setup');
console.log('Connecting with config:', { ...config, password: '******' });

async function setupDatabase() {
  const client = new pg.Client(config);

  try {
    await client.connect();
    console.log('Connected to database successfully');

    // Test the connection
    const result = await client.query('SELECT NOW()');
    console.log('Database test query successful:', result.rows[0].now);

    // Check if tables exist
    const tablesExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);

    if (!tablesExist.rows[0].exists) {
      console.log('Tables do not exist, running migrations...');

      // List migration files in directory
      const migrationsDir = path.join(__dirname, '..', 'migrations');
      console.log('Checking migrations directory:', migrationsDir);

      const files = fs.readdirSync(migrationsDir);
      console.log('Files in migrations directory:', files);

      // Find the migration files (those that end with .sql)
      let migrationFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort();

      if (migrationFiles.length === 0) {
        throw new Error('Migration files not found in directory');
      }

      // Run the migrations
      for (const migrationFile of migrationFiles) {
        const migrationFilePath = path.join(migrationsDir, migrationFile);
        console.log('Using migration file:', migrationFilePath);

        const migrationSQL = fs.readFileSync(migrationFilePath, 'utf8');

        console.log('Running migration script...');
        await client.query(migrationSQL);
        console.log('Migration completed successfully');
      }
    } else {
      console.log('Tables already exist, skipping migrations');
    }

    // Set up test users
    console.log('Setting up test users...');
    await client.query(`
      INSERT INTO users (id, recurse_id, email, name, access_token)
      VALUES
        (1, 12345, 'alice@example.com', 'Alice Tester', 'mock-token-alice'),
        (2, 67890, 'bob@example.com', 'Bob Reviewer', 'mock-token-bob')
      ON CONFLICT (id) DO UPDATE
      SET recurse_id = EXCLUDED.recurse_id,
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          access_token = EXCLUDED.access_token
    `);

    // Set up test rooms
    console.log('Setting up test rooms...');
    await client.query(`
      INSERT INTO rooms (id, name, capacity)
      VALUES
        (1, 'Green Phone Room', 1),
        (2, 'Lovelace', 4)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          capacity = EXCLUDED.capacity
    `);

    // Verify setup
    const usersResult = await client.query('SELECT id, name FROM users');
    console.log('Users in database:', usersResult.rows);

    const roomsResult = await client.query('SELECT id, name FROM rooms');
    console.log('Rooms in database:', roomsResult.rows);

    console.log('Database setup completed successfully');
  } catch (error) {
    console.error('Database setup error:', error);
    console.error('Error details:', error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase();
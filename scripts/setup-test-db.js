/**
 * Test Database Setup Script
 *
 * This script prepares the database environment for running tests.
 * It ensures:
 * 1. The test database exists and is created if needed
 * 2. The database tables are created
 * 3. Test users are created
 * 4. Test rooms are created if none exist
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Set NODE_ENV to test to ensure we're using test configuration
process.env.NODE_ENV = 'test';

// Detect GitHub Actions environment
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
if (isGitHubActions) {
  console.log('Detected GitHub Actions environment');
}

// Get the directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test environment variables
console.log('Loading test environment variables from .env.test');
dotenv.config({ path: path.resolve(__dirname, '..', '.env.test') });

// Constants
const TEST_USERS = [
  {
    id: 1,
    name: 'Alice Tester',
    email: 'alice@example.com',
    recurse_id: 12345,
    access_token: 'mock-token-alice'
  },
  {
    id: 2,
    name: 'Bob Reviewer',
    email: 'bob@example.com',
    recurse_id: 67890,
    access_token: 'mock-token-bob'
  }
];

// List migration files in directory
const migrationsDir = path.join(__dirname, '..', 'migrations');
console.log('Checking migrations directory:', migrationsDir);

const files = fs.readdirSync(migrationsDir);
console.log('Files in migrations directory:', files);

// Find the migration files (those that end with .sql)
let migrationFiles = files
  .filter(file => file.endsWith('.sql'))
  .sort();

// Log database connection details (excluding password)
console.log('Database connection details:');
console.log(`- User: ${process.env.VITE_DB_USER}`);
console.log(`- Host: ${process.env.VITE_DB_HOST}`);
console.log(`- Database: ${process.env.VITE_DB_NAME}`);
console.log(`- Port: ${process.env.VITE_DB_PORT}`);
console.log(`- SSL: ${process.env.VITE_DB_SSL === 'true' ? 'enabled' : 'disabled'}`);
console.log(`- GitHub Actions: ${isGitHubActions ? 'yes' : 'no'}`);

// Create a PostgreSQL connection pool for admin operations
// In GitHub Actions, we can skip this step because the database is created via psql
const adminConfig = {
  user: process.env.VITE_DB_USER,
  host: process.env.VITE_DB_HOST,
  database: 'postgres', // Connect to default postgres database first
  password: process.env.VITE_DB_PASSWORD,
  port: parseInt(process.env.VITE_DB_PORT || '5432'),
  ssl: process.env.VITE_DB_SSL === 'true' ? { rejectUnauthorized: true } : false
};

console.log('Admin pool config:', { ...adminConfig, password: '******' });
const adminPool = new pg.Pool(adminConfig);

async function setupTestDatabase() {
  console.log('Setting up test database environment...');

  try {
    // Skip database creation in GitHub Actions since it's already created via psql in the workflow
    if (!isGitHubActions) {
      // First check if our test database exists and create it if not
      console.log('Connecting to admin database to check/create test database...');
      const adminClient = await adminPool.connect();
      try {
        console.log(`Checking if test database ${process.env.VITE_DB_NAME} exists...`);
        const dbCheck = await adminClient.query(`
          SELECT 1 FROM pg_database WHERE datname = $1
        `, [process.env.VITE_DB_NAME]);

        if (dbCheck.rows.length === 0) {
          console.log(`Creating test database ${process.env.VITE_DB_NAME}...`);
          // Need to use template0 to avoid encoding issues
          await adminClient.query(`CREATE DATABASE ${process.env.VITE_DB_NAME} TEMPLATE template0`);
          console.log('Test database created successfully');
        } else {
          console.log('Test database already exists');
        }
      } catch (error) {
        console.error('Error checking/creating database:', error.message);
        // If the database might have been created in the workflow
        console.log('Continuing with setup assuming database exists...');
      } finally {
        adminClient.release();
      }
    } else {
      console.log('Skipping database creation check in GitHub Actions, assuming database was created in workflow');
    }

    // Now connect to the test database to set up tables and data
    const testConfig = {
      user: process.env.VITE_DB_USER,
      host: process.env.VITE_DB_HOST,
      database: process.env.VITE_DB_NAME, // Now connect to the test database
      password: process.env.VITE_DB_PASSWORD,
      port: parseInt(process.env.VITE_DB_PORT || '5432'),
      ssl: process.env.VITE_DB_SSL === 'true' ? { rejectUnauthorized: true } : false
    };

    console.log('Test pool config:', { ...testConfig, password: '******' });
    const testPool = new pg.Pool(testConfig);

    console.log('Connecting to test database...');
    const client = await testPool.connect();
    console.log(`Connected to test database ${process.env.VITE_DB_NAME}`);

    try {
      // Verify connection with simple query
      const testQuery = await client.query('SELECT NOW()');
      console.log(`Test query successful: ${testQuery.rows[0].now}`);

      // Check if tables exist
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'users'
        );
      `);

      const tablesExist = tableCheck.rows[0].exists;

      if (!tablesExist) {
        console.log('Tables do not exist, running migration...');

        for (const migrationFile of migrationFiles) {
          // Read the migration SQL file
          const filePath = path.join(migrationsDir, migrationFile);
          console.log(`Reading migration file from ${filePath}`);
          const migrationSQL = fs.readFileSync(filePath, 'utf8');

          // Run the migration
          console.log('Running SQL migration...');
          await client.query(migrationSQL);
          console.log('Migration completed');
        }
      } else {
        console.log('Tables already exist, skipping migration');
      }

      // Set up test users
      console.log('Setting up test users...');
      for (const user of TEST_USERS) {
        await client.query(`
          INSERT INTO users (id, recurse_id, email, name, access_token)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE
          SET recurse_id = $2, email = $3, name = $4, access_token = $5
        `, [user.id, user.recurse_id, user.email, user.name, user.access_token]);
        console.log(`- User ${user.name} (ID: ${user.id}) created or updated`);
      }

      // Check if we have rooms
      const roomsCheck = await client.query('SELECT COUNT(*) as count FROM rooms');
      const roomCount = parseInt(roomsCheck.rows[0].count);

      if (roomCount === 0) {
        console.log('No rooms found, creating test rooms...');

        // Create test rooms
        await client.query(`
          INSERT INTO rooms (name, description, capacity)
          VALUES ('Test Room 1', 'A test room for API tests', 4),
                 ('Test Room 2', 'Another test room for API tests', 2)
        `);
        console.log('Test rooms created');
      } else {
        console.log(`Found ${roomCount} existing rooms, skipping room creation`);
      }

      console.log('Test database setup completed successfully');
    } finally {
      client.release();
      await testPool.end();
    }
  } catch (error) {
    console.error('Error setting up test database:', error);
    console.error('Full error details:', error.stack);
    process.exit(1);
  } finally {
    await adminPool.end();
  }
}

// Run the setup
setupTestDatabase()
  .then(() => console.log('Setup completed successfully'))
  .catch(err => {
    console.error('Fatal error in setup:', err);
    process.exit(1);
  });
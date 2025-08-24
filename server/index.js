/**
 * Server Application
 *
 * Supports multiple environments:
 * - Development: Regular server for local development
 * - Test: Test server for automated tests
 * - Production: Production server with more security
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import { canDeleteBooking, authenticate, testLogin } from './auth-middleware.js';
import db from './db.js'; // Consolidated db module that handles both environments
import fs from 'fs';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine environment
const isTestEnv = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isTestEnv && !isProduction;

console.log(`Current NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

// Environment variable loading strategy based on environment
if (isTestEnv) {
  // TEST ENVIRONMENT: Load from .env.test
  console.log('Loading test environment variables from .env.test');
  const testEnvPath = path.resolve(__dirname, '..', '.env.test');
  dotenv.config({ path: testEnvPath });
} else if (isDevelopment) {
  // DEVELOPMENT ENVIRONMENT: Load from .env.local or .env.example
  console.log('Loading development environment variables');

  // Clear any existing environment variables that might conflict
  ['VITE_RECURSE_CLIENT_ID', 'VITE_RECURSE_CLIENT_SECRET', 'VITE_OAUTH_REDIRECT_URI'].forEach(key => {
    if (process.env[key]) {
      console.log(`Clearing existing ${key}`);
      delete process.env[key];
    }
  });

  // First try to load .env.local (highest priority)
  const localEnvPath = path.resolve(__dirname, '..', '.env.local');
  const localEnvResult = dotenv.config({ path: localEnvPath });
  if (localEnvResult.error) {
    console.log('No .env.local found or error loading it:', localEnvResult.error.message);

    // As a fallback, try to load from .env.example
    const exampleEnvPath = path.resolve(__dirname, '..', '.env.example');
    if (fs.existsSync(exampleEnvPath)) {
      console.log('Falling back to .env.example as a template');
      dotenv.config({ path: exampleEnvPath });
    }
  } else {
    console.log('Successfully loaded environment from .env.local');
  }
} else {
  // PRODUCTION ENVIRONMENT: Use environment variables provided by Railway
  console.log('Using production environment variables from Railway');
}

// Check and log critical environment variables
console.log('\n=== OAuth Configuration ===');
if (!process.env.VITE_RECURSE_CLIENT_ID) {
  console.error('ERROR: Missing VITE_RECURSE_CLIENT_ID');
} else {
  console.log(`Client ID: ${process.env.VITE_RECURSE_CLIENT_ID.substring(0, 8)}...`);
}

if (!process.env.VITE_RECURSE_CLIENT_SECRET) {
  console.error('ERROR: Missing VITE_RECURSE_CLIENT_SECRET');
} else {
  console.log(`Client Secret: Present`);
}

if (!process.env.VITE_OAUTH_REDIRECT_URI) {
  console.error('ERROR: Missing VITE_OAUTH_REDIRECT_URI');
} else {
  console.log(`Redirect URI: ${process.env.VITE_OAUTH_REDIRECT_URI}`);
}
console.log('========================\n');

// Set up the Express app
const app = express();
const PORT = isTestEnv ? (process.env.TEST_PORT || 3001) : (process.env.PORT || 3000);

// Configure CORS to allow requests from our frontend
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://recurse-bookings-production.up.railway.app',
    'https://phoneroom.recurse.com'
  ],
  credentials: true
}));

// Body parsing middleware
app.use(express.json());

// Cookie parsing middleware
app.use(cookieParser());

// Log environment variables
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`OAuth Redirect URI: ${process.env.VITE_OAUTH_REDIRECT_URI}`);
if (isTestEnv) {
  console.log(`Test server running on port ${PORT}`);
} else {
  console.log(`Server running on port ${PORT}`);
}

// Health Check endpoint - does not require authentication
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', environment: process.env.NODE_ENV });
});

// Authentication endpoints
// =======================

// OAuth callback endpoint for exchanging code for token
app.post('/api/auth/callback', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code is required' });
  }

  console.log('Processing OAuth code exchange');

  try {
    // Exchange the code for an access token with Recurse Center
    let tokenResponse;
    try {
      tokenResponse = await axios.post('https://www.recurse.com/oauth/token', {
        client_id: process.env.VITE_RECURSE_CLIENT_ID,
        client_secret: process.env.VITE_RECURSE_CLIENT_SECRET,
        redirect_uri: process.env.VITE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
        code
      });
      console.log('Successfully obtained access token');
    } catch (tokenError) {
      console.error('Error exchanging code for token:', tokenError.message);
      if (tokenError.response) {
        console.error('Token error response data:', tokenError.response.data);
      }
      return res.status(401).json({
        error: 'Failed to exchange authorization code for token',
        details: tokenError.response?.data || { error: 'unknown_error' }
      });
    }

    const { access_token } = tokenResponse.data;

    // Get user info from Recurse API
    let userResponse;
    try {
      console.log('Attempting to fetch user profile from Recurse API');
      userResponse = await axios.get('https://www.recurse.com/api/v1/profiles/me', {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      });
      console.log('Successfully received user profile response');
    } catch (profileError) {
      console.error('Error fetching user profile:', profileError.message);
      return res.status(500).json({ error: 'Failed to fetch user profile from Recurse Center' });
    }

    const userData = userResponse.data;
    console.log('Retrieved user profile for:', userData.email);

    // Create or update user in our database
    try {
      console.log('Attempting to save user to database with recurse_id:', userData.id);

      // First check if user with this recurse_id already exists
      const userCheck = await db.query('SELECT * FROM users WHERE recurse_id = $1', [userData.id]);

      let dbUser;
      if (userCheck.rows.length > 0) {
        // Update existing user
        console.log('Found existing user, updating...');
        const updateResult = await db.query(
          `UPDATE users
           SET email = $2, name = $3, access_token = $4, updated_at = CURRENT_TIMESTAMP
           WHERE recurse_id = $1
           RETURNING id, recurse_id, email, name`,
          [userData.id, userData.email, userData.name, access_token]
        );
        dbUser = updateResult.rows[0];
      } else {
        // Insert new user with auto-generated ID
        console.log('No existing user found, creating new user...');
        const insertResult = await db.query(
          `INSERT INTO users (recurse_id, email, name, access_token)
           VALUES ($1, $2, $3, $4)
           RETURNING id, recurse_id, email, name`,
          [userData.id, userData.email, userData.name, access_token]
        );
        dbUser = insertResult.rows[0];
      }

      console.log('User data saved to database, ID:', dbUser.id);

      // Set the auth_token cookie for authenticated API requests
      res.cookie('auth_token', access_token, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax', // Allow cross-site requests from same-site navigation
        secure: process.env.NODE_ENV === 'production' // Only use secure in production
      });

      // Return user data to frontend
      res.json({
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        recurseId: dbUser.recurse_id,
        accessToken: access_token
      });
    } catch (dbError) {
      console.error('Database error during user save:', dbError.message);
      return res.status(500).json({ error: 'Failed to save user data to database', details: dbError.message });
    }
  } catch (error) {
    console.error('Unhandled OAuth error:', error.message);
    res.status(500).json({
      error: 'A server error occurred during authentication',
      details: { error: 'server_error' }
    });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.status(200).json({ message: 'Logged out successfully' });
});

// Test-only endpoints (only available in development and test modes)
if (process.env.NODE_ENV !== 'production') {
  // Login endpoint for tests
  app.post('/api/auth/test-login', testLogin);

  // Test user setup endpoint
  app.post('/api/test/setup-users', async (req, res) => {
    const { users } = req.body || { users: [] };

    try {
      for (const user of users) {
        // Check if user exists
        const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [user.id]);

        if (userCheck.rows.length === 0) {
          // Create the user with a test token that's predictable
          await db.query(
            `INSERT INTO users (id, recurse_id, email, name, access_token)
             VALUES ($1, $2, $3, $4, $5)`,
            [user.id, user.recurse_id, user.email, user.name, `test-token-${user.id}`]
          );
          console.log(`Created test user: ${user.name} (ID: ${user.id})`);
        } else {
          console.log(`Test user already exists: ${user.name} (ID: ${user.id})`);
        }
      }
      res.status(200).json({ message: 'Test users set up successfully' });
    } catch (error) {
      console.error('Error setting up test users:', error);
      res.status(500).json({ error: 'Failed to set up test users' });
    }
  });

  // Test cleanup endpoint - safely removes test resources
  app.post('/api/test/cleanup', async (req, res) => {
    // This endpoint is ONLY available in test mode for safety
    if (process.env.NODE_ENV !== 'test') {
      return res.status(403).json({
        error: 'This endpoint is only available in test mode'
      });
    }

    // Safety check: require testOnly parameter to be true
    const { testOnly } = req.body;
    if (testOnly !== true) {
      return res.status(400).json({
        error: 'For safety, the testOnly parameter must be set to true'
      });
    }

    try {
      console.log('Starting test resource cleanup...');

      // Begin transaction for atomic cleanup
      await db.query('BEGIN');

      // 1. Delete all bookings for test users (IDs 1 and 2)
      const deleteBookingsResult = await db.query(
        'DELETE FROM bookings WHERE user_id IN (1, 2) RETURNING id'
      );
      const deletedBookingIds = deleteBookingsResult.rows.map(row => row.id);
      console.log(`Deleted ${deleteBookingsResult.rowCount} test bookings: ${deletedBookingIds.join(', ') || 'none'}`);

      // We'll preserve rooms since they're shared test fixtures
      // But we can report which ones exist for informational purposes
      const roomsResult = await db.query('SELECT id, name FROM rooms');
      console.log(`Test rooms (preserved): ${roomsResult.rows.map(r => `${r.id}:${r.name}`).join(', ')}`);

      // Commit the transaction
      await db.query('COMMIT');

      // Return success with details
      res.status(200).json({
        message: 'Test resources cleaned up successfully',
        details: {
          bookings: {
            deleted: deleteBookingsResult.rowCount,
            ids: deletedBookingIds
          },
          rooms: {
            preserved: roomsResult.rowCount,
            ids: roomsResult.rows.map(r => r.id)
          }
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      console.error('Error during test cleanup:', error);
      res.status(500).json({
        error: 'Failed to clean up test resources',
        details: error.message
      });
    }
  });

  // Test endpoint to echo cookies and headers for debugging
  app.get('/api/test/debug-auth', (req, res) => {
    console.log('Debug auth headers:', req.headers);
    res.json({
      cookies: req.cookies,
      headers: {
        cookie: req.headers.cookie,
        authorization: req.headers.authorization
      },
      user: req.user || null
    });
  });
}

// In test mode, add extra debug information
if (process.env.NODE_ENV === 'test') {
  app.use((req, res, next) => {
    console.log(`[TEST] ${req.method} ${req.path} - Auth token: ${req.cookies?.auth_token ? 'Present' : 'Missing'}`);
    next();
  });
}

// API routes
// ==========

// API route to get rooms
app.get('/api/rooms', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM rooms ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// API route to get bookings
app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    const { user_id } = req.query;

    let query = `
      SELECT b.*, r.name as room_name, u.email as user_email, u.name as user_name
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN users u ON b.user_id = u.id
    `;

    const params = [];

    if (user_id) {
      query += ` WHERE b.user_id = $1`;
      params.push(user_id);
    }

    query += ` ORDER BY b.start_time`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// API route to create a booking
app.post('/api/bookings', authenticate, async (req, res) => {
  const { room_id, start_time, end_time, notes } = req.body;
  // Get user_id from authenticated user
  const user_id = req.user.id;

  try {
    // Check for booking conflicts
    const conflictCheck = await db.query(
      `SELECT COUNT(*) as count
       FROM bookings
       WHERE room_id = $1
       AND $2 < end_time
       AND $3 > start_time`,
      [room_id, start_time, end_time]
    );

    if (parseInt(conflictCheck.rows[0].count) > 0) {
      return res.status(409).json({ error: 'This time slot is already booked' });
    }

    // Create the booking
    const result = await db.query(
      `INSERT INTO bookings (user_id, room_id, start_time, end_time, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, room_id, start_time, end_time, notes]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// API route to check booking availability
app.get('/api/bookings/check-availability', authenticate, async (req, res) => {
  const { room_id, start_time, end_time } = req.query;

  try {
    const result = await db.query(
      `SELECT COUNT(*) as count
       FROM bookings
       WHERE room_id = $1
       AND $2 < end_time
       AND $3 > start_time`,
      [room_id, new Date(start_time), new Date(end_time)]
    );

    res.json({ available: parseInt(result.rows[0].count) === 0 });
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// API route to delete a booking
app.delete('/api/bookings/:id', canDeleteBooking, async (req, res) => {
  const bookingId = req.params.id;

  try {
    // The canDeleteBooking middleware has already checked if the booking exists
    // and if the user has permission to delete it, so we can proceed with deletion

    // Delete the booking
    await db.query(
      'DELETE FROM bookings WHERE id = $1',
      [bookingId]
    );

    res.status(200).json({ message: 'Booking deleted successfully' });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// Serve static files from the frontend build directory
const staticPath = path.join(__dirname, '..', 'dist');
console.log(`Serving static files from: ${staticPath}`);
app.use(express.static(staticPath));

// Catch all API routes that haven't been matched and return 404
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Catch-all route to handle frontend routing - serve index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  // Intentionally left blank, we've already logged the server start message
});

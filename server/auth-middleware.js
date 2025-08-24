// Authentication Middleware for the Booking API
// This provides a production-like authentication flow for both environments

import db from './db.js';

// Function to get the user from the request
async function getUserFromRequest(req) {
  // Cookie-based authentication for both production and test environments
  const token = req.cookies?.auth_token;

  if (!token) {
    return null;
  }

  try {
    // Find the user with this token
    const result = await db.query(
      'SELECT * FROM users WHERE access_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting user from token:', error);
    return null;
  }
}

// Middleware to check if a user can delete a booking
export async function canDeleteBooking(req, res, next) {
  const user = await getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const bookingId = req.params.id;

  if (!bookingId) {
    return res.status(400).json({ error: 'Booking ID is required' });
  }

  try {
    // Check if the booking exists and belongs to the user
    const result = await db.query(
      'SELECT * FROM bookings WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Check if the user owns this booking
    if (booking.user_id !== user.id) {
      return res.status(403).json({
        error: 'You are not authorized to delete this booking'
      });
    }

    // User is authorized to delete this booking
    // Add the user to the request
    req.user = user;
    next();
  } catch (error) {
    console.error('Error in canDeleteBooking middleware:', error);
    res.status(500).json({ error: 'Server error checking booking permissions' });
  }
}

// Authentication middleware
export async function authenticate(req, res, next) {
  const user = await getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Add the user to the request
  req.user = user;
  next();
}

// Login middleware for tests
export async function testLogin(req, res) {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: 'Endpoint not found' });
  }

  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Find the user with this email
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // In a real application, we would verify the password here
    // For test purposes, we won't require a real password

    // Set a cookie with the access token
    res.cookie('auth_token', user.access_token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict'
    });

    // Return the user data
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      recurseId: user.recurse_id
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
}
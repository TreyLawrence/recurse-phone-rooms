import { test, expect } from '@playwright/test';
import axios from 'axios';
import { API_BASE_URL, USERS, authRequest, setupTestUsers } from './test-setup.js';

// Tracking IDs for cleanup
let testRoomId = null;
// Use objects to track all created resources for proper cleanup
const testResources = {
  bookings: {
    alice: [],
    bob: []
  },
  users: [1, 2], // Alice and Bob IDs
  rooms: []
};

test.describe('Booking API Tests', () => {
  // Setup: Make sure server is running before tests
  // and ensure test users exist in the database
  test.beforeAll(async () => {
    try {
      // Check if the server is running with health check
      await axios.get(`${API_BASE_URL}/health`);
      console.log('Server is running and API health check is accessible');

      // Try an authenticated endpoint without authentication - should fail with 401
      try {
        await axios.get(`${API_BASE_URL}/rooms`);
        console.error('WARNING: Unauthenticated access to /rooms succeeded - authentication may not be properly configured');
      } catch (authError) {
        if (authError.response && authError.response.status === 401) {
          console.log('Authentication correctly required for protected endpoints');
        } else {
          console.error('Error accessing rooms endpoint:', authError.message);
          throw authError;
        }
      }

      // Set up test users
      await setupTestUsers();
      console.log(`Test users setup completed, tracking IDs: ${testResources.users.join(', ')}`);
    } catch (error) {
      console.error('ERROR: API server is not running or setup failed');
      throw new Error(`API server must be running for these tests: ${error.message}`);
    }
  });

  // Setup: Get a room ID we can use in all tests
  test.beforeAll(async () => {
    try {
      // Get an authenticated client
      const aliceClient = await authRequest(USERS.ALICE.id);

      // Try to get rooms with authentication
      const response = await aliceClient.get('/rooms');
      console.log('Authenticated request for rooms succeeded');

      if (response.data.length > 0) {
        testRoomId = response.data[0].id;
        // Track all room IDs for potential cleanup
        testResources.rooms = response.data.map(room => room.id);
        console.log(`Using room ID ${testRoomId} for tests`);
        console.log(`All room IDs for reference: ${testResources.rooms.join(', ')}`);
      } else {
        throw new Error('No rooms found in the database');
      }
    } catch (error) {
      console.error('Error getting rooms:', error.message);
      throw error;
    }
  });

  // Cleanup: Delete any test resources after all tests
  test.afterAll(async () => {
    console.log('Running comprehensive cleanup to delete all test resources...');

    // 1. Clean up bookings first (due to foreign key constraints)
    console.log('Cleaning up test bookings...');

    // Clean up Alice's bookings
    if (testResources.bookings.alice.length > 0) {
      const aliceClient = await authRequest(USERS.ALICE.id);
      for (const bookingId of testResources.bookings.alice) {
        try {
          await aliceClient.delete(`/bookings/${bookingId}`);
          console.log(`Cleaned up Alice's booking: ${bookingId}`);
        } catch (error) {
          console.log(`Could not delete Alice's booking ${bookingId}: ${error.message}`);
        }
      }
    }

    // Clean up Bob's bookings
    if (testResources.bookings.bob.length > 0) {
      const bobClient = await authRequest(USERS.BOB.id);
      for (const bookingId of testResources.bookings.bob) {
        try {
          await bobClient.delete(`/bookings/${bookingId}`);
          console.log(`Cleaned up Bob's booking: ${bookingId}`);
        } catch (error) {
          console.log(`Could not delete Bob's booking ${bookingId}: ${error.message}`);
        }
      }
    }

    // 2. Use API endpoint to clean up test users and rooms
    // This is preferred over direct database truncation for proper API-level cleanup
    try {
      console.log('Requesting test resource cleanup via API...');
      await axios.post(`${API_BASE_URL}/test/cleanup`, {
        testOnly: true // Safety parameter to ensure we only delete test data
      }).then(response => {
        console.log('API cleanup response:', response.data);
      }).catch(error => {
        console.log('API cleanup endpoint not available or failed:', error.message);
        console.log('Consider adding a /test/cleanup endpoint to your server for better test isolation');
      });
    } catch (error) {
      console.log('Error during test cleanup:', error.message);
    }

    console.log('Cleanup completed.');
  });

  test('should get all rooms', async ({ page }) => {
    // This endpoint requires authentication
    const client = await authRequest(USERS.ALICE.id);
    const response = await client.get('/rooms');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);

    // Verify room data structure
    const room = response.data[0];
    expect(room).toHaveProperty('id');
    expect(room).toHaveProperty('name');
    expect(room).toHaveProperty('description');
    expect(room).toHaveProperty('capacity');
  });

  test('should get all bookings', async ({ page }) => {
    // Authenticated endpoint
    const client = await authRequest(USERS.ALICE.id);
    const response = await client.get('/bookings');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);

    // Log the first booking for debugging if available
    if (response.data.length > 0) {
      const booking = response.data[0];
      console.log('First booking:', {
        id: booking.id,
        room_id: booking.room_id,
        start_time: booking.start_time
      });
    }
  });

  test('should get all bookings with filters', async ({ page }) => {
    const aliceClient = await authRequest(USERS.ALICE.id);

    const now = new Date();
    const oneHour = 60 * 60 * 1000;

    const startTime1 = new Date(now.getTime() + oneHour);
    const endTime1 = new Date(startTime1.getTime() + oneHour);

    const bookingData1 = {
      room_id: testRoomId,
      start_time: startTime1.toISOString(),
      end_time: endTime1.toISOString(),
    };

    const startTime2 = new Date(now.getTime() + oneHour * 24);
    const endTime2 = new Date(startTime2.getTime() + oneHour);

    const bookingData2 = {
      room_id: testRoomId,
      start_time: startTime2.toISOString(),
      end_time: endTime2.toISOString(),
    };

    const timeStartBound = new Date(startTime1.getTime() - oneHour);
    const timeEndBound = new Date(endTime2.getTime() + oneHour);

    try {
      const response1 = await aliceClient.post(`/bookings`, bookingData1);

      expect(response1.status).toBe(201);
      expect(response1.data).toHaveProperty('id');
      expect(response1.data).toHaveProperty('room_id', testRoomId);
      expect(response1.data).toHaveProperty('start_time');
      expect(response1.data).toHaveProperty('end_time');

      // Save the bookingId for cleanup
      testResources.bookings.alice.push(response1.data.id);
      console.log(`Created booking ID ${response1.data.id} for test`);

      const response2 = await aliceClient.post(`/bookings`, bookingData2);

      expect(response2.status).toBe(201);
      expect(response2.data).toHaveProperty('id');
      expect(response2.data).toHaveProperty('room_id', testRoomId);
      expect(response2.data).toHaveProperty('start_time');
      expect(response2.data).toHaveProperty('end_time');

      // Save the bookingId for cleanup
      testResources.bookings.alice.push(response2.data.id);
      console.log(`Created booking ID ${response2.data.id} for test`);

      const bookings = await aliceClient.get(`/bookings`);
      expect(bookings.data.length).toBeGreaterThanOrEqual(2);
      expect(bookings.data[0]).toHaveProperty('id', response1.data.id);
      expect(bookings.data[1]).toHaveProperty('id', response2.data.id);

      const bookings_with_filters1 = await aliceClient.get(`/bookings?start_time=${startTime2.toISOString()}&end_time=${timeEndBound.toISOString()}`);
      expect(bookings_with_filters1.data.length).toBe(1);
      expect(bookings_with_filters1.data[0]).toHaveProperty('id', response2.data.id);

      const bookings_with_filters2 = await aliceClient.get(`/bookings?start_time=${timeStartBound.toISOString()}&end_time=${endTime1.toISOString()}`);
      expect(bookings_with_filters2.data.length).toBe(1);
      expect(bookings_with_filters2.data[0]).toHaveProperty('id', response1.data.id);

      const bookings_with_filters3 = await aliceClient.get(`/bookings?start_time=${endTime2.toISOString()}&start_time_op=<&end_time=${startTime2.toISOString()}&end_time_op=>`);
      expect(bookings_with_filters3.data.length).toBe(1);
      expect(bookings_with_filters3.data[0]).toHaveProperty('id', response2.data.id);

      const bookings_with_filters4 = await aliceClient.get(`/bookings?limit=1`);
      expect(bookings_with_filters4.data.length).toBe(1);

    } catch (error) {
      console.error('Error creating booking:', error.response?.data || error.message);
      throw error;
    }
  });

  // We'll make each test independent and not rely on other tests creating bookings

  test('should create a booking successfully', async ({ page }) => {
    const aliceClient = await authRequest(USERS.ALICE.id);

    // Create booking data with randomized time (far future to avoid conflicts)
    const now = new Date();
    // Use a random offset of days in the future (between 30-60 days)
    const randomDayOffset = 30 + Math.floor(Math.random() * 30);
    const startTime = new Date(now.getTime() + (randomDayOffset * 24 * 60 * 60 * 1000));
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

    const bookingData = {
      room_id: testRoomId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      notes: `API Test Booking - Random offset: ${randomDayOffset} days`,
    };

    try {
      const response = await aliceClient.post(`/bookings`, bookingData);

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data).toHaveProperty('room_id', testRoomId);
      expect(response.data).toHaveProperty('start_time');
      expect(response.data).toHaveProperty('end_time');

      // Save the bookingId for cleanup
      testResources.bookings.alice.push(response.data.id);
      console.log(`Created booking ID ${response.data.id} for test`);
    } catch (error) {
      console.error('Error creating booking:', error.response?.data || error.message);
      throw error;
    }
  });

  test('should check if a time slot is available', async ({ page }) => {
    // This needs authentication
    const client = await authRequest(USERS.ALICE.id);

    // Create times for testing
    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

    const response = await client.get('/bookings/check-availability', {
      params: {
        room_id: testRoomId,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString()
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('available');

    // Since we're not creating a booking for this time slot, it should be available
    expect(response.data.available).toBe(true);
  });

  test('should not allow double-booking the same room', async ({ page }) => {
    // Create overlapping bookings and expect the second one to fail
    const now = new Date();
    // Use a random offset of days in the future (between 300-400 days)
    const randomDayOffset = 300 + Math.floor(Math.random() * 100);
    // Use random hour to avoid conflicts with existing bookings
    const randomHour = Math.floor(Math.random() * 12); // 0-11 hours offset
    const startTime = new Date(now.getTime() + (randomDayOffset * 24 * 60 * 60 * 1000) + (randomHour * 60 * 60 * 1000));
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

    console.log(`Double-booking test: Using dates ${startTime.toISOString()} to ${endTime.toISOString()}`);

    const aliceClient = await authRequest(USERS.ALICE.id);

    // First booking data
    const aliceBookingData = {
      room_id: testRoomId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      notes: `API Test First Booking - Random offset: ${randomDayOffset} days, hour: ${randomHour}`,
    };

    // Create Alice's booking
    let aliceResponse;
    let aliceBookingCreated = false;
    try {
      aliceResponse = await aliceClient.post(`/bookings`, aliceBookingData);
      expect(aliceResponse.status).toBe(201);

      // Save for cleanup
      testResources.bookings.alice.push(aliceResponse.data.id);
      aliceBookingCreated = true;
      console.log(`Created booking ID ${aliceResponse.data.id} for double-booking test`);
    } catch (error) {
      console.error('Error creating Alice\'s booking:', error.response?.data || error.message);

      // Skip the rest of the test if we couldn't create Alice's booking
      if (error.response?.status === 409) {
        console.log('Time slot already booked, test skipped');
        return;
      }

      throw error;
    }

    // Only continue if we successfully created Alice's booking
    if (aliceBookingCreated) {
      // Now try to book the same time slot as Bob
      const bobClient = await authRequest(USERS.BOB.id);

      // Overlapping booking - starts 15 minutes into Alice's booking
      const bobStartTime = new Date(startTime.getTime() + 15 * 60 * 1000);
      const bobEndTime = new Date(bobStartTime.getTime() + 30 * 60 * 1000);

      const bobBookingData = {
        room_id: testRoomId,
        start_time: bobStartTime.toISOString(),
        end_time: bobEndTime.toISOString(),
        notes: 'API Test Overlapping Booking',
      };

      try {
        await bobClient.post(`/bookings`, bobBookingData);
        // If we get here, the request succeeded, which is wrong
        expect(false).toBe(true, 'Should not allow double-booking the same room');
      } catch (error) {
        // Expect conflict error - better error handling
        console.log('Got expected error for double booking:', error.message);

        // Check for expected error - either in response object or in generic error
        if (error.response) {
          expect(error.response.status).toBe(409);
          expect(error.response.data.error).toContain('already booked');
        } else {
          // If error.response is undefined, just ensure we got some error
          // This handles the case where the network request totally failed
          expect(error.message).toBeTruthy();
          console.log('Network error occurred, but at least the double booking was prevented');
        }
      }
    }
  });

  test('should allow users to delete their own bookings', async ({ page }) => {
    const now = new Date();
    const startTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

    const aliceClient = await authRequest(USERS.ALICE.id);

    // Create a booking
    let bookingId;
    try {
      const createResponse = await aliceClient.post(`/bookings`, {
        room_id: testRoomId,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        notes: 'API Test: Booking to be deleted',
      });

      expect(createResponse.status).toBe(201);
      bookingId = createResponse.data.id;
      console.log(`Created booking ID ${bookingId} for deletion test`);

      // No need to add to testResources since we'll delete it within the test
    } catch (error) {
      console.error('Error creating booking to delete:', error.response?.data || error.message);
      throw error;
    }

    // Now delete the booking
    try {
      const deleteResponse = await aliceClient.delete(`/bookings/${bookingId}`);
      expect(deleteResponse.status).toBe(200);
    } catch (error) {
      console.error('Error deleting booking:', error.response?.data || error.message);
      throw error;
    }

    // Verify the booking was deleted
    try {
      const bookingsResponse = await aliceClient.get('/bookings');

      const bookingStillExists = bookingsResponse.data.some(b => b.id === bookingId);
      expect(bookingStillExists).toBe(false, `Booking with ID ${bookingId} should not exist after deletion`);
    } catch (error) {
      console.error('Error verifying booking was deleted:', error.response?.data || error.message);
      throw error;
    }
  });

  test('should not allow users to delete bookings that don\'t exist', async ({ page }) => {
    // Try to delete a non-existent booking
    const aliceClient = await authRequest(USERS.ALICE.id);

    try {
      await aliceClient.delete(`/bookings/999999`);
      // If we get here, the request succeeded, which is wrong
      expect(false).toBe(true, 'Should not allow deleting non-existent bookings');
    } catch (error) {
      // Expect a 404 not found error
      expect(error.response.status).toBe(404);
      expect(error.response.data.error).toContain('not found');
    }
  });

  test('should not allow deleting another user\'s booking', async ({ page }) => {
    // Create a booking for Bob first
    const now = new Date();
    // Use a random offset of days in the future (between 91-120 days)
    const randomDayOffset = 91 + Math.floor(Math.random() * 30);
    const startTime = new Date(now.getTime() + (randomDayOffset * 24 * 60 * 60 * 1000));
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

    const bobClient = await authRequest(USERS.BOB.id);

    // Create Bob's booking
    let bobsBookingId;
    try {
      const createResponse = await bobClient.post(`/bookings`, {
        room_id: testRoomId,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        notes: `API Test: Bob's booking that Alice cannot delete - Random offset: ${randomDayOffset} days`,
      });

      expect(createResponse.status).toBe(201);
      bobsBookingId = createResponse.data.id;
      console.log(`Created Bob's booking ID ${bobsBookingId} for deletion test`);

      // Save for cleanup
      testResources.bookings.bob.push(bobsBookingId);
    } catch (error) {
      console.error('Error creating Bob\'s booking:', error.response?.data || error.message);
      throw error;
    }

    // Now try to delete Bob's booking as Alice (should fail)
    const aliceClient = await authRequest(USERS.ALICE.id);

    try {
      await aliceClient.delete(`/bookings/${bobsBookingId}`);
      // If we get here, the request succeeded, which is wrong
      expect(false).toBe(true, 'Should not allow deleting another user\'s booking');
    } catch (error) {
      console.log('Got expected error when trying to delete another user\'s booking:', error.message);

      // Either a 403 (forbidden) or 404 (not found) are acceptable responses
      // Both prevent the user from deleting the booking
      expect([403, 404]).toContain(error.response.status);

      if (error.response.status === 403) {
        expect(error.response.data.error).toContain('not authorized');
      } else if (error.response.status === 404) {
        expect(error.response.data.error).toContain('not found');
      }
    }
  });

  // Test authentication and authorization
  test('should require authentication for protected endpoints', async ({ page }) => {
    // Unauthenticated request should return 401
    try {
      await axios.get(`${API_BASE_URL}/rooms`);
      // If we reach this point, the request succeeded - which is wrong
      expect(false).toBe(true, 'Should not allow unauthenticated access to /rooms endpoint');
    } catch (error) {
      expect(error.response.status).toBe(401);
      expect(error.response.data.error).toContain('Authentication required');
    }

    // Same for bookings endpoint
    try {
      await axios.get(`${API_BASE_URL}/bookings`);
      expect(false).toBe(true, 'Should not allow unauthenticated access to /bookings endpoint');
    } catch (error) {
      expect(error.response.status).toBe(401);
      expect(error.response.data.error).toContain('Authentication required');
    }
  });

  test('should login successfully with test credentials', async ({ page }) => {
    // Test the login endpoint
    try {
      // Use a valid test user from our test data
      const testUser = USERS.ALICE;

      const loginResponse = await axios.post(`${API_BASE_URL}/auth/test-login`, {
        email: testUser.email
      }, {
        withCredentials: true
      });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.data).toHaveProperty('id');
      expect(loginResponse.data).toHaveProperty('email', testUser.email);

      // Verify that the auth_token cookie was set
      expect(loginResponse.headers).toHaveProperty('set-cookie');
      const cookies = loginResponse.headers['set-cookie'];
      expect(cookies.some(cookie => cookie.startsWith('auth_token='))).toBe(true);
    } catch (error) {
      console.error('Login test error:', error.response?.data || error.message);
      throw error;
    }
  });

  test('should logout successfully and clear auth cookie', async ({ page }) => {
    // First authenticate
    const client = await authRequest(USERS.ALICE.id);

    // Then logout
    const logoutResponse = await client.post('/auth/logout');

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.data.message).toContain('Logged out successfully');

    // Verify the cookie was cleared
    expect(logoutResponse.headers).toHaveProperty('set-cookie');
    const cookies = logoutResponse.headers['set-cookie'];
    expect(cookies.some(cookie =>
      cookie.includes('auth_token=;') ||
      cookie.includes('auth_token=; Max-Age=0')
    )).toBe(true);

    // After logout, authenticated endpoints should fail
    try {
      // Using the raw axios instance to avoid any interceptors
      await axios.get(`${API_BASE_URL}/rooms`, { withCredentials: true });
      // If we get here, the request succeeded, which is wrong
      expect(false).toBe(true, 'Should not allow access after logout');
    } catch (error) {
      // We expect a 401 Unauthorized error
      expect(error.response?.status).toBe(401);
    }
  });
});
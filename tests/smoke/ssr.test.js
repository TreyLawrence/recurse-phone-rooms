import { test, expect } from '@playwright/test';
import axios from 'axios';

const SERVER_URL = `http://localhost:${process.env.TEST_PORT || 3001}`;

test.describe('Production SSR Smoke Tests', () => {
  test('homepage should return 200 (not 500 from SSR crash)', async () => {
    const response = await axios.get(SERVER_URL, {
      // Don't throw on non-2xx so we can assert the status ourselves
      validateStatus: () => true,
    });

    // The critical assertion: SSR must not crash
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(200);

    // Verify we got HTML back (not an error page or empty response)
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.data).toContain('<!doctype html');
  });

  test('API health check should still work alongside SvelteKit handler', async () => {
    const response = await axios.get(`${SERVER_URL}/api/health`);
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('status', 'ok');
  });

  test('unknown routes should return HTML (SvelteKit handles them), not crash', async () => {
    const response = await axios.get(`${SERVER_URL}/some/random/page`, {
      validateStatus: () => true,
    });

    // SvelteKit should handle this — either 200 (client-side routing) or 404 page, never 500
    expect(response.status).not.toBe(500);
  });
});

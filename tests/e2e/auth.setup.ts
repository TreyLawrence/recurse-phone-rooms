import { test as setup, expect } from '@playwright/test';

// This file provides authentication setup for our tests
// It creates a reusable authenticated state that other tests can use

// Test user state
const mockUsers = {
    standard: {
        id: '1',
        email: 'test@example.com',
        name: 'Alice Tester',
        recurseId: 12345,
        accessToken: 'mock-token',
    },
    other: {
        id: '2',
        email: 'other@example.com',
        name: 'Bob Reviewer',
        recurseId: 67890,
        accessToken: 'other-mock-token',
    }
};

// Setup authentication for standard user
setup('authenticate as standard user', async ({ page }) => {
    // Go to the application
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Set the user in localStorage to simulate a successful login
    await page.evaluate((user) => {
        localStorage.setItem('recurse_user', JSON.stringify(user));

        // Let's just use localStorage for simplicity
        // Svelte stores are not directly accessible here

        // Force a reload to apply the user data
        window.location.href = '/';
    }, mockUsers.standard);

    // Wait for the page to reload and calendar to display
    // Use a specific selector that should be present on the calendar page
    try {
        await page.waitForSelector('div.calendar-grid', { state: 'visible', timeout: 10000 });
    } catch (e) {
        // If we can't find the calendar grid, take a screenshot for debugging
        await page.screenshot({ path: './tests/debug-auth-standard.png' });
        throw new Error(`Failed to authenticate as standard user: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Save the authenticated state for future use in tests
    await page.context().storageState({ path: './tests/storage-state/standard-user.json' });
});

// Setup authentication for other user
setup('authenticate as other user', async ({ page }) => {
    // Go to the application
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Set the user in localStorage to simulate a successful login
    await page.evaluate((user) => {
        localStorage.setItem('recurse_user', JSON.stringify(user));

        // Let's just use localStorage for simplicity
        // Svelte stores are not directly accessible here

        // Force a reload to apply the user data
        window.location.href = '/';
    }, mockUsers.other);

    // Wait for the page to reload and calendar to display
    try {
        await page.waitForSelector('div.calendar-grid', { state: 'visible', timeout: 10000 });
    } catch (e) {
        // If we can't find the calendar grid, take a screenshot for debugging
        await page.screenshot({ path: './tests/debug-auth-other.png' });
        throw new Error(`Failed to authenticate as other user: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Save the authenticated state for future use in tests
    await page.context().storageState({ path: './tests/storage-state/other-user.json' });
});
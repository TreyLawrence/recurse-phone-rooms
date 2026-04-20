/// <reference types="vite/client" />

import { writable } from 'svelte/store';
import { OAUTH_REDIRECT_URI } from './apiConfig';

// Define user type
export interface User {
  id: string;
  email: string;
  name: string;
  recurseId: number;
  accessToken: string;
}

// Create a writable store for the user
export const user = writable<User | null>(null);

// Check if user is logged in on load (browser only — localStorage not available during SSR)
if (typeof localStorage !== 'undefined') {
  const userJson = localStorage.getItem('recurse_user');
  if (userJson) {
    try {
      user.set(JSON.parse(userJson));
    } catch (err) {
      localStorage.removeItem('recurse_user');
    }
  }
}

// Redirect to Recurse OAuth
export function initiateOAuthLogin() {
  const clientId = import.meta.env.VITE_RECURSE_CLIENT_ID;
  const redirectUri = encodeURIComponent(import.meta.env.VITE_OAUTH_REDIRECT_URI);

  console.log('OAuth login initiated with redirect URI:', import.meta.env.VITE_OAUTH_REDIRECT_URI);

  // According to Recurse API docs, no scope parameter is needed
  window.location.href = `https://www.recurse.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
}


export async function signOut() {
  // Remove from localStorage
  localStorage.removeItem('recurse_user');
  user.set(null);

  // Call the logout endpoint to clear the authentication cookie
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (error) {
    console.error('Error during logout:', error);
    // Continue with local signout even if server logout fails
  }
}
<script lang="ts">
  import { user } from "./lib/auth";
  import Login from "./routes/Login.svelte";
  import SimpleCalendar from "./routes/SimpleCalendar.svelte";
  import OAuthCallback from "./routes/OAuthCallback.svelte";
  import { onMount } from "svelte";

  // Simple routing
  let path = window.location.pathname;

  // Listen for path changes
  window.addEventListener("popstate", () => {
    path = window.location.pathname;
  });

  // Special handling for OAuth callback when using the OAuth flow
  onMount(() => {
    // Check if we were redirected from OAuth with code parameter
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      console.log("OAuth callback detected with code parameter");
      // If we have a code parameter in the URL, make sure we're on the callback route
      if (path === "/oauth/callback") {
        console.log("Already on the OAuth callback route");
      } else {
        console.log("Setting path to OAuth callback route");
        path = "/oauth/callback";
      }
    }
  });
</script>

<main class="min-h-screen bg-slate-50">
  {#if path === "/oauth/callback"}
    <OAuthCallback />
  {:else if $user}
    <SimpleCalendar />
  {:else}
    <Login />
  {/if}
</main>

<style>
  /* The global styles are imported in app.css, not here */
  /* This prevents the "unused CSS selector" warnings */
</style>

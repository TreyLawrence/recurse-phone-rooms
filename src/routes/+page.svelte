<script lang="ts">
  import { user } from '$lib/auth';
  import Login from './Login.svelte';
  import SimpleCalendar from './SimpleCalendar.svelte';
</script>

<main class="min-h-screen bg-slate-50">
  {#if $user}
    <SimpleCalendar />
  {:else}
    <Login />
  {/if}
</main>

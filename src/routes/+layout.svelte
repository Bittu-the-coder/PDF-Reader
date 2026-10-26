<script lang="ts">
  import "../lib/styles/theme.css";
  import { appState } from "../lib/stores/appState.svelte";
  import { onMount } from "svelte";

  let { children } = $props();

  onMount(() => {
    // Set initial theme
    document.documentElement.setAttribute("data-theme", appState.theme);

    // Global keyboard shortcuts
    function handleGlobalKeys(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        appState.topBarPinned = !appState.topBarPinned;
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        appState.sidebarPinned = !appState.sidebarPinned;
      }
    }

    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  });
</script>

<div class="app-root">
  {@render children()}
</div>

<style>
  .app-root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-primary);
  }
</style>

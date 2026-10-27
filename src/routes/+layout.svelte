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

    const preventScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("scroll", preventScroll, { passive: true });

    window.addEventListener("keydown", handleGlobalKeys);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeys);
      window.removeEventListener("scroll", preventScroll);
    };
  });
</script>

<div class="app-root">
  {@render children()}
</div>

<style>
  .app-root {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-primary);
  }
</style>

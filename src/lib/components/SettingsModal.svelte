<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import { api } from "../api";

  let activeProvider = $state<"gemini" | "openrouter">(appState.aiProvider || "gemini");
  let apiKeyInput = $state("");
  let showKey = $state(false);
  let isTesting = $state(false);
  let isSaving = $state(false);
  let testStatus = $state<{ type: "success" | "error"; message: string } | null>(null);

  // Models
  let selectedGeminiModel = $state(appState.geminiModel || "gemini-3.5-flash-lite");
  let customGeminiModel = $state("");
  let isCustomGemini = $state(false);

  let selectedOpenrouterModel = $state(appState.openrouterModel || "google/gemini-2.0-flash-exp:free");
  let customOpenrouterModel = $state("");
  let isCustomOpenrouter = $state(false);

  // Language
  let selectedLanguagePreset = $state("Hindi");
  let customLanguageText = $state("");
  let isCustomLanguage = $state(false);

  const geminiPresets = [
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", badge: "Recommended — 500 RPD, 15 RPM" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", badge: "500 RPD, 15 RPM" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", badge: "Latest Flagship — 20 RPD, 5 RPM" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", badge: "20 RPD, 5 RPM" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", badge: "Deep Reasoning" },
  ];

  const languagePresets = [
    "Hindi",
    "Spanish",
    "French",
    "German",
    "Japanese",
    "Chinese",
    "Russian",
    "Arabic",
    "Portuguese",
    "Italian",
  ];

  const openrouterPresets = [
    { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (Free)" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)" },
    { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Free)" },
    { id: "qwen/qwen-2.5-72b-instruct:free", name: "Qwen 2.5 72B (Free)" },
    { id: "mistralai/mistral-small-24b-instruct-2501:free", name: "Mistral 24B (Free)" },
  ];

  $effect(() => {
    if (appState.settingsModalOpen) {
      testStatus = null;
      apiKeyInput = "";
      activeProvider = appState.aiProvider || "gemini";

      const currentGemini = appState.geminiModel || "gemini-3.5-flash-lite";
      if (geminiPresets.some((p) => p.id === currentGemini)) {
        selectedGeminiModel = currentGemini;
        isCustomGemini = false;
        customGeminiModel = currentGemini;
      } else {
        selectedGeminiModel = "Custom";
        isCustomGemini = true;
        customGeminiModel = currentGemini;
      }

      selectedOpenrouterModel = appState.openrouterModel || "google/gemini-2.0-flash-exp:free";

      if (openrouterPresets.some((p) => p.id === appState.openrouterModel)) {
        isCustomOpenrouter = false;
        customOpenrouterModel = appState.openrouterModel;
      } else {
        isCustomOpenrouter = true;
        customOpenrouterModel = appState.openrouterModel;
      }

      appState.checkApiKey();

      if (languagePresets.includes(appState.targetLanguage)) {
        selectedLanguagePreset = appState.targetLanguage;
        isCustomLanguage = false;
        customLanguageText = appState.targetLanguage;
      } else {
        selectedLanguagePreset = "Custom";
        isCustomLanguage = true;
        customLanguageText = appState.targetLanguage || "Hindi";
      }
    }
  });

  async function handleProviderSwitch(provider: "gemini" | "openrouter") {
    activeProvider = provider;
    await appState.setAiProvider(provider);
    testStatus = null;
    apiKeyInput = "";
  }

  async function handleTestKey() {
    if (!apiKeyInput.trim()) {
      testStatus = { type: "error", message: "Please enter an API key to test." };
      return;
    }
    isTesting = true;
    testStatus = null;
    try {
      await api.testApiKey(apiKeyInput.trim(), activeProvider);
      testStatus = {
        type: "success",
        message: `Connection successful! ${activeProvider === "openrouter" ? "OpenRouter" : "Gemini"} key is active and valid.`,
      };
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || `Failed to connect to ${activeProvider}.`;
      testStatus = { type: "error", message: msg };
    } finally {
      isTesting = false;
    }
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) {
      testStatus = { type: "error", message: "Please enter a valid API key." };
      return;
    }
    isSaving = true;
    try {
      await api.setApiKey(apiKeyInput.trim(), activeProvider);
      if (activeProvider === "openrouter") {
        const modelToSave = isCustomOpenrouter ? customOpenrouterModel.trim() : selectedOpenrouterModel;
        await appState.setAiModel(modelToSave);
      } else {
        await appState.setAiModel(selectedGeminiModel);
      }
      await appState.checkApiKey();
      apiKeyInput = "";
      testStatus = { type: "success", message: `${activeProvider === "openrouter" ? "OpenRouter" : "Gemini"} key securely saved to OS keychain!` };
      setTimeout(() => {
        appState.settingsModalOpen = false;
      }, 700);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to save key.";
      testStatus = { type: "error", message: msg };
    } finally {
      isSaving = false;
    }
  }

  async function handleRemoveKey() {
    const provName = activeProvider === "openrouter" ? "OpenRouter" : "Gemini";
    if (confirm(`Are you sure you want to remove your stored ${provName} API key from the keychain?`)) {
      await api.clearApiKey(activeProvider);
      await appState.checkApiKey();
      testStatus = { type: "success", message: `${provName} key removed from keychain.` };
    }
  }

  async function handleGeminiModelChange() {
    if (selectedGeminiModel === "Custom") {
      isCustomGemini = true;
      if (customGeminiModel.trim()) {
        await appState.setAiModel(customGeminiModel.trim());
      }
    } else {
      isCustomGemini = false;
      customGeminiModel = selectedGeminiModel;
      await appState.setAiModel(selectedGeminiModel);
    }
  }

  async function handleCustomGeminiInput() {
    const val = customGeminiModel.trim();
    if (val) {
      await appState.setAiModel(val);
    }
  }

  async function handleOpenrouterModelChange() {
    if (selectedOpenrouterModel === "Custom") {
      isCustomOpenrouter = true;
    } else {
      isCustomOpenrouter = false;
      customOpenrouterModel = selectedOpenrouterModel;
      await appState.setAiModel(selectedOpenrouterModel);
    }
  }

  async function handleCustomOpenrouterInput() {
    const val = customOpenrouterModel.trim();
    if (val) {
      await appState.setAiModel(val);
    }
  }

  async function handleLanguagePresetChange() {
    if (selectedLanguagePreset === "Custom") {
      isCustomLanguage = true;
    } else {
      isCustomLanguage = false;
      customLanguageText = selectedLanguagePreset;
      await appState.setTargetLanguage(selectedLanguagePreset);
    }
  }

  async function handleCustomLanguageInput() {
    const val = customLanguageText.trim();
    if (val) {
      await appState.setTargetLanguage(val);
    }
  }

  let isCurrentProviderConfigured = $derived.by(() => {
    return activeProvider === "openrouter" ? appState.hasOpenrouterKey : appState.hasGeminiKey;
  });
</script>

{#if appState.settingsModalOpen}
  <div
    class="modal-backdrop"
    onclick={() => (appState.settingsModalOpen = false)}
    onkeydown={(e) => e.key === "Escape" && (appState.settingsModalOpen = false)}
    role="presentation"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div
      class="settings-modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Reader Settings"
      tabindex="-1"
    >
      <div class="modal-header">
        <div class="header-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <h2>Reader Settings</h2>
        </div>
        <button class="close-btn" onclick={() => (appState.settingsModalOpen = false)}>×</button>
      </div>

      <div class="modal-body">
        <!-- AI Provider Switcher Tabs -->
        <div class="provider-tabs">
          <button
            class="prov-tab {activeProvider === 'gemini' ? 'active' : ''}"
            onclick={() => handleProviderSwitch('gemini')}
          >
            <span class="prov-icon">✨</span>
            <div class="prov-text">
              <span class="prov-name">Google Gemini</span>
              <span class="prov-desc">Direct Google AI Studio API</span>
            </div>
            {#if appState.hasGeminiKey}
              <span class="key-pill active">✓ Saved</span>
            {/if}
          </button>

          <button
            class="prov-tab {activeProvider === 'openrouter' ? 'active' : ''}"
            onclick={() => handleProviderSwitch('openrouter')}
          >
            <span class="prov-icon">🌐</span>
            <div class="prov-text">
              <span class="prov-name">OpenRouter</span>
              <span class="prov-desc">Free & Open-Source Models</span>
            </div>
            {#if appState.hasOpenrouterKey}
              <span class="key-pill active">✓ Saved</span>
            {/if}
          </button>
        </div>

        <!-- API Key Status Banner -->
        <div class="status-banner {isCurrentProviderConfigured ? 'configured' : 'unconfigured'}">
          <div class="status-dot"></div>
          <div class="status-text">
            <strong>{activeProvider === 'openrouter' ? 'OpenRouter' : 'Google Gemini'}:</strong>
            {isCurrentProviderConfigured
              ? "Key configured & active in OS keychain"
              : "No key configured (AI Lookups & Chat disabled)"}
          </div>
          {#if isCurrentProviderConfigured}
            <button class="btn-danger-sm" onclick={handleRemoveKey}>Remove</button>
          {/if}
        </div>

        <!-- API Key Input Section -->
        <div class="form-group">
          <label for="provider-key">
            <span>{activeProvider === 'openrouter' ? 'OpenRouter API Key' : 'Google Gemini API Key'}</span>
            {#if activeProvider === 'openrouter'}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" class="link-help">
                Get key at OpenRouter.ai ↗
              </a>
            {:else}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" class="link-help">
                Get free key at Google AI Studio ↗
              </a>
            {/if}
          </label>
          <div class="input-with-actions">
            <input
              id="provider-key"
              type={showKey ? "text" : "password"}
              bind:value={apiKeyInput}
              placeholder={isCurrentProviderConfigured ? "Enter new key to replace existing..." : (activeProvider === 'openrouter' ? "sk-or-v1-..." : "AIzaSy...")}
              class="text-input"
            />
            <button
              type="button"
              class="btn-icon"
              onclick={() => (showKey = !showKey)}
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? "👁️" : "🔒"}
            </button>
          </div>
        </div>

        <!-- Model Selection Section -->
        {#if activeProvider === "gemini"}
          <div class="form-group">
            <label for="gemini-model-select">Gemini Model</label>
            <select
              id="gemini-model-select"
              bind:value={selectedGeminiModel}
              onchange={handleGeminiModelChange}
              class="select-input"
            >
              {#each geminiPresets as opt}
                <option value={opt.id}>{opt.id} ({opt.badge})</option>
              {/each}
              <option value="Custom">Custom Model ID...</option>
            </select>
            {#if isCustomGemini || !geminiPresets.some((p) => p.id === selectedGeminiModel)}
              <input
                type="text"
                bind:value={customGeminiModel}
                oninput={handleCustomGeminiInput}
                placeholder="Enter Gemini model ID (e.g. gemini-3.5-flash-lite)"
                class="text-input"
                style="margin-top: 6px;"
              />
            {/if}
            <span class="field-hint">Supports all official Gemini models (gemini-3.5-flash-lite, gemini-3.8-flash, etc.)</span>
          </div>
        {:else}
          <div class="form-group">
            <label for="openrouter-model-select">OpenRouter Model (Free & Paid)</label>
            <select
              id="openrouter-model-select"
              bind:value={selectedOpenrouterModel}
              onchange={handleOpenrouterModelChange}
              class="select-input"
            >
              {#each openrouterPresets as opt}
                <option value={opt.id}>{opt.name} ({opt.id})</option>
              {/each}
              <option value="Custom">Custom Model ID...</option>
            </select>
            {#if isCustomOpenrouter || !openrouterPresets.some((p) => p.id === customOpenrouterModel)}
              <input
                type="text"
                bind:value={customOpenrouterModel}
                oninput={handleCustomOpenrouterInput}
                placeholder="Enter OpenRouter model ID (e.g. meta-llama/llama-3.3-70b-instruct:free)"
                class="text-input"
                style="margin-top: 6px;"
              />
            {/if}
            <span class="field-hint">Supports all free and open models on openrouter.ai/models</span>
          </div>
        {/if}

        <!-- Secondary Meaning Language Setting -->
        <div class="form-group">
          <label for="lang-select">Secondary Meaning Language</label>
          <select
            id="lang-select"
            bind:value={selectedLanguagePreset}
            onchange={handleLanguagePresetChange}
            class="select-input"
          >
            {#each languagePresets as lang}
              <option value={lang}>{lang}</option>
            {/each}
            <option value="Custom">Custom Language...</option>
          </select>
          {#if isCustomLanguage || !languagePresets.includes(customLanguageText)}
            <input
              type="text"
              bind:value={customLanguageText}
              oninput={handleCustomLanguageInput}
              placeholder="Type language name (e.g. Marathi, Bengali, Tamil, etc.)"
              class="text-input"
              style="margin-top: 6px;"
            />
          {/if}
          <span class="field-hint">Used for secondary translations, passage explanations, and AI reading tutor answers.</span>
        </div>

        {#if testStatus}
          <div class="test-feedback {testStatus.type}">
            {testStatus.message}
          </div>
        {/if}

        <!-- Privacy & Security Guarantee -->
        <div class="privacy-note">
          <div class="note-icon">🛡️</div>
          <div class="note-content">
            <p class="note-title">Local-First & Secure Keychain</p>
            <p class="note-body">
              Your API keys are stored securely in your OS keychain (via <code>keyring</code>) and never written to disk unencrypted. Only words or passages you select are transmitted to your chosen AI provider.
            </p>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button
          class="btn-secondary"
          onclick={handleTestKey}
          disabled={isTesting || !apiKeyInput.trim()}
        >
          {isTesting ? "Testing..." : `Test ${activeProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'} Key`}
        </button>
        <button
          class="btn-primary"
          onclick={handleSaveKey}
          disabled={isSaving || !apiKeyInput.trim()}
        >
          {isSaving ? "Saving..." : "Save Key to Keychain"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    animation: fadeIn 0.16s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .settings-modal {
    background: var(--bg-surface-elevated, #1c1c22);
    border: 1px solid var(--border-subtle, #33333f);
    border-radius: var(--radius-lg, 12px);
    width: 100%;
    max-width: 540px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle, #333);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-primary, #f0f0f4);
  }

  .header-title h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #999);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 80vh;
    overflow-y: auto;
  }

  /* Provider Switcher Tabs */
  .provider-tabs {
    display: flex;
    gap: 8px;
    background: var(--bg-surface, #141418);
    padding: 4px;
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-subtle, #2c2c34);
  }

  .prov-tab {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .prov-tab:hover {
    background: var(--bg-hover);
  }

  .prov-tab.active {
    background: var(--bg-surface-elevated, #24242c);
    border-color: var(--accent);
    box-shadow: var(--shadow-sm);
  }

  .prov-icon {
    font-size: 18px;
  }

  .prov-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .prov-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .prov-desc {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .key-pill {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .status-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--radius-md, 8px);
    font-size: 12.5px;
  }

  .status-banner.configured {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: #10b981;
  }

  .status-banner.unconfigured {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.25);
    color: #f59e0b;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .status-text {
    flex: 1;
    line-height: 1.4;
  }

  .btn-danger-sm {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .btn-danger-sm:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .link-help {
    font-size: 11.5px;
    color: var(--accent);
    text-decoration: none;
  }

  .link-help:hover {
    text-decoration: underline;
  }

  .input-with-actions {
    position: relative;
    display: flex;
    align-items: center;
  }

  .text-input {
    width: 100%;
    padding: 9px 12px;
    background: var(--bg-surface, #141418) !important;
    border: 1px solid var(--border-subtle, #333) !important;
    border-radius: var(--radius-md, 6px);
    color: var(--text-primary, #f4f4f5) !important;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease;
  }

  /* Robust dark & light mode styling for select dropdowns across WebKitGTK */
  select.select-input {
    width: 100%;
    padding: 9px 34px 9px 12px;
    background-color: var(--bg-surface, #141418) !important;
    border: 1px solid var(--border-subtle, #333) !important;
    border-radius: var(--radius-md, 6px);
    color: var(--text-primary, #f4f4f5) !important;
    font-size: 13px;
    font-weight: 500;
    outline: none;
    box-sizing: border-box;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") !important;
    background-repeat: no-repeat !important;
    background-position: right 12px center !important;
    background-size: 15px !important;
    transition: border-color 0.15s ease;
  }

  select.select-input option {
    background-color: var(--bg-surface-elevated, #222228) !important;
    color: var(--text-primary, #f4f4f5) !important;
    padding: 8px 12px;
  }

  .input-with-actions .text-input {
    padding-right: 36px;
  }

  .text-input:focus,
  select.select-input:focus {
    border-color: var(--accent) !important;
  }

  .btn-icon {
    position: absolute;
    right: 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    color: var(--text-secondary);
  }

  .btn-icon:hover {
    color: var(--text-primary);
  }

  .test-feedback {
    padding: 8px 12px;
    border-radius: var(--radius-sm, 6px);
    font-size: 12px;
    line-height: 1.4;
  }

  .test-feedback.success {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .test-feedback.error {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .privacy-note {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md, 8px);
  }

  .note-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .note-title {
    margin: 0 0 4px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .note-body {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .note-body code {
    background: var(--bg-surface);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10.5px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle);
  }

  .btn-secondary {
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 7px 14px;
    border-radius: var(--radius-md, 6px);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    border: 1px solid transparent;
    color: var(--accent-text, #ffffff);
    padding: 7px 16px;
    border-radius: var(--radius-md, 6px);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

<script lang="ts">
  import { getApiKey } from '../../core/dataGateway.js';
  import { getCachedVault } from '../../core/secretsVault';
  import { APP_MODE } from '../../config/runtimeConfig.js';
  import {
    THEON_EXPRESSION_LABELS,
    THEON_EXPRESSIONS,
    THEON_HEAD_STYLE_LABELS,
    THEON_HEAD_STYLES,
    THEON_MODEL_PRESETS,
    THEON_PROVIDER_LABELS,
    THEON_PROVIDERS,
    type TheonExpression,
    type TheonHeadStyle,
    type TheonMatrixSpeed,
    type TheonProvider,
  } from './theonConfig';
  import { theonStore } from './theonStore.svelte';

  let { onToast }: { onToast?: (message: string) => void } = $props();

  const settings = $derived(theonStore.settings);
  const presets = $derived(THEON_MODEL_PRESETS[settings.provider] ?? []);
  const selectedPreset = $derived(
    presets.some((item) => item.id === settings.model) ? settings.model : '__custom__',
  );

  const keyReadyNote = $derived.by(() => {
    if (settings.provider === 'vertex') {
      return APP_MODE === 'firebase_auth'
        ? 'Dùng Vertex AI (Firebase AI Logic) qua Gmail chủ sở hữu — không cần API key.'
        : 'Đang ở chế độ dev_mock: hãy chọn Google AI Studio / OpenAI / OpenRouter hoặc chuyển firebase_auth để dùng Vertex AI.';
    }
    const vault = getCachedVault();
    const hasKey = Boolean(
      (settings.provider === 'google' ? vault.geminiApiKey : '') || getApiKey(settings.provider),
    );
    return hasKey
      ? `Đã có khóa API cho ${THEON_PROVIDER_LABELS[settings.provider]}.`
      : `Chưa có khóa API cho ${THEON_PROVIDER_LABELS[settings.provider]} — nhập khóa ở mục BYOK hoặc Firestore Vault bên trên.`;
  });

  function handleProviderChange(event: Event) {
    const provider = (event.currentTarget as HTMLSelectElement).value as TheonProvider;
    theonStore.setProvider(provider);
  }

  function handlePresetChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value !== '__custom__') {
      theonStore.updateSettings({ model: value });
    }
  }

  function handleModelInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value.trim();
    if (value) theonStore.updateSettings({ model: value });
  }

  function handleClearHistory() {
    theonStore.clearHistory();
    onToast?.('Đã xóa lịch sử hội thoại của Theon.');
  }

  function handleReset() {
    theonStore.resetSettings();
    onToast?.('Đã khôi phục cài đặt mặc định cho Theon.');
  }
</script>

<section class="settings-section theon-settings">
  <h3>Nhân dạng Theon (Planar AI)</h3>
  <p class="status-line">
    Cấu hình model AI riêng, biểu cảm và hiển thị 3D cho Theon. Khóa API dùng chung từ mục Firestore Vault / BYOK phía trên.
  </p>

  <label for="theon-provider">Nhà cung cấp AI cho Theon</label>
  <select
    id="theon-provider"
    class="select-input"
    value={settings.provider}
    onchange={handleProviderChange}
  >
    {#each THEON_PROVIDERS as provider (provider)}
      <option value={provider}>{THEON_PROVIDER_LABELS[provider]}</option>
    {/each}
  </select>
  <p class="status-line">{keyReadyNote}</p>

  <label for="theon-model-preset">Chọn nhanh Model</label>
  <select
    id="theon-model-preset"
    class="select-input"
    value={selectedPreset}
    onchange={handlePresetChange}
  >
    {#each presets as preset (preset.id)}
      <option value={preset.id}>{preset.label}</option>
    {/each}
    <option value="__custom__">Model ID tùy chỉnh…</option>
  </select>

  <label for="theon-model-id">Model ID gửi API</label>
  <input
    id="theon-model-id"
    class="text-input"
    type="text"
    value={settings.model}
    placeholder="VD: gemini-2.5-flash, gpt-4.1, claude-sonnet-4-20250514"
    onchange={handleModelInput}
  />

  <div class="setting-row">
    <label for="theon-temperature">Độ sáng tạo (Temperature)</label>
    <strong>{settings.temperature.toFixed(2)}</strong>
  </div>
  <input
    id="theon-temperature"
    class="theon-range"
    type="range"
    min="0"
    max="1.2"
    step="0.05"
    value={settings.temperature}
    oninput={(e) => {
      theonStore.updateSettings({
        temperature: Number((e.currentTarget as HTMLInputElement).value),
      });
    }}
  />

  <label for="theon-system-prompt">Chỉ dẫn nhân dạng (System Prompt)</label>
  <textarea
    id="theon-system-prompt"
    class="text-input theon-prompt-input"
    rows="3"
    value={settings.systemPrompt}
    onchange={(e) => {
      theonStore.updateSettings({
        systemPrompt: (e.currentTarget as HTMLTextAreaElement).value,
      });
    }}
  ></textarea>

  <div class="setting-row">
    <label for="theon-auto-context">Đính kèm ngữ cảnh bài học đang mở</label>
    <input
      id="theon-auto-context"
      type="checkbox"
      checked={settings.autoContext}
      onchange={(e) => {
        theonStore.updateSettings({ autoContext: (e.currentTarget as HTMLInputElement).checked });
      }}
    />
  </div>

  <div class="setting-row">
    <label for="theon-auto-expr">Cho phép Agent tự chọn biểu cảm (hàm <code>set_expression</code>)</label>
    <input
      id="theon-auto-expr"
      type="checkbox"
      checked={settings.autoExpression}
      onchange={(e) => {
        theonStore.updateSettings({
          autoExpression: (e.currentTarget as HTMLInputElement).checked,
        });
      }}
    />
  </div>

  <label for="theon-default-expr">Biểu cảm mặc định khi nghỉ</label>
  <select
    id="theon-default-expr"
    class="select-input"
    value={settings.defaultExpression}
    onchange={(e) => {
      theonStore.updateSettings({
        defaultExpression: (e.currentTarget as HTMLSelectElement).value as TheonExpression,
      });
    }}
  >
    {#each THEON_EXPRESSIONS as expr (expr)}
      <option value={expr}>{THEON_EXPRESSION_LABELS[expr]}</option>
    {/each}
  </select>

  <label for="theon-head-style">Kiểu hiển thị khối Planar 3D</label>
  <select
    id="theon-head-style"
    class="select-input"
    value={settings.headStyle}
    onchange={(e) => {
      theonStore.updateSettings({
        headStyle: (e.currentTarget as HTMLSelectElement).value as TheonHeadStyle,
      });
    }}
  >
    {#each THEON_HEAD_STYLES as style (style)}
      <option value={style}>{THEON_HEAD_STYLE_LABELS[style]}</option>
    {/each}
  </select>

  <div class="setting-row">
    <label for="theon-edge-brightness">Độ sáng viền cạnh</label>
    <strong>{settings.edgeBrightness.toFixed(2)}</strong>
  </div>
  <input
    id="theon-edge-brightness"
    class="theon-range"
    type="range"
    min="0.10"
    max="1.00"
    step="0.02"
    value={settings.edgeBrightness}
    oninput={(e) => {
      theonStore.updateSettings({
        edgeBrightness: Number((e.currentTarget as HTMLInputElement).value),
      });
    }}
  />

  <div class="setting-row">
    <label for="theon-read-speed">Tốc độ mắt đọc khi đang xử lý</label>
    <strong>{settings.readSpeed.toFixed(1)}x</strong>
  </div>
  <input
    id="theon-read-speed"
    class="theon-range"
    type="range"
    min="0.5"
    max="2.5"
    step="0.1"
    value={settings.readSpeed}
    oninput={(e) => {
      theonStore.updateSettings({
        readSpeed: Number((e.currentTarget as HTMLInputElement).value),
      });
    }}
  />

  <label for="theon-matrix-speed">Tốc độ hiệu ứng ma trận chữ trả lời</label>
  <select
    id="theon-matrix-speed"
    class="select-input"
    value={settings.matrixTextSpeed}
    onchange={(e) => {
      theonStore.updateSettings({
        matrixTextSpeed: (e.currentTarget as HTMLSelectElement).value as TheonMatrixSpeed,
      });
    }}
  >
    <option value="fast">Nhanh</option>
    <option value="medium">Vừa</option>
    <option value="slow">Chậm</option>
  </select>

  <div class="setting-row">
    <label for="theon-bg-rain">Mưa ma trận nền</label>
    <input
      id="theon-bg-rain"
      type="checkbox"
      checked={settings.bgMatrixRain}
      onchange={(e) => {
        theonStore.updateSettings({ bgMatrixRain: (e.currentTarget as HTMLInputElement).checked });
      }}
    />
  </div>

  <div class="setting-row">
    <label for="theon-fixed-box">Khung hộp cố định (tắt nghiêng Parallax theo chuột)</label>
    <input
      id="theon-fixed-box"
      type="checkbox"
      checked={!settings.parallaxEnabled}
      onchange={(e) => {
        theonStore.updateSettings({
          parallaxEnabled: !(e.currentTarget as HTMLInputElement).checked,
        });
      }}
    />
  </div>

  <div class="theon-settings-actions">
    <button type="button" class="button button-soft" onclick={handleClearHistory}>
      Xóa lịch sử Theon ({Math.floor(theonStore.history.length / 2)} lượt)
    </button>
    <button type="button" class="button button-soft" onclick={handleReset}>
      Khôi phục mặc định
    </button>
  </div>
</section>

<style>
  .theon-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .theon-prompt-input {
    min-height: 76px;
    resize: vertical;
    font-family: inherit;
    line-height: 1.45;
  }

  .theon-range {
    width: 100%;
    accent-color: var(--accent-solid);
  }

  .theon-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
</style>

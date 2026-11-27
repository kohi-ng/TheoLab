<script lang="ts">
  import { APP_MODE } from '../../config/runtimeConfig.js';
  import { aiConfigStore } from '../../core/aiConfigStore.svelte';
  import {
    THEON_EXPRESSION_LABELS,
    THEON_EXPRESSIONS,
    THEON_HEAD_STYLE_LABELS,
    THEON_HEAD_STYLES,
    type TheonExpression,
    type TheonHeadStyle,
    type TheonMatrixSpeed,
  } from './theonConfig';
  import { THEON_SKILLS, type TheonSkillId } from './theonSkills';
  import { theonStore } from './theonStore.svelte';

  let { onToast }: { onToast?: (message: string) => void } = $props();

  let modelSearch = $state('');

  const settings = $derived(theonStore.settings);
  const enabledProviders = $derived(aiConfigStore.enabledProviders);
  const groupedModels = $derived.by(() => {
    const visible = aiConfigStore.listModels({
      includeHidden: false,
      onlyEnabledProviders: true,
      query: modelSearch,
    });
    return enabledProviders
      .map((provider) => ({
        provider,
        models: visible.filter((m) => m.providerId === provider.id),
      }))
      .filter((group) => group.models.length > 0);
  });

  function toggleTheonSkill(skillId: TheonSkillId, checked: boolean) {
    const current = new Set(settings.enabledSkills);
    if (checked) current.add(skillId);
    else current.delete(skillId);
    theonStore.updateSettings({ enabledSkills: [...current] });
  }

  function handleMcpAllowlistChange(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value;
    const tools = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 30);
    theonStore.updateSettings({ mcpAllowedTools: tools });
  }

  const keyReadyNote = $derived.by(() => {
    void aiConfigStore.keyRevision;
    const providerLabel = aiConfigStore.getProviderLabel(settings.provider);
    if (settings.provider === 'vertex') {
      return APP_MODE === 'firebase_auth'
        ? 'Dùng Vertex AI (Firebase AI Logic) qua Gmail chủ sở hữu — không cần API key.'
        : 'Đang ở chế độ dev_mock: hãy chọn Google AI Studio / OpenAI / OpenRouter hoặc chuyển firebase_auth để dùng Vertex AI.';
    }
    const configured = aiConfigStore.isProviderConfigured(settings.provider);
    return configured
      ? `Đã sẵn sàng cấu hình cho ${providerLabel}.`
      : `Chưa có khóa API hoặc Base URL cho ${providerLabel} — thiết lập ở mục Cấu hình AI bên trên.`;
  });

  function handleProviderChange(event: Event) {
    const provider = (event.currentTarget as HTMLSelectElement).value;
    theonStore.setProvider(provider);
  }

  function handleSelectRegistryModel(providerId: string, modelId: string) {
    theonStore.updateSettings({ provider: providerId, model: modelId });
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
    Cấu hình model AI riêng, biểu cảm và hiển thị 3D cho Theon. Danh sách model &amp; khóa API dùng chung từ mục Cấu hình AI phía trên.
  </p>

  <label for="theon-provider">Nhà cung cấp AI cho Theon</label>
  <select
    id="theon-provider"
    class="select-input"
    value={settings.provider}
    onchange={handleProviderChange}
  >
    {#each enabledProviders as provider (provider.id)}
      <option value={provider.id}>{provider.label}</option>
    {/each}
  </select>
  <p class="status-line">{keyReadyNote}</p>

  <label for="theon-model-search">Chọn nhanh Model từ danh mục chung (nhóm theo nhà cung cấp)</label>
  <input
    id="theon-model-search"
    class="text-input"
    type="search"
    placeholder="Tìm nhanh theo tên model hoặc nhà cung cấp…"
    bind:value={modelSearch}
  />
  <div class="theon-model-picker" role="listbox" aria-label="Danh mục model AI cho Theon">
    {#each groupedModels as group (group.provider.id)}
      <p class="theon-model-group">{group.provider.label}</p>
      {#each group.models as entry (entry.id)}
        <button
          type="button"
          class="theon-model-option"
          class:selected={settings.provider === entry.providerId && settings.model === entry.modelId}
          onclick={() => handleSelectRegistryModel(entry.providerId, entry.modelId)}
        >
          <span>
            <strong>{entry.label}</strong>
            <small>{entry.modelId}</small>
          </span>
          {#if settings.provider === entry.providerId && settings.model === entry.modelId}
            <span class="theon-model-active">Đang dùng</span>
          {/if}
        </button>
      {/each}
    {:else}
      <p class="status-line">Không có model khớp từ khóa.</p>
    {/each}
  </div>

  <label for="theon-model-id">Model ID gửi API (có thể nhập tay)</label>
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

  <div class="theon-subsection">
    <strong>Skills của Theon Multiagent</strong>
    {#each THEON_SKILLS as skill (skill.id)}
      <div class="setting-row">
        <label for={`theon-skill-${skill.id}`}>
          <span>{skill.name}</span>
          <small class="theon-skill-desc">{skill.summary}</small>
        </label>
        <input
          id={`theon-skill-${skill.id}`}
          type="checkbox"
          checked={settings.enabledSkills.includes(skill.id)}
          onchange={(e) => toggleTheonSkill(skill.id, (e.currentTarget as HTMLInputElement).checked)}
        />
      </div>
    {/each}
  </div>

  <div class="theon-subsection">
    <div class="setting-row">
      <label for="theon-mcp-enabled">Bật cầu nối MCP cho Theon (chỉ gọi tool trong allowlist)</label>
      <input
        id="theon-mcp-enabled"
        type="checkbox"
        checked={settings.mcpEnabled}
        onchange={(e) => {
          theonStore.updateSettings({ mcpEnabled: (e.currentTarget as HTMLInputElement).checked });
        }}
      />
    </div>
    {#if settings.mcpEnabled}
      <label for="theon-mcp-allowlist">Danh sách tên tool MCP cho phép (phân cách bằng dấu phẩy)</label>
      <input
        id="theon-mcp-allowlist"
        class="text-input"
        type="text"
        value={settings.mcpAllowedTools.join(', ')}
        placeholder="VD: search_docs, calc_stoichiometry"
        onchange={handleMcpAllowlistChange}
      />
    {/if}
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

  .theon-subsection {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--surface-elevated);
  }

  .theon-skill-desc {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 400;
  }

  .theon-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }

  .theon-model-picker {
    max-height: 220px;
    overflow: auto;
    padding: 8px;
    border-radius: 14px;
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .theon-model-group {
    margin: 6px 6px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .theon-model-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    border: 0;
    border-radius: 11px;
    padding: 7px 10px;
    background: transparent;
    text-align: left;
    font-size: 12px;
  }

  .theon-model-option:hover,
  .theon-model-option.selected {
    background: #fff;
  }

  .theon-model-option small {
    display: block;
    font-size: 10px;
    color: var(--text-muted);
  }

  .theon-model-active {
    font-size: 11px;
    font-weight: 600;
    color: var(--success);
    white-space: nowrap;
  }
</style>

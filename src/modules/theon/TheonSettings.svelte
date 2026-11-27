<script lang="ts">
  import { onDestroy } from 'svelte';
  import { APP_MODE } from '../../config/runtimeConfig.js';
  import { aiConfigStore } from '../../core/aiConfigStore.svelte';
  import {
    THEON_EXPRESSION_LABELS,
    THEON_EXPRESSIONS,
    THEON_GEMINI_VOICES,
    THEON_HEAD_STYLE_LABELS,
    THEON_HEAD_STYLES,
    THEON_OPENAI_VOICES,
    THEON_STT_PROVIDER_LABELS,
    THEON_STT_PROVIDERS,
    THEON_TTS_PROVIDER_LABELS,
    THEON_TTS_PROVIDERS,
    type TheonExpression,
    type TheonHeadStyle,
    type TheonMatrixSpeed,
    type TheonSttProvider,
    type TheonTtsProvider,
  } from './theonConfig';
  import { THEON_SKILLS, type TheonSkillId } from './theonSkills';
  import { theonStore } from './theonStore.svelte';
  import {
    createTheonVoicePlayer,
    DEFAULT_GOOGLE_TTS_MODEL,
    DEFAULT_OPENAI_TTS_MODEL,
    resolveEffectiveTtsProvider,
  } from './theonVoice';

  let { onToast }: { onToast?: (message: string) => void } = $props();

  let modelSearch = $state('');
  let testingVoice = $state(false);
  let voiceTestNote = $state('');
  const voicePreviewPlayer = createTheonVoicePlayer();

  onDestroy(() => {
    voicePreviewPlayer.stop();
  });

  const settings = $derived(theonStore.settings);
  const enabledProviders = $derived(aiConfigStore.enabledProviders);
  const customTtsProviders = $derived(
    aiConfigStore.providers.filter((p) => p.kind === 'openai-compatible'),
  );
  const effectiveTtsProvider = $derived.by(() => {
    void aiConfigStore.keyRevision;
    return resolveEffectiveTtsProvider(settings);
  });
  const activeVoicePresets = $derived(
    effectiveTtsProvider === 'google' ? THEON_GEMINI_VOICES : THEON_OPENAI_VOICES,
  );
  const ttsModelPlaceholder = $derived(
    effectiveTtsProvider === 'google'
      ? `Mặc định: ${DEFAULT_GOOGLE_TTS_MODEL}`
      : `Mặc định: ${DEFAULT_OPENAI_TTS_MODEL}`,
  );
  const ttsStatusNote = $derived.by(() => {
    void aiConfigStore.keyRevision;
    if (effectiveTtsProvider === 'google') {
      return aiConfigStore.isProviderConfigured('google')
        ? 'Sẽ dùng Google Gemini Native TTS (khóa Google AI Studio).'
        : 'Chưa có Google AI Studio API Key — sẽ tự dự phòng sang giọng trình duyệt.';
    }
    if (effectiveTtsProvider === 'openai') {
      return aiConfigStore.isProviderConfigured('openai')
        ? 'Sẽ dùng OpenAI TTS API (/v1/audio/speech).'
        : 'Chưa có OpenAI API Key — sẽ tự dự phòng sang giọng trình duyệt.';
    }
    if (effectiveTtsProvider === 'custom') {
      const cfg = aiConfigStore.getProvider(settings.ttsCustomProviderId || 'custom');
      return cfg?.baseUrl
        ? `Sẽ gọi ${cfg.baseUrl.replace(/\/+$/, '')}/audio/speech.`
        : 'Chưa có Base URL cho endpoint Custom TTS.';
    }
    return 'Dùng Web Speech API tích hợp sẵn của trình duyệt (miễn phí, độ trễ thấp).';
  });
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
    onToast?.('Đã xóa lịch sử nhắn tin của Theon.');
  }

  function handleClearVoiceHistory() {
    theonStore.clearVoiceHistory();
    onToast?.('Đã xóa lịch sử luồng thoại của Theon.');
  }

  async function handleTestVoice() {
    if (testingVoice) {
      voicePreviewPlayer.stop();
      testingVoice = false;
      voiceTestNote = '';
      return;
    }
    testingVoice = true;
    voiceTestNote = 'Đang tổng hợp giọng nói…';
    await voicePreviewPlayer.speak(
      'Xin chào! Tôi là Theon. Hệ thống đàm thoại giọng nói và vẽ đồ thị trục số đã sẵn sàng.',
      settings,
      {
        onAmplitude: () => {},
        onStart: (note) => {
          voiceTestNote = note ? `Đang phát: ${note}` : 'Đang phát…';
        },
        onEnd: () => {
          testingVoice = false;
          voiceTestNote = '';
        },
        onError: (msg) => {
          testingVoice = false;
          voiceTestNote = msg;
        },
      },
    );
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
    <strong>Giọng nói &amp; AI TTS (Luồng thoại)</strong>
    <p class="status-line">
      Luồng thoại tách biệt với luồng gõ chữ — nhấn nút sóng âm bên trái ô nhập của Theon để nói chuyện trực tiếp và ra lệnh gọi hàm.
    </p>

    <label for="theon-tts-provider">Động cơ giọng nói (AI TTS)</label>
    <select
      id="theon-tts-provider"
      class="select-input"
      value={settings.ttsProvider}
      onchange={(e) => {
        const nextProvider = (e.currentTarget as HTMLSelectElement).value as TheonTtsProvider;
        const patch: Partial<typeof settings> = { ttsProvider: nextProvider };
        if (nextProvider === 'google' && !(THEON_GEMINI_VOICES as readonly string[]).includes(settings.ttsVoice)) {
          patch.ttsVoice = 'Kore';
        } else if (
          (nextProvider === 'openai' || nextProvider === 'custom') &&
          !(THEON_OPENAI_VOICES as readonly string[]).includes(settings.ttsVoice)
        ) {
          patch.ttsVoice = 'alloy';
        }
        theonStore.updateSettings(patch);
      }}
    >
      {#each THEON_TTS_PROVIDERS as pid (pid)}
        <option value={pid}>{THEON_TTS_PROVIDER_LABELS[pid]}</option>
      {/each}
    </select>
    <p class="status-line">{ttsStatusNote}</p>

    {#if settings.ttsProvider === 'custom'}
      <label for="theon-tts-custom-provider">Endpoint Custom TTS (OpenAI-compatible)</label>
      <select
        id="theon-tts-custom-provider"
        class="select-input"
        value={settings.ttsCustomProviderId}
        onchange={(e) => {
          theonStore.updateSettings({
            ttsCustomProviderId: (e.currentTarget as HTMLSelectElement).value,
          });
        }}
      >
        {#each customTtsProviders as p (p.id)}
          <option value={p.id}>{p.label} ({p.baseUrl || 'chưa có URL'})</option>
        {/each}
      </select>
    {/if}

    {#if effectiveTtsProvider !== 'browser'}
      <label for="theon-tts-model">Model TTS (để trống để dùng mặc định)</label>
      <input
        id="theon-tts-model"
        class="text-input"
        type="text"
        value={settings.ttsModel}
        placeholder={ttsModelPlaceholder}
        onchange={(e) => {
          theonStore.updateSettings({
            ttsModel: (e.currentTarget as HTMLInputElement).value.trim(),
          });
        }}
      />

      <label for="theon-tts-voice">Giọng đọc (Voice)</label>
      <div class="theon-voice-row">
        <select
          id="theon-tts-voice"
          class="select-input"
          value={(activeVoicePresets as readonly string[]).includes(settings.ttsVoice) ? settings.ttsVoice : ''}
          onchange={(e) => {
            const val = (e.currentTarget as HTMLSelectElement).value;
            if (val) theonStore.updateSettings({ ttsVoice: val });
          }}
        >
          {#each activeVoicePresets as v (v)}
            <option value={v}>{v}</option>
          {/each}
          {#if !(activeVoicePresets as readonly string[]).includes(settings.ttsVoice)}
            <option value="">Tùy chỉnh ({settings.ttsVoice})</option>
          {/if}
        </select>
        <input
          class="text-input"
          type="text"
          aria-label="Tên giọng đọc tùy chỉnh"
          value={settings.ttsVoice}
          placeholder="Nhập tên voice..."
          onchange={(e) => {
            const val = (e.currentTarget as HTMLInputElement).value.trim();
            if (val) theonStore.updateSettings({ ttsVoice: val });
          }}
        />
      </div>
    {/if}

    <div class="setting-row">
      <label for="theon-tts-speed">Tốc độ đọc</label>
      <strong>{settings.ttsSpeed.toFixed(2)}x</strong>
    </div>
    <input
      id="theon-tts-speed"
      class="theon-range"
      type="range"
      min="0.6"
      max="1.8"
      step="0.05"
      value={settings.ttsSpeed}
      oninput={(e) => {
        theonStore.updateSettings({
          ttsSpeed: Number((e.currentTarget as HTMLInputElement).value),
        });
      }}
    />

    <label for="theon-stt-provider">Nhận dạng giọng nói (Ra lệnh bằng giọng nói)</label>
    <select
      id="theon-stt-provider"
      class="select-input"
      value={settings.sttProvider}
      onchange={(e) => {
        theonStore.updateSettings({
          sttProvider: (e.currentTarget as HTMLSelectElement).value as TheonSttProvider,
        });
      }}
    >
      {#each THEON_STT_PROVIDERS as sid (sid)}
        <option value={sid}>{THEON_STT_PROVIDER_LABELS[sid]}</option>
      {/each}
    </select>

    <label for="theon-voice-lang">Ngôn ngữ thoại</label>
    <select
      id="theon-voice-lang"
      class="select-input"
      value={settings.voiceLang}
      onchange={(e) => {
        theonStore.updateSettings({
          voiceLang: (e.currentTarget as HTMLSelectElement).value,
        });
      }}
    >
      <option value="vi-VN">Tiếng Việt (vi-VN)</option>
      <option value="en-US">English (en-US)</option>
    </select>

    <div class="setting-row">
      <label for="theon-voice-continuous">Thoại liên tục (tự lắng nghe tiếp sau khi Theon nói xong)</label>
      <input
        id="theon-voice-continuous"
        type="checkbox"
        checked={settings.voiceContinuous}
        onchange={(e) => {
          theonStore.updateSettings({
            voiceContinuous: (e.currentTarget as HTMLInputElement).checked,
          });
        }}
      />
    </div>

    <div class="setting-row">
      <label for="theon-tts-autospeak-text">Tự đọc thành tiếng cả câu trả lời ở luồng gõ chữ</label>
      <input
        id="theon-tts-autospeak-text"
        type="checkbox"
        checked={settings.ttsAutoSpeakText}
        onchange={(e) => {
          theonStore.updateSettings({
            ttsAutoSpeakText: (e.currentTarget as HTMLInputElement).checked,
          });
        }}
      />
    </div>

    <div class="theon-settings-actions">
      <button type="button" class="button button-soft" onclick={handleTestVoice}>
        {testingVoice ? '⏹ Dừng nghe thử' : '🔊 Nghe thử giọng Theon'}
      </button>
      {#if voiceTestNote}
        <span class="status-line">{voiceTestNote}</span>
      {/if}
    </div>
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
      Xóa lịch sử nhắn tin ({Math.floor(theonStore.history.length / 2)} lượt)
    </button>
    <button type="button" class="button button-soft" onclick={handleClearVoiceHistory}>
      Xóa lịch sử thoại ({Math.floor(theonStore.voiceHistory.length / 2)} lượt)
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

  .theon-voice-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
</style>

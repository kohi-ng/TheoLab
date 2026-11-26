<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    TheonEngineController,
    TheonHoverInfo,
    TheonObjectActionMeta,
  } from './theonEngine.js';
  import { dockStore } from '../apps/dockStore.svelte';
  import { renderMatrixFrame, startMatrixReveal } from './matrixText';
  import { runTheonTurn } from './theonAgent';
  import { theonStore } from './theonStore.svelte';
  import type { TheonSettings } from './theonConfig';

  let { active = true }: { active?: boolean } = $props();

  let canvasHost: HTMLDivElement | undefined = $state();
  let outputHost: HTMLDivElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();

  let controller: TheonEngineController | null = null;
  let webglError = $state('');
  let draft = $state('');
  let renderedOutput = $state(theonStore.outputText);
  let hoverInfo = $state<TheonHoverInfo | null>(null);

  let cancelReveal: (() => void) | null = null;
  let thinkingTimer: number | null = null;
  let thinkingPhrase = 'THEON // ĐANG ĐỌC & PHÂN TÍCH...';
  let requestSeq = 0;

  function applySettingsToEngine(settings: TheonSettings) {
    if (!controller) return;
    controller.updateSettings({
      headStyle: settings.headStyle,
      edgeBrightness: settings.edgeBrightness,
      bgMatrixRain: settings.bgMatrixRain,
      parallaxEnabled: settings.parallaxEnabled,
      readSpeed: settings.readSpeed,
      autoExpression: settings.autoExpression,
    });
    if (theonStore.status === 'idle') {
      controller.setExpression(settings.defaultExpression);
    }
  }

  function stopAnimations() {
    cancelReveal?.();
    cancelReveal = null;
    if (thinkingTimer !== null) {
      window.clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
  }

  function scrollOutputToBottom() {
    if (!outputHost) return;
    outputHost.scrollTop = outputHost.scrollHeight;
  }

  function startThinkingMatrix(initialPhrase = 'THEON // ĐANG ĐỌC & PHÂN TÍCH...') {
    stopAnimations();
    thinkingPhrase = initialPhrase;
    let seed = 0;
    renderedOutput = renderMatrixFrame(thinkingPhrase, 0.35, seed);
    thinkingTimer = window.setInterval(() => {
      seed++;
      renderedOutput = renderMatrixFrame(thinkingPhrase, 0.25 + ((seed % 6) * 0.08), seed);
    }, 65);
  }

  function updateThinkingStep(nextPhrase: string) {
    thinkingPhrase = nextPhrase;
    if (controller) {
      controller.setReadingDocument('THEON // MULTIAGENT', nextPhrase);
    }
  }

  function revealMatrixReply(text: string) {
    stopAnimations();
    theonStore.outputText = text;
    theonStore.status = 'speaking';
    cancelReveal = startMatrixReveal(text, {
      speed: theonStore.settings.matrixTextSpeed,
      onFrame: (frame) => {
        renderedOutput = frame;
        scrollOutputToBottom();
      },
      onDone: () => {
        renderedOutput = text;
        theonStore.status = 'idle';
        scrollOutputToBottom();
      },
    });
  }

  function handleObjectClick(action: TheonObjectActionMeta) {
    if (action.kind === 'deep-link') {
      window.dispatchEvent(new CustomEvent('theolab:navigate-deep-link', { detail: action.deepLink }));
    } else if (action.kind === 'exercise') {
      dockStore.openExerciseTab(action.payload);
    } else if (action.kind === 'app') {
      dockStore.openApp(action.appId, { title: action.title, url: action.url });
    } else if (action.kind === 'url') {
      dockStore.openCustomUrl(action.url, action.title);
    } else if (action.kind === 'formula') {
      window.dispatchEvent(new CustomEvent('theolab:open-formula'));
    }
  }

  function autoResizeInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 96)}px`;
  }

  async function submitPrompt() {
    const prompt = draft.trim();
    if (!prompt || theonStore.status === 'processing') return;

    const seq = ++requestSeq;
    draft = '';
    if (inputEl) inputEl.style.height = 'auto';

    theonStore.status = 'processing';
    theonStore.expression = 'focused';

    if (controller) {
      controller.setReadingDocument('THEON // INPUT', prompt);
      controller.setMode('reading');
      controller.setExpression('focused');
    }

    startThinkingMatrix();

    try {
      const result = await runTheonTurn({
        prompt,
        history: theonStore.history,
        settings: theonStore.settings,
        handlers: {
          onStep: (line) => {
            if (seq !== requestSeq) return;
            updateThinkingStep(line);
          },
          onSetExpression: (expr) => {
            if (seq !== requestSeq) return;
            theonStore.expression = expr;
            controller?.setExpression(expr);
          },
          onSpawnBook: (opts) => {
            if (seq !== requestSeq) return;
            controller?.spawnBook(opts);
          },
          onSpawnTag: (opts) => {
            if (seq !== requestSeq) return;
            controller?.spawnNoteCard(opts);
          },
          onOpenExerciseTab: (payload) => {
            const tab = dockStore.openExerciseTab(payload);
            return { tabId: tab.id, title: tab.title };
          },
          onOpenAppTab: (appId, opts) => {
            dockStore.openApp(appId, { title: opts?.title, url: opts?.url });
            return true;
          },
          onShowGraph: (visible, mode) => {
            if (seq !== requestSeq) return;
            controller?.setPinnedGraph(visible, mode);
          },
          onClearObjects: () => {
            if (seq !== requestSeq) return;
            controller?.clearObjects();
          },
        },
      });

      if (seq !== requestSeq) return;
      theonStore.pushTurn(prompt, result.reply);

      if (controller) {
        controller.setMode('mouse');
        controller.setExpression(result.expression);
        controller.triggerNod(0.52);
      }

      revealMatrixReply(result.reply);
    } catch (error) {
      if (seq !== requestSeq) return;
      const msg = error instanceof Error ? error.message : 'Không thể kết nối AI API.';
      theonStore.status = 'error';
      theonStore.expression = 'serious';
      if (controller) {
        controller.setMode('mouse');
        controller.setExpression('serious');
      }
      revealMatrixReply(msg);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitPrompt();
    }
  }

  onMount(() => {
    let disposed = false;
    const offSettings = theonStore.onSettingsChange((next) => {
      applySettingsToEngine(next);
    });

    void import('./theonEngine.js')
      .then(({ createTheonEngine }) => {
        if (disposed || !canvasHost) return;
        const s = theonStore.settings;
        controller = createTheonEngine(canvasHost, {
          headStyle: s.headStyle,
          edgeBrightness: s.edgeBrightness,
          bgMatrixRain: s.bgMatrixRain,
          parallaxEnabled: s.parallaxEnabled,
          readSpeed: s.readSpeed,
          defaultExpression: s.defaultExpression,
          autoExpression: s.autoExpression,
          onObjectClick: (action) => handleObjectClick(action),
          onObjectHover: (info) => {
            hoverInfo = info;
          },
          onError: (err) => {
            webglError = err instanceof Error ? err.message : 'Không thể khởi tạo WebGL 3D cho Theon.';
          },
        });
        controller.setPaused(!active);
      })
      .catch((err) => {
        if (disposed) return;
        webglError = err instanceof Error ? err.message : 'Không thể tải động cơ 3D Theon.';
      });

    return () => {
      disposed = true;
      offSettings();
      stopAnimations();
      controller?.destroy();
      controller = null;
    };
  });

  $effect(() => {
    controller?.setPaused(!active);
  });

  $effect(() => {
    if (theonStore.outputText === '' && theonStore.status === 'idle') {
      renderedOutput = '';
    }
  });
</script>

<div class="theon-stage">
  <div class="theon-viewport">
    <div class="theon-canvas-host" bind:this={canvasHost}></div>
    {#if hoverInfo?.actionMeta}
      <div class="theon-object-hint" aria-live="polite">
        {hoverInfo.label} · Nhấn để mở
      </div>
    {/if}
    {#if webglError}
      <div class="theon-fallback" role="alert">
        <p>{webglError}</p>
      </div>
    {/if}
  </div>

  <div class="theon-matrix-box">
    {#if renderedOutput}
      <div
        class="theon-matrix-output"
        class:processing={theonStore.status === 'processing'}
        class:error={theonStore.status === 'error'}
        bind:this={outputHost}
        aria-live="polite"
      >
        {renderedOutput}
      </div>
    {/if}
    <textarea
      bind:this={inputEl}
      class="theon-matrix-input"
      rows="1"
      placeholder="Nhập cho Theon…"
      aria-label="Nhập câu hỏi cho Theon"
      disabled={theonStore.status === 'processing'}
      bind:value={draft}
      oninput={autoResizeInput}
      onkeydown={handleKeyDown}
    ></textarea>
  </div>
</div>

<style>
  .theon-stage {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #02050b;
    overflow: hidden;
  }

  .theon-viewport {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    background: #02050b;
    overflow: hidden;
  }

  .theon-canvas-host {
    width: 100%;
    height: 100%;
    display: block;
  }

  .theon-object-hint {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    pointer-events: none;
    padding: 4px 10px;
    background: rgba(2, 6, 16, 0.86);
    color: #93c5fd;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
    max-width: calc(100% - 24px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .theon-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    text-align: center;
    color: #93c5fd;
    font-size: 13px;
    background: #02050b;
  }

  /* Ô nhập liệu + sinh chữ trả lời dạng ma trận: hộp ngang vuông màu đen */
  .theon-matrix-box {
    flex: 0 0 auto;
    width: 100%;
    border-radius: 0;
    background: #000000;
    box-shadow: inset 0 1px 0 rgba(59, 130, 246, 0.24);
    display: flex;
    flex-direction: column;
    padding: 10px 14px 12px;
    gap: 8px;
  }

  .theon-matrix-output {
    max-height: 170px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(59, 130, 246, 0.35) transparent;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.55;
    color: #dbeafe;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    letter-spacing: 0.01em;
    text-shadow: 0 0 8px rgba(59, 130, 246, 0.32);
  }

  .theon-matrix-output.processing {
    color: #60a5fa;
  }

  .theon-matrix-output.error {
    color: #fca5a5;
    text-shadow: none;
  }

  .theon-matrix-input {
    width: 100%;
    min-height: 24px;
    max-height: 96px;
    resize: none;
    border: 0;
    border-radius: 0;
    outline: none;
    padding: 2px 0;
    background: transparent;
    color: #f8fafc;
    caret-color: #60a5fa;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.45;
  }

  .theon-matrix-input::placeholder {
    color: rgba(148, 163, 184, 0.55);
  }

  .theon-matrix-input:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>

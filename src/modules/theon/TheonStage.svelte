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
  import { renderTheonReply } from './theonReplyFormatter';
  import { createTheonVoicePlayer, createTheonVoiceRecognizer } from './theonVoice';

  let { active = true }: { active?: boolean } = $props();

  let canvasHost: HTMLDivElement | undefined = $state();
  let outputHost: HTMLDivElement | undefined = $state();
  let formattedHost: HTMLDivElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();

  let controller: TheonEngineController | null = null;
  let webglError = $state('');
  let draft = $state('');
  let renderedOutput = $state(theonStore.outputText);
  let isAnimatingMatrix = $state(false);
  let outputSource = $state<'text' | 'voice'>('text');
  let hoverInfo = $state<TheonHoverInfo | null>(null);
  let textReplayActive = $state(false);

  let cancelReveal: (() => void) | null = null;
  let thinkingTimer: number | null = null;
  let voiceResumeTimer: number | null = null;
  let thinkingPhrase = 'THEON // ĐANG ĐỌC & PHÂN TÍCH...';
  let requestSeq = 0;
  let voiceSeq = 0;

  const voicePlayer = createTheonVoicePlayer();
  const voiceRecognizer = createTheonVoiceRecognizer();

  const activeDisplayText = $derived(
    outputSource === 'voice'
      ? (theonStore.voiceReply || theonStore.outputText)
      : theonStore.outputText,
  );

  const isBusyProcessing = $derived(
    theonStore.status === 'processing' || theonStore.voicePhase === 'processing',
  );

  const hasErrorState = $derived(
    (outputSource === 'text' && theonStore.status === 'error') ||
      (outputSource === 'voice' && theonStore.voicePhase === 'error'),
  );

  const isWavePulsing = $derived(
    theonStore.voicePhase === 'listening' ||
      theonStore.voicePhase === 'speaking' ||
      textReplayActive,
  );

  const waveAmp = $derived(Math.max(0, Math.min(1, theonStore.voiceAmplitude)));

  const voicePhaseLabel = $derived.by(() => {
    switch (theonStore.voicePhase) {
      case 'listening':
        return 'ĐANG NGHE';
      case 'processing':
        return 'XỬ LÝ LỆNH THOẠI';
      case 'speaking':
        return 'THEON ĐANG NÓI';
      case 'error':
        return 'LỖI THOẠI';
      default:
        return 'SẴN SÀNG THOẠI';
    }
  });

  const voiceButtonTitle = $derived.by(() => {
    if (!theonStore.voiceActive) return 'Bật luồng thoại — nói chuyện & ra lệnh bằng giọng nói';
    if (theonStore.voicePhase === 'speaking') return 'Ngắt lời & lắng nghe tiếp';
    if (theonStore.voicePhase === 'listening' && theonStore.settings.sttProvider === 'openai') {
      return 'Gửi đoạn ghi âm ngay';
    }
    return 'Dừng luồng thoại';
  });

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
    if (theonStore.status === 'idle' && theonStore.voicePhase === 'idle') {
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
    isAnimatingMatrix = false;
  }

  function clearVoiceResumeTimer() {
    if (voiceResumeTimer !== null) {
      window.clearTimeout(voiceResumeTimer);
      voiceResumeTimer = null;
    }
  }

  function setLiveAmplitude(level: number, driveLipSync: boolean) {
    const clamped = Math.max(0, Math.min(1, level));
    theonStore.voiceAmplitude = clamped;
    controller?.setSpeechAmplitude(driveLipSync ? clamped : 0);
  }

  function scrollOutputToBottom() {
    if (!outputHost) return;
    outputHost.scrollTop = outputHost.scrollHeight;
  }

  function startThinkingMatrix(initialPhrase = 'THEON // ĐANG ĐỌC & PHÂN TÍCH...') {
    stopAnimations();
    isAnimatingMatrix = true;
    thinkingPhrase = initialPhrase;
    let seed = 0;
    renderedOutput = renderMatrixFrame(thinkingPhrase, 0.35, seed);
    thinkingTimer = window.setInterval(() => {
      seed++;
      renderedOutput = renderMatrixFrame(thinkingPhrase, 0.25 + (seed % 6) * 0.08, seed);
    }, 65);
  }

  function updateThinkingStep(nextPhrase: string) {
    thinkingPhrase = nextPhrase;
    if (controller) {
      controller.setReadingDocument('THEON // MULTIAGENT', nextPhrase);
    }
  }

  function revealMatrixReply(text: string, source: 'text' | 'voice') {
    stopAnimations();
    outputSource = source;
    if (source === 'text') {
      theonStore.outputText = text;
      theonStore.status = 'speaking';
    } else {
      theonStore.voiceReply = text;
    }
    isAnimatingMatrix = true;
    cancelReveal = startMatrixReveal(text, {
      speed: theonStore.settings.matrixTextSpeed,
      onFrame: (frame) => {
        renderedOutput = frame;
        scrollOutputToBottom();
      },
      onDone: () => {
        renderedOutput = text;
        isAnimatingMatrix = false;
        if (source === 'text') {
          theonStore.status = 'idle';
        }
        scrollOutputToBottom();
      },
    });
  }

  function buildToolHandlers(isStale: () => boolean) {
    return {
      onStep: (line: string) => {
        if (isStale()) return;
        updateThinkingStep(line);
      },
      onSetExpression: (expr: typeof theonStore.expression) => {
        if (isStale()) return;
        theonStore.expression = expr;
        controller?.setExpression(expr);
      },
      onSpawnBook: (opts: Parameters<TheonEngineController['spawnBook']>[0]) => {
        if (isStale()) return;
        controller?.spawnBook(opts);
      },
      onSpawnTag: (opts: Parameters<TheonEngineController['spawnNoteCard']>[0]) => {
        if (isStale()) return;
        controller?.spawnNoteCard(opts);
      },
      onOpenExerciseTab: (payload: Parameters<typeof dockStore.openExerciseTab>[0]) => {
        const tab = dockStore.openExerciseTab(payload);
        return { tabId: tab.id, title: tab.title };
      },
      onOpenAppTab: (appId: string, opts?: { title?: string; url?: string }) => {
        dockStore.openApp(appId, { title: opts?.title, url: opts?.url });
        return true;
      },
      onDrawChart: (spec: Parameters<TheonEngineController['setScreenChart']>[0]) => {
        if (isStale()) return;
        controller?.setScreenChart(spec);
      },
      onClearObjects: () => {
        if (isStale()) return;
        controller?.clearObjects();
      },
    };
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

  function handleDeepLink(deepLink: string) {
    window.dispatchEvent(new CustomEvent('theolab:navigate-deep-link', { detail: deepLink }));
  }

  function autoResizeInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 96)}px`;
  }

  // ── LUỒNG 1: GÕ CHỮ (Text Stream — giữ nguyên hành vi cũ) ─────────────────
  async function submitPrompt() {
    const prompt = draft.trim();
    if (!prompt || theonStore.status === 'processing') return;

    const seq = ++requestSeq;
    draft = '';
    if (inputEl) inputEl.style.height = 'auto';

    outputSource = 'text';
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
        mode: 'text',
        handlers: buildToolHandlers(() => seq !== requestSeq),
      });

      if (seq !== requestSeq) return;
      theonStore.pushTurn(prompt, result.reply);

      if (controller) {
        controller.setMode('mouse');
        controller.setExpression(result.expression);
        controller.triggerNod(0.52);
      }

      revealMatrixReply(result.reply, 'text');

      if (theonStore.settings.ttsAutoSpeakText && !theonStore.voiceActive) {
        void speakTextOnDemand(result.reply);
      }
    } catch (error) {
      if (seq !== requestSeq) return;
      const msg = error instanceof Error ? error.message : 'Không thể kết nối AI API.';
      theonStore.status = 'error';
      theonStore.expression = 'serious';
      if (controller) {
        controller.setMode('mouse');
        controller.setExpression('serious');
      }
      revealMatrixReply(msg, 'text');
    }
  }

  async function speakTextOnDemand(text: string) {
    if (!text.trim()) return;
    if (textReplayActive) {
      voicePlayer.stop();
      textReplayActive = false;
      setLiveAmplitude(0, true);
      return;
    }
    textReplayActive = true;
    await voicePlayer.speak(text, theonStore.settings, {
      onAmplitude: (level) => setLiveAmplitude(level, true),
      onEnd: () => {
        textReplayActive = false;
        setLiveAmplitude(0, true);
      },
      onError: () => {
        textReplayActive = false;
        setLiveAmplitude(0, true);
      },
    });
  }

  // ── LUỒNG 2: THOẠI & RA LỆNH GIỌNG NÓI (Voice Stream — tách biệt) ─────────
  function stopVoiceStream() {
    voiceSeq += 1;
    clearVoiceResumeTimer();
    voiceRecognizer.stop();
    voicePlayer.stop();
    textReplayActive = false;
    theonStore.voiceActive = false;
    theonStore.voicePhase = 'idle';
    theonStore.voiceStatusNote = '';
    setLiveAmplitude(0, true);
    if (controller && theonStore.status === 'idle') {
      controller.setMode('mouse');
      controller.setExpression(theonStore.settings.defaultExpression);
    }
  }

  async function beginVoiceListening(seq: number) {
    if (!theonStore.voiceActive || seq !== voiceSeq) return;
    clearVoiceResumeTimer();
    voicePlayer.stop();
    textReplayActive = false;

    theonStore.voicePhase = 'listening';
    theonStore.voiceStatusNote = '';
    theonStore.voiceTranscript = '';
    setLiveAmplitude(0, false);

    if (controller) {
      controller.setMode('mouse');
      controller.setExpression('friendly');
    }

    await voiceRecognizer.start(theonStore.settings, {
      onInterim: (text) => {
        if (seq !== voiceSeq || !theonStore.voiceActive) return;
        theonStore.voiceTranscript = text;
      },
      onFinal: (spokenText) => {
        if (seq !== voiceSeq || !theonStore.voiceActive) return;
        void runVoiceTurn(spokenText, seq);
      },
      onAmplitude: (level) => {
        if (seq !== voiceSeq || !theonStore.voiceActive) return;
        setLiveAmplitude(level, false);
      },
      onError: (msg) => {
        if (seq !== voiceSeq) return;
        theonStore.voicePhase = 'error';
        theonStore.voiceStatusNote = msg;
        theonStore.voiceActive = false;
        setLiveAmplitude(0, true);
      },
      onEnd: () => {
        if (seq !== voiceSeq) return;
        setLiveAmplitude(0, false);
        if (theonStore.voiceActive && theonStore.voicePhase === 'listening') {
          if (theonStore.settings.voiceContinuous) {
            voiceResumeTimer = window.setTimeout(() => {
              void beginVoiceListening(seq);
            }, 420);
          } else {
            theonStore.voiceActive = false;
            theonStore.voicePhase = 'idle';
          }
        }
      },
    });
  }

  async function runVoiceTurn(spokenText: string, seq: number) {
    const clean = spokenText.trim();
    if (!clean || seq !== voiceSeq) return;

    theonStore.voiceTranscript = clean;
    theonStore.voicePhase = 'processing';
    theonStore.voiceStatusNote = 'Đang suy luận & gọi công cụ…';
    setLiveAmplitude(0.18, false);
    outputSource = 'voice';

    if (controller) {
      controller.setReadingDocument('THEON // VOICE CMD', clean);
      controller.setMode('reading');
      controller.setExpression('focused');
    }

    startThinkingMatrix('THEON // ĐANG XỬ LÝ LỆNH GIỌNG NÓI...');

    try {
      const result = await runTheonTurn({
        prompt: clean,
        history: theonStore.voiceHistory,
        settings: theonStore.settings,
        mode: 'voice',
        handlers: buildToolHandlers(() => seq !== voiceSeq),
      });

      if (seq !== voiceSeq || !theonStore.voiceActive) return;

      theonStore.pushVoiceTurn(clean, result.reply);
      if (controller) {
        controller.setMode('mouse');
        controller.setExpression(result.expression);
        controller.triggerNod(0.55);
      }

      revealMatrixReply(result.reply, 'voice');

      theonStore.voicePhase = 'speaking';
      theonStore.voiceStatusNote = 'Đang tổng hợp giọng nói…';

      await voicePlayer.speak(result.reply, theonStore.settings, {
        onAmplitude: (level) => {
          if (seq !== voiceSeq) return;
          setLiveAmplitude(level, true);
        },
        onStart: (note) => {
          if (seq !== voiceSeq) return;
          theonStore.voiceStatusNote = note || 'Đang nói…';
        },
        onEnd: () => {
          if (seq !== voiceSeq) return;
          setLiveAmplitude(0, true);
          theonStore.voiceStatusNote = '';
          if (theonStore.voiceActive && theonStore.settings.voiceContinuous) {
            voiceResumeTimer = window.setTimeout(() => {
              void beginVoiceListening(seq);
            }, 360);
          } else {
            theonStore.voiceActive = false;
            theonStore.voicePhase = 'idle';
          }
        },
        onError: (msg) => {
          if (seq !== voiceSeq) return;
          setLiveAmplitude(0, true);
          theonStore.voicePhase = 'error';
          theonStore.voiceStatusNote = msg;
          theonStore.voiceActive = false;
        },
      });
    } catch (error) {
      if (seq !== voiceSeq) return;
      const msg = error instanceof Error ? error.message : 'Không thể xử lý lệnh thoại.';
      setLiveAmplitude(0, true);
      theonStore.voicePhase = 'error';
      theonStore.voiceStatusNote = msg;
      theonStore.voiceActive = false;
      if (controller) {
        controller.setMode('mouse');
        controller.setExpression('serious');
      }
      revealMatrixReply(msg, 'voice');
    }
  }

  function handleVoiceButtonClick() {
    if (!theonStore.voiceActive) {
      const seq = ++voiceSeq;
      theonStore.voiceActive = true;
      void beginVoiceListening(seq);
      return;
    }

    if (theonStore.voicePhase === 'speaking') {
      // Barge-in: interrupt TTS and immediately listen for next command.
      const seq = ++voiceSeq;
      voicePlayer.stop();
      setLiveAmplitude(0, true);
      void beginVoiceListening(seq);
      return;
    }

    if (theonStore.voicePhase === 'listening' && theonStore.settings.sttProvider === 'openai') {
      // Finish push-to-talk recording and send to Whisper.
      voiceRecognizer.commitCurrent();
      return;
    }

    stopVoiceStream();
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
      stopVoiceStream();
      controller?.destroy();
      controller = null;
    };
  });

  $effect(() => {
    controller?.setPaused(!active);
    if (!active && theonStore.voiceActive) {
      stopVoiceStream();
    }
  });

  $effect(() => {
    if (theonStore.outputText === '' && theonStore.status === 'idle' && outputSource === 'text') {
      renderedOutput = '';
    }
  });

  // Render formatted Markdown + KaTeX + mhchem whenever Matrix reveal completes.
  $effect(() => {
    const host = formattedHost;
    const text = activeDisplayText;
    const animating = isAnimatingMatrix;
    if (!host || animating || !text) return;
    renderTheonReply(host, text, { onDeepLink: handleDeepLink });
    scrollOutputToBottom();
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
    {#if theonStore.voiceActive || theonStore.voicePhase === 'error'}
      <div class="theon-voice-bar" data-phase={theonStore.voicePhase} aria-live="polite">
        <span class="theon-voice-dot" aria-hidden="true"></span>
        <span class="theon-voice-phase">{voicePhaseLabel}</span>
        {#if theonStore.voiceTranscript}
          <span class="theon-voice-transcript" title={theonStore.voiceTranscript}>
            “{theonStore.voiceTranscript}”
          </span>
        {:else if theonStore.voiceStatusNote}
          <span class="theon-voice-note">{theonStore.voiceStatusNote}</span>
        {/if}
        <div class="theon-voice-actions">
          {#if theonStore.voicePhase === 'speaking'}
            <button
              type="button"
              class="theon-voice-chip"
              onclick={handleVoiceButtonClick}
              title="Ngắt lời Theon để nói tiếp"
            >
              Nói tiếp
            </button>
          {/if}
          <button
            type="button"
            class="theon-voice-chip danger"
            onclick={stopVoiceStream}
            aria-label="Tắt luồng thoại"
          >
            Tắt
          </button>
        </div>
      </div>
    {/if}

    {#if renderedOutput || activeDisplayText}
      <div
        class="theon-matrix-output"
        class:processing={isBusyProcessing}
        class:error={hasErrorState}
        bind:this={outputHost}
        aria-live="polite"
      >
        {#if !isAnimatingMatrix && activeDisplayText}
          <div class="theon-output-tools">
            <span class="theon-stream-badge">
              {outputSource === 'voice' ? 'LUỒNG THOẠI' : 'THEON'}
            </span>
            <button
              type="button"
              class="theon-speak-mini"
              class:active={textReplayActive}
              onclick={() => void speakTextOnDemand(activeDisplayText)}
              title={textReplayActive ? 'Dừng đọc' : 'Đọc thành tiếng câu trả lời này'}
              aria-label={textReplayActive ? 'Dừng đọc' : 'Đọc thành tiếng câu trả lời này'}
            >
              {textReplayActive ? '⏹' : '🔊'}
            </button>
          </div>
          <div class="theon-formatted-output" bind:this={formattedHost}></div>
        {:else}
          <div class="theon-matrix-raw">{renderedOutput}</div>
        {/if}
      </div>
    {/if}

    <div class="theon-input-row">
      <button
        type="button"
        class="theon-voice-btn"
        class:active={theonStore.voiceActive || textReplayActive}
        class:listening={theonStore.voicePhase === 'listening'}
        class:processing={theonStore.voicePhase === 'processing'}
        class:speaking={theonStore.voicePhase === 'speaking' || textReplayActive}
        class:error={theonStore.voicePhase === 'error'}
        class:pulsing={isWavePulsing}
        style:--amp={waveAmp.toFixed(3)}
        onclick={handleVoiceButtonClick}
        title={voiceButtonTitle}
        aria-label={voiceButtonTitle}
        aria-pressed={theonStore.voiceActive}
      >
        <span class="theon-wave" aria-hidden="true">
          <span class="theon-wave-bar b1"></span>
          <span class="theon-wave-bar b2"></span>
          <span class="theon-wave-bar b3"></span>
          <span class="theon-wave-bar b4"></span>
          <span class="theon-wave-bar b5"></span>
        </span>
      </button>

      <textarea
        bind:this={inputEl}
        class="theon-matrix-input"
        rows="1"
        placeholder="Nhập cho Theon… (hoặc nhấn sóng âm bên trái để thoại)"
        aria-label="Nhập câu hỏi cho Theon"
        disabled={theonStore.status === 'processing'}
        bind:value={draft}
        oninput={autoResizeInput}
        onkeydown={handleKeyDown}
      ></textarea>
    </div>
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
    border-radius: 999px;
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

  /* Ô nhập liệu + sinh chữ trả lời dạng ma trận */
  .theon-matrix-box {
    flex: 0 0 auto;
    width: 100%;
    border-radius: 0;
    background: #000000;
    box-shadow: inset 0 1px 0 rgba(59, 130, 246, 0.24);
    display: flex;
    flex-direction: column;
    padding: 10px 12px 12px;
    gap: 8px;
  }

  /* Thanh trạng thái luồng thoại */
  .theon-voice-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.9);
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 11px;
    color: #cbd5e1;
    min-height: 30px;
  }

  .theon-voice-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #60a5fa;
    flex: 0 0 auto;
  }

  .theon-voice-bar[data-phase='listening'] .theon-voice-dot {
    background: #34d399;
    box-shadow: 0 0 8px rgba(52, 211, 153, 0.85);
  }

  .theon-voice-bar[data-phase='speaking'] .theon-voice-dot {
    background: #38bdf8;
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.85);
  }

  .theon-voice-bar[data-phase='error'] .theon-voice-dot {
    background: #f87171;
  }

  .theon-voice-phase {
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #93c5fd;
    flex: 0 0 auto;
  }

  .theon-voice-bar[data-phase='listening'] .theon-voice-phase {
    color: #6ee7b7;
  }

  .theon-voice-bar[data-phase='speaking'] .theon-voice-phase {
    color: #7dd3fc;
  }

  .theon-voice-bar[data-phase='error'] .theon-voice-phase {
    color: #fca5a5;
  }

  .theon-voice-transcript,
  .theon-voice-note {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e2e8f0;
  }

  .theon-voice-note {
    color: #94a3b8;
  }

  .theon-voice-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }

  .theon-voice-chip {
    border: 0;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    font-family: inherit;
    background: rgba(56, 189, 248, 0.18);
    color: #bae6fd;
    cursor: pointer;
  }

  .theon-voice-chip:hover {
    background: rgba(56, 189, 248, 0.3);
  }

  .theon-voice-chip.danger {
    background: rgba(248, 113, 113, 0.18);
    color: #fecaca;
  }

  .theon-voice-chip.danger:hover {
    background: rgba(248, 113, 113, 0.32);
  }

  .theon-matrix-output {
    max-height: 210px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(59, 130, 246, 0.35) transparent;
    font-size: 13px;
    line-height: 1.55;
    color: #dbeafe;
    overflow-wrap: anywhere;
  }

  .theon-matrix-output.processing {
    color: #60a5fa;
  }

  .theon-matrix-output.error {
    color: #fca5a5;
  }

  .theon-output-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .theon-stream-badge {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: rgba(147, 197, 253, 0.72);
  }

  .theon-speak-mini {
    border: 0;
    border-radius: 6px;
    padding: 2px 6px;
    background: rgba(59, 130, 246, 0.14);
    color: #bae6fd;
    font-size: 11px;
    cursor: pointer;
    line-height: 1.2;
  }

  .theon-speak-mini:hover,
  .theon-speak-mini.active {
    background: rgba(56, 189, 248, 0.3);
  }

  .theon-matrix-raw {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    white-space: pre-wrap;
    letter-spacing: 0.01em;
    text-shadow: 0 0 8px rgba(59, 130, 246, 0.32);
  }

  /* Formatted Markdown + KaTeX inside Theon dark panel */
  .theon-formatted-output {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #e2e8f0;
  }

  .theon-formatted-output :global(.theon-md-p) {
    margin: 0 0 6px;
  }

  .theon-formatted-output :global(.theon-md-p:last-child) {
    margin-bottom: 0;
  }

  .theon-formatted-output :global(.theon-md-h2),
  .theon-formatted-output :global(.theon-md-h3),
  .theon-formatted-output :global(.theon-md-h4) {
    margin: 8px 0 4px;
    color: #93c5fd;
    font-weight: 700;
    line-height: 1.35;
  }

  .theon-formatted-output :global(.theon-md-h2) {
    font-size: 14px;
  }

  .theon-formatted-output :global(.theon-md-h3),
  .theon-formatted-output :global(.theon-md-h4) {
    font-size: 13px;
  }

  .theon-formatted-output :global(.theon-md-list) {
    margin: 4px 0 6px;
    padding-left: 18px;
  }

  .theon-formatted-output :global(.theon-md-list li) {
    margin: 2px 0;
  }

  .theon-formatted-output :global(.theon-md-quote) {
    margin: 6px 0;
    padding: 4px 10px;
    border-radius: 6px;
    background: rgba(59, 130, 246, 0.12);
    color: #bfdbfe;
  }

  .theon-formatted-output :global(.theon-inline-code) {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 12px;
    padding: 1px 5px;
    border-radius: 5px;
    background: rgba(30, 41, 59, 0.9);
    color: #7dd3fc;
  }

  .theon-formatted-output :global(.theon-code-block) {
    margin: 6px 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.95);
    color: #cbd5e1;
    overflow-x: auto;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
  }

  .theon-formatted-output :global(.theon-math-block) {
    margin: 6px 0;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.72);
    overflow-x: auto;
    color: #f0f9ff;
  }

  .theon-formatted-output :global(.theon-math-inline) {
    color: #f0f9ff;
  }

  .theon-formatted-output :global(.katex) {
    font-size: 1.04em;
    color: #f0f9ff;
  }

  .theon-formatted-output :global(.theon-table-wrap) {
    overflow-x: auto;
    margin: 6px 0;
  }

  .theon-formatted-output :global(.theon-md-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .theon-formatted-output :global(.theon-md-table th),
  .theon-formatted-output :global(.theon-md-table td) {
    padding: 4px 8px;
    text-align: left;
    background: rgba(15, 23, 42, 0.7);
  }

  .theon-formatted-output :global(.theon-md-table th) {
    color: #93c5fd;
    background: rgba(30, 58, 138, 0.35);
    font-weight: 600;
  }

  .theon-formatted-output :global(.theon-deep-link),
  .theon-formatted-output :global(.theon-ext-link) {
    border: 0;
    border-radius: 6px;
    padding: 1px 6px;
    background: rgba(56, 189, 248, 0.18);
    color: #7dd3fc;
    font-size: 12px;
    text-decoration: none;
    cursor: pointer;
  }

  .theon-formatted-output :global(.theon-deep-link:hover),
  .theon-formatted-output :global(.theon-ext-link:hover) {
    background: rgba(56, 189, 248, 0.32);
    color: #e0f2fe;
  }

  .theon-formatted-output :global(.theon-hr) {
    border: 0;
    height: 1px;
    margin: 8px 0;
    background: rgba(59, 130, 246, 0.25);
  }

  /* Hàng nhập liệu: nút sóng âm bên TRÁI + ô nhập chữ bên phải */
  .theon-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .theon-voice-btn {
    --amp: 0;
    position: relative;
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 10px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(59, 130, 246, 0.14);
    color: #93c5fd;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, box-shadow 120ms ease, transform 90ms ease;
  }

  .theon-voice-btn:hover {
    background: rgba(59, 130, 246, 0.26);
    color: #dbeafe;
  }

  .theon-voice-btn.listening {
    background: rgba(16, 185, 129, 0.22);
    color: #6ee7b7;
    box-shadow: 0 0 calc(8px + var(--amp) * 16px) rgba(52, 211, 153, calc(0.32 + var(--amp) * 0.5));
  }

  .theon-voice-btn.processing {
    background: rgba(59, 130, 246, 0.28);
    color: #93c5fd;
    box-shadow: 0 0 12px rgba(96, 165, 250, 0.45);
  }

  .theon-voice-btn.speaking {
    background: rgba(14, 165, 233, 0.26);
    color: #38bdf8;
    box-shadow: 0 0 calc(8px + var(--amp) * 18px) rgba(56, 189, 248, calc(0.38 + var(--amp) * 0.55));
    transform: scale(calc(1 + var(--amp) * 0.08));
  }

  .theon-voice-btn.error {
    background: rgba(239, 68, 68, 0.22);
    color: #fca5a5;
  }

  .theon-wave {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2.5px;
    height: 18px;
  }

  .theon-wave-bar {
    width: 2.6px;
    height: 16px;
    border-radius: 999px;
    background: currentColor;
    transform-origin: center;
    transition: transform 60ms linear;
  }

  /* Idle icon: balanced compact sound-wave glyph */
  .theon-wave-bar.b1 { transform: scaleY(0.32); }
  .theon-wave-bar.b2 { transform: scaleY(0.62); }
  .theon-wave-bar.b3 { transform: scaleY(0.92); }
  .theon-wave-bar.b4 { transform: scaleY(0.62); }
  .theon-wave-bar.b5 { transform: scaleY(0.32); }

  /* Processing state: gentle wave ripple */
  .theon-voice-btn.processing .theon-wave-bar {
    animation: theonWaveIdle 1.05s ease-in-out infinite;
  }
  .theon-voice-btn.processing .theon-wave-bar.b1 { animation-delay: 0ms; }
  .theon-voice-btn.processing .theon-wave-bar.b2 { animation-delay: 120ms; }
  .theon-voice-btn.processing .theon-wave-bar.b3 { animation-delay: 240ms; }
  .theon-voice-btn.processing .theon-wave-bar.b4 { animation-delay: 360ms; }
  .theon-voice-btn.processing .theon-wave-bar.b5 { animation-delay: 480ms; }

  /* Active listening / speaking: bars vibrate in real time to live audio --amp */
  .theon-voice-btn.pulsing .theon-wave-bar.b1 {
    transform: scaleY(clamp(0.22, calc(0.22 + var(--amp) * 0.72), 1.08));
  }
  .theon-voice-btn.pulsing .theon-wave-bar.b2 {
    transform: scaleY(clamp(0.28, calc(0.32 + var(--amp) * 0.96), 1.18));
  }
  .theon-voice-btn.pulsing .theon-wave-bar.b3 {
    transform: scaleY(clamp(0.34, calc(0.42 + var(--amp) * 1.18), 1.25));
  }
  .theon-voice-btn.pulsing .theon-wave-bar.b4 {
    transform: scaleY(clamp(0.28, calc(0.30 + var(--amp) * 0.92), 1.16));
  }
  .theon-voice-btn.pulsing .theon-wave-bar.b5 {
    transform: scaleY(clamp(0.22, calc(0.20 + var(--amp) * 0.68), 1.05));
  }

  @keyframes theonWaveIdle {
    0%, 100% { transform: scaleY(0.28); }
    50% { transform: scaleY(0.95); }
  }

  .theon-matrix-input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 24px;
    max-height: 96px;
    resize: none;
    border: 0;
    border-radius: 0;
    outline: none;
    padding: 4px 0;
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

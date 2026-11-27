/**
 * Theon Voice Runtime:
 * - AI TTS synthesis (Google Gemini Native TTS, OpenAI TTS, Custom OpenAI-compatible TTS)
 *   with automatic Web Speech API fallback.
 * - Real-time Web Audio AnalyserNode amplitude metering (0..1) to drive both the left
 *   waveform pulse button and Theon's 3D mouth/jaw lip-sync.
 * - Voice command recognition (Browser SpeechRecognition + optional OpenAI Whisper/Transcribe).
 *
 * Security: API keys are read on-demand from `resolveProviderApiKey()` and never logged or stored.
 */
import { aiConfigStore, resolveProviderApiKey } from '../../core/aiConfigStore.svelte';
import { isAllowedProviderBaseUrl } from '../../domain/ai/providerCatalog';
import { getLocalSetting } from '../../core/dataGateway.js';
import type { TheonSettings, TheonTtsProvider } from './theonConfig';
import { stripFormattingForSpeech } from './theonReplyFormatter';

export const DEFAULT_GOOGLE_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Wrap raw little-endian 16-bit PCM samples in a valid 44-byte RIFF/WAVE header.
 */
export function pcm16ToWavBytes(
  pcmBytes: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.byteLength;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  out.set(pcmBytes, 44);
  return out;
}

export function pcm16ToWavBlob(
  pcmBytes: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
): Blob {
  const bytes = pcm16ToWavBytes(pcmBytes, sampleRate, numChannels);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'audio/wav' });
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function parseSampleRateFromMime(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match?.[1]) return 24000;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 96000 ? parsed : 24000;
}

export function resolveOpenAiTtsEndpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (/\/audio\/speech$/i.test(clean)) return clean;
  const stripped = clean.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
  return `${stripped}/audio/speech`;
}

export function resolveEffectiveTtsProvider(
  settings: Pick<TheonSettings, 'ttsProvider' | 'ttsCustomProviderId'>,
): Exclude<TheonTtsProvider, 'auto'> {
  if (settings.ttsProvider !== 'auto') return settings.ttsProvider;
  if (resolveProviderApiKey('google')) return 'google';
  if (resolveProviderApiKey('openai')) return 'openai';
  return 'browser';
}

async function synthesizeGoogleTts(
  spokenText: string,
  settings: TheonSettings,
  signal?: AbortSignal,
): Promise<Blob> {
  const apiKey = resolveProviderApiKey('google');
  if (!apiKey) {
    throw new Error('Chưa cấu hình Google AI Studio API Key cho Gemini TTS.');
  }
  const model = settings.ttsModel.trim() || DEFAULT_GOOGLE_TTS_MODEL;
  const voiceName = settings.ttsVoice.trim() || 'Kore';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Đọc tự nhiên, rõ ràng bằng tiếng Việt đoạn sau (không thêm lời mở đầu):\n${spokenText}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };

  if (!response.ok) {
    throw new Error(body.error?.message || `Gemini TTS trả về HTTP ${response.status}.`);
  }

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((p) => p.inlineData?.data);
  if (!audioPart?.inlineData?.data) {
    throw new Error('Gemini TTS không trả về dữ liệu âm thanh.');
  }

  const mime = (audioPart.inlineData.mimeType || 'audio/L16;rate=24000').toLowerCase();
  const rawBytes = decodeBase64ToBytes(audioPart.inlineData.data);
  if (mime.includes('l16') || mime.includes('pcm')) {
    return pcm16ToWavBlob(rawBytes, parseSampleRateFromMime(mime), 1);
  }
  const buffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: mime || 'audio/wav' });
}

async function synthesizeOpenAiCompatibleTts(
  endpoint: string,
  apiKey: string,
  model: string,
  voice: string,
  speed: number,
  spokenText: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model,
      voice,
      input: spokenText,
      speed: clamp(speed, 0.25, 4.0),
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(errText.slice(0, 180) || `TTS API trả về HTTP ${response.status}.`);
  }

  return await response.blob();
}

export interface SpeakCallbacks {
  onAmplitude: (level: number) => void;
  onStart?: (note?: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface TheonVoicePlayer {
  speak: (rawText: string, settings: TheonSettings, callbacks: SpeakCallbacks) => Promise<void>;
  stop: () => void;
  isSpeaking: () => boolean;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createTheonVoicePlayer(): TheonVoicePlayer {
  let activeAbort: AbortController | null = null;
  let activeAudio: HTMLAudioElement | null = null;
  let activeObjectUrl: string | null = null;
  let audioCtx: AudioContext | null = null;
  let rafId = 0;
  let syntheticTimer: number | null = null;
  let speaking = false;
  let activeSeq = 0;

  function cleanupAudio(onAmplitude?: (level: number) => void) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (syntheticTimer !== null) {
      window.clearInterval(syntheticTimer);
      syntheticTimer = null;
    }
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.src = '';
      } catch {
        // Ignore teardown errors
      }
      activeAudio = null;
    }
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    speaking = false;
    onAmplitude?.(0);
  }

  function stop() {
    activeSeq += 1;
    activeAbort?.abort();
    activeAbort = null;
    cleanupAudio();
  }

  async function playBlobWithMeter(
    blob: Blob,
    speed: number,
    seq: number,
    callbacks: SpeakCallbacks,
  ): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      activeObjectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      audio.crossOrigin = 'anonymous';
      audio.playbackRate = clamp(speed, 0.7, 1.6);
      activeAudio = audio;

      let analyser: AnalyserNode | null = null;
      let dataArray: Uint8Array<ArrayBuffer> | null = null;

      try {
        const Ctor = getAudioContextCtor();
        if (Ctor) {
          if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new Ctor();
          }
          if (audioCtx.state === 'suspended') {
            void audioCtx.resume();
          }
          const source = audioCtx.createMediaElementSource(audio);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.72;
          source.connect(analyser);
          analyser.connect(audioCtx.destination);
          dataArray = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        }
      } catch {
        analyser = null;
        dataArray = null;
      }

      const pumpAmplitude = () => {
        if (!speaking || seq !== activeSeq) return;
        let level = 0;
        if (analyser && dataArray) {
          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const centered = ((dataArray[i] ?? 128) - 128) / 128;
            sumSq += centered * centered;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          level = clamp(rms * 3.8, 0, 1);
        } else {
          const t = performance.now() * 0.014;
          level = clamp(0.28 + Math.abs(Math.sin(t)) * 0.45, 0, 1);
        }
        callbacks.onAmplitude(level);
        rafId = requestAnimationFrame(pumpAmplitude);
      };

      const finish = () => {
        if (seq !== activeSeq) {
          resolve();
          return;
        }
        cleanupAudio(callbacks.onAmplitude);
        callbacks.onEnd?.();
        resolve();
      };

      audio.onended = finish;
      audio.onerror = () => {
        if (seq !== activeSeq) {
          resolve();
          return;
        }
        cleanupAudio(callbacks.onAmplitude);
        reject(new Error('Không thể phát âm thanh TTS.'));
      };

      speaking = true;
      rafId = requestAnimationFrame(pumpAmplitude);
      audio.play().catch((err) => {
        if (seq !== activeSeq) {
          resolve();
          return;
        }
        cleanupAudio(callbacks.onAmplitude);
        reject(err instanceof Error ? err : new Error('Trình duyệt chặn phát âm thanh tự động.'));
      });
    });
  }

  async function speakWithBrowserSpeech(
    spokenText: string,
    settings: TheonSettings,
    seq: number,
    callbacks: SpeakCallbacks,
  ): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('Trình duyệt không hỗ trợ tổng hợp giọng nói Web Speech.');
    }

    return await new Promise<void>((resolve, reject) => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = settings.voiceLang || 'vi-VN';
      utterance.rate = clamp(settings.ttsSpeed, 0.65, 1.8);
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const langPrefix = (settings.voiceLang || 'vi-VN').toLowerCase().slice(0, 2);
      const preferred =
        voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix) && /natural|neural|google|microsoft|linh|an|hoai/i.test(v.name)) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
      if (preferred) utterance.voice = preferred;

      let phase = 0;
      let boundaryBoost = 0;

      utterance.onboundary = () => {
        boundaryBoost = 0.35;
      };

      utterance.onstart = () => {
        if (seq !== activeSeq) return;
        speaking = true;
        syntheticTimer = window.setInterval(() => {
          if (!speaking || seq !== activeSeq) return;
          phase += 0.42;
          boundaryBoost *= 0.72;
          const wave =
            0.22 +
            Math.abs(Math.sin(phase)) * 0.36 +
            Math.abs(Math.sin(phase * 2.3 + 0.8)) * 0.22 +
            boundaryBoost;
          callbacks.onAmplitude(clamp(wave, 0.08, 0.96));
        }, 55);
      };

      utterance.onend = () => {
        if (seq !== activeSeq) {
          resolve();
          return;
        }
        cleanupAudio(callbacks.onAmplitude);
        callbacks.onEnd?.();
        resolve();
      };

      utterance.onerror = (ev) => {
        if (seq !== activeSeq || ev.error === 'canceled' || ev.error === 'interrupted') {
          resolve();
          return;
        }
        cleanupAudio(callbacks.onAmplitude);
        reject(new Error(`Lỗi giọng nói trình duyệt: ${ev.error}`));
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  async function speak(
    rawText: string,
    settings: TheonSettings,
    callbacks: SpeakCallbacks,
  ): Promise<void> {
    stop();
    const seq = ++activeSeq;
    const spoken = stripFormattingForSpeech(rawText).slice(0, 1400);
    if (!spoken) {
      callbacks.onEnd?.();
      return;
    }

    const abort = new AbortController();
    activeAbort = abort;
    const effective = resolveEffectiveTtsProvider(settings);

    if (effective === 'browser') {
      callbacks.onStart?.('Giọng trình duyệt');
      try {
        await speakWithBrowserSpeech(spoken, settings, seq, callbacks);
      } catch (err) {
        if (seq === activeSeq) {
          callbacks.onError?.(err instanceof Error ? err.message : 'Lỗi phát giọng nói.');
        }
      }
      return;
    }

    try {
      let blob: Blob;
      let label = '';

      if (effective === 'google') {
        label = `Gemini TTS (${settings.ttsVoice || 'Kore'})`;
        blob = await synthesizeGoogleTts(spoken, settings, abort.signal);
      } else if (effective === 'openai') {
        const apiKey = resolveProviderApiKey('openai');
        if (!apiKey) throw new Error('Chưa cấu hình OpenAI API Key cho OpenAI TTS.');
        const model = settings.ttsModel.trim() || DEFAULT_OPENAI_TTS_MODEL;
        const voice = settings.ttsVoice.trim() || 'alloy';
        label = `OpenAI TTS (${voice})`;
        blob = await synthesizeOpenAiCompatibleTts(
          'https://api.openai.com/v1/audio/speech',
          apiKey,
          model,
          voice,
          settings.ttsSpeed,
          spoken,
          abort.signal,
        );
      } else {
        const customId = settings.ttsCustomProviderId || 'custom';
        const providerCfg = aiConfigStore.getProvider(customId);
        const baseUrl =
          providerCfg?.baseUrl || (customId === 'custom' ? getLocalSetting('custom-endpoint', '') : '');
        if (!baseUrl || !isAllowedProviderBaseUrl(baseUrl)) {
          throw new Error('Chưa cấu hình Base URL hợp lệ cho Custom TTS.');
        }
        const apiKey = resolveProviderApiKey(customId);
        const model = settings.ttsModel.trim() || DEFAULT_OPENAI_TTS_MODEL;
        const voice = settings.ttsVoice.trim() || 'alloy';
        label = `Custom TTS (${voice})`;
        blob = await synthesizeOpenAiCompatibleTts(
          resolveOpenAiTtsEndpoint(baseUrl),
          apiKey,
          model,
          voice,
          settings.ttsSpeed,
          spoken,
          abort.signal,
        );
      }

      if (seq !== activeSeq || abort.signal.aborted) return;
      callbacks.onStart?.(label);
      const playbackSpeed = effective === 'google' ? settings.ttsSpeed : 1.0;
      await playBlobWithMeter(blob, playbackSpeed, seq, callbacks);
    } catch (err) {
      if (seq !== activeSeq || abort.signal.aborted) return;
      const reason = err instanceof Error ? err.message : 'Lỗi AI TTS';
      // Graceful fallback to browser speech synthesis so voice conversation never breaks.
      callbacks.onStart?.(`Dự phòng trình duyệt (${reason.slice(0, 64)})`);
      try {
        await speakWithBrowserSpeech(spoken, settings, seq, callbacks);
      } catch (fallbackErr) {
        if (seq === activeSeq) {
          callbacks.onError?.(
            fallbackErr instanceof Error ? fallbackErr.message : reason,
          );
        }
      }
    }
  }

  return {
    speak,
    stop,
    isSpeaking: () => speaking,
  };
}

// ── Speech-to-Text (Voice Command Listener) ─────────────────────────────────

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative | undefined;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult | undefined;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceListenCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onAmplitude: (level: number) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}

export interface TheonVoiceRecognizer {
  start: (settings: TheonSettings, callbacks: VoiceListenCallbacks) => Promise<void>;
  stop: () => void;
  commitCurrent: () => void;
  isListening: () => boolean;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function createTheonVoiceRecognizer(): TheonVoiceRecognizer {
  let recognition: BrowserSpeechRecognition | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let meterRaf = 0;
  let listening = false;
  let finalized = false;
  let abortCtrl: AbortController | null = null;

  function teardownMicMeter(onAmplitude?: (level: number) => void) {
    if (meterRaf) {
      cancelAnimationFrame(meterRaf);
      meterRaf = 0;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    onAmplitude?.(0);
  }

  async function startMicMeter(
    onAmplitude: (level: number) => void,
    onSilenceDetected?: () => void,
  ): Promise<MediaStream | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream = stream;
      const Ctor = getAudioContextCtor();
      if (Ctor) {
        audioCtx = new Ctor();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        const buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));

        let heardSpeech = false;
        let silenceStart = 0;

        const loop = () => {
          if (!listening) return;
          analyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const c = ((buf[i] ?? 128) - 128) / 128;
            sumSq += c * c;
          }
          const rms = Math.sqrt(sumSq / buf.length);
          const level = clamp(rms * 4.5, 0, 1);
          onAmplitude(level);

          if (onSilenceDetected) {
            const now = performance.now();
            if (level > 0.14) {
              heardSpeech = true;
              silenceStart = 0;
            } else if (heardSpeech) {
              if (!silenceStart) silenceStart = now;
              else if (now - silenceStart > 1450) {
                onSilenceDetected();
                return;
              }
            }
          }
          meterRaf = requestAnimationFrame(loop);
        };
        meterRaf = requestAnimationFrame(loop);
      }
      return stream;
    } catch {
      return null;
    }
  }

  function stop() {
    listening = false;
    abortCtrl?.abort();
    abortCtrl = null;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      } catch {
        // ignore
      }
      recognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      } catch {
        // ignore
      }
      mediaRecorder = null;
    }
    teardownMicMeter();
  }

  function commitCurrent() {
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
  }

  async function startOpenAiWhisper(
    settings: TheonSettings,
    callbacks: VoiceListenCallbacks,
  ): Promise<void> {
    const apiKey = resolveProviderApiKey('openai');
    if (!apiKey) {
      callbacks.onError('Chưa có OpenAI API Key cho nhận dạng giọng nói Whisper.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      callbacks.onError('Trình duyệt không hỗ trợ ghi âm MediaRecorder.');
      return;
    }

    listening = true;
    finalized = false;
    const chunks: Blob[] = [];
    const abort = new AbortController();
    abortCtrl = abort;

    const stream = await startMicMeter(callbacks.onAmplitude, () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    });

    if (!stream) {
      listening = false;
      callbacks.onError('Không thể truy cập micro. Hãy cấp quyền micro cho trình duyệt.');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    recorder.onstop = async () => {
      listening = false;
      teardownMicMeter(callbacks.onAmplitude);
      if (abort.signal.aborted || chunks.length === 0) {
        callbacks.onEnd?.();
        return;
      }
      callbacks.onInterim('Đang phiên âm giọng nói…');
      try {
        const audioBlob = new Blob(chunks, { type: mimeType });
        const form = new FormData();
        form.append('file', audioBlob, 'voice.webm');
        form.append('model', DEFAULT_OPENAI_STT_MODEL);
        const lang = (settings.voiceLang || 'vi-VN').slice(0, 2);
        form.append('language', lang);

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          signal: abort.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
        if (!res.ok) {
          throw new Error(body.error?.message || `Transcribe trả về HTTP ${res.status}.`);
        }
        const transcript = (body.text || '').trim();
        if (transcript && !finalized) {
          finalized = true;
          callbacks.onFinal(transcript);
        } else {
          callbacks.onEnd?.();
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          callbacks.onError(err instanceof Error ? err.message : 'Lỗi phiên âm Whisper.');
        }
      }
    };

    recorder.start();
    callbacks.onInterim('Đang nghe… (nói xong dừng nhẹ hoặc bấm để gửi)');
  }

  async function start(
    settings: TheonSettings,
    callbacks: VoiceListenCallbacks,
  ): Promise<void> {
    stop();

    if (settings.sttProvider === 'openai') {
      await startOpenAiWhisper(settings, callbacks);
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      if (resolveProviderApiKey('openai')) {
        await startOpenAiWhisper(settings, callbacks);
        return;
      }
      callbacks.onError(
        'Trình duyệt chưa hỗ trợ Web Speech Recognition. Hãy dùng Chrome/Edge hoặc chuyển STT sang OpenAI Whisper trong Cấu hình Theon.',
      );
      return;
    }

    listening = true;
    finalized = false;
    let latestTranscript = '';

    const rec = new Ctor();
    rec.lang = settings.voiceLang || 'vi-VN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recognition = rec;

    // Best-effort mic amplitude meter for live waveform while speaking.
    void startMicMeter(callbacks.onAmplitude);

    rec.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res?.[0]?.transcript ?? '';
        if (res?.isFinal) finalChunk += text;
        else interim += text;
      }
      const combined = (finalChunk || interim).trim();
      if (combined) {
        latestTranscript = combined;
        callbacks.onInterim(combined);
      }
      if (finalChunk.trim() && !finalized) {
        finalized = true;
        listening = false;
        teardownMicMeter(callbacks.onAmplitude);
        callbacks.onFinal(finalChunk.trim());
      }
    };

    rec.onerror = (event) => {
      listening = false;
      teardownMicMeter(callbacks.onAmplitude);
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        callbacks.onEnd?.();
        return;
      }
      const map: Record<string, string> = {
        'not-allowed': 'Chưa được cấp quyền Micro. Hãy cho phép Micro trên trình duyệt.',
        'audio-capture': 'Không tìm thấy thiết bị Micro.',
        network: 'Lỗi mạng khi nhận dạng giọng nói.',
      };
      callbacks.onError(map[event.error] ?? `Lỗi nhận dạng giọng nói: ${event.error}`);
    };

    rec.onend = () => {
      listening = false;
      teardownMicMeter(callbacks.onAmplitude);
      if (!finalized && latestTranscript.trim()) {
        finalized = true;
        callbacks.onFinal(latestTranscript.trim());
        return;
      }
      callbacks.onEnd?.();
    };

    try {
      rec.start();
    } catch (err) {
      listening = false;
      teardownMicMeter(callbacks.onAmplitude);
      callbacks.onError(err instanceof Error ? err.message : 'Không thể khởi động Micro.');
    }
  }

  return {
    start,
    stop,
    commitCurrent,
    isListening: () => listening,
  };
}

/**
 * Reactive Svelte 5 store for Theon's configuration, expression state,
 * Matrix speech output, and in-memory turn history.
 */
import {
  createDefaultTheonSettings,
  defaultModelForProvider,
  loadTheonSettings,
  saveTheonSettings,
  type TheonExpression,
  type TheonProvider,
  type TheonSettings,
} from './theonConfig';
import type { TheonMessage } from './theonAgent';

export type TheonStatus = 'idle' | 'processing' | 'speaking' | 'error';
export type TheonVoicePhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

class TheonStore {
  settings = $state<TheonSettings>(loadTheonSettings());

  // ── Luồng gõ chữ (Text stream — giữ nguyên hành vi hiện có) ──
  status = $state<TheonStatus>('idle');
  expression = $state<TheonExpression>(this.settings.defaultExpression);
  outputText = $state<string>('');
  history = $state<TheonMessage[]>([]);

  // ── Luồng thoại (Voice stream — độc lập với luồng gõ chữ) ──
  voiceActive = $state<boolean>(false);
  voicePhase = $state<TheonVoicePhase>('idle');
  voiceTranscript = $state<string>('');
  voiceReply = $state<string>('');
  voiceAmplitude = $state<number>(0);
  voiceStatusNote = $state<string>('');
  voiceHistory = $state<TheonMessage[]>([]);

  private settingsListeners = new Set<(next: TheonSettings) => void>();

  onSettingsChange(cb: (next: TheonSettings) => void): () => void {
    this.settingsListeners.add(cb);
    return () => {
      this.settingsListeners.delete(cb);
    };
  }

  updateSettings(patch: Partial<TheonSettings>) {
    const next: TheonSettings = {
      ...this.settings,
      ...patch,
    };
    this.settings = next;
    saveTheonSettings(next);
    if (patch.defaultExpression && this.status === 'idle' && this.voicePhase === 'idle') {
      this.expression = patch.defaultExpression;
    }
    this.settingsListeners.forEach((cb) => cb(next));
  }

  setProvider(provider: TheonProvider) {
    const model = defaultModelForProvider(provider);
    this.updateSettings({ provider, model });
  }

  resetSettings() {
    const defaults = createDefaultTheonSettings();
    this.settings = defaults;
    saveTheonSettings(defaults);
    this.expression = defaults.defaultExpression;
    this.settingsListeners.forEach((cb) => cb(defaults));
  }

  pushTurn(userText: string, assistantText: string) {
    const next = [
      ...this.history,
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: assistantText },
    ];
    // Keep a bounded sliding window for lightweight multi-turn context.
    this.history = next.slice(-20);
  }

  pushVoiceTurn(userText: string, assistantText: string) {
    const next = [
      ...this.voiceHistory,
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: assistantText },
    ];
    this.voiceHistory = next.slice(-20);
  }

  clearHistory() {
    this.history = [];
    this.outputText = '';
    this.status = 'idle';
    this.expression = this.settings.defaultExpression;
  }

  clearVoiceHistory() {
    this.voiceHistory = [];
    this.voiceTranscript = '';
    this.voiceReply = '';
    this.voiceStatusNote = '';
    this.voiceAmplitude = 0;
    if (!this.voiceActive) {
      this.voicePhase = 'idle';
    }
  }
}

export const theonStore = new TheonStore();

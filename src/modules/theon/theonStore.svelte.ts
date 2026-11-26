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

class TheonStore {
  settings = $state<TheonSettings>(loadTheonSettings());
  status = $state<TheonStatus>('idle');
  expression = $state<TheonExpression>(this.settings.defaultExpression);
  outputText = $state<string>('');
  history = $state<TheonMessage[]>([]);

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
    if (patch.defaultExpression && this.status === 'idle') {
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

  clearHistory() {
    this.history = [];
    this.outputText = '';
    this.status = 'idle';
    this.expression = this.settings.defaultExpression;
  }
}

export const theonStore = new TheonStore();

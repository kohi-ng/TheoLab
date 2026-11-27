import type { TheonExpression, TheonHeadStyle } from './theonConfig';
import type { ExerciseTabPayload } from './exerciseSchema';
import type { NormalizedChartSpec } from './chartSchema';

export type TheonMode = 'reading' | 'mouse';
export type TheonGraphMode = 'wave' | 'bars' | 'orbit';

export type TheonObjectActionMeta =
  | { kind: 'deep-link'; deepLink: string; title?: string }
  | { kind: 'url'; url: string; title?: string }
  | { kind: 'app'; appId: string; title?: string; url?: string }
  | { kind: 'exercise'; payload: ExerciseTabPayload }
  | { kind: 'formula'; title?: string };

export interface TheonHoverInfo {
  kind: 'book' | 'card';
  label: string;
  actionMeta: TheonObjectActionMeta | null;
}

export interface SpawnBookOptions {
  title?: string;
  subtitle?: string;
  code?: string;
  actionMeta?: TheonObjectActionMeta | null;
}

export interface SpawnNoteCardOptions {
  tag?: string;
  label?: string;
  text?: string;
  actionMeta?: TheonObjectActionMeta | null;
}

export interface TheonEngineOptions {
  headStyle?: TheonHeadStyle;
  edgeBrightness?: number;
  bgMatrixRain?: boolean;
  parallaxEnabled?: boolean;
  readSpeed?: number;
  defaultExpression?: TheonExpression;
  autoExpression?: boolean;
  onError?: (err: unknown) => void;
  onObjectClick?: (action: TheonObjectActionMeta, label: string) => void;
  onObjectHover?: (info: TheonHoverInfo | null) => void;
}

export interface TheonEngineController {
  setMode(mode: TheonMode): void;
  setExpression(expression: TheonExpression): void;
  setReadingDocument(title: string, body: string): void;
  triggerNod(strength?: number): void;
  triggerBlink(): void;
  updateSettings(patch: Partial<TheonEngineOptions>): void;
  setPaused(paused: boolean): void;
  replayMatrix(): void;
  spawnBook(options?: SpawnBookOptions): unknown;
  spawnNoteCard(options?: SpawnNoteCardOptions): unknown;
  setScreenChart(spec: NormalizedChartSpec | null): void;
  setPinnedGraph(visible: boolean, mode?: TheonGraphMode): void;
  setSpeechAmplitude(level: number): void;
  clearObjects(): void;
  destroy(): void;
}

export function createTheonEngine(
  container: HTMLElement,
  initialOptions?: TheonEngineOptions,
): TheonEngineController;

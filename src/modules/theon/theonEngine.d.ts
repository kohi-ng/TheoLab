import type { TheonExpression, TheonHeadStyle } from './theonConfig';

export type TheonMode = 'reading' | 'mouse';
export type TheonGraphMode = 'wave' | 'bars' | 'orbit';

export interface TheonEngineOptions {
  headStyle?: TheonHeadStyle;
  edgeBrightness?: number;
  bgMatrixRain?: boolean;
  parallaxEnabled?: boolean;
  readSpeed?: number;
  defaultExpression?: TheonExpression;
  autoExpression?: boolean;
  onError?: (err: unknown) => void;
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
  spawnBook(customPos?: unknown): unknown;
  spawnNoteCard(customPos?: unknown): unknown;
  setPinnedGraph(visible: boolean, mode?: TheonGraphMode): void;
  clearObjects(): void;
  destroy(): void;
}

export function createTheonEngine(
  container: HTMLElement,
  initialOptions?: TheonEngineOptions,
): TheonEngineController;

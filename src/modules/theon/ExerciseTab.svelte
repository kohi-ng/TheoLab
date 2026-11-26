<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { updateContext } from '../../core/contextBus.js';
  import { checkChoice, checkNumeric, startCountdown } from '../assessmentEngine/assessmentEngine.js';
  import { renderSafeMarkdown } from '../academy/markdownRenderer';
  import type { ExerciseItem, ExerciseTabPayload } from './exerciseSchema';

  let { payload }: { payload: ExerciseTabPayload } = $props();

  interface ItemGrade {
    correct: boolean;
    feedback: string;
  }

  let mcqSelections = $state<Record<number, number>>({});
  let numericDrafts = $state<Record<number, string>>({});
  let grades = $state<Record<number, ItemGrade>>({});
  let submitted = $state(false);
  let remainingSec = $state<number | null>(null);
  let stopTimer: (() => void) | null = null;

  const totalCount = $derived(payload.items.length);
  const gradedEntries = $derived(Object.values(grades));
  const correctCount = $derived(gradedEntries.filter((g) => g.correct).length);

  function safeMd(node: HTMLElement, text: string) {
    renderSafeMarkdown(node, text);
    return {
      update(nextText: string) {
        renderSafeMarkdown(node, nextText);
      },
    };
  }

  function formatTimer(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function gradeOne(index: number, item: ExerciseItem): ItemGrade {
    if (item.type === 'mcq') {
      const selected = mcqSelections[index];
      if (selected === undefined) {
        return { correct: false, feedback: 'Chưa chọn đáp án.' };
      }
      const res = checkChoice(item, selected);
      return { correct: res.correct, feedback: res.feedback };
    }
    const raw = numericDrafts[index] ?? '';
    const res = checkNumeric({ value: raw, answer: item.answer, tolerance: item.tolerance });
    return { correct: res.correct, feedback: res.feedback };
  }

  function publishResult(nextGrades: Record<number, ItemGrade>) {
    const entries = Object.values(nextGrades);
    const correct = entries.filter((e) => e.correct).length;
    updateContext({
      lastExerciseResult: {
        title: payload.title,
        total: payload.items.length,
        answered: entries.length,
        correct,
        completedAt: new Date().toISOString(),
      },
    });
  }

  function checkSingle(index: number, item: ExerciseItem) {
    const result = gradeOne(index, item);
    const next = { ...grades, [index]: result };
    grades = next;
    publishResult(next);
  }

  function submitAll() {
    stopTimer?.();
    stopTimer = null;
    const next: Record<number, ItemGrade> = {};
    payload.items.forEach((item, idx) => {
      next[idx] = gradeOne(idx, item);
    });
    grades = next;
    submitted = true;
    publishResult(next);
  }

  function resetAll() {
    stopTimer?.();
    stopTimer = null;
    mcqSelections = {};
    numericDrafts = {};
    grades = {};
    submitted = false;
    if (payload.time_limit_sec && payload.time_limit_sec > 0) {
      remainingSec = payload.time_limit_sec;
      stopTimer = startCountdown(
        payload.time_limit_sec,
        (left: number) => {
          remainingSec = left;
        },
        () => {
          if (!submitted) submitAll();
        },
      );
    }
  }

  onMount(() => {
    if (payload.time_limit_sec && payload.time_limit_sec > 0) {
      remainingSec = payload.time_limit_sec;
      stopTimer = startCountdown(
        payload.time_limit_sec,
        (left: number) => {
          remainingSec = left;
        },
        () => {
          if (!submitted) submitAll();
        },
      );
    }
  });

  onDestroy(() => {
    stopTimer?.();
    stopTimer = null;
  });
</script>

<div class="exercise-shell">
  <header class="exercise-head">
    <div class="exercise-head-copy">
      <h2>{payload.title}</h2>
      {#if payload.subtitle}
        <p>{payload.subtitle}</p>
      {/if}
    </div>
    <div class="exercise-head-meta">
      {#if remainingSec !== null}
        <span class="exercise-pill" class:warn={remainingSec <= 30 && !submitted}>
          ◷ {formatTimer(remainingSec)}
        </span>
      {/if}
      <span class="exercise-pill score">
        {correctCount}/{totalCount} đúng
      </span>
    </div>
  </header>

  <div class="exercise-list">
    {#each payload.items as item, idx (item.id ?? idx)}
      {@const grade = grades[idx]}
      <article class="exercise-card" class:correct={grade?.correct === true} class:wrong={grade?.correct === false}>
        <div class="exercise-item-head">
          <span class="exercise-num">Câu {idx + 1}</span>
          <span class="exercise-kind">{item.type === 'mcq' ? 'Trắc nghiệm' : 'Điền số'}</span>
        </div>

        {#if item.type === 'mcq'}
          <div class="exercise-question" use:safeMd={item.question}></div>
          <div class="exercise-options" role="radiogroup" aria-label={`Câu ${idx + 1}`}>
            {#each item.options as opt, optIdx (optIdx)}
              {@const picked = mcqSelections[idx] === optIdx}
              {@const isRight = submitted && optIdx === item.answer}
              <button
                type="button"
                class="exercise-option"
                class:picked={picked}
                class:right-answer={isRight}
                onclick={() => {
                  mcqSelections = { ...mcqSelections, [idx]: optIdx };
                }}
              >
                <span class="option-letter">{String.fromCharCode(65 + optIdx)}</span>
                <span class="option-body" use:safeMd={opt.text}></span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="exercise-question" use:safeMd={item.prompt}></div>
          <div class="numeric-row">
            <input
              class="numeric-input"
              type="text"
              inputmode="decimal"
              placeholder={item.placeholder || 'Nhập giá trị số…'}
              aria-label={`Đáp án câu ${idx + 1}`}
              value={numericDrafts[idx] ?? ''}
              oninput={(e) => {
                numericDrafts = { ...numericDrafts, [idx]: (e.currentTarget as HTMLInputElement).value };
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  checkSingle(idx, item);
                }
              }}
            />
            {#if item.unit}
              <span class="numeric-unit">{item.unit}</span>
            {/if}
            <button type="button" class="exercise-check-btn" onclick={() => checkSingle(idx, item)}>
              Kiểm tra
            </button>
          </div>
        {/if}

        {#if item.type === 'mcq' && !submitted}
          <div class="exercise-item-actions">
            <button type="button" class="exercise-check-btn" onclick={() => checkSingle(idx, item)}>
              Kiểm tra câu này
            </button>
          </div>
        {/if}

        {#if grade}
          <div class="exercise-feedback" class:ok={grade.correct} class:err={!grade.correct}>
            <strong>{grade.correct ? '✓' : '✕'} {grade.feedback}</strong>
            {#if item.type === 'numeric' && !grade.correct && submitted}
              <small>Đáp số chuẩn: {item.answer}{item.tolerance ? ` ± ${item.tolerance}` : ''}{item.unit ? ` ${item.unit}` : ''}</small>
            {/if}
            {#if item.explanation}
              <div class="exercise-explain" use:safeMd={item.explanation}></div>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  <footer class="exercise-footer">
    <button type="button" class="exercise-submit-btn" onclick={submitAll}>
      {submitted ? 'Chấm lại toàn bài' : 'Nộp bài & chấm điểm'}
    </button>
    <button type="button" class="exercise-reset-btn" onclick={resetAll}>
      Làm lại
    </button>
  </footer>
</div>

<style>
  .exercise-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-canvas, #f8fafd);
    color: var(--text-primary, #1f1f1f);
    overflow: hidden;
  }

  .exercise-head {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px 12px;
    background: var(--surface-card, #ffffff);
  }

  .exercise-head-copy h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .exercise-head-copy p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--text-muted, #5f6368);
  }

  .exercise-head-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }

  .exercise-pill {
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--surface-elevated, #edf2fa);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .exercise-pill.warn {
    background: #fce8e6;
    color: #c5221f;
  }

  .exercise-pill.score {
    background: #e8f0fe;
    color: #174ea6;
  }

  .exercise-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .exercise-card {
    background: var(--surface-card, #ffffff);
    border-radius: 18px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .exercise-card.correct {
    background: #f2fbf5;
  }

  .exercise-card.wrong {
    background: #fef6f5;
  }

  .exercise-item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .exercise-num {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-solid, #1a73e8);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .exercise-kind {
    font-size: 11px;
    color: var(--text-muted, #5f6368);
  }

  .exercise-question :global(p) {
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
  }

  .exercise-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .exercise-option {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    border: 0;
    border-radius: 12px;
    padding: 10px 12px;
    background: var(--surface-elevated, #edf2fa);
    color: inherit;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .exercise-option:hover {
    background: #dde8fb;
  }

  .exercise-option.picked {
    background: #d2e3fc;
    color: #174ea6;
  }

  .exercise-option.right-answer {
    background: #ceead6;
    color: #137333;
  }

  .option-letter {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgb(255 255 255 / 75%);
    font-size: 12px;
    font-weight: 700;
  }

  .option-body :global(p) {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
  }

  .numeric-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .numeric-input {
    flex: 1;
    min-width: 0;
    border: 0;
    border-radius: 12px;
    padding: 10px 12px;
    background: var(--surface-elevated, #edf2fa);
    color: inherit;
    font-size: 14px;
  }

  .numeric-unit {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted, #5f6368);
  }

  .exercise-item-actions {
    display: flex;
    justify-content: flex-end;
  }

  .exercise-check-btn {
    border: 0;
    border-radius: 999px;
    padding: 7px 14px;
    background: var(--surface-elevated, #edf2fa);
    color: #174ea6;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .exercise-check-btn:hover {
    background: #d2e3fc;
  }

  .exercise-feedback {
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .exercise-feedback.ok {
    background: #e6f4ea;
    color: #137333;
  }

  .exercise-feedback.err {
    background: #fce8e6;
    color: #c5221f;
  }

  .exercise-explain :global(p) {
    margin: 4px 0 0;
    color: var(--text-primary, #1f1f1f);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .exercise-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    background: var(--surface-card, #ffffff);
  }

  .exercise-submit-btn {
    border: 0;
    border-radius: 999px;
    padding: 10px 18px;
    background: var(--accent-solid, #1a73e8);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .exercise-reset-btn {
    border: 0;
    border-radius: 999px;
    padding: 10px 16px;
    background: var(--surface-elevated, #edf2fa);
    color: var(--text-primary, #1f1f1f);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }
</style>

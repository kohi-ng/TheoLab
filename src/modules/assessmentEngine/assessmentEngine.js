export function checkChoice(question, selectedIndex) {
  const correct = selectedIndex === question.answer;
  return {
    correct,
    feedback: question.options[selectedIndex]?.feedback
      ?? (correct ? 'Chính xác!' : 'Chưa đúng, hãy thử lại.'),
  };
}

export function checkNumeric({ value, answer, tolerance = 0 }) {
  const source = String(value).trim();
  const parsedValue = source === '' ? Number.NaN : Number(source);
  const correct = Number.isFinite(parsedValue)
    && Math.abs(parsedValue - Number(answer)) <= Number(tolerance);
  return {
    correct,
    difference: Number.isFinite(parsedValue) ? Math.abs(parsedValue - Number(answer)) : null,
    feedback: correct ? 'Chính xác!' : 'Chưa đúng, hãy kiểm tra lại phép tính.',
  };
}

export function startCountdown(seconds, onTick, onComplete) {
  let remaining = Math.max(0, Number(seconds));
  onTick(remaining);
  const timer = window.setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    onTick(remaining);
    if (remaining === 0) {
      window.clearInterval(timer);
      onComplete?.();
    }
  }, 1000);
  return () => window.clearInterval(timer);
}

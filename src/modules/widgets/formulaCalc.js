export function mount(container, props = {}, { contextBus }) {
  const form = document.createElement('form');
  form.className = 'formula-calc';
  const heading = document.createElement('h3');
  heading.textContent = props.title ?? 'Tính nhanh pKₐ';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.min = '0';
  input.value = String(props.ka ?? 1.8e-5);
  input.setAttribute('aria-label', 'Hằng số Ka');
  const result = document.createElement('output');
  const calculate = () => {
    const ka = Number(input.value);
    result.textContent = ka > 0
      ? `pKₐ = ${(-Math.log10(ka)).toFixed(3)}`
      : 'Nhập Ka lớn hơn 0';
    contextBus.updateContext({
      selectedBlockId: props.blockId ?? 'formula-calc',
      widgetState: { widgetId: 'formula_calc', ka, pKa: ka > 0 ? -Math.log10(ka) : null },
    });
  };
  form.append(heading, input, result);
  input.addEventListener('input', calculate);
  container.replaceChildren(form);
  calculate();
  return () => {
    input.removeEventListener('input', calculate);
    form.remove();
    if (contextBus.getActiveContext().widgetState?.widgetId === 'formula_calc') {
      contextBus.updateContext({ widgetState: null });
    }
  };
}

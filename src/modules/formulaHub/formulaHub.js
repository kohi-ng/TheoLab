const formulas = [
  { symbol: 'Kₐ', name: 'Hằng số phân ly axit', formula: 'K_a = \\frac{[H^+][A^-]}{[HA]}' },
  { symbol: 'Kᵦ', name: 'Hằng số bazơ liên hợp', formula: 'K_b = \\frac{[HA][OH^-]}{[A^-]}' },
  { symbol: 'pKₐ', name: 'Độ mạnh axit', formula: 'pK_a = -\\log K_a' },
  { symbol: 'pK_w', name: 'Tích số ion của nước', formula: 'pK_w = pH + pOH = 14.00\\ (25^\\circ C)' },
  { symbol: 'Henderson–Hasselbalch', name: 'Dung dịch đệm', formula: 'pH = pK_a + \\log\\frac{[A^-]}{[HA]}' },
];

export function renderFormulaHub(container, katex) {
  container.replaceChildren();
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = 'Formula Hub';
  const subtitle = document.createElement('p');
  subtitle.className = 'page-subtitle';
  subtitle.textContent = 'Công thức và hằng số thường dùng trong hóa phân tích.';
  container.append(heading, subtitle);
  const grid = document.createElement('div');
  grid.className = 'formula-grid';
  formulas.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'formula-card';
    const name = document.createElement('h2');
    name.textContent = item.name;
    const expression = document.createElement('div');
    expression.className = 'formula-display';
    try {
      katex.render(item.formula, expression, { throwOnError: false, displayMode: true });
    } catch {
      expression.textContent = item.formula;
    }
    card.append(name, expression);
    grid.append(card);
  });
  container.append(grid);
}

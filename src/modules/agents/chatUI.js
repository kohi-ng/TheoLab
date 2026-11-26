import { APP_MODE } from '../../config/runtimeConfig.js';
import { getApiKey, getLocalSetting } from '../../core/dataGateway.js';
import { getActiveContext, subscribeContext, updateContext } from '../../core/contextBus.js';
import { checkNumeric, startCountdown } from '../assessmentEngine/assessmentEngine.js';

const modelCatalog = [
  { provider: 'vertex', model: 'gemini-3.8-flash', label: 'Vertex AI · Gemini 3.8 Flash', description: 'Qua Firebase, không cần API Key' },
  { provider: 'google', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Suy luận sâu, giải bài phức tạp' },
  { provider: 'google', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Phản hồi nhanh, ôn tập hằng ngày' },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', label: 'Claude Sonnet', description: 'Phân tích dài, diễn đạt tự nhiên' },
  { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1', description: 'Học tập và giải thích đa dụng' },
  { provider: 'openrouter', model: 'deepseek/deepseek-r1', label: 'DeepSeek R1', description: 'Suy luận từng bước' },
  { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3', description: 'Nhanh, hiệu quả cho hội thoại' },
  { provider: 'openrouter', model: 'openrouter-custom', label: 'OpenRouter / model khác', description: 'Nhập model OpenRouter tùy chọn' },
  { provider: 'custom', model: 'custom', label: 'Custom model', description: 'Endpoint tương thích OpenAI trong Cấu hình' },
];

function makeButton(label, action, className = 'composer-action') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.composerAction = action;
  button.textContent = label;
  return button;
}

function contextChip(label, onRemove) {
  const chip = document.createElement('span');
  chip.className = 'context-chip';
  const text = document.createElement('span');
  text.textContent = label;
  const remove = makeButton('×', 'remove-context', 'chip-remove');
  remove.addEventListener('click', onRemove);
  chip.append(text, remove);
  return chip;
}

function renderContextBar(bar, state, lessons, onChange) {
  bar.replaceChildren();
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'auto-context-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(state.autoContext);
  toggle.addEventListener('change', () => onChange({ ...state, autoContext: toggle.checked }));
  const toggleText = document.createElement('span');
  toggleText.textContent = 'Bám bài đang học';
  toggleLabel.append(toggle, toggleText);
  bar.append(toggleLabel);

  const chips = document.createElement('div');
  chips.className = 'context-chips';
  if (state.autoContext && state.activeTitle) {
    chips.append(contextChip(`Đang học: ${state.activeTitle}`, () => onChange({ ...state, autoContext: false })));
  }
  const active = state.activeContext;
  const activeLesson = lessons.find((item) => item.id === active?.lessonId);
  if (state.autoContext && active?.selectedBlockId) {
    const block = activeLesson?.payload.blocks.find((item) => item.id === active.selectedBlockId);
    chips.append(contextChip(`Khối: ${block?.title ?? active.selectedBlockId}`, () => onChange({ ...state, autoContext: false })));
  }
  if (state.autoContext && active?.widgetState) {
    const widget = active.widgetState;
    const payload = widget.payload ?? {};
    const widgetSummary = Number.isFinite(payload.pH)
      ? `${widget.widgetId} · ${payload.volumeNaOHmL ?? ''} mL · pH ${payload.pH}`
      : widget.widgetId;
    chips.append(contextChip(`Widget: ${widgetSummary}`, () => onChange({ ...state, autoContext: false })));
  }
  for (const id of state.lessonIds ?? []) {
    const lesson = lessons.find((item) => item.id === id);
    if (!lesson) continue;
    chips.append(contextChip(lesson.payload.title, () => {
      onChange({ ...state, lessonIds: state.lessonIds.filter((lessonId) => lessonId !== id) });
    }));
  }
  if (state.includeFormula) {
    chips.append(contextChip('Formula Hub', () => onChange({ ...state, includeFormula: false })));
  }
  const libraryContext = state.libraryContext ?? active?.libraryContext;
  if (libraryContext) {
    chips.append(contextChip(`Tài liệu: ${libraryContext.title}`, () => {
      updateContext({ libraryContext: null });
      onChange({ ...state, libraryContext: null });
    }));
  }
  bar.append(chips);
}

function renderContextPicker(popover, state, lessons, onChange) {
  popover.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = 'Đính kèm ngữ cảnh';
  popover.append(heading);
  const lessonHeading = document.createElement('p');
  lessonHeading.className = 'popover-label';
  lessonHeading.textContent = 'Bài học';
  popover.append(lessonHeading);
  lessons.forEach((lesson) => {
    const label = document.createElement('label');
    label.className = 'picker-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = (state.lessonIds ?? []).includes(lesson.id);
    checkbox.addEventListener('change', () => {
      const lessonIds = new Set(state.lessonIds ?? []);
      if (checkbox.checked) lessonIds.add(lesson.id);
      else lessonIds.delete(lesson.id);
      onChange({ ...state, lessonIds: [...lessonIds] });
    });
    const title = document.createElement('span');
    title.textContent = `${lesson.core?.subject ?? 'Bài học'} · ${lesson.payload.title}`;
    label.append(checkbox, title);
    popover.append(label);
  });
  const formula = makeButton(
    state.includeFormula ? '✓ Đã đính kèm Formula Hub' : '+ Formula Hub',
    'toggle-formula',
    'picker-button',
  );
  formula.addEventListener('click', () => onChange({ ...state, includeFormula: !state.includeFormula }));
  popover.append(formula);
}

function renderTuning(popover, state, onChange) {
  popover.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = 'Tinh chỉnh phiên này';
  popover.append(heading);

  const skillLabel = document.createElement('label');
  skillLabel.className = 'popover-label';
  skillLabel.textContent = 'Chế độ / Skill';
  const skill = document.createElement('select');
  skill.className = 'select-input';
  [
    ['supporter', 'Agent Supporter · Gợi mở'],
    ['step_by_step', 'Giải chi tiết từng bước'],
    ['timed_exercise', 'Tạo bài tập bấm giờ'],
    ['instructor', 'Agent Instructor · Soạn JSON'],
  ].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    skill.append(option);
  });
  skill.value = state.skill ?? 'supporter';
  skill.addEventListener('change', () => onChange({ ...state, skill: skill.value }));
  skillLabel.append(skill);
  popover.append(skillLabel);

  const temperatureLabel = document.createElement('label');
  temperatureLabel.className = 'popover-label range-label';
  temperatureLabel.append(document.createTextNode('Độ sáng tạo '));
  const temperatureValue = document.createElement('span');
  temperatureValue.textContent = Number(state.temperature ?? 0.3).toFixed(1);
  temperatureLabel.append(temperatureValue);
  const temperature = document.createElement('input');
  temperature.type = 'range';
  temperature.min = '0';
  temperature.max = '1.2';
  temperature.step = '0.1';
  temperature.value = String(state.temperature ?? 0.3);
  temperature.addEventListener('input', () => {
    temperatureValue.textContent = Number(temperature.value).toFixed(1);
  });
  temperature.addEventListener('change', () => onChange({ ...state, temperature: Number(temperature.value) }));
  temperatureLabel.append(temperature);
  popover.append(temperatureLabel);

  const depthLabel = document.createElement('span');
  depthLabel.className = 'popover-label';
  depthLabel.textContent = 'Độ sâu câu trả lời';
  const depthGroup = document.createElement('div');
  depthGroup.className = 'depth-pills';
  [['short', 'Ngắn gọn'], ['balanced', 'Cân bằng'], ['deep', 'Chuyên sâu']].forEach(([value, text]) => {
    const button = makeButton(text, 'depth', `depth-pill${(state.depth ?? 'balanced') === value ? ' selected' : ''}`);
    button.addEventListener('click', () => onChange({ ...state, depth: value }));
    button.dataset.value = value;
    depthGroup.append(button);
  });
  popover.append(depthLabel, depthGroup);

  [['useRag', 'Vector RAG'], ['useMcp', 'MCP Tools']].forEach(([key, text]) => {
    const label = document.createElement('label');
    label.className = 'setting-row';
    const title = document.createElement('span');
    title.textContent = text;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(state[key]);
    toggle.addEventListener('change', () => onChange({ ...state, [key]: toggle.checked }));
    label.append(title, toggle);
    popover.append(label);
  });
  const toolStatus = document.createElement('p');
  toolStatus.className = 'status-line tuning-note';
  toolStatus.textContent = 'Vector index chưa được nạp; MCP cần cấu hình transport và tool allowlist trước khi thực thi.';
  popover.append(toolStatus);

  const instructions = document.createElement('textarea');
  instructions.className = 'text-input session-instructions';
  instructions.placeholder = 'Chỉ dẫn bổ sung cho phiên này';
  instructions.value = state.instructions ?? '';
  instructions.addEventListener('change', () => onChange({ ...state, instructions: instructions.value }));
  popover.append(instructions);
}

function renderModels(popover, state, onChange) {
  popover.replaceChildren();
  let currentProvider = '';
  for (const model of modelCatalog) {
    if (model.provider !== currentProvider) {
      currentProvider = model.provider;
      const group = document.createElement('p');
      group.className = 'model-group';
      group.textContent = {
        vertex: 'Vertex AI',
        google: 'Google AI',
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        openrouter: 'OpenRouter',
        custom: 'Custom',
      }[currentProvider];
      popover.append(group);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-option';
    const copy = document.createElement('span');
    copy.className = 'model-copy';
    const name = document.createElement('strong');
    name.textContent = model.label;
    const description = document.createElement('small');
    description.textContent = model.description;
    copy.append(name, description);
    const isVertex = model.provider === 'vertex';
    const configured = isVertex ? APP_MODE === 'firebase_auth' : Boolean(getApiKey(model.provider));
    const status = document.createElement('span');
    status.className = `model-status${configured ? ' configured' : ''}`;
    status.title = isVertex
      ? (configured ? 'Dùng đăng nhập Firebase' : 'Cần chế độ firebase_auth')
      : (configured ? 'API Key đã được nhập' : 'Chưa có API Key');
    button.append(copy, status);
    button.addEventListener('click', () => {
      if (!configured) {
        window.dispatchEvent(new CustomEvent('theolab:open-settings'));
        return;
      }
      const selectedModel = model.model === 'openrouter-custom'
        ? getLocalSetting('model:openrouter', 'deepseek/deepseek-chat-v3-0324')
        : model.model;
      onChange({ ...state, provider: model.provider, model: selectedModel, modelLabel: model.label });
    });
    popover.append(button);
  }
}

export function mountChatComposer(root, {
  getState,
  onStateChange,
  onSend,
  lessons,
  activeTitle,
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'composer-wrap';
  const contextBar = document.createElement('div');
  contextBar.className = 'context-bar';
  const popover = document.createElement('div');
  popover.className = 'composer-popover hidden';
  const textarea = document.createElement('textarea');
  textarea.className = 'chat-input chat-textarea';
  textarea.rows = 1;
  textarea.placeholder = 'Hỏi TheoLab điều bạn đang tìm hiểu…';
  textarea.setAttribute('aria-label', 'Tin nhắn');
  const actionBar = document.createElement('div');
  actionBar.className = 'composer-actions';
  const left = document.createElement('div');
  left.className = 'composer-action-group';
  const attach = makeButton('+', 'attach', 'composer-action attach-action');
  attach.setAttribute('aria-label', 'Đính kèm ngữ cảnh');
  const tune = makeButton('☷', 'tune', 'composer-action');
  tune.setAttribute('aria-label', 'Tinh chỉnh sâu');
  left.append(attach, tune);
  const right = document.createElement('div');
  right.className = 'composer-action-group';
  const modelButton = makeButton('', 'models', 'model-pill');
  const send = makeButton('↑', 'send', 'send-button composer-send');
  send.setAttribute('aria-label', 'Gửi');
  right.append(modelButton, send);
  actionBar.append(left, right);
  wrapper.append(contextBar, popover, textarea, actionBar);
  root.replaceChildren(wrapper);

  let popoverMode = '';
  const getContextState = () => {
    const current = getState() ?? {};
    return {
      ...current,
      activeTitle: activeTitle ?? current.activeTitle,
      activeContext: getActiveContext(),
    };
  };
  const update = (next) => {
    const { activeContext, ...persistedState } = next;
    onStateChange(persistedState);
    renderContextBar(contextBar, getContextState(), lessons, update);
    if (popoverMode === 'tune') renderTuning(popover, getContextState(), update);
    if (popoverMode === 'attach') renderContextPicker(popover, getContextState(), lessons, update);
    if (popoverMode === 'models') renderModels(popover, getContextState(), update);
    updateModelButton();
  };
  const updateModelButton = () => {
    const state = getContextState();
    modelButton.textContent = `${state.modelLabel ?? 'Gemini 2.5 Flash'} ▾`;
  };
  const showPopover = (mode) => {
    popoverMode = popoverMode === mode ? '' : mode;
    popover.classList.toggle('hidden', !popoverMode);
    if (popoverMode === 'tune') renderTuning(popover, getContextState(), update);
    if (popoverMode === 'attach') renderContextPicker(popover, getContextState(), lessons, update);
    if (popoverMode === 'models') renderModels(popover, getContextState(), update);
  };
  renderContextBar(contextBar, getContextState(), lessons, update);
  const unsubscribeContext = subscribeContext(() => renderContextBar(contextBar, getContextState(), lessons, update));
  updateModelButton();
  attach.addEventListener('click', () => showPopover('attach'));
  tune.addEventListener('click', () => showPopover('tune'));
  modelButton.addEventListener('click', () => showPopover('models'));
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    send.disabled = !textarea.value.trim();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send.click();
    }
  });
  send.disabled = true;
  send.addEventListener('click', () => {
    const prompt = textarea.value.trim();
    if (!prompt) return;
    const state = getContextState();
    textarea.value = '';
    textarea.style.height = 'auto';
    send.disabled = true;
    popoverMode = '';
    popover.classList.add('hidden');
    onSend(prompt, state);
  });
  return () => {
    unsubscribeContext();
    wrapper.remove();
  };
}

export function renderMessage(root, message, { onExerciseResult } = {}) {
  const bubble = document.createElement('article');
  bubble.className = `chat-bubble${message.role === 'user' ? ' user' : ''}`;
  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = message.content ?? '';
  bubble.append(text);
  if (message.exercise) {
    const exercise = document.createElement('div');
    exercise.className = 'chat-exercise';
    const label = document.createElement('label');
    label.textContent = message.exercise.prompt;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'numeric-input';
    input.placeholder = 'Nhập số rồi bấm Enter';
    input.setAttribute('aria-label', 'Đáp án bài tập');
    const timer = document.createElement('p');
    timer.className = 'status-line';
    const feedback = document.createElement('p');
    feedback.className = 'exercise-feedback';
    exercise.append(label, input, timer, feedback);
    bubble.append(exercise);
    const cancel = startCountdown(message.exercise.seconds ?? 45, (remaining) => {
      timer.textContent = `Còn ${remaining} giây`;
    }, () => {
      if (!feedback.textContent) feedback.textContent = 'Hết giờ — bạn vẫn có thể thử đáp án.';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const result = checkNumeric({
        value: input.value,
        answer: message.exercise.answer,
        tolerance: message.exercise.tolerance,
      });
      feedback.textContent = result.feedback;
      feedback.dataset.state = result.correct ? 'correct' : 'incorrect';
      onExerciseResult?.(result);
      cancel();
    });
    bubble.cleanup = cancel;
  }
  root.append(bubble);
  root.scrollTop = root.scrollHeight;
  return bubble;
}

export { modelCatalog };

export function clearMessages(root) {
  root.querySelectorAll('.chat-bubble').forEach((bubble) => bubble.cleanup?.());
  root.replaceChildren();
}

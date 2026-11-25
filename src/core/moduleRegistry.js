const modules = new Map();
const mountedWidgets = new WeakMap();
const navigationTabs = new Map();

export function registerNavigationTab(tab) {
  if (!tab?.id || !tab.label || !tab.icon) {
    throw new Error('Navigation tabs require id, label, and icon.');
  }
  const existing = navigationTabs.get(tab.id);
  if (existing && !existing.placeholder) {
    throw new Error(`Navigation tab "${tab.id}" is already registered.`);
  }
  navigationTabs.set(tab.id, { ...existing, ...tab });
}

export function registerNavigationTabs(tabs) {
  tabs.forEach(registerNavigationTab);
}

export function listNavigationTabs() {
  return [...navigationTabs.values()].filter((tab) => tab.enabled !== false).map((tab) => ({ ...tab }));
}

export function registerModule(name, loader, { enabled = true } = {}) {
  if (modules.has(name)) throw new Error(`Module "${name}" is already registered.`);
  modules.set(name, { loader, enabled, instance: null });
}

export function setModuleEnabled(name, enabled) {
  const entry = modules.get(name);
  if (!entry) throw new Error(`Unknown module "${name}".`);
  entry.enabled = Boolean(enabled);
}

export async function loadModule(name) {
  const entry = modules.get(name);
  if (!entry) throw new Error(`Unknown module "${name}".`);
  if (!entry.enabled) return null;
  if (!entry.instance) {
    entry.instance = await entry.loader();
    if (!entry.instance || typeof entry.instance !== 'object') {
      throw new Error(`Module "${name}" did not return an ES module.`);
    }
  }
  return entry.instance;
}

export async function mountWidget(widgetId, container, props, { contextBus, owner = container }) {
  const module = await loadModule(`widget:${widgetId}`);
  if (typeof module.mount !== 'function') {
    throw new Error(`Widget "${widgetId}" must export mount(container, props, { contextBus }).`);
  }
  const unmount = await module.mount(container, props, { contextBus });
  if (typeof unmount !== 'function') {
    throw new Error(`Widget "${widgetId}" mount() must return an unmount function.`);
  }
  const mounted = mountedWidgets.get(owner) ?? [];
  mounted.push(unmount);
  mountedWidgets.set(owner, mounted);
}

export async function unmountWidgets(container) {
  const mounted = mountedWidgets.get(container) ?? [];
  mountedWidgets.delete(container);
  const errors = [];
  for (const unmount of mounted.reverse()) {
    try {
      await unmount();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'One or more widgets failed to unmount.');
}

export function listModules() {
  return [...modules.entries()].map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    loaded: Boolean(entry.instance),
  }));
}

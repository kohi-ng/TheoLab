/** Mount bridge for VectorPanel (moduleRegistry) and global Ctrl+K CommandPalette. */
import { mount, unmount } from 'svelte';
import VectorPanel from './VectorPanel.svelte';
import CommandPalette from './CommandPalette.svelte';

let activePanelCleanup: (() => void) | null = null;

export function mountVectorPanel(target: HTMLElement, { onNavigate }: { onNavigate?: (deepLink: string) => void } = {}) {
  activePanelCleanup?.();
  target.replaceChildren();
  const instance = mount(VectorPanel, { target, props: { onNavigate } });
  activePanelCleanup = () => {
    unmount(instance);
    activePanelCleanup = null;
  };
  return activePanelCleanup;
}

export function renderMain(target: HTMLElement) {
  return mountVectorPanel(target, {
    onNavigate: (deepLink) => {
      window.dispatchEvent(new CustomEvent('theolab:navigate-deep-link', { detail: deepLink }));
    },
  });
}

export function mountCommandPalette(target: HTMLElement, { onNavigate }: { onNavigate?: (deepLink: string) => void } = {}) {
  const instance = mount(CommandPalette, { target, props: { onNavigate } });
  return () => { unmount(instance); };
}

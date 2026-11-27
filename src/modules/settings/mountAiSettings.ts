/** Mount bridge connecting the Svelte 5 AiSettings component into src/main.js. */
import { mount, unmount } from 'svelte';
import AiSettings from './AiSettings.svelte';

export function mountAiSettings(
  target: HTMLElement,
  { onToast }: { onToast?: (message: string) => void } = {},
): () => void {
  target.replaceChildren();
  const instance = mount(AiSettings, { target, props: { onToast } });
  return () => {
    unmount(instance);
  };
}

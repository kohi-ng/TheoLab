/** Mount bridge connecting Theon Svelte 5 settings into src/main.js. */
import { mount, unmount } from 'svelte';
import TheonSettings from './TheonSettings.svelte';

export function mountTheonSettings(
  target: HTMLElement,
  { onToast }: { onToast?: (message: string) => void } = {},
): () => void {
  target.replaceChildren();
  const instance = mount(TheonSettings, { target, props: { onToast } });
  return () => {
    unmount(instance);
  };
}

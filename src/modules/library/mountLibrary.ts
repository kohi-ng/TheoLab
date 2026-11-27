/** Mount bridges connecting Svelte 5 LibraryBrowser into main canvas and sidebar drawer. */
import { mount, unmount } from 'svelte';
import LibraryBrowser from './LibraryBrowser.svelte';
import { libraryStore } from './libraryStore.svelte';
import type { LibraryItemView } from '../../domain/library/schemas';

export interface LibraryMountCallbacks {
  onOpenItem: (item: LibraryItemView) => void;
  onOpenInDock?: (item: LibraryItemView) => void;
  onAttachToChat?: (item: LibraryItemView) => void;
  onToast?: (message: string) => void;
}

export function mountLibraryMain(
  target: HTMLElement,
  callbacks: LibraryMountCallbacks,
): () => void {
  target.replaceChildren();
  const instance = mount(LibraryBrowser, {
    target,
    props: {
      mode: 'full',
      ...callbacks,
    },
  });
  return () => {
    unmount(instance);
  };
}

export function mountLibraryDrawer(
  target: HTMLElement,
  callbacks: LibraryMountCallbacks,
): () => void {
  target.replaceChildren();
  const instance = mount(LibraryBrowser, {
    target,
    props: {
      mode: 'drawer',
      ...callbacks,
    },
  });
  return () => {
    unmount(instance);
  };
}

export async function ensureLibraryLoaded(force = false): Promise<void> {
  await libraryStore.load(force);
}

export { libraryStore };

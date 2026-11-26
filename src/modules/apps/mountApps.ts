/** Mount bridge connecting the Svelte 5 Apps & WorkspaceDock module to src/main.js. */
import { mount, unmount } from 'svelte';
import AppsDrawer from './AppsDrawer.svelte';
import WorkspaceDock from './WorkspaceDock.svelte';
import { dockStore, type DockLayoutSnapshot } from './dockStore.svelte';
import { buildLibraryDockSpec, type LibraryDockInput } from './appCatalog';

export function mountAppsDrawer(
  target: HTMLElement,
  { onLaunched }: { onLaunched?: () => void } = {},
): () => void {
  target.replaceChildren();
  const instance = mount(AppsDrawer, { target, props: { onLaunched } });
  return () => {
    unmount(instance);
  };
}

export function mountWorkspaceDock(
  target: HTMLElement,
  {
    onToast,
    onToggleChat,
  }: { onToast?: (message: string) => void; onToggleChat?: () => void } = {},
): () => void {
  target.replaceChildren();
  const instance = mount(WorkspaceDock, { target, props: { onToast, onToggleChat } });
  const offToast = onToast ? dockStore.onToast(onToast) : () => {};
  return () => {
    offToast();
    unmount(instance);
  };
}

export function onDockLayoutChange(cb: (snapshot: DockLayoutSnapshot) => void): () => void {
  return dockStore.onLayoutChange(cb);
}

export function canOpenLibraryItemInDock(item: LibraryDockInput): boolean {
  return buildLibraryDockSpec(item, import.meta.env.BASE_URL ?? '/') !== null;
}

export function openLibraryItemInDock(item: LibraryDockInput) {
  return dockStore.openLibraryItem(item);
}

export function syncDockLibraryBridge(
  items: LibraryDockInput[],
  onSaveDriveItem?: (input: { title: string; url: string }) => Promise<LibraryDockInput>,
) {
  dockStore.setLibraryBridge(items, onSaveDriveItem);
}

export { dockStore };

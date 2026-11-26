/** Mount/unmount bridge connecting Svelte 5 Academy components to the legacy main.js shell. */
import { mount, unmount } from 'svelte';
import CourseTree from './CourseTree.svelte';
import UnitWorkspace from './UnitWorkspace.svelte';
import { academyStore } from './academyStore.svelte';
import { parseDeepLink } from '../../domain/content/ids';

let initialized = false;

export async function ensureAcademyLoaded() {
  if (!initialized) {
    initialized = true;
    await academyStore.init();
  }
}

export async function navigateToDeepLink(deepLink: string): Promise<boolean> {
  const target = parseDeepLink(deepLink);
  if (!target) return false;
  await ensureAcademyLoaded();
  await academyStore.selectPath(target.subjectId, target.chapterId, target.unitId, target.tabId, target.blockId);
  return true;
}

export function onAcademyEvent(cb: (event: { type: 'toast' | 'unit-selected'; message?: string; title?: string }) => void) {
  return academyStore.onEvent(cb);
}

export function mountCourseTree(target: HTMLElement, { onSelectUnit }: { onSelectUnit?: () => void } = {}) {
  target.replaceChildren();
  const instance = mount(CourseTree, { target, props: { onSelectUnit } });
  return () => { unmount(instance); };
}

export function mountUnitWorkspace(target: HTMLElement) {
  target.replaceChildren();
  const instance = mount(UnitWorkspace, { target });
  return () => { unmount(instance); };
}

/**
 * Pure domain query, sort, filter, grouping, and folder-tree helpers for Library v2.
 * Uses Vietnamese diacritic folding consistent with `slugify()` / `tokenize()`.
 */
import type {
  LibraryFolder,
  LibraryGroupMode,
  LibraryItem,
  LibraryItemKind,
  LibraryItemSource,
  LibrarySortDir,
  LibrarySortField,
} from './schemas';

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const BUILTIN_FOLDER_SENTINEL = '__builtin__';
export const UNFILED_FOLDER_SENTINEL = '__unfiled__';

/** Lowercase and strip Vietnamese diacritics (đ → d) for accent-insensitive search. */
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 40);
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const clean = normalizeTag(raw);
    if (!clean) continue;
    const folded = foldVietnamese(clean);
    if (!seen.has(folded)) seen.set(folded, clean);
  }
  return [...seen.values()].slice(0, 30);
}

export function getKindLabel(kind: LibraryItemKind, mimeType?: string): string {
  if (kind === 'drive-file' && mimeType === DRIVE_FOLDER_MIME) return 'Thư mục Drive';
  switch (kind) {
    case 'markdown':
      return 'Markdown';
    case 'pdf':
      return 'PDF';
    case 'google-doc':
      return 'Google Docs';
    case 'google-sheet':
      return 'Google Sheets';
    case 'google-slide':
      return 'Google Slides';
    case 'drive-file':
      return 'Tệp Drive';
    case 'json':
      return 'JSON';
    case 'formula':
      return 'Công thức';
    case 'widget':
      return 'Mô phỏng';
  }
}

export function getKindIcon(kind: LibraryItemKind, mimeType?: string): string {
  if (kind === 'drive-file' && mimeType === DRIVE_FOLDER_MIME) return '📁';
  if (mimeType?.startsWith('image/')) return '🖼';
  switch (kind) {
    case 'markdown':
      return '📝';
    case 'pdf':
      return '📕';
    case 'google-doc':
      return '▤';
    case 'google-sheet':
      return '▦';
    case 'google-slide':
      return '▣';
    case 'drive-file':
      return '☁';
    case 'json':
      return '｛｝';
    case 'formula':
      return '∑';
    case 'widget':
      return '⚗';
  }
}

export function getSourceLabel(source: LibraryItemSource): string {
  switch (source) {
    case 'builtin':
      return 'TheoLab';
    case 'drive':
      return 'Google Drive';
    case 'upload':
      return 'Tải lên';
  }
}

/* --------------------------------------------------------- Folder tree */

export interface FolderTreeNode {
  folder: LibraryFolder;
  depth: number;
  children: FolderTreeNode[];
}

/**
 * Checks whether setting `folderId`'s parent to `nextParentId` would create a cycle
 * (including self-parenting or assigning a descendant as parent).
 */
export function wouldCreateFolderCycle(
  folders: readonly LibraryFolder[],
  folderId: string,
  nextParentId: string | null,
): boolean {
  if (!nextParentId) return false;
  if (folderId === nextParentId) return true;
  const parentMap = new Map<string, string | null>(folders.map((f) => [f.id, f.parentId]));
  const visited = new Set<string>([folderId]);
  let cursor: string | null = nextParentId;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parentMap.get(cursor) ?? null;
  }
  return false;
}

/** Collects `folderId` plus all nested descendant folder IDs safely (cycle-resistant). */
export function collectDescendantFolderIds(
  folders: readonly LibraryFolder[],
  rootFolderId: string,
): Set<string> {
  const result = new Set<string>([rootFolderId]);
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = childrenByParent.get(folder.parentId) ?? [];
    list.push(folder.id);
    childrenByParent.set(folder.parentId, list);
  }
  const queue = [rootFolderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

/** Builds an ordered nested tree of folders, guarding against orphaned or cyclic links. */
export function buildFolderTree(folders: readonly LibraryFolder[]): FolderTreeNode[] {
  const byId = new Map<string, LibraryFolder>(folders.map((f) => [f.id, f]));
  const sortFolders = (list: LibraryFolder[]) =>
    [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));

  const childrenMap = new Map<string | null, LibraryFolder[]>();
  for (const folder of folders) {
    const effectiveParent =
      folder.parentId && byId.has(folder.parentId) && !wouldCreateFolderCycle(folders, folder.id, folder.parentId)
        ? folder.parentId
        : null;
    const list = childrenMap.get(effectiveParent) ?? [];
    list.push(folder);
    childrenMap.set(effectiveParent, list);
  }

  const visited = new Set<string>();
  const build = (parentId: string | null, depth: number): FolderTreeNode[] => {
    const kids = sortFolders(childrenMap.get(parentId) ?? []);
    const nodes: FolderTreeNode[] = [];
    for (const folder of kids) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      nodes.push({
        folder,
        depth,
        children: build(folder.id, depth + 1),
      });
    }
    return nodes;
  };

  return build(null, 0);
}

/** Flattens a folder tree into depth-first order for indentation in sidebars and `<select>` lists. */
export function flattenFolderTree(nodes: readonly FolderTreeNode[]): Array<{ folder: LibraryFolder; depth: number }> {
  const out: Array<{ folder: LibraryFolder; depth: number }> = [];
  const walk = (list: readonly FolderTreeNode[]) => {
    for (const node of list) {
      out.push({ folder: node.folder, depth: node.depth });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function getFolderPathLabel(folders: readonly LibraryFolder[], folderId: string | null): string {
  if (!folderId) return 'Chưa phân thư mục';
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const f = byId.get(cursor);
    if (!f) break;
    parts.unshift(f.name);
    cursor = f.parentId;
  }
  return parts.join(' / ') || 'Chưa phân thư mục';
}

/* ----------------------------------------------------- Filter & Sort */

export interface LibraryQueryOptions {
  query?: string;
  kind?: LibraryItemKind | 'all';
  source?: LibraryItemSource | 'all';
  tag?: string | 'all';
  /**
   * - `'all'` or `undefined`: all items
   * - `BUILTIN_FOLDER_SENTINEL`: built-in system items only
   * - `UNFILED_FOLDER_SENTINEL`: user items with `folderId === null`
   * - `<folderId>`: items in that folder (and descendants if `includeSubfolders` is true)
   */
  folderFilter?: string;
  includeSubfolders?: boolean;
  sortBy?: LibrarySortField;
  sortDir?: LibrarySortDir;
}

export function queryLibraryItems<T extends LibraryItem>(
  items: readonly T[],
  folders: readonly LibraryFolder[],
  options: LibraryQueryOptions = {},
): T[] {
  const qTokens = options.query
    ? foldVietnamese(options.query.trim()).split(/\s+/).filter(Boolean)
    : [];
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

  let allowedFolders: Set<string> | null = null;
  if (
    options.folderFilter &&
    options.folderFilter !== 'all' &&
    options.folderFilter !== BUILTIN_FOLDER_SENTINEL &&
    options.folderFilter !== UNFILED_FOLDER_SENTINEL
  ) {
    allowedFolders = options.includeSubfolders !== false
      ? collectDescendantFolderIds(folders, options.folderFilter)
      : new Set([options.folderFilter]);
  }

  const wantedTagFolded =
    options.tag && options.tag !== 'all' ? foldVietnamese(options.tag) : null;

  const filtered = items.filter((item) => {
    if (options.kind && options.kind !== 'all' && item.kind !== options.kind) return false;
    if (options.source && options.source !== 'all' && item.source !== options.source) return false;

    if (options.folderFilter === BUILTIN_FOLDER_SENTINEL) {
      if (item.source !== 'builtin') return false;
    } else if (options.folderFilter === UNFILED_FOLDER_SENTINEL) {
      if (item.source === 'builtin' || item.folderId !== null) return false;
    } else if (allowedFolders) {
      if (!item.folderId || !allowedFolders.has(item.folderId)) return false;
    }

    if (wantedTagFolded) {
      const hasTag = item.tags.some((t) => foldVietnamese(t) === wantedTagFolded);
      if (!hasTag) return false;
    }

    if (qTokens.length > 0) {
      const folderName = item.folderId ? folderNameById.get(item.folderId) ?? '' : '';
      const haystack = foldVietnamese(
        `${item.title} ${item.description ?? ''} ${item.tags.join(' ')} ${getKindLabel(item.kind, item.mimeType)} ${getSourceLabel(item.source)} ${folderName}`,
      );
      if (!qTokens.every((token) => haystack.includes(token))) return false;
    }

    return true;
  });

  const sortBy = options.sortBy ?? 'createdAt';
  const dir = options.sortDir === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'title') {
      cmp = a.title.localeCompare(b.title, 'vi', { sensitivity: 'base' });
    } else if (sortBy === 'kind') {
      cmp = getKindLabel(a.kind, a.mimeType).localeCompare(getKindLabel(b.kind, b.mimeType), 'vi');
    } else if (sortBy === 'order') {
      cmp = a.order - b.order;
    } else {
      cmp = a.createdAt.localeCompare(b.createdAt);
    }
    if (cmp !== 0) return cmp * dir;
    return a.title.localeCompare(b.title, 'vi', { sensitivity: 'base' });
  });
}

export interface LibraryItemGroup<T extends LibraryItem> {
  key: string;
  label: string;
  items: T[];
}

export function groupLibraryItems<T extends LibraryItem>(
  items: readonly T[],
  folders: readonly LibraryFolder[],
  groupBy: LibraryGroupMode,
): LibraryItemGroup<T>[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: '', items: [...items] }];
  }

  const groups = new Map<string, LibraryItemGroup<T>>();
  const push = (key: string, label: string, item: T) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  };

  for (const item of items) {
    if (groupBy === 'folder') {
      if (item.source === 'builtin') {
        push(BUILTIN_FOLDER_SENTINEL, 'Tài nguyên TheoLab (mặc định)', item);
      } else if (!item.folderId) {
        push(UNFILED_FOLDER_SENTINEL, 'Chưa phân thư mục', item);
      } else {
        push(item.folderId, getFolderPathLabel(folders, item.folderId), item);
      }
    } else if (groupBy === 'kind') {
      const label = getKindLabel(item.kind, item.mimeType);
      const key = item.mimeType === DRIVE_FOLDER_MIME ? 'drive-folder' : item.kind;
      push(key, label, item);
    } else if (groupBy === 'tag') {
      if (!item.tags.length) {
        push('__untagged__', 'Chưa gắn thẻ', item);
      } else {
        for (const tag of item.tags) {
          push(foldVietnamese(tag), `#${tag}`, item);
        }
      }
    }
  }

  return [...groups.values()];
}

export function collectAllTags(items: readonly LibraryItem[]): Array<{ tag: string; count: number }> {
  const map = new Map<string, { tag: string; count: number }>();
  for (const item of items) {
    for (const raw of item.tags) {
      const clean = normalizeTag(raw);
      if (!clean) continue;
      const key = foldVietnamese(clean);
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { tag: clean, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'vi'));
}

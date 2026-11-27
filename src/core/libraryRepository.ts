/**
 * Document-per-item persistence repository for TheoLab Library v2.
 *
 * Collections:
 * - `library_items/{id}`
 * - `library_folders/{id}`
 *
 * All persistence flows through `dataGateway.js` (`dev_mock` → localStorage,
 * `firebase_auth` → owner-only Firestore). Follows the `contentRepository.ts` pattern
 * so domain & repository tests run deterministically with an in-memory backend.
 */
import {
  deleteCollectionDoc,
  getCollectionDoc,
  getLocalSetting,
  listCollectionDocs,
  readLegacyDriveLibraryItems,
  saveLocalSetting,
  setCollectionDoc,
} from './dataGateway.js';
import { isAllowedDriveUrl } from './secretsVault';
import { orderBetween, slugify, uniqueId } from '../domain/content/ids';
import {
  LibraryFolderSchema,
  LibraryItemSchema,
  type LibraryFolder,
  type LibraryItem,
  type LibraryItemKind,
  type LibraryItemSource,
} from '../domain/library/schemas';
import {
  buildNewItemId,
  detectKindFromDriveUrl,
  detectMimeTypeFromDriveUrl,
  extractDriveFileId,
  migrateLegacyDriveItems,
} from '../domain/library/migrations';
import { normalizeTags, wouldCreateFolderCycle } from '../domain/library/query';

export const LIBRARY_ITEMS_COLLECTION = 'library_items';
export const LIBRARY_FOLDERS_COLLECTION = 'library_folders';
const MIGRATION_FLAG_KEY = 'library-v2-migrated';

export interface LibraryBackend {
  list(collectionName: string): Promise<Record<string, unknown>[]>;
  get(collectionName: string, id: string): Promise<Record<string, unknown> | null>;
  set(collectionName: string, id: string, data: Record<string, unknown>): Promise<void>;
  remove(collectionName: string, id: string): Promise<void>;
  readLegacyDriveItems(): Promise<unknown[]>;
  isMigrated(): boolean;
  markMigrated(): void;
}

export function createGatewayLibraryBackend(): LibraryBackend {
  return {
    list: (collectionName) => listCollectionDocs(collectionName) as Promise<Record<string, unknown>[]>,
    get: (collectionName, id) => getCollectionDoc(collectionName, id) as Promise<Record<string, unknown> | null>,
    set: (collectionName, id, data) => setCollectionDoc(collectionName, id, data),
    remove: (collectionName, id) => deleteCollectionDoc(collectionName, id),
    readLegacyDriveItems: () => readLegacyDriveLibraryItems() as Promise<unknown[]>,
    isMigrated: () => typeof localStorage !== 'undefined' && getLocalSetting(MIGRATION_FLAG_KEY, '') === '1',
    markMigrated: () => {
      if (typeof localStorage !== 'undefined') saveLocalSetting(MIGRATION_FLAG_KEY, '1');
    },
  };
}

export function createMemoryLibraryBackend(legacyItems: unknown[] = []): LibraryBackend {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  let migrated = false;
  const table = (name: string) => {
    let t = tables.get(name);
    if (!t) tables.set(name, (t = new Map()));
    return t;
  };
  return {
    async list(name) {
      return [...table(name).values()].map((entry) => structuredClone(entry));
    },
    async get(name, id) {
      const found = table(name).get(id);
      return found ? structuredClone(found) : null;
    },
    async set(name, id, data) {
      table(name).set(id, structuredClone(data));
    },
    async remove(name, id) {
      table(name).delete(id);
    },
    async readLegacyDriveItems() {
      return structuredClone(legacyItems);
    },
    isMigrated: () => migrated,
    markMigrated: () => {
      migrated = true;
    },
  };
}

export interface CreateLibraryItemInput {
  id?: string;
  title: string;
  kind?: LibraryItemKind;
  source?: LibraryItemSource;
  url?: string;
  driveFileId?: string;
  file?: string;
  mimeType?: string;
  folderId?: string | null;
  tags?: string[];
  description?: string;
  order?: number;
}

export interface UpdateLibraryItemPatch {
  title?: string;
  folderId?: string | null;
  tags?: string[];
  description?: string;
  order?: number;
  url?: string;
  mimeType?: string;
  kind?: LibraryItemKind;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  order?: number;
}

export interface UpdateFolderPatch {
  name?: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  order?: number;
}

function parseSafeItem(raw: Record<string, unknown>): LibraryItem | null {
  const res = LibraryItemSchema.safeParse(raw);
  return res.success ? res.data : null;
}

function parseSafeFolder(raw: Record<string, unknown>): LibraryFolder | null {
  const res = LibraryFolderSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function createLibraryRepository(backend: LibraryBackend) {
  let migrationPromise: Promise<number> | null = null;

  async function runMigrationOnce(): Promise<number> {
    if (backend.isMigrated()) return 0;
    if (!migrationPromise) {
      migrationPromise = (async () => {
        const legacyRaw = await backend.readLegacyDriveItems();
        if (!legacyRaw.length) {
          backend.markMigrated();
          return 0;
        }
        const existingRaw = await backend.list(LIBRARY_ITEMS_COLLECTION);
        const existingIds = new Set(existingRaw.map((d) => String(d.id ?? '')));
        const migrated = migrateLegacyDriveItems(legacyRaw);
        let importedCount = 0;
        for (const item of migrated) {
          if (existingIds.has(item.id)) continue;
          await backend.set(LIBRARY_ITEMS_COLLECTION, item.id, item);
          importedCount += 1;
        }
        backend.markMigrated();
        return importedCount;
      })().finally(() => {
        migrationPromise = null;
      });
    }
    return migrationPromise;
  }

  return {
    /** Explicitly run idempotent migration from legacy `settings/library_drive` / `theolab:library-drive`. */
    migrateLegacy: runMigrationOnce,

    /* ----------------------------------------------------------- Items */

    async listItems(): Promise<LibraryItem[]> {
      await runMigrationOnce();
      const raw = await backend.list(LIBRARY_ITEMS_COLLECTION);
      return raw
        .map(parseSafeItem)
        .filter((item): item is LibraryItem => item !== null)
        .sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt));
    },

    async getItem(id: string): Promise<LibraryItem | null> {
      await runMigrationOnce();
      const raw = await backend.get(LIBRARY_ITEMS_COLLECTION, id);
      return raw ? parseSafeItem(raw) : null;
    },

    async createItem(input: CreateLibraryItemInput): Promise<LibraryItem> {
      await runMigrationOnce();
      const title = input.title.trim();
      if (!title) throw new Error('Nhập tên tài liệu.');

      const source: LibraryItemSource = input.source ?? 'drive';
      const url = input.url?.trim() || undefined;
      if (source === 'drive') {
        if (!url || !isAllowedDriveUrl(url)) {
          throw new Error('Chỉ chấp nhận liên kết https://drive.google.com hoặc https://docs.google.com.');
        }
      }

      const mimeType = input.mimeType?.trim() || (url ? detectMimeTypeFromDriveUrl(url) : undefined);
      const kind: LibraryItemKind = input.kind ?? (url ? detectKindFromDriveUrl(url, mimeType) : 'drive-file');
      const driveFileId = input.driveFileId?.trim() || (url ? extractDriveFileId(url) : undefined);
      const now = new Date().toISOString();

      let order = input.order;
      if (order === undefined) {
        const existing = await this.listItems();
        const firstOrder = existing.length ? Math.min(...existing.map((i) => i.order)) : undefined;
        order = orderBetween(undefined, firstOrder);
      }

      const item = LibraryItemSchema.parse({
        id: input.id?.trim() || buildNewItemId(source === 'drive' ? 'drive' : 'item', title),
        title,
        kind,
        source,
        url,
        driveFileId,
        file: input.file?.trim() || undefined,
        mimeType,
        folderId: input.folderId ?? null,
        tags: normalizeTags(input.tags ?? []),
        description: input.description?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        order,
      });

      await backend.set(LIBRARY_ITEMS_COLLECTION, item.id, item);
      return item;
    },

    async updateItem(id: string, patch: UpdateLibraryItemPatch): Promise<LibraryItem> {
      const existing = await this.getItem(id);
      if (!existing) throw new Error(`Không tìm thấy tài liệu "${id}".`);
      if (existing.source === 'builtin') {
        throw new Error('Không thể chỉnh sửa tài liệu hệ thống mặc định.');
      }

      const nextUrl = patch.url !== undefined ? (patch.url.trim() || undefined) : existing.url;
      if (existing.source === 'drive' && nextUrl && !isAllowedDriveUrl(nextUrl)) {
        throw new Error('Chỉ chấp nhận liên kết https://drive.google.com hoặc https://docs.google.com.');
      }

      const updated = LibraryItemSchema.parse({
        ...existing,
        ...patch,
        title: patch.title !== undefined ? patch.title.trim() : existing.title,
        url: nextUrl,
        description:
          patch.description !== undefined ? (patch.description.trim() || undefined) : existing.description,
        tags: patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags,
        updatedAt: new Date().toISOString(),
      });

      await backend.set(LIBRARY_ITEMS_COLLECTION, updated.id, updated);
      return updated;
    },

    async deleteItem(id: string): Promise<void> {
      await backend.remove(LIBRARY_ITEMS_COLLECTION, id);
    },

    async bulkMoveItems(ids: readonly string[], folderId: string | null): Promise<LibraryItem[]> {
      const updated: LibraryItem[] = [];
      for (const id of ids) {
        const item = await this.getItem(id);
        if (!item || item.source === 'builtin') continue;
        updated.push(await this.updateItem(id, { folderId }));
      }
      return updated;
    },

    async bulkAddTags(ids: readonly string[], tagsToAdd: readonly string[]): Promise<LibraryItem[]> {
      const cleanAdd = normalizeTags(tagsToAdd);
      if (!cleanAdd.length) return [];
      const updated: LibraryItem[] = [];
      for (const id of ids) {
        const item = await this.getItem(id);
        if (!item || item.source === 'builtin') continue;
        updated.push(await this.updateItem(id, { tags: normalizeTags([...item.tags, ...cleanAdd]) }));
      }
      return updated;
    },

    async bulkDeleteItems(ids: readonly string[]): Promise<void> {
      for (const id of ids) {
        await backend.remove(LIBRARY_ITEMS_COLLECTION, id);
      }
    },

    /* --------------------------------------------------------- Folders */

    async listFolders(): Promise<LibraryFolder[]> {
      const raw = await backend.list(LIBRARY_FOLDERS_COLLECTION);
      return raw
        .map(parseSafeFolder)
        .filter((folder): folder is LibraryFolder => folder !== null)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
    },

    async createFolder(input: CreateFolderInput): Promise<LibraryFolder> {
      const name = input.name.trim();
      if (!name) throw new Error('Nhập tên thư mục.');

      const existing = await this.listFolders();
      const parentId = input.parentId ?? null;
      if (parentId && !existing.some((f) => f.id === parentId)) {
        throw new Error('Thư mục cha không tồn tại.');
      }

      const siblings = existing.filter((f) => f.parentId === parentId);
      const lastOrder = siblings.length ? Math.max(...siblings.map((f) => f.order)) : undefined;
      const order = input.order ?? orderBetween(lastOrder, undefined);
      const id = uniqueId(slugify(name, 48), existing.map((f) => f.id));

      const folder = LibraryFolderSchema.parse({
        id,
        name,
        parentId,
        order,
        color: input.color?.trim() || undefined,
        icon: input.icon?.trim() || undefined,
      });

      await backend.set(LIBRARY_FOLDERS_COLLECTION, folder.id, folder);
      return folder;
    },

    async updateFolder(id: string, patch: UpdateFolderPatch): Promise<LibraryFolder> {
      const folders = await this.listFolders();
      const existing = folders.find((f) => f.id === id);
      if (!existing) throw new Error(`Không tìm thấy thư mục "${id}".`);

      const nextParentId = patch.parentId !== undefined ? patch.parentId : existing.parentId;
      if (nextParentId && !folders.some((f) => f.id === nextParentId)) {
        throw new Error('Thư mục cha không tồn tại.');
      }
      if (wouldCreateFolderCycle(folders, id, nextParentId)) {
        throw new Error('Không thể chuyển thư mục vào chính nó hoặc thư mục con của nó.');
      }

      const updated = LibraryFolderSchema.parse({
        ...existing,
        ...patch,
        name: patch.name !== undefined ? patch.name.trim() : existing.name,
        parentId: nextParentId,
      });

      await backend.set(LIBRARY_FOLDERS_COLLECTION, updated.id, updated);
      return updated;
    },

    /**
     * Deletes a folder safely: child folders are promoted to the deleted folder's parent,
     * and items inside are moved to that parent (or root `null`) so nothing is orphaned.
     */
    async deleteFolder(id: string): Promise<void> {
      const folders = await this.listFolders();
      const target = folders.find((f) => f.id === id);
      if (!target) return;

      const fallbackParent = target.parentId ?? null;
      for (const child of folders) {
        if (child.parentId === id) {
          await backend.set(LIBRARY_FOLDERS_COLLECTION, child.id, {
            ...child,
            parentId: fallbackParent,
          });
        }
      }

      const items = await this.listItems();
      for (const item of items) {
        if (item.folderId === id) {
          await this.updateItem(item.id, { folderId: fallbackParent });
        }
      }

      await backend.remove(LIBRARY_FOLDERS_COLLECTION, id);
    },
  };
}

export const libraryRepo = createLibraryRepository(createGatewayLibraryBackend());

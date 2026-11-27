/**
 * Reactive Svelte 5 store for TheoLab Library v2.
 * Shared between full-page LibraryBrowser and compact Drawer mode,
 * and bridges user + built-in items to WorkspaceDock (`syncDockLibraryBridge`).
 */
import { getJsonSetting, saveJsonSetting } from '../../core/dataGateway.js';
import {
  libraryRepo,
  type CreateFolderInput,
  type CreateLibraryItemInput,
  type UpdateFolderPatch,
  type UpdateLibraryItemPatch,
} from '../../core/libraryRepository';
import { LIBRARY_DOCUMENTS } from './libraryCatalog.js';
import {
  buildBuiltinLibraryItems,
  enrichLibraryItemView,
} from '../../domain/library/migrations';
import {
  AiLibrarySuggestionSchema,
  LibraryViewPrefsSchema,
  type AiLibrarySuggestionBatch,
  type LibraryFolder,
  type LibraryItemView,
  type LibraryViewPrefs,
} from '../../domain/library/schemas';
import { syncDockLibraryBridge } from '../apps/mountApps';
import { runAgent } from '../agents/agentLoop.js';
import { aiConfigStore } from '../../core/aiConfigStore.svelte';

export const LIBRARY_VIEW_PREFS_KEY = 'theolab:library-view-prefs:v1';

function loadViewPrefs(): LibraryViewPrefs {
  const raw = getJsonSetting(LIBRARY_VIEW_PREFS_KEY);
  const parsed = LibraryViewPrefsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : LibraryViewPrefsSchema.parse({});
}

function formatRepoError(error: unknown): string {
  const msg = (error as Error)?.message ?? String(error);
  if (/permission-denied|Missing or insufficient permissions/i.test(msg)) {
    return 'Firestore từ chối quyền truy cập collection library_items / library_folders. Hãy cập nhật Firestore Rules cho chủ sở hữu.';
  }
  return msg;
}

class LibraryStore {
  userItems = $state<LibraryItemView[]>([]);
  builtinItems = $state<LibraryItemView[]>(
    buildBuiltinLibraryItems(LIBRARY_DOCUMENTS).map(enrichLibraryItemView),
  );
  folders = $state<LibraryFolder[]>([]);
  viewPrefs = $state<LibraryViewPrefs>(loadViewPrefs());
  activeItemId = $state<string | null>(null);
  loading = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);

  get allItems(): LibraryItemView[] {
    return [...this.userItems, ...this.builtinItems];
  }

  private syncDockBridge() {
    const dockItems = this.allItems.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type ?? item.kind,
      kind: item.kind,
      url: item.url,
      file: item.file,
      mimeType: item.mimeType,
      sourceLabel: item.sourceLabel,
      widget: item.widget,
    }));
    syncDockLibraryBridge(dockItems, async ({ title, url, driveFileId, mimeType }) => {
      const created = await this.createItem({
        title,
        url,
        driveFileId,
        mimeType,
        source: 'drive',
      });
      return {
        id: created.id,
        title: created.title,
        type: created.type ?? created.kind,
        kind: created.kind,
        url: created.url,
        mimeType: created.mimeType,
        sourceLabel: created.sourceLabel,
      };
    });
  }

  async load(force = false): Promise<void> {
    if (this.loading) return;
    if (this.loaded && !force) {
      this.syncDockBridge();
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const [items, folders] = await Promise.all([
        libraryRepo.listItems(),
        libraryRepo.listFolders(),
      ]);
      this.userItems = items.map((item) => enrichLibraryItemView(item));
      this.folders = folders;
      this.loaded = true;
      this.syncDockBridge();
    } catch (error) {
      this.error = formatRepoError(error);
      this.syncDockBridge();
    } finally {
      this.loading = false;
    }
  }

  setActiveItemId(id: string | null) {
    this.activeItemId = id;
  }

  setViewPrefs(patch: Partial<LibraryViewPrefs>) {
    const next = LibraryViewPrefsSchema.parse({ ...this.viewPrefs, ...patch });
    this.viewPrefs = next;
    try {
      saveJsonSetting(LIBRARY_VIEW_PREFS_KEY, next);
    } catch {
      // Ignore storage quota restrictions.
    }
  }

  async createItem(input: CreateLibraryItemInput): Promise<LibraryItemView> {
    try {
      const created = enrichLibraryItemView(await libraryRepo.createItem(input));
      this.userItems = [created, ...this.userItems.filter((i) => i.id !== created.id)];
      this.syncDockBridge();
      return created;
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  async updateItem(id: string, patch: UpdateLibraryItemPatch): Promise<LibraryItemView> {
    try {
      const updated = enrichLibraryItemView(await libraryRepo.updateItem(id, patch));
      this.userItems = this.userItems.map((i) => (i.id === id ? updated : i));
      this.syncDockBridge();
      return updated;
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  async deleteItem(id: string): Promise<void> {
    try {
      await libraryRepo.deleteItem(id);
      this.userItems = this.userItems.filter((i) => i.id !== id);
      if (this.activeItemId === id) this.activeItemId = null;
      this.syncDockBridge();
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  async bulkMove(ids: readonly string[], folderId: string | null): Promise<number> {
    const updated = await libraryRepo.bulkMoveItems(ids, folderId);
    const byId = new Map(updated.map((u) => [u.id, enrichLibraryItemView(u)]));
    this.userItems = this.userItems.map((i) => byId.get(i.id) ?? i);
    this.syncDockBridge();
    return updated.length;
  }

  async bulkAddTags(ids: readonly string[], tags: readonly string[]): Promise<number> {
    const updated = await libraryRepo.bulkAddTags(ids, tags);
    const byId = new Map(updated.map((u) => [u.id, enrichLibraryItemView(u)]));
    this.userItems = this.userItems.map((i) => byId.get(i.id) ?? i);
    this.syncDockBridge();
    return updated.length;
  }

  async bulkDelete(ids: readonly string[]): Promise<void> {
    const deletable = ids.filter((id) => this.userItems.some((u) => u.id === id));
    await libraryRepo.bulkDeleteItems(deletable);
    const removed = new Set(deletable);
    this.userItems = this.userItems.filter((i) => !removed.has(i.id));
    if (this.activeItemId && removed.has(this.activeItemId)) this.activeItemId = null;
    this.syncDockBridge();
  }

  async createFolder(input: CreateFolderInput): Promise<LibraryFolder> {
    try {
      const created = await libraryRepo.createFolder(input);
      this.folders = [...this.folders, created].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'),
      );
      return created;
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  async updateFolder(id: string, patch: UpdateFolderPatch): Promise<LibraryFolder> {
    try {
      const updated = await libraryRepo.updateFolder(id, patch);
      this.folders = this.folders
        .map((f) => (f.id === id ? updated : f))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
      return updated;
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  async deleteFolder(id: string): Promise<void> {
    try {
      await libraryRepo.deleteFolder(id);
      await this.load(true);
    } catch (error) {
      throw new Error(formatRepoError(error));
    }
  }

  /**
   * Optional AI metadata-only categorization helper.
   * Sends ONLY item titles, kinds, mimeTypes, and existing folder/tag names — NEVER file contents.
   * Returns validated suggestions for user review before applying.
   */
  async suggestCategorizationWithAi(
    targetItems: readonly LibraryItemView[],
  ): Promise<AiLibrarySuggestionBatch['suggestions']> {
    const mutable = targetItems.filter((i) => i.source !== 'builtin').slice(0, 20);
    if (!mutable.length) {
      throw new Error('Chọn ít nhất 1 tài liệu cá nhân để AI gợi ý phân loại.');
    }
    const defaults = aiConfigStore.defaults;
    const payload = {
      existingFolders: this.folders.map((f) => f.name),
      items: mutable.map((item) => ({
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        mimeType: item.mimeType ?? null,
        currentTags: item.tags,
      })),
    };
    const prompt = [
      'Hãy đề xuất tên thư mục (folderName) và tối đa 3 thẻ ngắn (tags) bằng tiếng Việt cho từng tài liệu dựa CHỈ trên tiêu đề và loại tệp.',
      'Ưu tiên dùng lại tên thư mục có sẵn trong existingFolders nếu phù hợp, hoặc gợi ý tên ngắn gọn mới.',
      'Chỉ trả về JSON thuần đúng cấu trúc: {"suggestions":[{"itemId":"...","folderName":"...|null","tags":["..."]}]} — không bọc markdown.',
      JSON.stringify(payload),
    ].join('\n');

    const raw = await runAgent({
      prompt,
      provider: defaults.providerId,
      model: defaults.modelId,
      preferences: {
        temperature: 0.2,
        maxTokens: Math.min(2048, defaults.maxTokens || 2048),
        autoContext: false,
        useRag: false,
        useMcp: false,
      },
      context: {},
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI không trả về JSON gợi ý hợp lệ.');
    }
    const parsed = AiLibrarySuggestionSchema.parse(JSON.parse(jsonMatch[0]));
    const allowedIds = new Set(mutable.map((m) => m.id));
    return parsed.suggestions.filter((s) => allowedIds.has(s.itemId));
  }
}

export const libraryStore = new LibraryStore();

import { describe, expect, it } from 'vitest';
import {
  createLibraryRepository,
  createMemoryLibraryBackend,
} from '../../core/libraryRepository';
import {
  buildFolderTree,
  collectAllTags,
  flattenFolderTree,
  foldVietnamese,
  groupLibraryItems,
  queryLibraryItems,
  wouldCreateFolderCycle,
} from './query';
import {
  buildBuiltinLibraryItems,
  detectKindFromDriveUrl,
  extractDriveFileId,
  migrateLegacyDriveItems,
} from './migrations';
import { LIBRARY_DOCUMENTS } from '../../modules/library/libraryCatalog.js';

describe('Library v2 repository, migration, query, and folder tree', () => {
  it('migrates legacy Drive items idempotently into individual documents with inferred kind & driveFileId', async () => {
    const legacy = [
      {
        id: 'drive-de-thi-1',
        category: 'documents',
        title: 'Đề thi Hóa phân tích 2026',
        sourceLabel: 'Google Docs',
        type: 'google',
        url: 'https://docs.google.com/document/d/doc_abc_123/edit',
        note: 'Có đáp án cuối file',
        created_at: '2026-05-01T08:00:00.000Z',
      },
      {
        id: 'drive-bang-tinh-2',
        category: 'documents',
        title: 'Số liệu chuẩn độ NaOH',
        type: 'google',
        url: 'https://docs.google.com/spreadsheets/d/sheet_xyz_99/edit',
        created_at: '2026-05-02T09:30:00.000Z',
      },
      {
        id: 'drive-slide-3',
        category: 'documents',
        title: 'Bài giảng Phức chất EDTA',
        type: 'google',
        url: 'https://docs.google.com/presentation/d/slide_77/edit',
        created_at: '2026-05-03T10:00:00.000Z',
      },
    ];

    const backend = createMemoryLibraryBackend(legacy);
    const repo = createLibraryRepository(backend);

    const first = await repo.listItems();
    expect(first).toHaveLength(3);
    expect(first.find((i) => i.id === 'drive-de-thi-1')?.kind).toBe('google-doc');
    expect(first.find((i) => i.id === 'drive-de-thi-1')?.driveFileId).toBe('doc_abc_123');
    expect(first.find((i) => i.id === 'drive-bang-tinh-2')?.kind).toBe('google-sheet');
    expect(first.find((i) => i.id === 'drive-slide-3')?.kind).toBe('google-slide');

    // Calling migrate again must not duplicate documents
    const secondRun = await repo.migrateLegacy();
    expect(secondRun).toBe(0);
    expect(await repo.listItems()).toHaveLength(3);
  });

  it('supports full CRUD, bulk operations, and safe folder deletion without orphaning items', async () => {
    const repo = createLibraryRepository(createMemoryLibraryBackend());

    const root = await repo.createFolder({ name: 'Hóa phân tích' });
    const child = await repo.createFolder({ name: 'Đề thi mẫu', parentId: root.id });

    const doc1 = await repo.createItem({
      title: 'Chuẩn độ axit yếu',
      url: 'https://drive.google.com/file/d/pdf_111/view',
      folderId: child.id,
      tags: ['hóa phân tích', 'chương 3'],
    });
    const doc2 = await repo.createItem({
      title: 'Bảng hằng số Ka',
      url: 'https://docs.google.com/spreadsheets/d/sheet_222/edit',
      folderId: null,
      tags: ['hằng số'],
    });

    expect(doc1.kind).toBe('drive-file');
    expect(doc1.driveFileId).toBe('pdf_111');
    expect(doc2.kind).toBe('google-sheet');

    // Reject disallowed non-Google URLs
    await expect(
      repo.createItem({ title: 'Evil', url: 'https://evil.example.com/file/1', source: 'drive' }),
    ).rejects.toThrow();

    // Update & bulk move / bulk tag
    await repo.bulkMoveItems([doc2.id], child.id);
    await repo.bulkAddTags([doc1.id, doc2.id], ['ôn thi']);
    const afterBulk = await repo.listItems();
    expect(afterBulk.every((i) => i.folderId === child.id)).toBe(true);
    expect(afterBulk.every((i) => i.tags.includes('ôn thi'))).toBe(true);

    // Deleting `child` promotes its items to `root`
    await repo.deleteFolder(child.id);
    const afterDelete = await repo.listItems();
    expect(afterDelete.every((i) => i.folderId === root.id)).toBe(true);

    await repo.bulkDeleteItems([doc1.id]);
    expect((await repo.listItems()).map((i) => i.id)).toEqual([doc2.id]);
  });

  it('prevents circular folder hierarchies (self-parent and descendant cycles)', async () => {
    const repo = createLibraryRepository(createMemoryLibraryBackend());
    const a = await repo.createFolder({ name: 'Thư mục A' });
    const b = await repo.createFolder({ name: 'Thư mục B', parentId: a.id });
    const c = await repo.createFolder({ name: 'Thư mục C', parentId: b.id });

    const folders = await repo.listFolders();
    expect(wouldCreateFolderCycle(folders, a.id, a.id)).toBe(true);
    expect(wouldCreateFolderCycle(folders, a.id, b.id)).toBe(true);
    expect(wouldCreateFolderCycle(folders, a.id, c.id)).toBe(true);
    expect(wouldCreateFolderCycle(folders, c.id, a.id)).toBe(false);

    await expect(repo.updateFolder(a.id, { parentId: c.id })).rejects.toThrow(/vòng|con|chính nó/i);

    const tree = buildFolderTree(folders);
    const flat = flattenFolderTree(tree);
    expect(flat.map((n) => [n.folder.name, n.depth])).toEqual([
      ['Thư mục A', 0],
      ['Thư mục B', 1],
      ['Thư mục C', 2],
    ]);
  });

  it('searches Vietnamese text without diacritics, filters by folder/tag/kind, sorts, and groups', async () => {
    const repo = createLibraryRepository(createMemoryLibraryBackend());
    const chem = await repo.createFolder({ name: 'Hóa phân tích' });
    const sub = await repo.createFolder({ name: 'Bài tập Đệm', parentId: chem.id });

    const item1 = await repo.createItem({
      title: 'Đường cong chuẩn độ axit yếu',
      url: 'https://docs.google.com/document/d/id1/edit',
      folderId: sub.id,
      tags: ['Chuẩn độ', 'Chương 3'],
    });
    const item2 = await repo.createItem({
      title: 'Bài giảng cân bằng phức chất EDTA',
      url: 'https://docs.google.com/presentation/d/id2/edit',
      folderId: chem.id,
      tags: ['Phức chất'],
    });
    const builtins = buildBuiltinLibraryItems(LIBRARY_DOCUMENTS);
    const allItems = [item1, item2, ...builtins];
    const folders = await repo.listFolders();

    expect(foldVietnamese('Đường cong chuẩn độ')).toBe('duong cong chuan do');

    // Vietnamese diacritic-insensitive search
    const hits = queryLibraryItems(allItems, folders, { query: 'duong cong chuan do' });
    expect(hits.map((i) => i.id)).toContain(item1.id);

    // Folder filter includes nested subfolders by default
    const inChem = queryLibraryItems(allItems, folders, { folderFilter: chem.id, includeSubfolders: true });
    expect(inChem.map((i) => i.id).sort()).toEqual([item1.id, item2.id].sort());

    // Tag filter (diacritic-insensitive)
    const byTag = queryLibraryItems(allItems, folders, { tag: 'chuan do' });
    expect(byTag.map((i) => i.id)).toEqual([item1.id]);

    // Kind filter
    const onlySlides = queryLibraryItems(allItems, folders, { kind: 'google-slide' });
    expect(onlySlides.map((i) => i.id)).toEqual([item2.id]);

    // Sort by title ascending
    const sortedAsc = queryLibraryItems([item2, item1], folders, { sortBy: 'title', sortDir: 'asc' });
    expect(sortedAsc[0]?.id).toBe(item2.id);

    // Grouping by folder
    const grouped = groupLibraryItems(allItems, folders, 'folder');
    expect(grouped.some((g) => g.label.includes('Hóa phân tích'))).toBe(true);
    expect(grouped.some((g) => g.label.includes('TheoLab'))).toBe(true);

    // Tag counts
    const tagSummary = collectAllTags([item1, item2]);
    expect(tagSummary.map((t) => t.tag)).toContain('Chuẩn độ');
  });

  it('extracts Drive IDs and detects kinds cleanly', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/abc123/view?usp=sharing')).toBe('abc123');
    expect(extractDriveFileId('https://drive.google.com/drive/folders/fold_99')).toBe('fold_99');
    expect(extractDriveFileId('https://docs.google.com/document/d/REPLACE_WITH_ID/edit')).toBeUndefined();
    expect(detectKindFromDriveUrl('https://docs.google.com/spreadsheets/d/x/edit')).toBe('google-sheet');
    expect(migrateLegacyDriveItems([{ bad: true }])).toEqual([]);
  });
});

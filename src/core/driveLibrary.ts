/**
 * Backwards-compatible facade delegating Google Drive library calls to `libraryRepo`
 * (which persists each document individually via `dataGateway.js`).
 */
import { libraryRepo } from './libraryRepository';
import { enrichLibraryItemView } from '../domain/library/migrations';
import type { LibraryItemView } from '../domain/library/schemas';

export type DriveLibraryItem = LibraryItemView & {
  category: 'documents';
  userAdded: true;
  created_at: string;
};

function toLegacyShape(item: LibraryItemView): DriveLibraryItem {
  const enriched = enrichLibraryItemView(item);
  return {
    ...enriched,
    category: 'documents',
    userAdded: true,
    created_at: item.createdAt,
  };
}

export async function listDriveLibraryItems(): Promise<DriveLibraryItem[]> {
  const items = await libraryRepo.listItems();
  return items.map(toLegacyShape);
}

export async function addDriveLibraryItem(input: {
  title: string;
  url: string;
  note?: string;
  folderId?: string | null;
  tags?: string[];
  mimeType?: string;
  driveFileId?: string;
}): Promise<DriveLibraryItem> {
  const created = await libraryRepo.createItem({
    title: input.title,
    url: input.url,
    description: input.note,
    folderId: input.folderId ?? null,
    tags: input.tags ?? [],
    mimeType: input.mimeType,
    driveFileId: input.driveFileId,
    source: 'drive',
  });
  return toLegacyShape(created);
}

export async function removeDriveLibraryItem(id: string): Promise<void> {
  await libraryRepo.deleteItem(id);
}

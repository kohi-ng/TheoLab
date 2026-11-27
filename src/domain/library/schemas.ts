/**
 * Single source of truth for TheoLab Library v2 data schemas (Zod 4).
 *
 * Each user LibraryItem lives in `library_items/{id}` and each LibraryFolder in
 * `library_folders/{id}` (avoiding the 1MB single-document limit of legacy `settings/library_drive`).
 */
import { z } from 'zod';

export const LIBRARY_ITEM_KINDS = [
  'markdown',
  'pdf',
  'google-doc',
  'google-sheet',
  'google-slide',
  'drive-file',
  'json',
  'formula',
  'widget',
] as const;

export const LibraryItemKindSchema = z.enum(LIBRARY_ITEM_KINDS);
export type LibraryItemKind = z.infer<typeof LibraryItemKindSchema>;

export const LIBRARY_ITEM_SOURCES = ['builtin', 'drive', 'upload'] as const;
export const LibraryItemSourceSchema = z.enum(LIBRARY_ITEM_SOURCES);
export type LibraryItemSource = z.infer<typeof LibraryItemSourceSchema>;

export const LibraryItemSchema = z.object({
  id: z.string().trim().min(1).max(140),
  title: z.string().trim().min(1, 'Tên tài liệu không được rỗng.').max(200),
  kind: LibraryItemKindSchema,
  source: LibraryItemSourceSchema,
  url: z.string().trim().max(2000).optional(),
  driveFileId: z.string().trim().max(200).optional(),
  file: z.string().trim().max(260).optional(),
  mimeType: z.string().trim().max(160).optional(),
  folderId: z.string().trim().min(1).max(140).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  description: z.string().trim().max(1000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  order: z.number().finite().default(1000),
});

export type LibraryItem = z.infer<typeof LibraryItemSchema>;

/**
 * Runtime view type extending persisted `LibraryItem` with optional read-only fields
 * carried by built-in catalog entries (`libraryCatalog.js`) and viewer/dock bridges.
 */
export interface LibraryItemView extends LibraryItem {
  readonly?: boolean;
  /** Legacy category/type fields kept as derived adapters for viewer/dock compatibility. */
  type?: string;
  sourceLabel?: string;
  note?: string;
  contextText?: string;
  content?: unknown;
  widget?: {
    id: string;
    type: string;
    title: string;
    file: string;
    height?: number;
    initial_state?: Record<string, unknown>;
  };
}

export const LibraryFolderSchema = z.object({
  id: z.string().trim().min(1).max(140),
  name: z.string().trim().min(1, 'Tên thư mục không được rỗng.').max(120),
  parentId: z.string().trim().min(1).max(140).nullable().default(null),
  order: z.number().finite().default(1000),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(16).optional(),
});

export type LibraryFolder = z.infer<typeof LibraryFolderSchema>;

export const LIBRARY_VIEW_MODES = ['list', 'details', 'grid'] as const;
export type LibraryViewMode = (typeof LIBRARY_VIEW_MODES)[number];

export const LIBRARY_GRID_SIZES = ['sm', 'md', 'lg'] as const;
export type LibraryGridSize = (typeof LIBRARY_GRID_SIZES)[number];

export const LIBRARY_SORT_FIELDS = ['title', 'createdAt', 'kind', 'order'] as const;
export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];

export const LIBRARY_SORT_DIRS = ['asc', 'desc'] as const;
export type LibrarySortDir = (typeof LIBRARY_SORT_DIRS)[number];

export const LIBRARY_GROUP_MODES = ['none', 'folder', 'kind', 'tag'] as const;
export type LibraryGroupMode = (typeof LIBRARY_GROUP_MODES)[number];

export const LibraryViewPrefsSchema = z.object({
  viewMode: z.enum(LIBRARY_VIEW_MODES).default('details'),
  gridSize: z.enum(LIBRARY_GRID_SIZES).default('md'),
  sortBy: z.enum(LIBRARY_SORT_FIELDS).default('createdAt'),
  sortDir: z.enum(LIBRARY_SORT_DIRS).default('desc'),
  groupBy: z.enum(LIBRARY_GROUP_MODES).default('none'),
});

export type LibraryViewPrefs = z.infer<typeof LibraryViewPrefsSchema>;

export const LegacyDriveLibraryItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  sourceLabel: z.string().optional(),
  note: z.string().optional(),
  contextText: z.string().optional(),
  created_at: z.string().optional(),
});

export type LegacyDriveLibraryItem = z.infer<typeof LegacyDriveLibraryItemSchema>;

/** AI suggestion schema for optional metadata-only categorization proposals. */
export const AiLibrarySuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      itemId: z.string().min(1),
      folderName: z.string().trim().max(80).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(32)).max(6).default([]),
    }),
  ),
});

export type AiLibrarySuggestionBatch = z.infer<typeof AiLibrarySuggestionSchema>;

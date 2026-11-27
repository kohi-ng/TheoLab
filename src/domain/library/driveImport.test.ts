import { describe, expect, it } from 'vitest';
import {
  applyBatchRenameToDrafts,
  buildDriveCanonicalUrl,
  buildLibraryInputsFromDrafts,
  describeDriveMimeType,
  mapPickerDocToDraft,
  mimeTypeToLibraryKind,
  validateDriveUrl,
  type GooglePickerDocument,
} from './driveMapper';
import { createLibraryRepository, createMemoryLibraryBackend } from '../../core/libraryRepository';

describe('Google Drive Picker mapper & batch import flow', () => {
  it('maps Drive mimeTypes accurately to LibraryItemKind and Vietnamese labels', () => {
    expect(mimeTypeToLibraryKind('application/vnd.google-apps.document')).toBe('google-doc');
    expect(mimeTypeToLibraryKind('application/vnd.google-apps.spreadsheet')).toBe('google-sheet');
    expect(mimeTypeToLibraryKind('application/vnd.google-apps.presentation')).toBe('google-slide');
    expect(mimeTypeToLibraryKind('application/pdf')).toBe('pdf');
    expect(mimeTypeToLibraryKind('image/png')).toBe('drive-file');
    expect(mimeTypeToLibraryKind('application/vnd.google-apps.folder')).toBe('drive-file');

    expect(describeDriveMimeType('application/vnd.google-apps.folder')).toBe('Thư mục Drive');
    expect(describeDriveMimeType('image/jpeg')).toBe('Hình ảnh (Drive)');
    expect(describeDriveMimeType('application/pdf')).toBe('PDF (Drive)');
  });

  it('validates allowed Google Drive/Docs URLs and rejects untrusted hosts or placeholders', () => {
    expect(validateDriveUrl('https://drive.google.com/file/d/file_123/view')).toBe(true);
    expect(validateDriveUrl('https://docs.google.com/document/d/doc_99/edit')).toBe(true);
    expect(validateDriveUrl('https://drive.google.com/drive/folders/fold_77')).toBe(true);
    expect(validateDriveUrl('https://docs.google.com/document/d/REPLACE_WITH_ID/edit')).toBe(false);
    expect(validateDriveUrl('https://evil.example.com/file/d/abc/view')).toBe(false);
    expect(validateDriveUrl('http://drive.google.com/file/d/abc/view')).toBe(false);
    expect(validateDriveUrl('javascript:alert(1)')).toBe(false);

    expect(buildDriveCanonicalUrl('abc123', 'application/vnd.google-apps.spreadsheet')).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/edit',
    );
    expect(buildDriveCanonicalUrl('fold9', 'application/vnd.google-apps.folder')).toBe(
      'https://drive.google.com/drive/folders/fold9',
    );
  });

  it('maps mocked Google Picker multi-select results to editable drafts, supports batch rename, and persists as LibraryItems', async () => {
    const mockedPickerDocs: GooglePickerDocument[] = [
      {
        id: 'pdf_chem_01',
        name: 'Giao_trinh_Hoa_Phan_Tich.pdf',
        mimeType: 'application/pdf',
        url: 'https://drive.google.com/file/d/pdf_chem_01/view',
      },
      {
        id: 'sheet_lab_02',
        name: 'So lieu chuan do',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
      {
        id: 'folder_exams_03',
        name: 'Kho De Thi',
        mimeType: 'application/vnd.google-apps.folder',
      },
    ];

    let drafts = mockedPickerDocs.map((doc) =>
      mapPickerDocToDraft(doc, { folderId: 'hoa-phan-tich', tags: ['học kỳ 1'] }),
    );
    expect(drafts).toHaveLength(3);
    expect(drafts[2]?.isFolder).toBe(true);
    expect(drafts[2]?.folderAction).toBe('link');

    // Batch rename: strip extensions and add prefix
    drafts = applyBatchRenameToDrafts(drafts, {
      prefix: '[HPT] ',
      stripExtension: true,
    });
    expect(drafts[0]?.title).toBe('[HPT] Giao_trinh_Hoa_Phan_Tich');
    expect(drafts[1]?.title).toBe('[HPT] So lieu chuan do');

    // Simulate expanding the folder into 2 child files and deselecting 1 of them
    drafts = drafts.map((d) => (d.isFolder ? { ...d, folderAction: 'expand' as const } : d));
    const child1 = mapPickerDocToDraft(
      { id: 'exam_a', name: 'De_thi_2025.pdf', mimeType: 'application/pdf' },
      { folderId: 'hoa-phan-tich', tags: ['đề thi'], fromFolderId: 'folder_exams_03' },
    );
    const child2 = {
      ...mapPickerDocToDraft(
        { id: 'exam_b', name: 'Nhap_cu.pdf', mimeType: 'application/pdf' },
        { folderId: 'hoa-phan-tich', fromFolderId: 'folder_exams_03' },
      ),
      selected: false,
    };
    drafts = [...drafts, child1, child2];

    const prepared = buildLibraryInputsFromDrafts(drafts);
    // Expected: pdf_chem_01, sheet_lab_02, exam_a (folder row skipped because expanded; exam_b deselected)
    expect(prepared.map((p) => p.driveFileId)).toEqual(['pdf_chem_01', 'sheet_lab_02', 'exam_a']);

    const repo = createLibraryRepository(createMemoryLibraryBackend());
    for (const input of prepared) {
      await repo.createItem(input);
    }
    const stored = await repo.listItems();
    expect(stored).toHaveLength(3);
    expect(stored.find((i) => i.driveFileId === 'pdf_chem_01')?.kind).toBe('pdf');
    expect(stored.find((i) => i.driveFileId === 'sheet_lab_02')?.kind).toBe('google-sheet');
    expect(stored.find((i) => i.driveFileId === 'exam_a')?.tags).toContain('đề thi');
  });
});

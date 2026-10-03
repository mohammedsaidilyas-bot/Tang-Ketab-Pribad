export type PaperTheme = 'alabaster' | 'kuning' | 'eink' | 'malam';

export type SpreadMode = 'double' | 'single';

export type RenderMode = 'pocketbook' | 'pdf_canvas';

export type NoteCategory = 'syarah' | 'makna' | 'dalil' | 'muzakarah';

export interface KitabPage {
  pageNumber: number;
  chapterTitle: string;
  arabicMatan?: string;
  paragraphs: string[];
  footnote?: string;
}

export interface KitabChapter {
  id: string;
  number: string;
  title: string;
  startPage: number;
}

export interface HasyiyahNote {
  id: string;
  kitabId: string;
  pageNumber: number;
  category: NoteCategory;
  quotedText?: string;
  content: string;
  createdAt: string;
}

export interface KitabDocument {
  id: string;
  catalogNumber: string;
  title: string;
  subtitle: string;
  author: string;
  category: string;
  language: string;
  totalPages: number;
  lastReadPage: number;
  bookmarks: number[];
  addedAt: string;
  isUploadedPdf: boolean;
  fileSizeLabel?: string;
  coverTone: 'bronze' | 'lapis' | 'forest' | 'terracotta' | 'charcoal';
  chapters: KitabChapter[];
  pages: KitabPage[];
  pdfBlobKey?: string;
  coverOffset?: number;
}

export interface ReaderSettings {
  theme: PaperTheme;
  fontSize: number;
  lineHeight: 'normal' | 'relaxed' | 'loose';
  spreadMode: SpreadMode;
  renderMode: RenderMode;
  showHardwareBezel: boolean;
  showArabicMatan: boolean;
  showMarginNotes: boolean;
}

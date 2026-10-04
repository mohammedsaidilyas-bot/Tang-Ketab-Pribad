import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookOpen,
  List,
  MessageSquarePlus,
  Search,
  Minus,
  Plus,
  Columns2,
  RectangleVertical,
  Eye,
  Trash2,
  Check,
  Smartphone,
  Upload,
  Edit3,
  RotateCw,
  Save,
  Sparkles,
  Sliders,
  MapPin,
  ArrowUpDown,
  X,
} from 'lucide-react';
import {
  HasyiyahNote,
  KitabChapter,
  KitabDocument,
  KitabPage,
  NoteCategory,
  PaperTheme,
  ReaderSettings,
} from '../types/kitab';
import * as pdfjsLib from 'pdfjs-dist';
import {
  renderPdfPageToCanvas,
  loadPdfArrayBuffer,
  extractChaptersFromPdfDoc,
  detectOrGenerateKitabChapters,
  detectPdfCoverOffset,
  createPdfLoadingTask,
  globalPdfDocCache,
  getOrLoadPdfDoc,
  extractArabicTitleOnly,
  stripArabicTashkeel,
  normalizeArabicTitle,
  POPULAR_TURATS_TEMPLATES,
} from '../utils/pdfProcessor';

interface PocketBookReaderProps {
  kitab: KitabDocument;
  notes: HasyiyahNote[];
  settings: ReaderSettings;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onPageChange: (newPage: number) => void;
  onUpdateChapters?: (kitabId: string, chapters: KitabChapter[]) => void;
  onToggleBookmark: (pageNumber: number) => void;
  onAddNote: (note: Omit<HasyiyahNote, 'id' | 'createdAt'>) => void;
  onDeleteNote: (noteId: string) => void;
  onOpenUploadModal?: () => void;
  onBackToLibrary: () => void;
}

const THEME_STYLES: Record<
  PaperTheme,
  {
    name: string;
    pageBg: string;
    pageText: string;
    mutedText: string;
    border: string;
    accentText: string;
    matanBg: string;
    swatch: string;
  }
> = {
  alabaster: {
    name: 'Kertas Alabaster',
    pageBg: 'bg-[#FBF9F5]',
    pageText: 'text-[#1C1917]',
    mutedText: 'text-[#57534E]',
    border: 'border-[#E2DCD0]',
    accentText: 'text-[#78350F]',
    matanBg: 'bg-[#F4EFE6]',
    swatch: 'bg-[#FBF9F5] border-[#D6CEBE]',
  },
  kuning: {
    name: 'Kitab Kuning Turats',
    pageBg: 'bg-[#F5E6C4]',
    pageText: 'text-[#261C14]',
    mutedText: 'text-[#6B533B]',
    border: 'border-[#DEC89B]',
    accentText: 'text-[#7C2D12]',
    matanBg: 'bg-[#EEDB9F]/55',
    swatch: 'bg-[#F5E6C4] border-[#C9B07A]',
  },
  eink: {
    name: 'Layar E-Ink PocketBook',
    pageBg: 'bg-[#EAE8E1]',
    pageText: 'text-[#18181B]',
    mutedText: 'text-[#52525B]',
    border: 'border-[#D4D1C7]',
    accentText: 'text-[#27272A]',
    matanBg: 'bg-[#DFDDD4]',
    swatch: 'bg-[#EAE8E1] border-[#A1A1AA]',
  },
  malam: {
    name: 'Lentera Malam',
    pageBg: 'bg-[#181614]',
    pageText: 'text-[#E7E2DA] tracking-[0.01em]',
    mutedText: 'text-[#A8A29E]',
    border: 'border-[#2E2A27]',
    accentText: 'text-[#D97706]',
    matanBg: 'bg-[#221F1C]',
    swatch: 'bg-[#181614] border-[#57534E]',
  },
};

const NOTE_CATEGORY_LABELS: Record<NoteCategory, string> = {
  syarah: 'Syarah & Uraian',
  makna: 'Makna & Mufradat',
  dalil: 'Dalil & Rujukan',
  muzakarah: 'Pertanyaan Muzakarah',
};

const PdfCanvasPage: React.FC<{
  pdfDoc: any;
  pageNumber: number;
}> = ({ pdfDoc, pageNumber }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let isCancelled = false;

    if (!pdfDoc) {
      setStatus('loading');
      return;
    }
    if (!canvasRef.current) {
      setStatus('error');
      return;
    }
    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      setStatus('error');
      return;
    }

    // Cancel any previous render task on this canvas before starting a new one
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {}
      renderTaskRef.current = null;
    }

    setStatus('loading');

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const scale = 1.35;
        const viewport = page.getViewport({ scale: scale * Math.min(dpr, 2) });
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
          if (!isCancelled) setStatus('error');
          return;
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!isCancelled) {
          setStatus('ready');
        }
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException') {
          return;
        }
        console.warn(`Error rendering PDF page ${pageNumber}:`, err);
        if (!isCancelled) {
          setStatus('error');
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber]);

  return (
    <div className="relative w-full min-h-[360px] flex flex-col items-center justify-center bg-white/60 p-1 border border-[#D6CEBE]/50 shadow-xs overflow-hidden">
      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#FBF9F5]/70 backdrop-blur-xs py-12 text-xs text-[#57534E] font-mono-tabular">
          <div className="w-5 h-5 border-2 border-[#78350F] border-t-transparent rounded-full animate-spin mb-2" />
          <p>Menyiapkan Lembar {pageNumber}...</p>
        </div>
      )}
      {status === 'error' && (
        <div className="p-8 text-center text-xs text-[#9A3412] font-mono-tabular">
          <p>Lembar {pageNumber} tidak dapat dimuat.</p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto block shadow-2xs"
      />
    </div>
  );
};

function toRomanNumeral(num: number): string {
  if (num <= 0) return '';
  const val = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syb = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let roman = '';
  for (let i = 0; i < val.length; i++) {
    while (num >= val[i]) {
      roman += syb[i];
      num -= val[i];
    }
  }
  return roman;
}

export const PocketBookReader: React.FC<PocketBookReaderProps> = ({
  kitab,
  notes,
  settings,
  onUpdateSettings,
  onPageChange,
  onUpdateChapters,
  onToggleBookmark,
  onAddNote,
  onDeleteNote,
  onOpenUploadModal,
  onBackToLibrary,
}) => {
  const [showTocDrawer, setShowTocDrawer] = useState(false);
  const [tocSearchQuery, setTocSearchQuery] = useState('');
  const [tocCategoryFilter, setTocCategoryFilter] = useState<'all' | 'kitab' | 'bab' | 'fasal' | 'furu' | 'tanbih'>('all');
  const [showTocEditModal, setShowTocEditModal] = useState(false);
  const [editingChapters, setEditingChapters] = useState<KitabChapter[]>([]);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterPage, setNewChapterPage] = useState<number>(1);
  const [isScanningPdfToc, setIsScanningPdfToc] = useState(false);
  const [tocUpdateSuccessToast, setTocUpdateSuccessToast] = useState(false);

  const [showSearchPopover, setShowSearchPopover] = useState(false);
  const [inBookQuery, setInBookQuery] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteQuote, setNewNoteQuote] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState<NoteCategory>('syarah');
  const [activeNoteTargetPage, setActiveNoteTargetPage] = useState<number>(kitab.lastReadPage);
  const [justSavedNote, setJustSavedNote] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(() => {
    if (kitab.pdfBlobKey && globalPdfDocCache.has(kitab.pdfBlobKey)) {
      return globalPdfDocCache.get(kitab.pdfBlobKey);
    }
    return null;
  });

  useEffect(() => {
    let isCancelled = false;
    if (kitab.isUploadedPdf && (kitab.pdfBlobKey || kitab.pdfUrl)) {
      const activeKey = kitab.pdfBlobKey || kitab.pdfUrl || '';
      if (globalPdfDocCache.has(activeKey)) {
        const cached = globalPdfDocCache.get(activeKey);
        if (pdfDoc !== cached) {
          setPdfDoc(cached);
        }
        return;
      }
      getOrLoadPdfDoc(kitab.pdfBlobKey, kitab.pdfUrl).then((doc) => {
        if (!isCancelled && doc) {
          setPdfDoc(doc);
        }
      });
    }
    return () => {
      isCancelled = true;
    };
  }, [kitab.pdfBlobKey, kitab.pdfUrl, kitab.isUploadedPdf]);

  // Automatically extract authentic PDF outline / bookmarks on load, or generate intelligent chapters for this specific book
  useEffect(() => {
    let isCancelled = false;

    if (kitab && onUpdateChapters) {
      const isMissingOrIncomplete =
        !kitab.chapters ||
        kitab.chapters.length <= 1 ||
        kitab.chapters.some((c) =>
          c.title.toLowerCase().includes('fasal lanjutan') ||
          /fasal\s+\d+\s*·\s*halaman/i.test(c.title) ||
          /bagian\s+\d+\s*·\s*halaman/i.test(c.title) ||
          /muqaddimah\s+&\s+lembar\s+awal\s+naskah/i.test(c.title)
        );

      detectOrGenerateKitabChapters(pdfDoc, kitab.title, kitab.totalPages).then((detected) => {
        if (isCancelled) return;
        if (detected && detected.length > 0) {
          const currentCount = kitab.chapters?.length || 0;
          // If current list has >= 10 rich chapters and detected has fewer, NEVER overwrite/downgrade!
          if (currentCount >= 10 && detected.length < currentCount) {
            return;
          }

          const isDifferent =
            isMissingOrIncomplete ||
            currentCount === 0 ||
            detected.length > currentCount ||
            (detected.length === currentCount &&
              detected.some(
                (ch, idx) =>
                  ch.title !== kitab.chapters[idx]?.title ||
                  ch.startPage !== kitab.chapters[idx]?.startPage
              ));

          if (isDifferent) {
            onUpdateChapters(kitab.id, detected);
          }
        }
      });
    }

    return () => {
      isCancelled = true;
    };
  }, [kitab.id, kitab.title, kitab.totalPages, pdfDoc]);

  const currentPage = Math.min(Math.max(1, kitab.lastReadPage), kitab.totalPages);

  const handleOpenTocEditModal = () => {
    setEditingChapters([...kitab.chapters]);
    setNewChapterTitle('');
    setNewChapterPage(currentPage);
    setShowTocEditModal(true);
  };

  const handleScanPdfOutline = async () => {
    setIsScanningPdfToc(true);
    try {
      let docToUse = pdfDoc;
      if (!docToUse && kitab.isUploadedPdf && kitab.pdfBlobKey) {
        const buf = await loadPdfArrayBuffer(kitab.pdfBlobKey);
        if (buf) {
          docToUse = await createPdfLoadingTask(new Uint8Array(buf)).promise;
          setPdfDoc(docToUse);
        }
      }
      const detected = await detectOrGenerateKitabChapters(docToUse, kitab.title, kitab.totalPages);
      if (detected && detected.length > 0) {
        setEditingChapters(detected);
        if (onUpdateChapters) {
          onUpdateChapters(kitab.id, detected);
        }
      } else {
        alert('Tidak ditemukan bab otomatis. Anda dapat memasukkan nama bab dan halaman secara manual di bawah.');
      }
    } finally {
      setIsScanningPdfToc(false);
    }
  };

  const handleAddCustomChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterTitle.trim()) return;
    const newCh: KitabChapter = {
      id: `ch-manual-${Date.now()}`,
      number: String(editingChapters.length + 1).padStart(2, '0'),
      title: newChapterTitle.trim(),
      startPage: Math.min(Math.max(1, newChapterPage), kitab.totalPages),
    };
    const nextList = [...editingChapters, newCh].sort((a, b) => a.startPage - b.startPage);
    const renumbered = nextList.map((ch, idx) => ({
      ...ch,
      number: String(idx + 1).padStart(2, '0'),
    }));
    setEditingChapters(renumbered);
    setNewChapterTitle('');
  };

  const handleDeleteChapter = (chId: string) => {
    const filtered = editingChapters.filter((c) => c.id !== chId);
    const renumbered = filtered.map((ch, idx) => ({
      ...ch,
      number: String(idx + 1).padStart(2, '0'),
    }));
    setEditingChapters(renumbered);
  };

  const handleSaveToc = () => {
    if (onUpdateChapters) {
      onUpdateChapters(kitab.id, editingChapters);
      setTocUpdateSuccessToast(true);
      setTimeout(() => setTocUpdateSuccessToast(false), 2200);
    }
    setShowTocEditModal(false);
  };

  const handleShiftAllPages = (delta: number) => {
    if (!onUpdateChapters || !kitab.chapters) return;
    const shifted = kitab.chapters.map((c) => ({
      ...c,
      startPage: Math.min(kitab.totalPages, Math.max(1, c.startPage + delta)),
    }));
    onUpdateChapters(kitab.id, shifted);
    setTocUpdateSuccessToast(true);
    setTimeout(() => setTocUpdateSuccessToast(false), 2200);
  };

  const handleSetChapterPage = (chapterId: string, targetPage: number) => {
    if (!onUpdateChapters || !kitab.chapters) return;
    const updated = kitab.chapters.map((c) =>
      c.id === chapterId ? { ...c, startPage: Math.min(kitab.totalPages, Math.max(1, targetPage)) } : c
    );
    onUpdateChapters(kitab.id, updated);
    setTocUpdateSuccessToast(true);
    setTimeout(() => setTocUpdateSuccessToast(false), 2000);
  };

  const handleShiftEditingPages = (delta: number) => {
    setEditingChapters((prev) =>
      prev.map((c) => ({
        ...c,
        startPage: Math.min(kitab.totalPages, Math.max(1, c.startPage + delta)),
      }))
    );
  };

  const [pdfCoverOffset, setPdfCoverOffset] = useState<number>(() => {
    if (kitab.coverOffset !== undefined) return kitab.coverOffset;
    if (kitab.title.includes('نهاية الزين') || kitab.title.includes('0084') || kitab.subtitle?.includes('نهاية الزين')) return 2;
    if (kitab.title.includes('فتح المعين')) return 9;
    if (kitab.title.includes('كاشفة السجا')) return 11;
    if (kitab.title.includes('رياض الصالحين')) return 14;
    return 0;
  });

  useEffect(() => {
    let isCancelled = false;
    if (pdfDoc) {
      detectPdfCoverOffset(pdfDoc).then((offset) => {
        if (!isCancelled && offset > 0) {
          setPdfCoverOffset(offset);
        }
      });
    } else {
      if (kitab.title.includes('نهاية الزين') || kitab.title.includes('0084') || kitab.subtitle?.includes('نهاية الزين')) setPdfCoverOffset(2);
      else if (kitab.title.includes('فتح المعين')) setPdfCoverOffset(9);
      else if (kitab.title.includes('كاشفة السجا')) setPdfCoverOffset(11);
      else if (kitab.title.includes('رياض الصالحين')) setPdfCoverOffset(14);
    }
    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, kitab.title, kitab.subtitle]);

  const handleChapterClick = async (ch: KitabChapter) => {
    setShowTocDrawer(false);

    if (pdfDoc) {
      try {
        const numPages = Math.min(pdfDoc.numPages, kitab.totalPages);
        const pureTitle = extractArabicTitleOnly(ch.title.split(':')[0]);
        const cleanTitle = stripArabicTashkeel(pureTitle);
        const words = cleanTitle
          .split(/\s+/)
          .filter((w) => w.length >= 2 && !/^(في|عن|على|من|إلى|مع|أن|إن|هو|هي)$/.test(w));

        if (words.length >= 1) {
          const corePhrase3 = words.slice(0, 3).join(' ');
          const corePhrase2 = words.slice(0, 2).join(' ');
          const corePhrase1 = words[0];

          for (let p = 1; p <= numPages; p++) {
            const page = await pdfDoc.getPage(p);
            const txt = await page.getTextContent();
            const pageText = stripArabicTashkeel(txt.items.map((it: any) => it.str || '').join(' '));

            if (
              (corePhrase3.length >= 3 && pageText.includes(corePhrase3)) ||
              (corePhrase2.length >= 3 && pageText.includes(corePhrase2)) ||
              (corePhrase1.length >= 4 && pageText.includes(corePhrase1) && p > 1)
            ) {
              onPageChange(p);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('Error finding exact chapter target sheet:', e);
      }
    }

    const targetSheet = Math.min(
      kitab.totalPages,
      Math.max(1, ch.startPage + pdfCoverOffset)
    );
    onPageChange(targetSheet);
  };

  const formatPageLabel = (fileSheet: number) => {
    if (pdfCoverOffset > 0) {
      if (fileSheet <= pdfCoverOffset) {
        const roman = toRomanNumeral(fileSheet);
        return `Hal. ${roman}`;
      }
      const mainPageNum = fileSheet - pdfCoverOffset;
      return `Hal. ${mainPageNum}`;
    }
    return `Hal. ${fileSheet}`;
  };
  const getChapterDisplayPage = (startPage: number) => {
    return startPage;
  };

  const isDouble = settings.spreadMode === 'double';

  const leftPageNum = isDouble
    ? currentPage % 2 === 0
      ? Math.max(1, currentPage - 1)
      : currentPage
    : currentPage;
  const rightPageNum = isDouble && leftPageNum + 1 <= kitab.totalPages ? leftPageNum + 1 : null;

  useEffect(() => {
    setActiveNoteTargetPage(currentPage);
  }, [currentPage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const bookContainerRef = useRef<HTMLDivElement | null>(null);

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    direction: 'rtl' | 'ltr' | null;
    progress: number;
  }>({ isDragging: false, direction: null, progress: 0 });

  const [flipDirection, setFlipDirection] = useState<'rtl' | 'ltr' | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const step = isDouble ? 2 : 1;

  const handlePrevPage = () => {
    if (leftPageNum > 1 && !flipDirection) {
      setFlipDirection('rtl');
      setTimeout(() => {
        onPageChange(Math.max(1, leftPageNum - step));
        setFlipDirection(null);
      }, 550);
    }
  };

  const handleNextPage = () => {
    const maxCurrent = rightPageNum || leftPageNum;
    if (maxCurrent < kitab.totalPages && !flipDirection) {
      setFlipDirection('ltr');
      setTimeout(() => {
        onPageChange(Math.min(kitab.totalPages, leftPageNum + step));
        setFlipDirection(null);
      }, 550);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (flipDirection) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setDragState({
      isDragging: false,
      direction: null,
      progress: 0,
    });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || flipDirection) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX.current;
    const diffY = currentY - touchStartY.current;

    if (!dragState.isDragging) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
        const direction = diffX > 0 ? 'ltr' : 'rtl';
        setDragState({
          isDragging: true,
          direction,
          progress: 0,
        });
      }
    } else {
      const width = bookContainerRef.current?.clientWidth || 800;
      const halfWidth = width / 2;
      let progress = 0;

      if (dragState.direction === 'ltr') {
        // Swipe Right -> Next Page: diffX goes from 0 to positive
        progress = Math.min(1, Math.max(0, diffX / halfWidth));
      } else if (dragState.direction === 'rtl') {
        // Swipe Left -> Prev Page: diffX goes from 0 to negative
        progress = Math.min(1, Math.max(0, -diffX / halfWidth));
      }

      setDragState((prev) => ({
        ...prev,
        progress,
      }));
    }
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || flipDirection) return;

    if (dragState.isDragging && dragState.direction) {
      const threshold = 0.22; // 22% progress is enough to trigger page turn
      if (dragState.progress >= threshold) {
        if (dragState.direction === 'ltr') {
          // Instantly change page on drag release, with no double/follow-up automated flip!
          onPageChange(Math.min(kitab.totalPages, leftPageNum + step));
        } else {
          // Instantly change page on drag release!
          onPageChange(Math.max(1, leftPageNum - step));
        }
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    setDragState({ isDragging: false, direction: null, progress: 0 });
  };

  const handleTextSelectionOnPage = (pageNum: number) => {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 3) {
      setNewNoteQuote(selection.slice(0, 180));
      setActiveNoteTargetPage(pageNum);
      if (!settings.showMarginNotes) {
        onUpdateSettings({ showMarginNotes: true });
      }
    }
  };

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    onAddNote({
      kitabId: kitab.id,
      pageNumber: activeNoteTargetPage,
      category: newNoteCategory,
      quotedText: newNoteQuote.trim() || undefined,
      content: newNoteText.trim(),
    });
    setNewNoteText('');
    setNewNoteQuote('');
    setJustSavedNote(true);
    setTimeout(() => setJustSavedNote(false), 1800);
  };

  const themeStyle = THEME_STYLES[settings.theme];

  // Determine what pages are rendered on the underlying static sheets during transition/drag
  let renderLeftPageNum = leftPageNum;
  let renderRightPageNum = rightPageNum;

  const isGoingNext = (dragState.isDragging && dragState.direction === 'ltr') || flipDirection === 'ltr';
  const isGoingPrev = (dragState.isDragging && dragState.direction === 'rtl') || flipDirection === 'rtl';

  if (isGoingNext) {
    // Going next: Left screen column (renderRightPageNum) changes immediately, right screen column (renderLeftPageNum) stays current
    renderRightPageNum = rightPageNum ? Math.min(kitab.totalPages, rightPageNum + step) : null;
    renderLeftPageNum = leftPageNum;
  } else if (isGoingPrev) {
    // Going prev: Right screen column (renderLeftPageNum) changes immediately, left screen column (renderRightPageNum) stays current
    renderLeftPageNum = Math.max(1, leftPageNum - step);
    renderRightPageNum = rightPageNum;
  }

  const leftPageData = kitab.pages.find((p) => p.pageNumber === renderLeftPageNum) || kitab.pages[0];
  const rightPageData = renderRightPageNum
    ? kitab.pages.find((p) => p.pageNumber === renderRightPageNum) || null
    : null;

  const currentLeftPageData = kitab.pages.find((p) => p.pageNumber === leftPageNum) || null;
  const currentRightPageData = rightPageNum
    ? kitab.pages.find((p) => p.pageNumber === rightPageNum) || null
    : null;

  const visiblePageNumbers = rightPageNum ? [leftPageNum, rightPageNum] : [leftPageNum];
  const currentSpreadNotes = notes.filter(
    (n) => n.kitabId === kitab.id && visiblePageNumbers.includes(n.pageNumber)
  );
  const allKitabNotes = notes.filter((n) => n.kitabId === kitab.id);

  const searchMatches =
    inBookQuery.trim().length > 1
      ? kitab.pages.filter((p) => {
          const q = inBookQuery.toLowerCase();
          return (
            p.chapterTitle.toLowerCase().includes(q) ||
            p.paragraphs.some((para) => para.toLowerCase().includes(q))
          );
        })
      : [];

  const progressPercentage = Math.round(
    ((rightPageNum || leftPageNum) / Math.max(1, kitab.totalPages)) * 100
  );

  const nextCurlBackPage = currentLeftPageData || currentRightPageData;

  const prevCurlBackPage = currentRightPageData || currentLeftPageData;

  const renderCurlingPageContent = (pageData: KitabPage | null) => {
    if (!pageData) return null;
    const lineLeadingClass =
      settings.lineHeight === 'loose'
        ? 'leading-[1.95]'
        : settings.lineHeight === 'relaxed'
        ? 'leading-[1.78]'
        : 'leading-[1.6]';

    return (
      <div className={`p-4 sm:p-8 lg:p-12 h-full flex flex-col justify-between ${themeStyle.pageBg} ${themeStyle.pageText} select-none overflow-hidden text-left`}>
        <div>
          <header className={`flex items-center justify-between pb-3 mb-6 border-b ${themeStyle.border} text-xs ${themeStyle.mutedText}`}>
            <span className="truncate max-w-[70%] font-arabic text-sm text-right font-medium">
              {extractArabicTitleOnly(pageData.chapterTitle) || pageData.chapterTitle || kitab.title}
            </span>
            <span className="font-mono-tabular shrink-0">Hal. {pageData.pageNumber}</span>
          </header>

          {kitab.isUploadedPdf ? (
            <PdfCanvasPage pdfDoc={pdfDoc} pageNumber={pageData.pageNumber} />
          ) : (
            <div className="space-y-4">
              {settings.showArabicMatan && pageData.arabicMatan && (
                <div dir="rtl" className={`p-3 border-r border-[#78350F] ${themeStyle.matanBg}`}>
                  <p className="font-arabic text-right text-base leading-[2]">
                    {pageData.arabicMatan}
                  </p>
                </div>
              )}

              <div style={{ fontSize: `${settings.fontSize}px` }} className={`space-y-3 ${lineLeadingClass} opacity-90`}>
                {pageData.paragraphs && pageData.paragraphs.length > 0 ? (
                  pageData.paragraphs.map((paragraph, idx) => (
                    <p key={idx} className="text-justify text-xs sm:text-sm">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <div className="space-y-4 py-6">
                    <div className={`h-3.5 w-full ${themeStyle.accentText} bg-current rounded opacity-25`} />
                    <div className={`h-3.5 w-11/12 ${themeStyle.accentText} bg-current rounded opacity-25`} />
                    <div className={`h-3.5 w-5/6 ${themeStyle.accentText} bg-current rounded opacity-25`} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className={`mt-8 pt-4 border-t ${themeStyle.border} text-center text-[10px] ${themeStyle.mutedText}`}>
          · {kitab.catalogNumber || 'DOKUMEN PDF PRIBADI'} ·
        </footer>
      </div>
    );
  };

  const renderSingleSheet = (pageData: KitabPage, side: 'left' | 'right' | 'single') => {
    const isBookmarked = kitab.bookmarks.includes(pageData.pageNumber);
    const pageNotesCount = notes.filter(
      (n) => n.kitabId === kitab.id && n.pageNumber === pageData.pageNumber
    ).length;

    const spineClass =
      side === 'left'
        ? 'pocketbook-spine-left pocketbook-page-stack-left border-r'
        : side === 'right'
        ? 'pocketbook-spine-right pocketbook-page-stack-right'
        : 'pocketbook-page-stack-right';

    const curveClass =
      side === 'left'
        ? 'pocketbook-curve-left'
        : side === 'right'
        ? 'pocketbook-curve-right'
        : '';

    const lineLeadingClass =
      settings.lineHeight === 'loose'
        ? 'leading-[1.95]'
        : settings.lineHeight === 'relaxed'
        ? 'leading-[1.78]'
        : 'leading-[1.6]';

    return (
      <article
        onMouseUp={() => handleTextSelectionOnPage(pageData.pageNumber)}
        className={`relative flex flex-col justify-between min-h-[360px] sm:min-h-[580px] lg:min-h-[660px] p-3 sm:p-8 lg:p-12 transition-colors duration-150 border ${themeStyle.pageBg} ${themeStyle.pageText} ${themeStyle.border} ${spineClass} ${curveClass}`}
      >
        {isBookmarked && (
          <div
            onClick={() => onToggleBookmark(pageData.pageNumber)}
            title="Hapus pita penanda halaman"
            className="cursor-pointer absolute -top-1 right-8 w-6 h-14 bg-[#9A3412] shadow-md flex flex-col items-center justify-end pb-2 transition-transform hover:translate-y-0.5"
            style={{
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%)',
            }}
          />
        )}

        <div>
          <header
            className={`flex items-center justify-between pb-3 mb-6 border-b ${themeStyle.border} text-xs ${themeStyle.mutedText}`}
          >
            <span className="truncate max-w-[70%] font-arabic text-sm text-right font-medium">
              {side === 'left' ? kitab.title : (extractArabicTitleOnly(pageData.chapterTitle) || pageData.chapterTitle)}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onToggleBookmark(pageData.pageNumber)}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  isBookmarked ? 'text-[#9A3412] font-semibold' : 'hover:opacity-80'
                }`}
                title="Pasang atau lepas pita penanda halaman"
              >
                <Bookmark
                  className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-[#9A3412]' : ''}`}
                />
                <span>{isBookmarked ? 'Ditandai' : 'Tandai'}</span>
              </button>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">Hal. {pageData.pageNumber}</span>
            </div>
          </header>

          {!kitab.isUploadedPdf && kitab.chapters.some((ch) => ch.startPage === pageData.pageNumber) && (
            <div className={`mb-6 pb-4 border-b border-double ${themeStyle.border}`}>
              <p className={`text-xs uppercase tracking-widest font-sans ${themeStyle.accentText}`}>
                {kitab.catalogNumber} · Lembar Bab
              </p>
              <h2 className="text-2xl sm:text-3xl font-display font-semibold mt-1 text-balance">
                {pageData.chapterTitle}
              </h2>
            </div>
          )}

          {kitab.isUploadedPdf ? (
            <PdfCanvasPage pdfDoc={pdfDoc} pageNumber={pageData.pageNumber} />
          ) : (
            <div className="space-y-5">
              {settings.showArabicMatan && pageData.arabicMatan && (
                <div
                  dir="rtl"
                  className={`p-4 sm:p-5 border-r-2 border-[#78350F] ${themeStyle.matanBg}`}
                >
                  <p className="font-arabic text-xl sm:text-2xl leading-[2.1] text-right">
                    {pageData.arabicMatan}
                  </p>
                </div>
              )}

              <div
                style={{ fontSize: `${settings.fontSize}px` }}
                className={`space-y-4 max-w-[68ch] ${lineLeadingClass}`}
              >
                {pageData.paragraphs.map((paragraph, idx) => (
                  <p
                    key={idx}
                    className={`text-justify ${
                      idx === 0
                        ? 'first-letter:text-4xl first-letter:font-display first-letter:font-bold first-letter:float-left first-letter:mr-3 first-letter:leading-none first-letter:mt-1'
                        : ''
                    }`}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className={`mt-8 pt-4 border-t ${themeStyle.border} space-y-2`}>
          {pageData.footnote && (
            <p className={`text-xs italic ${themeStyle.mutedText}`}>{pageData.footnote}</p>
          )}
          <div className="flex items-center justify-between text-xs font-mono-tabular">
            <span className={themeStyle.mutedText}>
              {pageNotesCount > 0
                ? `${pageNotesCount} Catatan Hasyiyah pada lembar ini`
                : 'Sorot teks untuk menulis hasyiyah'}
            </span>
            <span className="font-semibold">
              — {formatPageLabel(pageData.pageNumber)} —
            </span>
          </div>
        </footer>
      </article>
    );
  };

  return (
    <section className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-6">
      {/* Operational Reader Utility Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-6 border-b border-[#D6CEBE]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToLibrary}
            className="px-3 py-1.5 text-xs font-medium border border-[#D6CEBE] bg-[#F7F4EE] text-[#1C1917] hover:bg-[#EBE6DF] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Pustaka
          </button>

          <button
            type="button"
            onClick={() => setShowTocDrawer(!showTocDrawer)}
            className={`px-3 py-1.5 text-xs font-medium border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              showTocDrawer
                ? 'border-[#1C1917] bg-[#1C1917] text-white'
                : 'border-[#D6CEBE] bg-[#F7F4EE] text-[#1C1917] hover:bg-[#EBE6DF]'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Daftar Bab ({kitab.chapters.length})
          </button>

          <div className="hidden md:flex items-center gap-2 text-xs text-[#57534E] truncate">
            <span className="font-semibold text-[#1C1917] truncate">{kitab.title}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{kitab.catalogNumber}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Paper Theme Swatches */}
          <div className="flex items-center gap-1 px-2 py-1 bg-[#F3EFE6] border border-[#D6CEBE]">
            {(Object.keys(THEME_STYLES) as PaperTheme[]).map((themeKey) => (
              <button
                key={themeKey}
                type="button"
                onClick={() => onUpdateSettings({ theme: themeKey })}
                title={THEME_STYLES[themeKey].name}
                className={`px-2 py-1 text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  settings.theme === themeKey
                    ? 'bg-[#1C1917] text-white font-medium'
                    : 'text-[#57534E] hover:text-[#1C1917]'
                }`}
              >
                <span className={`w-2.5 h-2.5 border ${THEME_STYLES[themeKey].swatch}`} />
                <span className="hidden xl:inline">{THEME_STYLES[themeKey].name.split(' ')[1]}</span>
              </button>
            ))}
          </div>

          {/* Font Size Adjuster */}
          <div className="flex items-center border border-[#D6CEBE] bg-[#F7F4EE]">
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })
              }
              className="px-2.5 py-1.5 text-xs text-[#1C1917] hover:bg-[#EBE6DF] transition-colors"
              title="Perkecil ukuran huruf"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-xs font-mono-tabular text-[#57534E]">
              {settings.fontSize}px
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ fontSize: Math.min(24, settings.fontSize + 1) })
              }
              className="px-2.5 py-1.5 text-xs text-[#1C1917] hover:bg-[#EBE6DF] transition-colors"
              title="Perbesar ukuran huruf"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="hidden lg:flex items-center border border-[#D6CEBE] bg-[#F7F4EE]">
            <button
              type="button"
              onClick={() => onUpdateSettings({ spreadMode: 'double' })}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors whitespace-nowrap ${
                settings.spreadMode === 'double'
                  ? 'bg-[#1C1917] text-white'
                  : 'text-[#57534E] hover:text-[#1C1917]'
              }`}
              title="Mode Lembaran Ganda (2 Halaman)"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>2 Lembar</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ spreadMode: 'single' })}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors whitespace-nowrap ${
                settings.spreadMode === 'single'
                  ? 'bg-[#1C1917] text-white'
                  : 'text-[#57534E] hover:text-[#1C1917]'
              }`}
              title="Mode E-Reader Satu Halaman"
            >
              <RectangleVertical className="w-3.5 h-3.5" />
              <span>1 Lembar</span>
            </button>
          </div>





          <button
            type="button"
            onClick={() => setShowSearchPopover(!showSearchPopover)}
            className={`px-2.5 py-1.5 text-xs border flex items-center gap-1 transition-colors ${
              showSearchPopover
                ? 'border-[#1C1917] bg-[#1C1917] text-white'
                : 'border-[#D6CEBE] bg-[#F7F4EE] text-[#1C1917] hover:bg-[#EBE6DF]'
            }`}
            title="Cari kata di dalam kitab ini"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({ showMarginNotes: !settings.showMarginNotes })
            }
            className={`px-3 py-1.5 text-xs font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              settings.showMarginNotes
                ? 'border-[#1C1917] bg-[#1C1917] text-white'
                : 'border-[#D6CEBE] bg-[#F7F4EE] text-[#1C1917] hover:bg-[#EBE6DF]'
            }`}
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Hasyiyah ({allKitabNotes.length})</span>
          </button>
        </div>
      </div>

      {showSearchPopover && (
        <div className="mb-6 p-4 bg-[#F7F4EE] border border-[#D6CEBE]">
          <div className="flex items-center gap-3">
            <Search className="w-4 h-4 text-[#78350F] shrink-0" />
            <input
              type="text"
              value={inBookQuery}
              onChange={(e) => setInBookQuery(e.target.value)}
              placeholder={`Cari kalimat atau istilah di dalam "${kitab.title}"...`}
              className="w-full bg-white px-3 py-1.5 text-sm border border-[#D6CEBE] focus:outline-none focus:border-[#78350F]"
            />
            {inBookQuery && (
              <button
                type="button"
                onClick={() => setInBookQuery('')}
                className="text-xs text-[#57534E] hover:text-[#1C1917]"
              >
                Bersihkan
              </button>
            )}
          </div>
          {inBookQuery.trim().length > 1 && (
            <div className="mt-3 pt-3 border-t border-[#E5DEC9]">
              <p className="text-xs text-[#57534E] mb-2">
                Ditemukan pada {searchMatches.length} halaman:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {searchMatches.map((matchPage) => (
                  <button
                    key={matchPage.pageNumber}
                    type="button"
                    onClick={() => {
                      onPageChange(matchPage.pageNumber);
                      setShowSearchPopover(false);
                    }}
                    className="text-left p-2.5 bg-white border border-[#D6CEBE] hover:border-[#78350F] transition-colors"
                  >
                    <p className="text-xs font-mono-tabular font-semibold text-[#78350F]">
                      Halaman {matchPage.pageNumber} · {matchPage.chapterTitle}
                    </p>
                    <p className="text-xs text-[#44403C] line-clamp-2 mt-1">
                      {matchPage.paragraphs[0]}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showTocDrawer && (
        <div className="mb-6 p-4 sm:p-5 bg-[#F7F4EE] border border-[#D6CEBE] space-y-4 animate-fade-in shadow-inner">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E5DEC9]">
            <div>
              <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans font-semibold">
                Fihris / Daftar Isi Lengkap Kitab
              </p>
              <h3 className="text-lg font-display font-semibold text-[#1C1917]">
                {kitab.title}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isScanningPdfToc}
                onClick={async () => {
                  setIsScanningPdfToc(true);
                  try {
                    let docToUse = pdfDoc;
                    if (!docToUse && kitab.isUploadedPdf && kitab.pdfBlobKey) {
                      const buf = await loadPdfArrayBuffer(kitab.pdfBlobKey);
                      if (buf) {
                        docToUse = await createPdfLoadingTask(new Uint8Array(buf)).promise;
                        setPdfDoc(docToUse);
                      }
                    }
                    const detected = await detectOrGenerateKitabChapters(docToUse, kitab.title, kitab.totalPages);
                    if (detected && detected.length > 0 && onUpdateChapters) {
                      onUpdateChapters(kitab.id, detected);
                      setTocUpdateSuccessToast(true);
                      setTimeout(() => setTocUpdateSuccessToast(false), 2200);
                    }
                  } finally {
                    setIsScanningPdfToc(false);
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium bg-[#F7F4EE] border border-[#78350F] text-[#78350F] hover:bg-[#78350F] hover:text-white transition-colors flex items-center gap-1.5 shadow-xs"
                title="Pindai dan baca otomatis daftar isi / fihris dari berkas PDF ini"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isScanningPdfToc ? 'animate-spin' : ''}`} />
                <span>{isScanningPdfToc ? 'Memindai PDF...' : 'Pindai Ulang Fihris'}</span>
              </button>

              {onUpdateChapters && (
                <button
                  type="button"
                  onClick={handleOpenTocEditModal}
                  className="px-3 py-1.5 text-xs font-medium bg-[#78350F] text-white hover:bg-[#5C280B] transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Kelola / Edit</span>
                </button>
              )}
            </div>
          </div>

          {/* Row 1: Dedicated Full-Width Arabic Search Bar */}
          <div className="w-full relative pt-1" dir="rtl">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#78716C] pointer-events-none" />
            <input
              type="text"
              dir="rtl"
              value={tocSearchQuery}
              onChange={(e) => setTocSearchQuery(e.target.value)}
              placeholder="ابحث هنا عن الأبواب، الفصول، الفروع، التنبيهات، والمسائل (مثال: صلاة، وضوء، بيع، ربا)..."
              className="w-full pr-10 pl-10 py-2.5 text-sm sm:text-base font-arabic bg-white border-2 border-[#D6CEBE] text-[#1C1917] placeholder:text-[#A8A29E] placeholder:font-arabic placeholder:text-xs sm:placeholder:text-sm text-right focus:outline-none focus:border-[#78350F] transition-all shadow-xs"
            />
            {tocSearchQuery && (
              <button
                type="button"
                onClick={() => setTocSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#78716C] hover:text-[#1C1917] bg-[#F7F4EE] hover:bg-[#E2DCD0] rounded transition-colors"
                title="مسح البحث · Hapus pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Row 2: Category Filter Tabs */}
          <div className="w-full overflow-x-auto pb-1 text-xs font-mono-tabular">
            <div className="flex items-center gap-1.5 flex-nowrap">
              <button
                type="button"
                onClick={() => setTocCategoryFilter('all')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'all'
                    ? 'bg-[#78350F] text-white border-[#78350F]'
                    : 'bg-white text-[#44403C] border-[#D6CEBE] hover:bg-[#EBE6DF]'
                }`}
              >
                Semua ({kitab.chapters.length})
              </button>
              <button
                type="button"
                onClick={() => setTocCategoryFilter('kitab')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'kitab'
                    ? 'bg-emerald-800 text-white border-emerald-800'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                📗 Kitab ({kitab.chapters.filter((c) => stripArabicTashkeel(c.title).startsWith('كتاب')).length})
              </button>
              <button
                type="button"
                onClick={() => setTocCategoryFilter('bab')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'bab'
                    ? 'bg-amber-800 text-white border-amber-800'
                    : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                }`}
              >
                📙 Bab ({kitab.chapters.filter((c) => stripArabicTashkeel(c.title).startsWith('باب')).length})
              </button>
              <button
                type="button"
                onClick={() => setTocCategoryFilter('fasal')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'fasal'
                    ? 'bg-sky-800 text-white border-sky-800'
                    : 'bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100'
                }`}
              >
                📘 Fasal ({kitab.chapters.filter((c) => stripArabicTashkeel(c.title).startsWith('فصل')).length})
              </button>
              <button
                type="button"
                onClick={() => setTocCategoryFilter('furu')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'furu'
                    ? 'bg-rose-800 text-white border-rose-800'
                    : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'
                }`}
              >
                📕 Furu' ({kitab.chapters.filter((c) => {
                  const cl = stripArabicTashkeel(c.title);
                  return cl.startsWith('فرع') || cl.startsWith('مسألة');
                }).length})
              </button>
              <button
                type="button"
                onClick={() => setTocCategoryFilter('tanbih')}
                className={`px-3 py-1.5 font-medium border transition-colors whitespace-nowrap ${
                  tocCategoryFilter === 'tanbih'
                    ? 'bg-violet-800 text-white border-violet-800'
                    : 'bg-violet-50 text-violet-900 border-violet-200 hover:bg-violet-100'
                }`}
              >
                💡 Tanbih & Muhimmat ({kitab.chapters.filter((c) => {
                  const cl = stripArabicTashkeel(c.title);
                  return cl.startsWith('تنبيه') || cl.startsWith('مهمة') || cl.startsWith('مهمات') || cl.startsWith('فائدة') || cl.startsWith('تتمة');
                }).length})
              </button>
            </div>
          </div>

          {/* Chapters Grid with Categorized Badges */}
          {(() => {
            const listToDisplay = kitab.chapters.filter((ch) => {
              const clean = stripArabicTashkeel(ch.title);
              if (tocCategoryFilter === 'kitab' && !clean.startsWith('كتاب')) return false;
              if (tocCategoryFilter === 'bab' && !clean.startsWith('باب')) return false;
              if (tocCategoryFilter === 'fasal' && !clean.startsWith('فصل')) return false;
              if (
                tocCategoryFilter === 'furu' &&
                !clean.startsWith('فرع') &&
                !clean.startsWith('مسألة')
              ) {
                return false;
              }
              if (
                tocCategoryFilter === 'tanbih' &&
                !clean.startsWith('تنبيه') &&
                !clean.startsWith('مهمة') &&
                !clean.startsWith('مهمات') &&
                !clean.startsWith('فائدة') &&
                !clean.startsWith('تتمة')
              ) {
                return false;
              }

              if (tocSearchQuery.trim()) {
                const q = tocSearchQuery.trim();
                const normQ = normalizeArabicTitle(q);
                const normTitle = normalizeArabicTitle(ch.title);
                const titleLower = ch.title.toLowerCase();

                if (normTitle.includes(normQ) || titleLower.includes(q.toLowerCase())) {
                  return true;
                }

                const tokens = normQ.split(' ').filter(Boolean);
                if (
                  tokens.length > 0 &&
                  tokens.every((tok) => {
                    const tokNoAl = tok.startsWith('ال') ? tok.slice(2) : tok;
                    return (
                      normTitle.includes(tok) ||
                      (tokNoAl.length >= 2 && normTitle.includes(tokNoAl))
                    );
                  })
                ) {
                  return true;
                }

                if (String(ch.startPage) === q || ch.number === q) {
                  return true;
                }

                return false;
              }
              return true;
            });

            if (listToDisplay.length === 0) {
              return (
                <div className="py-8 px-4 text-center bg-white border border-[#D6CEBE] space-y-3" dir="rtl">
                  <p className="text-base font-arabic font-medium text-[#1C1917] leading-relaxed">
                    لم يتم العثور على أي باب أو مسألة تطابق:
                    <span className="font-bold text-[#78350F] px-1.5 inline-block" dir="rtl">
                      «{tocSearchQuery}»
                    </span>
                  </p>
                  <p className="text-xs text-[#78716C] font-sans" dir="ltr">
                    Coba gunakan kata kunci bahasa Arab lain atau klik tombol reset di bawah
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setTocSearchQuery('');
                      setTocCategoryFilter('all');
                    }}
                    className="px-4 py-2 text-xs font-medium bg-[#78350F] text-white hover:bg-[#5C280B] transition-colors shadow-xs"
                  >
                    إعادة ضبط البحث · Tampilkan Semua Bab
                  </button>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {listToDisplay.map((ch) => {
                  const isCurrentChapter =
                    currentPage >= ch.startPage &&
                    (!kitab.chapters.find((next) => next.startPage > ch.startPage) ||
                      currentPage <
                        (kitab.chapters.find((next) => next.startPage > ch.startPage)?.startPage ||
                          9999));
                  const pureArabicTitle = extractArabicTitleOnly(ch.title);
                  const cleanHeading = stripArabicTashkeel(pureArabicTitle);

                  let badgeStyle = 'bg-purple-100 text-purple-900 border-purple-300';
                  let badgeLabel = 'مقدمة / خاتمة';
                  if (cleanHeading.startsWith('كتاب')) {
                    badgeStyle = 'bg-emerald-100 text-emerald-950 border-emerald-300 font-semibold';
                    badgeLabel = 'كتاب · Kitab';
                  } else if (cleanHeading.startsWith('باب')) {
                    badgeStyle = 'bg-amber-100 text-amber-950 border-amber-300 font-medium';
                    badgeLabel = 'باب · Bab';
                  } else if (cleanHeading.startsWith('فصل')) {
                    badgeStyle = 'bg-sky-100 text-sky-950 border-sky-300 font-medium';
                    badgeLabel = 'فصل · Fasal';
                  } else if (cleanHeading.startsWith('فرع')) {
                    badgeStyle = 'bg-rose-100 text-rose-950 border-rose-300 font-medium';
                    badgeLabel = 'فرع · Furu\'';
                  } else if (cleanHeading.startsWith('تنبيه')) {
                    badgeStyle = 'bg-amber-100 text-amber-950 border-amber-400 font-semibold';
                    badgeLabel = 'تنبيه · Tanbih';
                  } else if (cleanHeading.startsWith('مهمة') || cleanHeading.startsWith('مهمات')) {
                    badgeStyle = 'bg-violet-100 text-violet-950 border-violet-400 font-semibold';
                    badgeLabel = 'مهمة · Muhimmat';
                  } else if (cleanHeading.startsWith('فائدة') || cleanHeading.startsWith('فوائد')) {
                    badgeStyle = 'bg-teal-100 text-teal-950 border-teal-300 font-medium';
                    badgeLabel = 'فائدة · Faidah';
                  } else if (cleanHeading.startsWith('مسألة')) {
                    badgeStyle = 'bg-orange-100 text-orange-950 border-orange-300 font-medium';
                    badgeLabel = 'مسألة · Mas\'alah';
                  }

                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => handleChapterClick(ch)}
                      className={`text-right p-3.5 border transition-all flex flex-col justify-between gap-2.5 ${
                        isCurrentChapter
                          ? 'border-[#78350F] bg-[#78350F]/10 shadow-md ring-1 ring-[#78350F]'
                          : 'border-[#D6CEBE] bg-white hover:border-[#78350F] hover:bg-[#FBF9F5]'
                      }`}
                      dir="rtl"
                    >
                      <div className="flex items-center justify-between gap-2 w-full text-xs font-mono-tabular" dir="rtl">
                        <span className={`text-[10px] px-2 py-0.5 border ${badgeStyle}`}>
                          {badgeLabel}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold px-2 py-0.5 bg-[#78350F]/10 border border-[#78350F]/30 text-[#78350F] text-[11px]">
                            ص {getChapterDisplayPage(ch.startPage)}
                          </span>
                          <span className="text-[11px] text-[#78716C]">
                            #{ch.number}
                          </span>
                        </div>
                      </div>
                      <p className="text-base font-arabic font-medium text-[#1C1917] leading-relaxed text-right w-full" dir="rtl">
                        {pureArabicTitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Toast Notification when TOC updated */}
      {tocUpdateSuccessToast && (
        <div className="fixed top-6 right-6 z-50 bg-[#1C1917] text-white text-xs px-4 py-3 rounded shadow-xl flex items-center gap-2 animate-fade-in border border-[#78350F]">
          <Check className="w-4 h-4 text-[#D97706]" />
          <span>Daftar isi / Fihris kitab berhasil diperbarui!</span>
        </div>
      )}

      {/* Interactive Table of Contents (Fihris) Edit & Manage Modal */}
      {showTocEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-2xl bg-[#F7F4EE] border-2 border-[#D6CEBE] shadow-2xl p-5 sm:p-7 max-h-[90vh] flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-start justify-between pb-3 mb-4 border-b border-[#E5DEC9]">
                <div>
                  <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans font-semibold">
                    Pengelola Daftar Isi (Fihris)
                  </p>
                  <h2 className="text-xl font-display font-semibold text-[#1C1917] mt-0.5">
                    {kitab.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTocEditModal(false)}
                  className="p-1.5 text-[#57534E] hover:text-[#1C1917] hover:bg-[#E2DCD0] transition-colors rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* PDF Auto Scan Option */}
              {kitab.isUploadedPdf && pdfDoc && (
                <div className="mb-4 p-3 bg-[#EEDB9F]/40 border border-[#DEC89B] flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-[#7C2D12]">
                    <Sparkles className="w-4 h-4 shrink-0 text-[#78350F]" />
                    <span>Ekstrak otomatis daftar bab/bookmarks dari dokumen PDF ini.</span>
                  </div>
                  <button
                    type="button"
                    disabled={isScanningPdfToc}
                    onClick={handleScanPdfOutline}
                    className="px-3 py-1.5 font-medium bg-[#78350F] text-white hover:bg-[#5C280B] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isScanningPdfToc ? 'animate-spin' : ''}`} />
                    <span>{isScanningPdfToc ? 'Memindai...' : 'Pindai Outlines PDF'}</span>
                  </button>
                </div>
              )}

              {/* Add Custom Chapter Form */}
              <form onSubmit={handleAddCustomChapter} className="mb-4 p-3.5 bg-white border border-[#D6CEBE] space-y-3">
                <p className="text-xs font-semibold text-[#1C1917] flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-[#78350F]" />
                  <span>Tambah Bab / Fasal Baru Secara Manual:</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={newChapterTitle}
                    onChange={(e) => setNewChapterTitle(e.target.value)}
                    placeholder="Judul Bab / Fasal (misal: bab shalat / باب الصلاة)..."
                    className="sm:col-span-8 bg-[#FBF9F5] px-3 py-1.5 text-xs border border-[#D6CEBE] focus:outline-none focus:border-[#78350F]"
                  />
                  <div className="sm:col-span-4 flex items-center gap-2">
                    <span className="text-xs text-[#57534E] shrink-0 font-mono-tabular">Hal:</span>
                    <input
                      type="number"
                      min={1}
                      max={kitab.totalPages}
                      value={newChapterPage}
                      onChange={(e) => setNewChapterPage(parseInt(e.target.value) || 1)}
                      className="w-full bg-[#FBF9F5] px-2.5 py-1.5 text-xs font-mono-tabular border border-[#D6CEBE] focus:outline-none focus:border-[#78350F]"
                    />
                    <button
                      type="submit"
                      disabled={!newChapterTitle.trim()}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-[#1C1917] hover:bg-[#78350F] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      + Tambah
                    </button>
                  </div>
                </div>
              </form>

              {/* Editable Chapters List */}
              <div className="space-y-2 overflow-y-auto max-h-[280px] pr-1">
                <div className="flex items-center justify-between pb-1 mb-1 font-mono-tabular text-xs">
                  <p className="font-semibold text-[#57534E]">
                    Daftar Bab Terdaftar ({editingChapters.length}):
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-[#78716C] font-sans">Geser Semua:</span>
                    <button
                      type="button"
                      onClick={() => handleShiftEditingPages(-5)}
                      className="px-1.5 py-0.5 bg-white border border-[#D6CEBE] hover:bg-[#78350F] hover:text-white text-[#1C1917] text-[10px] font-bold transition-colors"
                      title="Geser nomor semua bab -5 lembar"
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftEditingPages(-1)}
                      className="px-1.5 py-0.5 bg-white border border-[#D6CEBE] hover:bg-[#78350F] hover:text-white text-[#1C1917] text-[10px] font-bold transition-colors"
                      title="Geser nomor semua bab -1 lembar"
                    >
                      -1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftEditingPages(1)}
                      className="px-1.5 py-0.5 bg-white border border-[#D6CEBE] hover:bg-[#78350F] hover:text-white text-[#1C1917] text-[10px] font-bold transition-colors"
                      title="Geser nomor semua bab +1 lembar"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShiftEditingPages(5)}
                      className="px-1.5 py-0.5 bg-white border border-[#D6CEBE] hover:bg-[#78350F] hover:text-white text-[#1C1917] text-[10px] font-bold transition-colors"
                      title="Geser nomor semua bab +5 lembar"
                    >
                      +5
                    </button>
                  </div>
                </div>
                {editingChapters.length === 0 ? (
                  <p className="text-xs text-[#78716C] italic p-4 text-center bg-white border border-[#E2DCD0]">
                    Belum ada bab terdaftar. Tambahkan bab baru di atas atau pindai otomatis dari PDF.
                  </p>
                ) : (
                  editingChapters.map((ch, idx) => (
                    <div
                      key={ch.id || idx}
                      className="flex items-center gap-2 p-2 bg-white border border-[#D6CEBE] text-xs"
                    >
                      <span className="w-6 text-center font-mono-tabular text-[#78350F] font-bold shrink-0">
                        {ch.number || String(idx + 1).padStart(2, '0')}
                      </span>
                      <input
                        type="text"
                        value={ch.title}
                        onChange={(e) => {
                          const updatedTitle = e.target.value;
                          setEditingChapters((prev) =>
                            prev.map((item) => (item.id === ch.id ? { ...item, title: updatedTitle } : item))
                          );
                        }}
                        className="flex-1 bg-[#FBF9F5] px-2.5 py-1 text-xs border border-[#E2DCD0] focus:outline-none focus:border-[#78350F]"
                      />
                      <div className="flex items-center gap-1 shrink-0 font-mono-tabular">
                        <span className="text-[#57534E]">Hal:</span>
                        <input
                          type="number"
                          min={1}
                          max={kitab.totalPages}
                          value={ch.startPage}
                          onChange={(e) => {
                            const newStart = parseInt(e.target.value) || 1;
                            setEditingChapters((prev) =>
                              prev.map((item) => (item.id === ch.id ? { ...item, startPage: newStart } : item))
                            );
                          }}
                          className="w-16 bg-[#FBF9F5] px-2 py-1 text-xs text-center border border-[#E2DCD0] focus:outline-none focus:border-[#78350F]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteChapter(ch.id)}
                        className="p-1.5 text-[#A8A29E] hover:text-[#9A3412] transition-colors shrink-0"
                        title="Hapus bab ini"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-4 mt-4 border-t border-[#E5DEC9] flex items-center justify-between gap-3">
              <span className="text-xs text-[#57534E]">
                Total {editingChapters.length} Bab Fihris
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTocEditModal(false)}
                  className="px-4 py-2 text-xs font-medium border border-[#D6CEBE] bg-white hover:bg-[#EBE6DF] text-[#1C1917] transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveToc}
                  className="px-5 py-2 text-xs font-medium text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Simpan Daftar Isi</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div
          className={
            settings.showMarginNotes ? 'lg:col-span-8 xl:col-span-9' : 'lg:col-span-12'
          }
        >
          <div
            className={
              settings.showHardwareBezel
                ? 'p-4 sm:p-7 bg-[#262320] border-4 border-[#3D3834] shadow-2xl rounded-xl relative'
                : 'relative'
            }
          >
            {settings.showHardwareBezel && (
              <div className="flex items-center justify-between px-3 pb-3 mb-2 text-[11px] font-mono-tabular text-[#A8A29E]">
                <span>POCKETBOOK · TANG KETAB EDITION</span>
                <span>
                  {kitab.isUploadedPdf ? 'DOKUMEN PDF PRIBADI' : 'NASKAH TURATS'} · {progressPercentage}%
                </span>
              </div>
            )}

            <div 
              ref={bookContainerRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className="relative overflow-hidden"
            >
              {/* 3D Spine Crease Overlay */}
              {isDouble && rightPageData && (
                <div className="absolute left-1/2 top-0 bottom-0 w-[14px] -ml-[7px] bg-gradient-to-r from-black/10 via-black/30 to-black/10 pointer-events-none z-10 shadow-[0_0_8px_rgba(0,0,0,0.18)]" />
              )}

              {/* Real-time drag sheet for Next Page (LTR) */}
              {dragState.isDragging && dragState.direction === 'ltr' && (
                <div className="absolute inset-0 pointer-events-none z-30 flex" dir="ltr">
                  {/* Left half - Curling page */}
                  <div className="w-1/2 h-full relative book-perspective">
                    <div 
                      className={`absolute inset-0 border border-[#D6CEBE]/30 rounded-r-md ${themeStyle.pageBg} overflow-hidden`}
                      style={{
                        transform: `rotateY(${dragState.progress * 135}deg) skewY(${dragState.progress * 3}deg) translateX(${dragState.progress * 8}px)`,
                        transformOrigin: 'right center',
                        boxShadow: `${dragState.progress * 6}px 3px 12px rgba(0, 0, 0, ${dragState.progress * 0.05})`,
                        transformStyle: 'preserve-3d',
                      }}
                    >
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0.5px)' }}>
                        {renderCurlingPageContent(currentRightPageData)}
                      </div>
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg) translateZ(0.5px)' }}>
                        {renderCurlingPageContent(nextCurlBackPage)}
                      </div>
                    </div>
                  </div>
                  {/* Right half - Shadow overlay */}
                  <div className="w-1/2 h-full relative overflow-hidden">
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-black/10 via-black/3 to-transparent"
                      style={{
                        transform: `translateX(${(dragState.progress - 1) * 100}%)`,
                        opacity: dragState.progress * 0.2,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Real-time drag sheet for Prev Page (RTL) */}
              {dragState.isDragging && dragState.direction === 'rtl' && (
                <div className="absolute inset-0 pointer-events-none z-30 flex" dir="ltr">
                  {/* Left half - Shadow overlay */}
                  <div className="w-1/2 h-full relative overflow-hidden">
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black/10 via-black/3 to-transparent"
                      style={{
                        transform: `translateX(${(1 - dragState.progress) * 100}%)`,
                        opacity: dragState.progress * 0.2,
                      }}
                    />
                  </div>
                  {/* Right half - Curling page */}
                  <div className="w-1/2 h-full relative book-perspective">
                    <div 
                      className={`absolute inset-0 border border-[#D6CEBE]/30 rounded-l-md ${themeStyle.pageBg} overflow-hidden`}
                      style={{
                        transform: `rotateY(${-dragState.progress * 135}deg) skewY(${-dragState.progress * 3}deg) translateX(${-dragState.progress * 8}px)`,
                        transformOrigin: 'left center',
                        boxShadow: `-${dragState.progress * 6}px 3px 12px rgba(0, 0, 0, ${dragState.progress * 0.05})`,
                        transformStyle: 'preserve-3d',
                      }}
                    >
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0.5px)' }}>
                        {renderCurlingPageContent(currentLeftPageData)}
                      </div>
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg) translateZ(0.5px)' }}>
                        {renderCurlingPageContent(prevCurlBackPage)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3D Curling Sheet Overlay (Seperti Video) */}
              {flipDirection === 'rtl' && (
                <div className="absolute inset-0 pointer-events-none z-30 flex" dir="ltr">
                  {/* Left half has dynamic shadow sweep */}
                  <div className="w-1/2 h-full relative overflow-hidden">
                    <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black/10 via-black/3 to-transparent sweeping-shadow-rtl" />
                  </div>
                  {/* Right half is the curling paper leaf */}
                  <div className="w-1/2 h-full relative book-perspective">
                    <div 
                      className={`absolute inset-0 border border-[#D6CEBE]/30 shadow-lg rounded-l-md leaf-turn-rtl ${themeStyle.pageBg} overflow-hidden`}
                      style={{ transformStyle: 'preserve-3d' }}
                    >
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0.5px)' }}>
                        {renderCurlingPageContent(currentLeftPageData)}
                      </div>
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg) translateZ(0.5px)' }}>
                        {renderCurlingPageContent(prevCurlBackPage)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {flipDirection === 'ltr' && (
                <div className="absolute inset-0 pointer-events-none z-30 flex" dir="ltr">
                  {/* Left half is the curling paper leaf */}
                  <div className="w-1/2 h-full relative book-perspective">
                    <div 
                      className={`absolute inset-0 border border-[#D6CEBE]/30 shadow-lg rounded-r-md leaf-turn-ltr ${themeStyle.pageBg} overflow-hidden`}
                      style={{ transformStyle: 'preserve-3d' }}
                    >
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0.5px)' }}>
                        {renderCurlingPageContent(currentRightPageData)}
                      </div>
                      <div className={`absolute inset-0 ${themeStyle.pageBg}`} style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg) translateZ(0.5px)' }}>
                        {renderCurlingPageContent(nextCurlBackPage)}
                      </div>
                    </div>
                  </div>
                  {/* Right half has dynamic shadow sweep */}
                  <div className="w-1/2 h-full relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-black/10 via-black/3 to-transparent sweeping-shadow-ltr" />
                  </div>
                </div>
              )}

              <div
                className={`grid select-none transition-transform duration-300 ${
                  isDouble && rightPageData ? 'grid-cols-2' : 'grid-cols-1 max-w-3xl mx-auto'
                }`}
              >
                {isDouble && rightPageData ? (
                  <>
                    {renderSingleSheet(rightPageData, 'left')}
                    {renderSingleSheet(leftPageData, 'right')}
                  </>
                ) : (
                  renderSingleSheet(leftPageData, 'single')
                )}
              </div>
            </div>

            <div
              className={`mt-5 flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border ${
                settings.showHardwareBezel
                  ? 'bg-[#1C1917] border-[#3D3834] text-[#E7E2DA]'
                  : 'bg-[#F7F4EE] border-[#D6CEBE] text-[#1C1917]'
              }`}
            >
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={leftPageNum <= 1}
                className={`px-4 py-2 text-xs font-medium flex items-center gap-2 border transition-colors whitespace-nowrap ${
                  leftPageNum <= 1
                    ? 'opacity-40 cursor-not-allowed border-transparent'
                    : settings.showHardwareBezel
                    ? 'border-[#57534E] bg-[#292524] hover:bg-[#3D3834] text-white'
                    : 'border-[#D6CEBE] bg-white hover:bg-[#EBE6DF] text-[#1C1917]'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Lembar Sebelumnya</span>
              </button>

              <div className="flex flex-col items-center w-full max-w-md gap-1.5">
                <div className="flex items-center justify-between w-full text-xs font-mono-tabular">
                  <span>
                    {formatPageLabel(leftPageNum)}
                    {rightPageNum ? ` – ${formatPageLabel(rightPageNum)}` : ''} (Total {kitab.totalPages} Lembar PDF)
                  </span>
                  <span>{progressPercentage}% Selesai</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={kitab.totalPages}
                  value={currentPage}
                  onChange={(e) => onPageChange(Number(e.target.value))}
                  aria-label="Geser halaman kitab"
                  className="w-full accent-[#78350F] cursor-pointer h-1.5 bg-[#D6CEBE]"
                />
              </div>

              <button
                type="button"
                onClick={handleNextPage}
                disabled={(rightPageNum || leftPageNum) >= kitab.totalPages}
                className={`px-4 py-2 text-xs font-medium flex items-center gap-2 border transition-colors whitespace-nowrap ${
                  (rightPageNum || leftPageNum) >= kitab.totalPages
                    ? 'opacity-40 cursor-not-allowed border-transparent'
                    : settings.showHardwareBezel
                    ? 'border-[#78350F] bg-[#78350F] hover:bg-[#9A3412] text-white'
                    : 'border-[#1C1917] bg-[#1C1917] hover:bg-[#332E2A] text-white'
                }`}
              >
                <span>Lembar Berikutnya</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {settings.showMarginNotes && (
          <aside className="lg:col-span-4 xl:col-span-3 space-y-6 bg-[#F7F4EE] border border-[#D6CEBE] p-5">
            <div className="pb-3 border-b border-[#E5DEC9]">
              <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                Catatan Pinggir · Hasyiyah
              </p>
              <h3 className="text-xl font-display font-semibold text-[#1C1917] mt-0.5">
                Tadabbur Halaman {leftPageNum}
                {rightPageNum ? `–${rightPageNum}` : ''}
              </h3>
            </div>

            <form onSubmit={handleSaveNote} className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#57534E]">
                <span>Target Halaman:</span>
                <div className="flex items-center gap-1 font-mono-tabular">
                  <button
                    type="button"
                    onClick={() => setActiveNoteTargetPage(leftPageNum)}
                    className={`px-2 py-0.5 border ${
                      activeNoteTargetPage === leftPageNum
                        ? 'border-[#78350F] bg-[#78350F] text-white'
                        : 'border-[#D6CEBE] bg-white'
                    }`}
                  >
                    Hal. {leftPageNum}
                  </button>
                  {rightPageNum && (
                    <button
                      type="button"
                      onClick={() => setActiveNoteTargetPage(rightPageNum)}
                      className={`px-2 py-0.5 border ${
                        activeNoteTargetPage === rightPageNum
                          ? 'border-[#78350F] bg-[#78350F] text-white'
                          : 'border-[#D6CEBE] bg-white'
                      }`}
                    >
                      Hal. {rightPageNum}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#57534E] mb-1 font-sans">
                  Jenis Catatan
                </label>
                <select
                  value={newNoteCategory}
                  onChange={(e) => setNewNoteCategory(e.target.value as NoteCategory)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
                >
                  {(Object.keys(NOTE_CATEGORY_LABELS) as NoteCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {NOTE_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              {newNoteQuote && (
                <div className="p-2.5 bg-[#FBF9F5] border-l-2 border-[#78350F] text-xs italic text-[#44403C] flex items-start justify-between gap-2">
                  <span className="line-clamp-2">“{newNoteQuote}”</span>
                  <button
                    type="button"
                    onClick={() => setNewNoteQuote('')}
                    className="text-[11px] not-italic text-[#9A3412] shrink-0"
                  >
                    Hapus
                  </button>
                </div>
              )}

              <textarea
                rows={3}
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Tulis syarah, makna mufradat, atau kesimpulan halaman ini..."
                className="w-full p-3 text-xs bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F] leading-relaxed"
              />

              <button
                type="submit"
                className="w-full py-2 px-4 text-xs font-medium bg-[#78350F] hover:bg-[#5C280B] text-white transition-colors flex items-center justify-center gap-1.5"
              >
                {justSavedNote ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Tersimpan di Hasyiyah</span>
                  </>
                ) : (
                  <>
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>Simpan Catatan Hasyiyah</span>
                  </>
                )}
              </button>
            </form>

            <div className="space-y-3 pt-3 border-t border-[#E5DEC9]">
              <p className="text-xs font-medium text-[#57534E]">
                Catatan pada lembar terbuka ({currentSpreadNotes.length})
              </p>

              {currentSpreadNotes.length === 0 ? (
                <p className="text-xs text-[#78716C] italic leading-relaxed">
                  Belum ada catatan pinggir pada halaman ini. Sorot kalimat di halaman kitab atau tulis catatan di atas.
                </p>
              ) : (
                currentSpreadNotes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3.5 bg-[#FBF9F5] border border-[#E2DCD0] space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#78350F] font-mono-tabular">
                      <span>
                        Hal. {note.pageNumber} · {NOTE_CATEGORY_LABELS[note.category]}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteNote(note.id)}
                        className="text-[#78716C] hover:text-[#9A3412] transition-colors"
                        title="Hapus catatan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {note.quotedText && (
                      <blockquote className="pl-2.5 border-l-2 border-[#D6CEBE] text-xs italic text-[#57534E]">
                        “{note.quotedText}”
                      </blockquote>
                    )}
                    <p className="text-xs text-[#1C1917] leading-relaxed">{note.content}</p>
                  </div>
                ))
              )}
            </div>

            {onOpenUploadModal && (
              <div className="pt-4 border-t border-[#E5DEC9]">
                <button
                  type="button"
                  onClick={onOpenUploadModal}
                  className="w-full py-2 px-3 text-xs font-medium border border-[#D6CEBE] bg-white hover:bg-[#EBE6DF] text-[#1C1917] transition-colors flex items-center justify-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5 text-[#78350F]" />
                  <span>Masukkan PDF Kitab Lainnya</span>
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
};

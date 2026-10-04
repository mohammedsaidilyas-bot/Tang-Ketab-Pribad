import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Upload,
  Bookmark,
  Search,
  Trash2,
  Download,
  Check,
  Sparkles,
  ArrowRight,
  RotateCw,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  HasyiyahNote,
  KitabDocument,
  NoteCategory,
  ReaderSettings,
} from './types/kitab';
import { PocketBookReader } from './components/PocketBookReader';
import { PdfUploadModal } from './components/PdfUploadModal';
import { ReaderSelector } from './components/ReaderSelector';
import {
  subscribeToKitabs,
  subscribeToNotes,
  saveKitabToFirestore,
  deleteKitabFromFirestore,
  saveNoteToFirestore,
  deleteNoteFromFirestore,
  getStoragePdfUrl,
} from './services/firebaseService';
import {
  detectOrGenerateKitabChapters,
  detectPdfCoverOffset,
  loadPdfArrayBuffer,
  createPdfLoadingTask,
  extractArabicTitleOnly,
} from './utils/pdfProcessor';
import archivalDeskImg from './assets/images/tang_ketab_archival_desk_1791013805237.jpg';
import kitabCoverImg from './assets/images/kitab_manuscript_cover_1791013815328.jpg';

type ActiveTab = 'pustaka' | 'reader' | 'hasyiyah' | 'katalog';

const STORAGE_KEY_KITABS = 'tang_ketab_collection_v2';
const STORAGE_KEY_NOTES = 'tang_ketab_notes_v2';
const STORAGE_KEY_SETTINGS = 'tang_ketab_reader_settings_v2';

const COVER_TONE_CLASSES: Record<
  KitabDocument['coverTone'],
  { bg: string; border: string; spine: string; label: string }
> = {
  bronze: {
    bg: 'bg-[#4A2511]',
    border: 'border-[#78350F]',
    spine: 'bg-[#2E1608]',
    label: 'Jilid Perunggu Klasik',
  },
  lapis: {
    bg: 'bg-[#172554]',
    border: 'border-[#1E3A8A]',
    spine: 'bg-[#0F172A]',
    label: 'Jilid Biru Lapis',
  },
  forest: {
    bg: 'bg-[#143821]',
    border: 'border-[#14532D]',
    spine: 'bg-[#0A2112]',
    label: 'Jilid Hijau Zaitun',
  },
  terracotta: {
    bg: 'bg-[#69230D]',
    border: 'border-[#9A3412]',
    spine: 'bg-[#431407]',
    label: 'Jilid Terakota Kuno',
  },
  charcoal: {
    bg: 'bg-[#1C1917]',
    border: 'border-[#44403C]',
    spine: 'bg-[#0C0A09]',
    label: 'Jilid Hitam Tinta',
  },
};

export function App() {
  const [kitabs, setKitabs] = useState<KitabDocument[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_KITABS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Strictly keep only PDF books uploaded by the user
          return parsed.filter((k: any) => Boolean(k.isUploadedPdf));
        }
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  const [notes, setNotes] = useState<HasyiyahNote[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((n: any) => !n.id.startsWith('note-default-'));
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      theme: 'kuning',
      fontSize: 17,
      lineHeight: 'relaxed',
      spreadMode: 'double',
      renderMode: 'pocketbook',
      showHardwareBezel: false,
      showArabicMatan: true,
      showMarginNotes: true,
    };
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('pustaka');
  const [activeKitabId, setActiveKitabId] = useState<string>(kitabs[0]?.id || '');
  const [catalogKitabId, setCatalogKitabId] = useState<string>(kitabs[0]?.id || '');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [activePembaca, setActivePembaca] = useState<string | null>(null);

  const handleSelectPembaca = (role: 'pembaca' | 'admin') => {
    setActivePembaca(role);
  };

  const kitabsRef = useRef(kitabs);
  useEffect(() => {
    kitabsRef.current = kitabs;
  }, [kitabs]);

  // Real-time Firestore sync and auto-migration of local kitabs to cloud
  useEffect(() => {
    let isCancelled = false;

    const healKitabs = async () => {
      // Run on the initial set of kitabs
      for (const k of kitabsRef.current) {
        if (isCancelled) break;
        if (k.isUploadedPdf) {
          let currentK = { ...k };
          let updated = false;

          // 1. Try to recover missing cloud URL
          if (!currentK.pdfUrl) {
            try {
              const recoveredUrl = await getStoragePdfUrl(currentK.id);
              if (recoveredUrl) {
                currentK.pdfUrl = recoveredUrl;
                updated = true;
                console.log(`Recovered cloud URL for kitab: ${currentK.title}`);
              }
            } catch (e) {
              console.warn(`Failed to recover cloud URL for kitab ${currentK.id}:`, e);
            }
          }

          // 2. Only persist to Firestore if we actually changed something (like recovering a URL)
          // or if the kitab is entirely local (no pdfUrl at all but should have one).
          // We avoid unconditional writes to prevent hitting Firestore quotas.
          if (updated) {
            await saveKitabToFirestore(currentK);
            if (!isCancelled) {
              setKitabs((prev) =>
                prev.map((item) => (item.id === currentK.id ? currentK : item))
              );
            }
          }
        }
      }
    };

    healKitabs();

    const unsubKitabs = subscribeToKitabs((cloudKitabs) => {
      console.log('Received kitabs from cloud sync:', cloudKitabs.length);
      if (cloudKitabs && cloudKitabs.length > 0) {
        setKitabs((prev) => {
          const map = new Map<string, KitabDocument>();
          // Merge logic: Cloud version is authoritative for shared fields
          // but we keep local blob keys if they exist
          cloudKitabs.forEach((k) => map.set(k.id, k));
          prev.forEach((k) => {
            if (!map.has(k.id)) {
              map.set(k.id, k);
            } else {
              const cloudK = map.get(k.id)!;
              map.set(k.id, {
                ...cloudK,
                bookmarks: cloudK.bookmarks || k.bookmarks || [],
                pages: cloudK.pages || k.pages || [],
                chapters: cloudK.chapters || k.chapters || [],
                pdfBlobKey: k.pdfBlobKey || cloudK.pdfBlobKey,
              });
            }
          });

          return Array.from(map.values()).filter((k) => Boolean(k.isUploadedPdf));
        });
      }
    });
    const unsubNotes = subscribeToNotes((cloudNotes) => {
      if (cloudNotes && cloudNotes.length > 0) {
        setNotes((prev) => {
          const map = new Map<string, HasyiyahNote>();
          prev.forEach((n) => map.set(n.id, n));
          cloudNotes.forEach((n) => map.set(n.id, n));
          return Array.from(map.values()).filter((n) => !n.id.startsWith('note-default-'));
        });
      }
    });
    return () => {
      unsubKitabs?.();
      unsubNotes?.();
    };
  }, []);
 
  // Library Filter & Search states
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'pdf' | 'bookmarked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [noteCategoryFilter, setNoteCategoryFilter] = useState<'all' | NoteCategory>('all');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [isScanningCatalogToc, setIsScanningCatalogToc] = useState(false);

  // Auto-enrich chapters for existing uploaded kitabs whenever a more complete fihris is available
  useEffect(() => {
    kitabs.forEach((k) => {
      if (k.isUploadedPdf) {
        detectOrGenerateKitabChapters(null, k.title, k.totalPages).then((detected) => {
          if (detected && detected.length > (k.chapters?.length || 0)) {
            setKitabs((prev) =>
              prev.map((item) => (item.id === k.id ? { ...item, chapters: detected } : item))
            );
          }
        });
      }
    });
  }, []);

  // One-time cleanup to ensure all legacy default non-uploaded books are permanently purged
  useEffect(() => {
    setKitabs((prev) => {
      const uploadedOnly = prev.filter((k) => Boolean(k.isUploadedPdf));
      if (uploadedOnly.length !== prev.length) {
        try {
          localStorage.setItem(STORAGE_KEY_KITABS, JSON.stringify(uploadedOnly));
        } catch {}
        return uploadedOnly;
      }
      return prev;
    });

    setNotes((prev) => {
      const cleanNotes = prev.filter((n) => !n.id.startsWith('note-default-'));
      if (cleanNotes.length !== prev.length) {
        try {
          localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(cleanNotes));
        } catch {}
        return cleanNotes;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    try {
      if (kitabs.length > 0) {
        // Prune large page data for local storage to stay under 5MB quota
        const prunedKitabs = kitabs.map(k => ({
          ...k,
          pages: (k.pages || []).map(p => ({
            ...p,
            paragraphs: (p.pageNumber || 0) <= 12 ? (p.paragraphs || []) : ['[Teks disederhanakan untuk penyimpanan lokal · Silakan baca visual PDF asli]']
          }))
        }));
        localStorage.setItem(STORAGE_KEY_KITABS, JSON.stringify(prunedKitabs));
      }
    } catch (e) {
      console.warn('LocalStorage quota warning:', e);
    }
  }, [kitabs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(notes));
    } catch {
      // ignore
    }
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Keep activeKitabId aligned with kitabs list
  useEffect(() => {
    if (kitabs.length > 0) {
      if (!kitabs.some((k) => k.id === activeKitabId)) {
        setActiveKitabId(kitabs[0].id);
        setCatalogKitabId(kitabs[0].id);
      }
    } else {
      setActiveKitabId('');
      setCatalogKitabId('');
    }
  }, [kitabs, activeKitabId]);

  // Always keep catalogKitabId aligned with the currently active book
  useEffect(() => {
    if (activeKitabId) {
      setCatalogKitabId(activeKitabId);
    }
  }, [activeKitabId]);

  // Auto-enrich any kitabs with missing, generic, or misassigned chapters
  useEffect(() => {
    kitabs.forEach(async (k) => {
      const isMissingOrGeneric =
        !k.chapters ||
        k.chapters.length <= 1 ||
        k.chapters.some(
          (c) =>
            c.title.toLowerCase().includes('fasal lanjutan') ||
            /fasal\s+\d+\s*·\s*halaman/i.test(c.title) ||
            /bagian\s+\d+\s*·\s*halaman/i.test(c.title) ||
            /muqaddimah\s+&\s+lembar\s+awal\s+naskah/i.test(c.title) ||
            (!k.title.toLowerCase().includes('fathul mu') &&
             !k.title.includes('معين') &&
             c.title.includes('Ash-Shalah / Fiqih Shalat'))
        );

      if (isMissingOrGeneric) {
        let loadedDoc: any = null;
        if (k.isUploadedPdf && k.pdfBlobKey) {
          try {
            const buf = await loadPdfArrayBuffer(k.pdfBlobKey);
            if (buf) {
              loadedDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
            }
          } catch (e) {
            console.warn('Could not load PDF buffer for chapter auto-enrich:', e);
          }
        }

        const detected = await detectOrGenerateKitabChapters(loadedDoc, k.title, k.totalPages);
        const detectedOffset = loadedDoc ? await detectPdfCoverOffset(loadedDoc) : 0;
        if (detected && detected.length > 0) {
          setKitabs((prev) =>
            prev.map((item) =>
              item.id === k.id
                ? {
                    ...item,
                    chapters: detected,
                    coverOffset: detectedOffset > 0 ? detectedOffset : item.coverOffset,
                  }
                : item
            )
          );
        }
      }
    });
  }, [kitabs.length]);

  const activeKitab = kitabs.find((k) => k.id === activeKitabId) || kitabs[0] || null;
  const catalogKitab = kitabs.find((k) => k.id === catalogKitabId) || activeKitab || null;

  const handleOpenKitabInReader = (kitabId: string, targetPage?: number) => {
    setActiveKitabId(kitabId);
    setCatalogKitabId(kitabId);
    if (targetPage !== undefined) {
      setKitabs((prev) =>
        prev.map((k) => (k.id === kitabId ? { ...k, lastReadPage: targetPage } : k))
      );
    }
    setActiveTab('reader');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageChange = (newPage: number) => {
    if (!activeKitab) return;
    setKitabs((prev) =>
      prev.map((k) =>
        k.id === activeKitab.id
          ? { ...k, lastReadPage: Math.min(Math.max(1, newPage), k.totalPages) }
          : k
      )
    );
  };

  const handleUpdateChapters = (kitabId: string, chapters: KitabDocument['chapters']) => {
    setKitabs((prev) => {
      const existing = prev.find((k) => k.id === kitabId);
      if (!existing) return prev;
      
      // Only write if chapters actually changed
      const isSame = JSON.stringify(existing.chapters) === JSON.stringify(chapters);
      if (isSame) return prev;

      const updated = { ...existing, chapters };
      saveKitabToFirestore(updated);
      return prev.map((k) => (k.id === kitabId ? updated : k));
    });
  };

  const handleToggleBookmark = (pageNumber: number) => {
    if (!activeKitab) return;
    setKitabs((prev) =>
      prev.map((k) => {
        if (k.id !== activeKitab.id) return k;
        const exists = k.bookmarks.includes(pageNumber);
        const nextBookmarks = exists
          ? k.bookmarks.filter((b) => b !== pageNumber)
          : [...k.bookmarks, pageNumber].sort((a, b) => a - b);
        return { ...k, bookmarks: nextBookmarks };
      })
    );
  };

  const handleAddNote = (noteInput: Omit<HasyiyahNote, 'id' | 'createdAt'>) => {
    const now = new Date();
    const formattedDate = now.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const formattedTime = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const newNote: HasyiyahNote = {
      ...noteInput,
      id: `note-${Date.now()}`,
      createdAt: `${formattedDate} · ${formattedTime}`,
    };
    setNotes((prev) => [newNote, ...prev]);
    saveNoteToFirestore(newNote);
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    deleteNoteFromFirestore(noteId);
  };

  const handleKitabCreated = (newKitab: KitabDocument) => {
    setKitabs((prev) => [newKitab, ...prev]);
    saveKitabToFirestore(newKitab);
    setActiveKitabId(newKitab.id);
    setCatalogKitabId(newKitab.id);
    setActiveTab('reader');
  };

  const handleUpdateKitab = (kitabId: string, partial: Partial<KitabDocument>) => {
    setKitabs((prev) => {
      const existing = prev.find((k) => k.id === kitabId);
      if (!existing) return prev;

      // Check if the partial update actually changes anything
      const isNoop = Object.entries(partial).every(
        ([key, value]) => JSON.stringify((existing as any)[key]) === JSON.stringify(value)
      );
      if (isNoop) return prev;

      const updated = { ...existing, ...partial };
      saveKitabToFirestore(updated);
      return prev.map((k) => (k.id === kitabId ? updated : k));
    });
  };

  const handleDeleteKitab = (kitabId: string) => {
    const filtered = kitabs.filter((k) => k.id !== kitabId);
    setKitabs(filtered);
    deleteKitabFromFirestore(kitabId);
    notes.filter((n) => n.kitabId === kitabId).forEach((n) => deleteNoteFromFirestore(n.id));
    setNotes((prev) => prev.filter((n) => n.kitabId !== kitabId));
    if (activeKitabId === kitabId) {
      setActiveKitabId(filtered[0]?.id || '');
    }
    if (catalogKitabId === kitabId) {
      setCatalogKitabId(filtered[0]?.id || '');
    }
  };

  const handleExportNotesMarkdown = () => {
    const lines = [
      '# Himpunan Catatan Hasyiyah — Pustaka Pribadi Tang Kitab',
      '',
      ...notes.map((n) => {
        const k = kitabs.find((item) => item.id === n.kitabId);
        return `## ${k?.title || 'Kitab'} (Halaman ${n.pageNumber} · ${n.category.toUpperCase()})\n${
          n.quotedText ? `> "${n.quotedText}"\n\n` : ''
        }${n.content}\n— *Dicatat pada ${n.createdAt}*\n`;
      }),
    ];
    navigator.clipboard?.writeText(lines.join('\n'));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const filteredKitabs = kitabs.filter((k) => {
    if (libraryFilter === 'pdf' && !k.isUploadedPdf) return false;
    if (libraryFilter === 'bookmarked' && k.bookmarks.length === 0) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        k.title.toLowerCase().includes(q) ||
        k.author.toLowerCase().includes(q) ||
        k.category.toLowerCase().includes(q) ||
        k.catalogNumber.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPagesAcrossLibrary = kitabs.reduce((acc, k) => acc + (k.totalPages || 0), 0);
  const totalBookmarks = kitabs.reduce((acc, k) => acc + (k.bookmarks?.length || 0), 0);

  if (!activePembaca) {
    return <ReaderSelector onSelect={handleSelectPembaca} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] text-[#1C1917]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-[#D6CEBE] bg-[#FBF9F5]/95 backdrop-blur-xs">
        {/* Zone 1: Brand Title (Single text element in display face) */}
        <a
          href="#pustaka"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('pustaka');
          }}
          className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#1C1917] whitespace-nowrap shrink-0"
        >
          Tang Ketab Pocket
        </a>

        {/* Zone 2: 4 Clean Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#57534E]">
          <button
            type="button"
            onClick={() => setActiveTab('pustaka')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'pustaka'
                ? 'text-[#1C1917] border-b-2 border-[#78350F] font-semibold'
                : 'hover:text-[#1C1917]'
            }`}
          >
            Pustaka Kitab
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reader')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'reader'
                ? 'text-[#1C1917] border-b-2 border-[#78350F] font-semibold'
                : 'hover:text-[#1C1917]'
            }`}
          >
            Meja Baca PocketBook
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hasyiyah')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'hasyiyah'
                ? 'text-[#1C1917] border-b-2 border-[#78350F] font-semibold'
                : 'hover:text-[#1C1917]'
            }`}
          >
            Catatan Hasyiyah
          </button>
          <button
            type="button"
            onClick={() => {
              setCatalogKitabId(activeKitabId);
              setActiveTab('katalog');
            }}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'katalog'
                ? 'text-[#1C1917] border-b-2 border-[#78350F] font-semibold'
                : 'hover:text-[#1C1917]'
            }`}
          >
            Katalog Naskah
          </button>
        </nav>

        {/* Zone 3: Primary Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setActivePembaca(null);
            }}
            className="px-3 py-1.5 text-xs font-medium text-[#78350F] bg-[#D6CEBE]/40 hover:bg-[#D6CEBE]/60 transition-colors rounded-xs whitespace-nowrap cursor-pointer"
          >
            Ganti Peran (Keluar)
          </button>

          {activePembaca === 'admin' && (
            <>
              <button
                type="button"
                onClick={() => {
                  const data = JSON.stringify({ kitabs, notes });
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `tang-ketab-backup-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 text-xs font-medium text-[#78350F] bg-[#D6CEBE]/20 hover:bg-[#D6CEBE]/40 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Backup Data</span>
              </button>
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Masukkan PDF Kitab</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Mobile Navigation Strip (for small screens) */}
      <div className="flex md:hidden items-center justify-around border-b border-[#E5DEC9] bg-[#F7F4EE] px-2 py-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('pustaka')}
          className={`px-2.5 py-1 whitespace-nowrap ${
            activeTab === 'pustaka' ? 'font-semibold text-[#78350F] underline' : 'text-[#57534E]'
          }`}
        >
          Pustaka
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reader')}
          className={`px-2.5 py-1 whitespace-nowrap ${
            activeTab === 'reader' ? 'font-semibold text-[#78350F] underline' : 'text-[#57534E]'
          }`}
        >
          PocketBook
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('hasyiyah')}
          className={`px-2.5 py-1 whitespace-nowrap ${
            activeTab === 'hasyiyah' ? 'font-semibold text-[#78350F] underline' : 'text-[#57534E]'
          }`}
        >
          Hasyiyah
        </button>
        <button
          type="button"
          onClick={() => {
            setCatalogKitabId(activeKitabId);
            setActiveTab('katalog');
          }}
          className={`px-2.5 py-1 whitespace-nowrap ${
            activeTab === 'katalog' ? 'font-semibold text-[#78350F] underline' : 'text-[#57534E]'
          }`}
        >
          Katalog
        </button>
      </div>

      <main className="flex-1">
        {activeTab === 'pustaka' && (
          <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-12">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#D6CEBE] text-xs text-[#57534E]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[#1C1917]">Maktabah Pribadi Tang Kitab</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{kitabs.length} Jilid Kitab Tersimpan</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{totalPagesAcrossLibrary} Lembar Halaman</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{notes.length} Catatan Hasyiyah</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{totalBookmarks} Pita Penanda</span>
              </div>
              <div className="text-xs text-[#78350F]">
                Mode Baca: {settings.spreadMode === 'double' ? 'Lembaran Ganda' : '1 Halaman'}
              </div>
            </div>

            {activeKitab ? (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-10 bg-[#F7F4EE] border border-[#D6CEBE]">
                  <div className="space-y-4">
                    <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                      Naskah Induk & Pembaca PDF PocketBook
                    </p>
                    <h1 className="text-3xl sm:text-5xl font-display font-semibold text-[#1C1917] leading-[1.12] text-balance">
                      {activeKitab.title}
                    </h1>
                    <p className="text-base text-[#44403C] leading-relaxed max-w-[64ch]">
                      {activeKitab.subtitle || 'Dokumen PDF pribadi Anda yang disajikan rapi dalam format lembaran buku saku PocketBook.'}
                    </p>
                  </div>

                  <div className="pt-8 mt-8 border-t border-[#E2DCD0] flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleOpenKitabInReader(activeKitab.id)}
                      className="px-5 py-3 text-xs font-medium text-white bg-[#1C1917] hover:bg-[#332E2A] transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>
                        Lanjutkan Membaca: {activeKitab.title.split(':')[0]} (Hal. {activeKitab.lastReadPage} / {activeKitab.totalPages})
                      </span>
                    </button>

                    {activePembaca === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsUploadModalOpen(true)}
                        className="px-4 py-3 text-xs font-medium text-[#78350F] border border-[#78350F] bg-[#FBF9F5] hover:bg-[#78350F] hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap"
                      >
                        <Upload className="w-4 h-4" />
                        <span>Unggah PDF Kitab Baru</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-5 relative min-h-[340px] border border-[#D6CEBE] bg-[#1C1917] overflow-hidden flex flex-col justify-end">
                  <img
                    src={archivalDeskImg}
                    alt="Meja baca kitab klasik Tang Ketab dengan pencahayaan alami"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover opacity-85"
                  />
                  <div className="relative z-10 p-6 sm:p-8 bg-gradient-to-t from-black/90 via-black/55 to-transparent text-[#FBF9F5] space-y-2">
                    <div className="flex items-center gap-2 text-xs text-[#D6CEBE] font-mono-tabular">
                      <span>{activeKitab.catalogNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeKitab.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Hal. {activeKitab.lastReadPage} / {activeKitab.totalPages}
                      </span>
                    </div>
                    <h2 className="text-2xl font-display font-semibold text-white text-balance">
                      {activeKitab.title}
                    </h2>
                    <p className="text-xs text-[#E7E2DA] line-clamp-2">
                      {activeKitab.subtitle}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <section className="p-8 sm:p-12 bg-[#F7F4EE] border border-[#D6CEBE] text-center max-w-2xl mx-auto space-y-5">
                <div className="w-14 h-14 mx-auto rounded-full bg-[#78350F]/10 flex items-center justify-center text-[#78350F]">
                  <BookOpen className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                    Maktabah Pribadi Bersih & Siap Digunakan
                  </p>
                  <h1 className="text-2xl sm:text-4xl font-display font-semibold text-[#1C1917]">
                    Koleksi Khusus Kitab PDF Anda
                  </h1>
                  <p className="text-sm text-[#57534E] leading-relaxed max-w-lg mx-auto">
                    Hanya kitab PDF yang Anda unggah yang akan disimpan dan ditampilkan di sini. Tidak ada kitab bawaan atau contoh yang tercampur.
                  </p>
                </div>
                {activePembaca === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setIsUploadModalOpen(true)}
                    className="px-6 py-3.5 text-xs font-semibold text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors inline-flex items-center gap-2 shadow-xs"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Unggah Berkas PDF Kitab Sekarang</span>
                  </button>
                )}
              </section>
            )}

            <section className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#D6CEBE]">
                <div>
                  <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                    Rak Buku Saku Digital
                  </p>
                  <h2 className="text-3xl font-display font-semibold text-[#1C1917] mt-1">
                    Koleksi Kitab Pribadi & Dokumen PDF
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 p-1 bg-[#EBE6DF] border border-[#D6CEBE]">
                    <button
                      type="button"
                      onClick={() => setLibraryFilter('all')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        libraryFilter === 'all'
                          ? 'bg-[#FBF9F5] text-[#1C1917] shadow-2xs'
                          : 'text-[#57534E] hover:text-[#1C1917]'
                      }`}
                    >
                      Semua Kitab ({kitabs.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLibraryFilter('pdf')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        libraryFilter === 'pdf'
                          ? 'bg-[#FBF9F5] text-[#1C1917] shadow-2xs'
                          : 'text-[#57534E] hover:text-[#1C1917]'
                      }`}
                    >
                      PDF Terunggah ({kitabs.filter((k) => k.isUploadedPdf).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLibraryFilter('bookmarked')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        libraryFilter === 'bookmarked'
                          ? 'bg-[#FBF9F5] text-[#1C1917] shadow-2xs'
                          : 'text-[#57534E] hover:text-[#1C1917]'
                      }`}
                    >
                      Berpenanda ({kitabs.filter((k) => k.bookmarks.length > 0).length})
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#78716C] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari judul atau kode..."
                      className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredKitabs.map((item) => {
                  const tone = COVER_TONE_CLASSES[item.coverTone];
                  const progressPct = Math.round(
                    (item.lastReadPage / Math.max(1, item.totalPages)) * 100
                  );
                  const kitabNotesCount = notes.filter((n) => n.kitabId === item.id).length;

                  return (
                    <article
                      key={item.id}
                      className="flex flex-col justify-between bg-[#F7F4EE] border border-[#D6CEBE] p-6 transition-colors hover:border-[#78350F]"
                    >
                      <div>
                        <div className="flex gap-5 mb-5">
                          <div
                            onClick={() => handleOpenKitabInReader(item.id)}
                            className={`cursor-pointer relative w-24 h-34 shrink-0 ${tone.bg} border ${tone.border} shadow-md flex overflow-hidden group`}
                          >
                            <img
                              src={kitabCoverImg}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 w-full h-full object-cover mix-blend-Soft-Light opacity-35"
                            />
                            <div className={`w-2.5 h-full ${tone.spine} shrink-0`} />
                            <div className="p-2.5 flex flex-col justify-between text-[#FBF9F5] relative z-10 w-full">
                              <span className="text-[9px] font-mono-tabular tracking-widest opacity-80">
                                {item.catalogNumber}
                              </span>
                              <p className="text-xs font-display font-semibold leading-tight line-clamp-3 text-balance">
                                {item.title}
                              </p>
                              <span className="text-[9px] opacity-75 truncate">
                                {item.totalPages} Hal.
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#78350F]">
                              <span className="font-mono-tabular">{item.catalogNumber}</span>
                              <span aria-hidden="true">·</span>
                              <span>{item.category}</span>
                              {item.isUploadedPdf && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-semibold">PDF PocketBook</span>
                                </>
                              )}
                            </div>

                            <h3
                              onClick={() => handleOpenKitabInReader(item.id)}
                              className="cursor-pointer text-xl font-display font-semibold text-[#1C1917] hover:text-[#78350F] transition-colors leading-snug"
                            >
                              {item.title}
                            </h3>

                            <p className="text-xs text-[#57534E]">{item.author}</p>

                            <p className="text-xs text-[#44403C] line-clamp-2 pt-1">
                              {item.subtitle}
                            </p>
                          </div>
                        </div>

                        <div className="py-3 border-y border-[#E5DEC9] flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E] font-mono-tabular">
                          <div>
                            <span>
                              Bacaan: Hal. {item.lastReadPage}/{item.totalPages} ({progressPct}%)
                            </span>
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <span>{kitabNotesCount} Hasyiyah</span>
                          </div>
                          {(item.bookmarks?.length || 0) > 0 && (
                            <span className="text-[#9A3412] flex items-center gap-1">
                              <Bookmark className="w-3 h-3 fill-[#9A3412]" />
                              Hal. {item.bookmarks.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 mt-4 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenKitabInReader(item.id)}
                          className="px-4 py-2 text-xs font-medium text-white bg-[#1C1917] hover:bg-[#78350F] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>Buka PocketBook</span>
                        </button>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setCatalogKitabId(item.id);
                              setActiveTab('katalog');
                            }}
                            className="text-xs text-[#57534E] hover:text-[#1C1917] underline whitespace-nowrap"
                          >
                            Rincian Katalog
                          </button>

                          {activePembaca === 'admin' && item.isUploadedPdf && (
                            <button
                              type="button"
                              onClick={() => handleDeleteKitab(item.id)}
                              className="p-1.5 text-[#78716C] hover:text-[#9A3412] transition-colors"
                              title="Hapus kitab PDF ini dari rak"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}

                {activePembaca === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setIsUploadModalOpen(true)}
                    className="min-h-[260px] border border-dashed border-[#C7B299] bg-[#F7F4EE]/50 hover:bg-[#F3EFE6] hover:border-[#78350F] p-6 flex flex-col items-center justify-center text-center gap-3 transition-colors animate-fade-in"
                  >
                    <Upload className="w-7 h-7 text-[#78350F]" />
                    <div>
                      <p className="text-lg font-display font-semibold text-[#1C1917]">
                        + Tambahkan PDF Kitab Baru
                      </p>
                      <p className="text-xs text-[#57534E] max-w-xs mt-1">
                        Pilih berkas PDF kitab dari perangkat Anda untuk diubah menjadi format buku saku PocketBook.
                      </p>
                    </div>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'reader' && (
          activeKitab ? (
            <PocketBookReader
              key={activeKitab.id}
              kitab={activeKitab}
              notes={notes}
              settings={settings}
              onUpdateSettings={(partial) =>
                setSettings((prev) => ({ ...prev, ...partial }))
              }
              onPageChange={handlePageChange}
              onUpdateChapters={handleUpdateChapters}
              onUpdateKitab={handleUpdateKitab}
              onToggleBookmark={handleToggleBookmark}
              onAddNote={handleAddNote}
              onDeleteNote={handleDeleteNote}
              onOpenUploadModal={activePembaca === 'admin' ? () => setIsUploadModalOpen(true) : undefined}
              onBackToLibrary={() => setActiveTab('pustaka')}
            />
          ) : (
            <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
              <div className="w-14 h-14 mx-auto rounded-full bg-[#78350F]/10 flex items-center justify-center text-[#78350F]">
                <BookOpen className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-display font-semibold text-[#1C1917]">
                Belum Ada Kitab yang Terpilih
              </h2>
              <p className="text-sm text-[#57534E] leading-relaxed">
                Silakan unggah berkas PDF kitab Anda untuk langsung membaca dalam format PocketBook dengan lembaran ganda dan tampilan kertas klasik turats.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(true)}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors flex items-center gap-2 shadow-xs"
                >
                  <Upload className="w-4 h-4" />
                  <span>Unggah Berkas PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('pustaka')}
                  className="px-5 py-2.5 text-xs font-medium border border-[#D6CEBE] bg-[#F7F4EE] hover:bg-[#EBE6DF] text-[#1C1917]"
                >
                  Kembali ke Maktabah
                </button>
              </div>
            </div>
          )
        )}

        {activeTab === 'hasyiyah' && (
          <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[#D6CEBE]">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                  Buku Induk Ta’liq & Syarah Pribadi
                </p>
                <h1 className="text-3xl sm:text-4xl font-display font-semibold text-[#1C1917] mt-1">
                  Arsip Catatan Hasyiyah
                </h1>
              </div>

              <button
                type="button"
                onClick={handleExportNotesMarkdown}
                className="px-4 py-2 text-xs font-medium border border-[#D6CEBE] bg-[#F7F4EE] hover:bg-[#EBE6DF] text-[#1C1917] transition-colors flex items-center gap-2 self-start sm:self-auto whitespace-nowrap"
              >
                {copiedSummary ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#14532D]" />
                    <span>Catatan Disalin ke Papan Klip</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Salin Ringkasan Catatan (Markdown)</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'all', label: 'Semua Catatan' },
                  { id: 'syarah', label: 'Syarah & Uraian' },
                  { id: 'makna', label: 'Makna & Mufradat' },
                  { id: 'dalil', label: 'Dalil & Rujukan' },
                  { id: 'muzakarah', label: 'Pertanyaan Muzakarah' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setNoteCategoryFilter(tab.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap ${
                    noteCategoryFilter === tab.id
                      ? 'border-[#1C1917] bg-[#1C1917] text-white'
                      : 'border-[#D6CEBE] bg-[#F7F4EE] text-[#57534E] hover:text-[#1C1917]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {notes
                .filter(
                  (n) => noteCategoryFilter === 'all' || n.category === noteCategoryFilter
                )
                .map((note) => {
                  const parentKitab = kitabs.find((k) => k.id === note.kitabId);
                  return (
                    <article
                      key={note.id}
                      className="p-6 bg-[#F7F4EE] border border-[#D6CEBE] space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E] pb-2 border-b border-[#E5DEC9]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#1C1917]">
                            {parentKitab?.title || 'Kitab Pribadi'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular text-[#78350F]">
                            Halaman {note.pageNumber}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="uppercase tracking-wider">{note.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">{note.createdAt}</span>
                        </div>

                        <div className="flex items-center gap-3">
                          {parentKitab && (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenKitabInReader(parentKitab.id, note.pageNumber)
                              }
                              className="text-xs font-medium text-[#78350F] hover:underline flex items-center gap-1"
                            >
                              <span>Buka Lembar Ini</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-[#78716C] hover:text-[#9A3412]"
                            title="Hapus catatan"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {note.quotedText && (
                        <blockquote className="pl-4 border-l-2 border-[#78350F] text-sm italic text-[#44403C]">
                          “{note.quotedText}”
                        </blockquote>
                      )}

                      <p className="text-base text-[#1C1917] leading-relaxed max-w-[72ch]">
                        {note.content}
                      </p>
                    </article>
                  );
                })}
            </div>
          </div>
        )}

        {activeTab === 'katalog' && (
          catalogKitab ? (
            <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-8 space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[#D6CEBE]">
                <div>
                  <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                    Lembar Katalog & Identitas Filologi
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-display font-semibold text-[#1C1917] mt-1">
                    Arsip Katalog Tang Ketab
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {catalogKitab.id === activeKitab?.id && (
                    <span className="px-2.5 py-1 text-xs bg-[#78350F]/10 text-[#78350F] font-semibold border border-[#78350F]/30 flex items-center gap-1.5 shadow-xs">
                      <span className="w-2 h-2 rounded-full bg-[#78350F] animate-pulse" />
                      Naskah yang Sedang Dibuka Saat Ini
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#57534E]">Pilih Kitab:</label>
                    <select
                      value={catalogKitab.id}
                      onChange={(e) => setCatalogKitabId(e.target.value)}
                      className="px-3 py-2 text-xs bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
                    >
                      {kitabs.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.catalogNumber} — {k.title} {k.id === activeKitab?.id ? '(Sedang Dibuka)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5 p-8 bg-[#F7F4EE] border border-[#D6CEBE] flex flex-col items-center text-center space-y-5">
                <div
                  className={`w-48 h-64 ${
                    COVER_TONE_CLASSES[catalogKitab.coverTone].bg
                  } border-2 ${
                    COVER_TONE_CLASSES[catalogKitab.coverTone].border
                  } shadow-xl p-5 flex flex-col justify-between text-[#FBF9F5] relative overflow-hidden`}
                >
                  <img
                    src={kitabCoverImg}
                    alt={catalogKitab.title}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover mix-blend-Soft-Light opacity-35"
                  />
                  <div className="relative z-10 border border-[#D6CEBE]/30 h-full p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-mono-tabular tracking-widest uppercase">
                      {catalogKitab.catalogNumber}
                    </span>
                    <div className="space-y-1">
                      <h3 className="text-lg font-display font-semibold leading-snug">
                        {catalogKitab.title}
                      </h3>
                      <p className="text-[10px] opacity-80">{catalogKitab.author}</p>
                    </div>
                    <span className="text-[10px] font-mono-tabular opacity-80">
                      TANG KETAB ARCHIVE
                    </span>
                  </div>
                </div>

                <p className="text-xs font-serif italic text-[#57534E]">
                  Fig. 1 — Representasi jilid pustaka {catalogKitab.catalogNumber} ({COVER_TONE_CLASSES[catalogKitab.coverTone].label}).
                </p>

                <button
                  type="button"
                  onClick={() => handleOpenKitabInReader(catalogKitab.id)}
                  className="w-full py-2.5 px-4 text-xs font-medium text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors flex items-center justify-center gap-2"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Buka Naskah di Meja Baca PocketBook</span>
                </button>
              </div>

              <div className="lg:col-span-7 bg-[#F7F4EE] border border-[#D6CEBE] p-6 sm:p-8 space-y-6">
                <dl className="divide-y divide-[#E2DCD0] text-sm">
                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Nomor Aksesi Katalog
                    </dt>
                    <dd className="sm:col-span-2 font-mono-tabular font-semibold text-[#1C1917]">
                      {catalogKitab.catalogNumber}
                    </dd>
                  </div>

                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Judul Naskah Kitab
                    </dt>
                    <dd className="sm:col-span-2 font-semibold text-[#1C1917] text-balance">
                      {catalogKitab.title}
                    </dd>
                  </div>

                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Mushannif / Penyusun
                    </dt>
                    <dd className="sm:col-span-2 text-[#1C1917]">{catalogKitab.author}</dd>
                  </div>

                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Bidang Keilmuan
                    </dt>
                    <dd className="sm:col-span-2 text-[#1C1917]">{catalogKitab.category}</dd>
                  </div>

                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Format & Sumber
                    </dt>
                    <dd className="sm:col-span-2 text-[#1C1917] font-mono-tabular">
                      {catalogKitab.fileSizeLabel || 'Naskah Digital PocketBook'} · {catalogKitab.totalPages} Lembar Halaman
                    </dd>
                  </div>

                  <div className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <dt className="text-xs uppercase tracking-widest text-[#57534E] font-sans">
                      Riwayat Penyimpanan
                    </dt>
                    <dd className="sm:col-span-2 text-[#1C1917]">
                      Dimasukkan pada {catalogKitab.addedAt} · Terakhir ditelaah pada Halaman {catalogKitab.lastReadPage}
                    </dd>
                  </div>
                </dl>

                <div className="pt-4 border-t border-[#D6CEBE]">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
                      Struktur Bab & Fihris Halaman ({catalogKitab.chapters.length} Bab)
                    </h3>
                    {catalogKitab.isUploadedPdf && catalogKitab.pdfBlobKey && (
                      <button
                        type="button"
                        disabled={isScanningCatalogToc}
                        onClick={async () => {
                          setIsScanningCatalogToc(true);
                          try {
                            const buf = await loadPdfArrayBuffer(catalogKitab.pdfBlobKey!);
                            if (buf) {
                              const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
                              const detected = await detectOrGenerateKitabChapters(
                                doc,
                                catalogKitab.title,
                                catalogKitab.totalPages
                              );
                              if (detected && detected.length > 0) {
                                handleUpdateChapters(catalogKitab.id, detected);
                              }
                            }
                          } catch (err) {
                            console.error('Error scanning PDF chapters in catalog:', err);
                          } finally {
                            setIsScanningCatalogToc(false);
                          }
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-[#78350F] bg-[#F3EFE6] border border-[#78350F]/40 hover:bg-[#78350F] hover:text-white transition-colors flex items-center gap-1.5 shadow-2xs"
                        title="Pindai ulang dan ekstrak daftar isi langsung dari PDF kitab ini"
                      >
                        <RotateCw className={`w-3 h-3 ${isScanningCatalogToc ? 'animate-spin' : ''}`} />
                        <span>{isScanningCatalogToc ? 'Memindai PDF...' : 'Pindai Otomatis Fihris PDF Ini'}</span>
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {catalogKitab.chapters.length === 0 ? (
                      <div className="p-4 text-center bg-[#FBF9F5] border border-[#E2DCD0] text-xs text-[#57534E]">
                        <p>Bab belum terdaftar untuk kitab ini.</p>
                        <button
                          type="button"
                          onClick={() => handleOpenKitabInReader(catalogKitab.id)}
                          className="mt-2 text-xs font-semibold text-[#78350F] hover:underline inline-block"
                        >
                          Buka di Meja Baca untuk Deteksi Bab Otomatis →
                        </button>
                      </div>
                    ) : (
                      catalogKitab.chapters.map((ch) => {
                        const pureArabic = extractArabicTitleOnly(ch.title);
                        return (
                          <div
                            key={ch.id}
                            className="flex items-center justify-between py-2.5 px-3.5 bg-[#FBF9F5] border border-[#E2DCD0] text-xs"
                          >
                            <span className="font-arabic font-medium text-[#1C1917] text-sm text-right flex-1" dir="rtl">
                              {pureArabic}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenKitabInReader(catalogKitab.id, ch.startPage)
                              }
                              className="font-mono-tabular text-[#78350F] hover:underline shrink-0 ml-4 text-xs font-semibold"
                            >
                              ص {ch.startPage} →
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
            <div className="w-14 h-14 mx-auto rounded-full bg-[#78350F]/10 flex items-center justify-center text-[#78350F]">
              <BookOpen className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-display font-semibold text-[#1C1917]">
              Katalog Naskah Masih Kosong
            </h2>
            <p className="text-sm text-[#57534E]">
              Setelah Anda mengunggah naskah PDF kitab, struktur bab, fihris halaman, dan identitas filologi akan ditampilkan di sini.
            </p>
            {activePembaca === 'admin' && (
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(true)}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors inline-flex items-center gap-2 shadow-xs"
              >
                <Upload className="w-4 h-4" />
                <span>Unggah Berkas PDF Sekarang</span>
              </button>
            )}
          </div>
        ))}
      </main>

      <footer className="mt-16 border-t border-[#D6CEBE] bg-[#F7F4EE] py-6 px-4 sm:px-8">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#57534E]">
          <div>
            <span className="font-display font-semibold text-sm text-[#1C1917]">
              Tang Ketab Pocket
            </span>{' '}
            · Pustaka Kitab Pribadi & Pembaca PDF Model PocketBook
          </div>
          <div className="flex items-center gap-4">
            {activePembaca === 'admin' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(true)}
                  className="hover:text-[#1C1917] underline"
                >
                  Unggah PDF Kitab
                </button>
                <span aria-hidden="true">·</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('reader')}
              className="hover:text-[#1C1917] underline"
            >
              Meja Baca PocketBook
            </button>
          </div>
        </div>
      </footer>

      <PdfUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onKitabCreated={handleKitabCreated}
      />
    </div>
  );
}

export default App;

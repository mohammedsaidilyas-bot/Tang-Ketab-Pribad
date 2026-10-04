import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { KitabChapter, KitabDocument, KitabPage } from '../types/kitab';
import { uploadPdfToStorage } from '../services/firebaseService';

// Configure PDF.js worker using local Vite asset URL with CDN fallback
const version = '4.10.38';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl || `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

const DB_NAME = 'tang_ketab_storage_v1';
const STORE_NAME = 'pdf_blobs';

function openPdfDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const inMemoryPdfCache = new Map<string, ArrayBuffer>();
export const globalPdfDocCache = new Map<string, any>();

export async function savePdfArrayBuffer(key: string, buffer: ArrayBuffer): Promise<void> {
  // Guarantee instant memory availability
  inMemoryPdfCache.set(key, buffer);
  try {
    const db = await openPdfDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(buffer, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // Non-fatal, memory fallback is already in place
    });
  } catch (err) {
    console.warn('IndexedDB storage fallback to in-memory:', err);
  }
}

export async function loadPdfArrayBuffer(key: string): Promise<ArrayBuffer | null> {
  if (inMemoryPdfCache.has(key)) {
    return inMemoryPdfCache.get(key) || null;
  }
  try {
    const db = await openPdfDatabase();
    const result = await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (result) {
      inMemoryPdfCache.set(key, result);
    }
    return result;
  } catch {
    return inMemoryPdfCache.get(key) || null;
  }
}

export async function getOrLoadPdfDoc(blobKey?: string, urlOrRawBuffer?: string | ArrayBuffer): Promise<any> {
  const cacheKey = blobKey || (typeof urlOrRawBuffer === 'string' ? urlOrRawBuffer : '');
  if (cacheKey && globalPdfDocCache.has(cacheKey)) {
    return globalPdfDocCache.get(cacheKey);
  }

  let buffer: ArrayBuffer | undefined = typeof urlOrRawBuffer === 'object' ? urlOrRawBuffer : undefined;

  if (!buffer && blobKey) {
    buffer = (await loadPdfArrayBuffer(blobKey)) || undefined;
  }

  if (!buffer && typeof urlOrRawBuffer === 'string' && urlOrRawBuffer) {
    try {
      console.log('Attempting to fetch PDF from URL:', urlOrRawBuffer);
      const resp = await fetch(urlOrRawBuffer, {
        mode: 'cors',
        credentials: 'omit',
      });
      if (resp.ok) {
        buffer = await resp.arrayBuffer();
        if (blobKey) {
          await savePdfArrayBuffer(blobKey, buffer);
        }
      } else {
        console.warn(`Fetch PDF failed with status: ${resp.status} ${resp.statusText}`);
      }
    } catch (err) {
      console.error('Error fetching PDF from URL (likely CORS or network):', urlOrRawBuffer, err);
      // We don't throw here to allow caller to handle null doc
    }
  }

  if (!buffer) return null;

  try {
    const task = createPdfLoadingTask(new Uint8Array(buffer));
    const doc = await task.promise;
    if (cacheKey) {
      globalPdfDocCache.set(cacheKey, doc);
    }
    return doc;
  } catch (err) {
    console.warn('Failed to load PDF doc into global cache:', err);
    return null;
  }
}

/**
 * Trims leading bytes if the file doesn't start directly at %PDF-
 * (e.g. UTF-8 BOM, HTTP wrappers, or downloaded bytes from web portals)
 */
export function sanitizePdfBytes(data: Uint8Array): Uint8Array {
  // Find '%PDF-' header (0x25, 0x50, 0x44, 0x46, 0x2D)
  for (let i = 0; i < Math.min(data.length - 4, 4096); i++) {
    if (
      data[i] === 0x25 &&
      data[i + 1] === 0x50 &&
      data[i + 2] === 0x44 &&
      data[i + 3] === 0x46 &&
      data[i + 4] === 0x2d
    ) {
      if (i > 0) {
        return data.subarray(i);
      }
      return data;
    }
  }
  return data;
}

/**
 * Checks if the PDF contains an /Encrypt dictionary.
 * If not, the PDF is fundamentally unencrypted and CANNOT require a password!
 */
export function pdfHasEncryptTag(data: Uint8Array): boolean {
  try {
    const scanLen = Math.min(data.length, 300000);
    const sub = data.subarray(Math.max(0, data.length - scanLen));
    const text = new TextDecoder('latin1').decode(sub);
    return /\/Encrypt\b/i.test(text);
  } catch {
    return false;
  }
}

/**
 * Creates a robust PDF.js loading task with CMap support, standard fonts,
 * and automatic blank-password resolution.
 */
export function createPdfLoadingTask(rawData: Uint8Array, password?: string) {
  const data = sanitizePdfBytes(rawData);
  const version = pdfjsLib.version || '4.10.38';
  const effectivePassword = password ?? '';

  const params: any = {
    data,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/standard_fonts/`,
    enableXfa: false,
    useSystemFonts: true,
    stopAtErrors: false,
    isEvalSupported: false,
    password: effectivePassword,
  };

  const loadingTask = pdfjsLib.getDocument(params);
  let attempt = 0;
  loadingTask.onPassword = (callback: (pwd: string) => void, reason: number) => {
    attempt++;
    if (attempt <= 1) {
      callback(effectivePassword);
    } else if (password && attempt <= 2) {
      callback(password);
    } else {
      callback('');
    }
  };

  return loadingTask;
}

export interface PdfConversionOptions {
  customTitle?: string;
  customSubtitle?: string;
  customAuthor?: string;
  customCategory?: string;
  coverTone?: KitabDocument['coverTone'];
  password?: string;
  onProgress?: (currentPage: number, totalPages: number) => void;
}

/**
 * Resolves a PDF destination to a 1-based page number.
 */
async function resolvePdfDestinationPage(dest: any, pdfDoc: any): Promise<number | null> {
  if (!dest) return null;
  let resolved = dest;
  if (typeof dest === 'string') {
    try {
      resolved = await pdfDoc.getDestination(dest);
    } catch {
      return null;
    }
  }
  if (!resolved) return null;

  if (typeof resolved === 'number') {
    return Math.min(pdfDoc.numPages, Math.max(1, resolved + 1));
  }

  if (Array.isArray(resolved) && resolved.length > 0) {
    const target = resolved[0];
    if (typeof target === 'number') {
      return Math.min(pdfDoc.numPages, Math.max(1, target + 1));
    }
    if (target && typeof target === 'object') {
      try {
        const pageIdx = await pdfDoc.getPageIndex(target);
        if (typeof pageIdx === 'number' && pageIdx >= 0) {
          return Math.min(pdfDoc.numPages, pageIdx + 1);
        }
      } catch {
        // Fallback: check if target has num property matching page ref
        if ('num' in target && typeof target.num === 'number') {
          for (let p = 1; p <= Math.min(pdfDoc.numPages, 1000); p++) {
            try {
              const page = await pdfDoc.getPage(p);
              if (page?.ref && page.ref.num === target.num) {
                return p;
              }
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Extracts embedded PDF Bookmarks / Outline (Table of Contents) from a pdfDoc instance
 */
export async function extractChaptersFromPdfDoc(pdfDoc: any): Promise<KitabChapter[]> {
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || !Array.isArray(outline) || outline.length === 0) {
      return [];
    }

    const chapters: KitabChapter[] = [];

    async function processItems(items: any[]) {
      for (const item of items) {
        if (!item || !item.title) continue;
        const startPage = await resolvePdfDestinationPage(item.dest, pdfDoc);
        const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
        if (cleanTitle && startPage && startPage >= 1 && startPage <= pdfDoc.numPages) {
          chapters.push({
            id: `ch-outline-${startPage}-${Math.random().toString(36).slice(2, 6)}`,
            number: String(chapters.length + 1).padStart(2, '0'),
            title: cleanTitle,
            startPage,
          });
        }

        if (Array.isArray(item.items) && item.items.length > 0) {
          await processItems(item.items);
        }
      }
    }

    await processItems(outline);

    // Sort by start page ascending
    chapters.sort((a, b) => a.startPage - b.startPage);

    // Deduplicate identical title & startPage
    const uniqueChapters: KitabChapter[] = [];
    for (const ch of chapters) {
      if (!uniqueChapters.some((u) => u.startPage === ch.startPage && u.title === ch.title)) {
        uniqueChapters.push({
          ...ch,
          number: String(uniqueChapters.length + 1).padStart(2, '0'),
        });
      }
    }

    return uniqueChapters;
  } catch (err) {
    console.warn('Error extracting outline from PDF:', err);
    return [];
  }
}

/**
 * Utility to strip Arabic diacritics / tashkeel for robust regex matching
 */
export function stripArabicTashkeel(text: string): string {
  if (!text) return '';
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '');
}

/**
 * Utility to convert Eastern Arabic digits (٠١٢٣٤٥٦٧٨٩) to standard number
 */
export function parseEasternArabicNumber(str: string): number | null {
  const easternDigits: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  const converted = str.replace(/[٠-٩]/g, (d) => easternDigits[d] || d);
  const match = converted.match(/\d+/);
  if (!match) return null;
  const parsed = parseInt(match[0], 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Scans printed Fihris / Table of Contents pages in the PDF
 */
async function scanPrintedFihrisPages(pdfDoc: any): Promise<KitabChapter[]> {
  try {
    const numPages = pdfDoc.numPages;
    const candidatePages: number[] = [];

    // For books up to 80 pages, scan all pages; for larger books, check beginning and end
    if (numPages <= 80) {
      for (let p = 1; p <= numPages; p++) candidatePages.push(p);
    } else {
      for (let p = 1; p <= Math.min(35, numPages); p++) candidatePages.push(p);
      for (let p = Math.max(36, numPages - 60); p <= numPages; p++) {
        if (!candidatePages.includes(p)) candidatePages.push(p);
      }
    }

    const fihrisChapters: KitabChapter[] = [];

    for (const pageNum of candidatePages) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      if (!textContent.items || textContent.items.length === 0) continue;

      // Group into lines by Y coordinate
      const lineBuckets: { y: number; text: string }[] = [];
      for (const item of textContent.items) {
        if ('str' in item && item.str.trim().length > 0) {
          const y = Math.round(item.transform[5]);
          const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 6);
          if (existing) {
            existing.text += (existing.text.endsWith(' ') ? '' : ' ') + item.str;
          } else {
            lineBuckets.push({ y, text: item.str });
          }
        }
      }
      lineBuckets.sort((a, b) => b.y - a.y);
      const lines = lineBuckets.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const fullPageText = stripArabicTashkeel(lines.join(' ')).toLowerCase();

      const isFihrisPage =
        fullPageText.includes('فهرس') ||
        fullPageText.includes('الفهرس') ||
        fullPageText.includes('فهرست') ||
        fullPageText.includes('المحتويات') ||
        fullPageText.includes('محتويات') ||
        fullPageText.includes('جدول المحتويات') ||
        fullPageText.includes('جدول الموضوعات') ||
        fullPageText.includes('daftar isi') ||
        fullPageText.includes('table of contents') ||
        lines.filter((l) => /[0-9٠-٩]+/.test(l) && (l.includes('فصل') || l.includes('باب') || l.includes('كتاب') || l.includes('مسألة'))).length >= 3;

      if (isFihrisPage) {
        for (const rawLine of lines) {
          const cleanLine = stripArabicTashkeel(rawLine);
          // Don't treat the title of the fihris header itself as a chapter
          if (/^(فهرس|الفهرس|المحتويات|جدول المحتويات|daftar isi)/i.test(cleanLine.trim()) && cleanLine.length < 25) {
            continue;
          }

          // Look for line containing title and page number
          const matchNum =
            cleanLine.match(/([0-9٠-٩]+)[\s._\-—…:·|/]*$/) ||
            cleanLine.match(/^[\s._\-—…:·|/]*([0-9٠-٩]+)/) ||
            cleanLine.match(/ص[\s.:]*([0-9٠-٩]+)/i);

          if (matchNum) {
            const parsedPage = parseEasternArabicNumber(matchNum[1]);
            if (parsedPage && parsedPage >= 1 && parsedPage <= numPages) {
              const titleOnly = cleanLine
                .replace(/[0-9٠-٩]+/g, '')
                .replace(/[._\-—…:·|/]+/g, ' ')
                .replace(/\b(hal|halaman|p|page|ص|صحيفة|صفحة)\b/gi, '')
                .trim();

              const pureArabic = extractArabicTitleOnly(titleOnly);

              if (pureArabic.length >= 2 && pureArabic.length <= 120) {
                if (!fihrisChapters.some((c) => c.startPage === parsedPage || c.title === pureArabic)) {
                  fihrisChapters.push({
                    id: `ch-fihris-${parsedPage}-${fihrisChapters.length}`,
                    number: String(fihrisChapters.length + 1).padStart(2, '0'),
                    title: pureArabic,
                    startPage: parsedPage,
                  });
                }
              }
            }
          }
        }
      }
    }

    if (fihrisChapters.length >= 2) {
      fihrisChapters.sort((a, b) => a.startPage - b.startPage);
      return fihrisChapters.map((ch, idx) => ({
        ...ch,
        number: String(idx + 1).padStart(2, '0'),
      }));
    }
  } catch (err) {
    console.warn('Error scanning printed fihris:', err);
  }
  return [];
}

/**
 * Detects the cover / front-matter offset (number of pages before main body text) for any PDF document.
 */
export async function detectPdfCoverOffset(pdfDoc: any): Promise<number> {
  if (!pdfDoc) return 0;
  try {
    const pagesToScan = Math.min(pdfDoc.numPages, 30);
    for (let p = 1; p <= pagesToScan; p++) {
      const page = await pdfDoc.getPage(p);
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map((it: any) => it.str || '').join(' ');
      const cleanText = stripArabicTashkeel(rawText);

      // Indicators of main body start (Page >= 2)
      const hasArabicKitabOrBab =
        /\b(كتاب|الكتاب|باب|الباب|فصل|الفصل)\s+(الطهارة|الصلاة|الزكاة|الصوم|الحج|البيوع|النكاح|الجنايات|الأذان|المقدمة|الطهاره|الصلاه|المعاملات|الفرائض|الحدود|الجهاد|الشهادات)\b/i.test(cleanText);

      const hasIntroPhrase =
        cleanText.includes('مقدمة المصنف') ||
        cleanText.includes('خطبة الكتاب') ||
        cleanText.includes('قال الشيخ') ||
        cleanText.includes('الحمد لله الذي') ||
        cleanText.includes('حمدا لمن') ||
        cleanText.includes('أحمده على') ||
        cleanText.includes('نحمده ونستعينه');

      const hasPrintedPageOne =
        p >= 3 &&
        (/\bص\s*1\b|\bصفحة\s*1\b|\bhal\s*1\b|\bhalaman\s*1\b/i.test(cleanText) ||
         /^\s*1\s*$/.test(cleanText) ||
         /\n\s*1\s*\n/.test(cleanText));

      if (p >= 2 && (hasArabicKitabOrBab || (p >= 3 && hasIntroPhrase) || hasPrintedPageOne)) {
        return Math.max(0, p - 1);
      }
    }
  } catch (err) {
    console.warn('Error detecting PDF cover offset:', err);
  }
  return 0;
}

/**
 * Automatically scans PDF text pages to align chapter startPage numbers
 * with real Application PDF pages (detects cover page offset & exact headings automatically).
 */
export async function autoAlignChaptersWithPdfPages(
  pdfDoc: any,
  chapters: KitabChapter[],
  totalPages: number
): Promise<KitabChapter[]> {
  if (!pdfDoc || !chapters || chapters.length === 0) return chapters;

  try {
    const numPages = Math.min(pdfDoc.numPages, totalPages);
    const pageTexts: { page: number; text: string }[] = [];

    // Pre-extract clean text for all PDF pages
    for (let p = 1; p <= numPages; p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const txt = await page.getTextContent();
        const str = txt.items.map((it: any) => it.str || '').join(' ');
        pageTexts.push({ page: p, text: stripArabicTashkeel(str) });
      } catch {
        // ignore
      }
    }

    const hitMap = new Map<number, number>();

    for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
      const ch = chapters[cIdx];
      const fullTitle = ch.title;
      const cleanFullTitle = stripArabicTashkeel(fullTitle);

      const isTarjamah =
        cleanFullTitle.includes('ترجمة') ||
        cleanFullTitle.includes('البنتني') ||
        cleanFullTitle.includes('المليباري') ||
        cleanFullTitle.includes('المصنف');

      const words = cleanFullTitle
        .split(/[\s:,\.\-\(\)]+/)
        .filter((w) => w.length >= 2 && !/^(في|عن|على|من|إلى|مع|أن|إن|هو|هي|و|أو)$/.test(w));

      if (words.length === 0) continue;

      const phrase3 = words.slice(0, 3).join(' ');
      const phrase2 = words.slice(0, 2).join(' ');
      const phrase1 = words[0];

      let foundPage = 0;
      for (const pt of pageTexts) {
        if (
          isTarjamah &&
          (pt.text.includes('ترجمة') || pt.text.includes('البنتني') || pt.text.includes('المليباري'))
        ) {
          foundPage = pt.page;
          break;
        }

        if (
          (phrase3.length >= 3 && pt.text.includes(phrase3)) ||
          (phrase2.length >= 3 && pt.text.includes(phrase2)) ||
          (phrase1.length >= 4 && pt.text.includes(phrase1) && pt.page > 1)
        ) {
          foundPage = pt.page;
          break;
        }
      }

      if (foundPage > 0) {
        hitMap.set(cIdx, foundPage);
      }
    }

    let lastFoundPage = 1;
    const numCh = chapters.length;

    return chapters.map((ch, idx) => {
      let finalPage = ch.startPage;
      if (hitMap.has(idx)) {
        finalPage = hitMap.get(idx)!;
        lastFoundPage = finalPage;
      } else {
        const nextHitIdx = Array.from(hitMap.keys()).find((k) => k > idx);
        if (nextHitIdx !== undefined) {
          const nextHitPage = hitMap.get(nextHitIdx)!;
          const gap = nextHitIdx - idx + 1;
          const step = Math.max(1, Math.floor((nextHitPage - lastFoundPage) / gap));
          finalPage = Math.min(nextHitPage, Math.max(lastFoundPage, lastFoundPage + step));
        } else {
          const remainingPages = totalPages - lastFoundPage;
          const remainingCh = numCh - idx;
          const step = Math.max(1, Math.floor(remainingPages / Math.max(1, remainingCh)));
          finalPage = Math.min(totalPages, Math.max(lastFoundPage, lastFoundPage + step));
        }
        lastFoundPage = finalPage;
      }

      return {
        ...ch,
        startPage: idx === 0 ? 1 : Math.min(totalPages, Math.max(1, finalPage)),
      };
    });
  } catch (err) {
    console.warn('Error in autoAlignChaptersWithPdfPages:', err);
    return chapters;
  }
}

export interface TuratsKitabTemplate {
  id: string;
  name: string;
  arabicName: string;
  author: string;
  keywords: string[];
  chapters: string[];
  chapterEntries?: { title: string; startPage: number }[];
}

export function normalizeArabicTitle(str: string): string {
  if (!str) return '';
  return stripArabicTashkeel(str)
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[أإآءؤئ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[-_.,;:!?/\\()[\]{}«»"'\s\u200e\u200f\u202a-\u202e]+/g, ' ')
    .trim();
}

export function extractArabicTitleOnly(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  // Check for Arabic text in parentheses, e.g. "Fashl (فصل في الطهارة)"
  const parenMatch = trimmed.match(/\(([\u0600-\u06FF\s0-9٠-٩:.,\-–—]+)\)/);
  if (parenMatch && parenMatch[1].trim().length >= 2) {
    return parenMatch[1].trim();
  }
  // If there's Arabic characters in the text
  const arabicMatch = trimmed.match(/[\u0600-\u06FF][\u0600-\u06FF\s0-9٠-٩:.,\-–—"']+/);
  if (arabicMatch && arabicMatch[0].trim().length >= 2) {
    return arabicMatch[0].trim();
  }
  return trimmed;
}

export const POPULAR_TURATS_TEMPLATES: TuratsKitabTemplate[] = [
  {
    id: 'tsamratu-raudhah',
    name: 'Tsamratu ar-Raudhah asy-Syahiyyah',
    arabicName: 'ثمرة الروضة الشهية في تحقيق مسائل السفينة',
    author: 'Syaikh Muhammad bin Ali bin Muhammad Al-Bantani',
    keywords: [
      'ثمرة',
      'الروضة',
      'الشهية',
      'ثمره',
      'الروضه',
      'الشهيه',
      'tsamrat',
      'tsamrot',
      'raudhah',
      'raudhoh',
      'syahiyyah',
      'syahiyah',
      'ثمرة الروضة'
    ],
    chapters: [
      'مقدمة الكتاب وخطبة التحقيق',
      'فصل في أركان الإسلام الخمسة',
      'فصل في أركان الإيمان الستة',
      'فصل في معنى لا إله إلا الله',
      'فصل في علامات البلوغ في الذكر والأنثى',
      'فصل في شروط إجزاء الاستنجاء بالحجر',
      'فصل في فروض الوضوء ونيته',
      'فصل في أقسام الماء وأحكامه',
      'فصل في موجبات الغسل ومفروضاته',
      'فصل في شروط صحة الوضوء والغسل',
      'فصل في نواقض الوضوء ومبطلاته',
      'فصل في محرمات الحدثين الأصغر والأكبر',
      'فصل في أسباب التيمم ومسوغاته',
      'فصل في فروض التيمم وشروطه ومبطلاته',
      'فصل في النجاسات وأقسامها وكيفية تطهيرها',
      'فصل في أحكام الحيض والنفاس والاستحاضة',
      'فصل في أعذار الصلاة المسقطة والمبيحة',
      'فصل في شروط صحة الصلاة وقبولها',
      'فصل في أحداث الصلاة ومبطلاتها',
      'فصل في أركان الصلاة السبعة عشر',
      'فصل في شروط تكبيرة الإحرام والفاتحة',
      'فصل في سنن الأركان وهيئات الصلاة',
      'فصل في سجدات السهو والتلاوة والشكر',
      'فصل في أوقات الصلاة والتحريم',
      'فصل في صلاة الجماعة وشروط القدوة والإمامة',
      'فصل في صلاة القصر والجمع في السفر',
      'فصل في صلاة الجمعة وشروط وجوبها وإقامتها',
      'فصل في أحكام الجنائز: الغسل والتكفين والصلاة والدفن',
      'فصل في أحكام الزكاة ومصارفها الثمانية',
      'فصل في أحكام الصيام وشروطه ومفطراته',
      'فصل في كفارة الفطر وقضاء رمضان',
      'فصل في الاعتكاف وشروطه',
      'باب المعاملات والبيوع وأحكام الربا',
      'خاتمة في التوبة النصوح والدعوات المستجابة والوصايا',
    ],
  },
  {
    id: 'nihayatuz-zain',
    name: 'Nihayatuz Zain',
    arabicName: 'نهاية الزين في إرشاد المبتدئين بشرح قرة العين',
    author: 'Al-Allamah Syaikh Muhammad Nawawi bin Umar Al-Bantani',
    keywords: [
      'نهاية',
      'الزين',
      'نهايه',
      'نهاية الزين',
      'نهايه الزين',
      'nihayah',
      'nihayat',
      'nihayatus',
      'nihayatuz',
      'nihayatuzzain',
      'nihayatuszain',
      'nihayatuzain',
      'nihayatusain',
      'zain',
      'zein',
      'نووي',
      'البنتني',
      'bantani',
      'البيوع',
      'البيع',
      'بيوع',
      'بيع',
    ],
    chapters: [
      'مقدمة الشارح العلامة نووي البنتني وخطبة التحقيق والبيان',
      'كتاب الصلاة: شروط وجوب الصلاة وأوقاتها وحكم تاركها',
      'تنبيه في تغليظ عقوبة تارك الصلاة ووجوب استتابته',
      'فرع في قضاء الصلوات الفائتة بالترتيب ووجوب المبادرة',
      'باب الأذان والإقامة وسننهما وألفاظهما المشروعة',
      'فرع في شروط المؤذن وسنن الإجابة والدعاء المأثور بعد الأذان',
      'تنبيه في كراهة أذان المحدث وتلحين الأذان والترجيع',
      'فائدة في فضل الأذان وإجابة المؤذن والدعاء بين الأذان والإقامة',
      'باب شروط صحة الصلاة الخمسة',
      'فصل في طهارة الحدثين الأصغر والأكبر وأقسام المياه',
      'فصل في أحكام الاستنجاء وآداب قضاء الحاجة والاستطابة',
      'فرع في شروط الاستنجاء بالحجر وما يقوم مقامه',
      'باب أحكام النجاسات وأقسامها وكيفية تطهيرها',
      'فصل في إزالة النجاسة العينية والحكمية بالماء الطهور',
      'فرع في النجاسات المعفو عنها في الصلاة والثوب والبدن',
      'تنبيه في طهارة جلد الميتة بالدباغ وما يطهر بالاستحالة',
      'باب أحكام الوضوء وفروضه الستة ونيته المعتبرة',
      'فرع في نية الوضوء ومقارنتها بغسل أول جزء من الوجه',
      'فرع في مسح الرأس وغسل الرجلين إلى الكعبين والتثليث',
      'فصل في سنن الوضوء وآدابه وأذكاره المستحبة',
      'فرع في إسباغ الوضوء والسواك والترتيب والموالاة ودعاء الأعضاء',
      'فصل في نواقض الوضوء ومبطلاته الأربعة',
      'فرع في الشك في الحدث والطهارة واستصحاب اليقين',
      'تنبيه في لمس المحارم والصغير والشعر والسن والظفر',
      'فصل في محرمات الحدثين الأصغر والأكبر والحيض والنفاس',
      'باب الغسل وموجباته الستة ومفروضاته وسننه الكاملة',
      'فرع في الأغسال المسنونة وأحكام الجنابة والانغماس',
      'تنبيه في تعميم جميع البدن والشعر الظاهر والباطن بالماء',
      'باب التيمم وأسبابه ومسوغاته الخمسة وشروطه وأركانه',
      'فرع في طلب الماء وضلاله وشرائه بثمن المثل ونقل التراب',
      'تنبيه في التيمم لكل فريضة وما يستباح به من النوافل',
      'فصل في أحكام المسح على الخفين والجبائر والضمائد',
      'فرع في شروط المسح ومدته للمقيم والمسافر وتنزيل الجبيرة',
      'مهمة في وجوب القضاء على صاحب الجبيرة إذا وضعت على غير طهر',
      'باب أحكام الحيض والنفاس والاستحاضة',
      'فرع في أقل الحيض وأكثره وغالبه وأحكام النقاء المتخلل',
      'مهمة في أحكام المستحاضة المبتدأة والمعتادة والمميزة والمتحيرة',
      'باب ستر العورة وحدودها للرجل والمرأة في الصلاة',
      'فرع في الصلاة في الثوب المغصوب أو النجس وحكم صلاة العريان',
      'تنبيه في شروط الستر من الأعلى والجوانب دون الأسفل',
      'باب استقبال القبلة وطرق معرفتها بالدلائل والقبل',
      'فرع في صلاة شدة الخوف والنافلة في السفر إلى غير القبلة',
      'تنبيه في حكم الاجتهاد في القبلة وتغير الاجتهاد في الصلاة',
      'باب أركان الصلاة السبعة عشر وتفاصيلها',
      'فصل في شروط تكبيرة الإحرام ومقارنة النية الحقيقية والعرفية',
      'مهمة في اشتراط إسماع النفس لجميع التكبير والقراءة والأذكار الواجبة',
      'فصل في شروط صحة قراءة الفاتحة وتشديداتها السبع عشرة',
      'فرع في أحكام البسملة وقراءة السورة بعد الفاتحة للإمام والمنفرد',
      'تنبيه في اللحن المغير للمعنى والمبطل للصلاة في الفاتحة',
      'فصل في أحكام الركوع والاعتدال والسجود والطمأنينة المفروضة',
      'فرع في شروط السجود على الجبهة مكشوفة ومباشرة الأعضاء السبعة',
      'تنبيه في ارتفاع الأسافل على الأعالي والتحامل على الجبهة',
      'فصل في الجلوس بين السجدتين والتشهد الأخير والصلاة على النبي والتسليم',
      'باب سنن الصلاة: الأبعاض والهيئات ودعاء القنوت',
      'فرع في جلسة الاستراحة ورفع اليدين وهيئة التورك والافتراش',
      'فصل في دعاء القنوت والتشهد الأول وسجود التلاوة والشكر',
      'مهمة في حكم جهر المأموم والمنفرد والإسرار وأوقاتهما',
      'باب سجود السهو وأسبابه ومواضعه وأحكامه',
      'تنبيه في ترتب السجود على ترك بعض المأمورات وفعل بعض المنهيات',
      'فصل في سجدات التلاوة في الصلاة وخارجها وسجدة الشكر',
      'باب مبطلات الصلاة ومكروهاتها وقواطع النية',
      'فرع في الأفعال الكثيرة والمفهمة وحكم الالتفات في الصلاة',
      'مهمة في ابتلاع النخامة وبقايا الطعام وحكم الحركة الخفيفة',
      'باب صلاة الجماعة وفضلها وشروط الإمامة والقدوة',
      'فرع في شروط القدوة وموقف المأموم من الإمام وقطع القدوة للمفارقة',
      'مهمة في حكم متابعة الإمام والمسابقة والموافقة والتخلف بركنين',
      'فصل في الأعذار المبيحة لترك الجماعة والجمعة',
      'باب صلاة المسافر: أحكام القصر والجمع في السفر الطويل',
      'فرع في شروط القصر والجمع تقديماً وتأخيراً',
      'تنبيه في نية السفر المباح ومفارقة بنيان البلد ونية الإقامة',
      'باب صلاة الجمعة وشروط وجوبها وصحتها وأركان الخطبتين',
      'فرع في سنن الجمعة وآداب التبكير والغسل وقراءة سورة الكهف',
      'مهمة في شروط العدد الأربعين وكونهم مستوطنين وأحكام الخطبتين',
      'فصل في سنن الجمعة وآداب الخطبتين وأركانهما وشروطهما',
      'باب صلاة الخوف وكيفياتها المشروعة',
      'باب صلاة العيدين: الفطر والأضحى والتكبير والخطبتين',
      'باب صلاة الكسوفين والخسوف',
      'باب صلاة الاستسقاء والاستغفار والتوبة',
      'باب صلاة النوافل: الرواتب المؤكدة والوتر والضحى والتهجد والتراويح',
      'فرع في صلاة الاستخارة والحاجة والتسبيح وركعتي الوضوء والإحرام',
      'تنبيه في كراهة النوافل المطلقة في أوقات الكراهة الخمسة',
      'باب أحكام الجنائز: غسل الميت وتكفينه والصلاة عليه ودفنه',
      'فرع في الشهداء وأحكام التعزية وزيارة القبور ونقل الميت',
      'تنبيه في حرمة النياحة وشق الجيوب وحكم حمل الجنازة وآداب الدفن',
      'كتاب الزكاة: شروط وجوبها وأصناف الأموال الزكوية',
      'باب زكاة النعم: الإبل والبقر والغنم وخلطة الشيوع والأوصاف',
      'باب زكاة الذهب والفضة والحلي المباح والمعادن والركاز',
      'تنبيه في نصاب الذهب والفضة وشروط الحول وقطع الحول بالفرار',
      'باب زكاة الزروع والثمار وعروض التجارة والربح',
      'مهمة في تقويم عروض التجارة بالنقد الغالب ومقدار الخمس في الركاز',
      'باب زكاة الفطر ومقدارها ووقت إخراجها وشروط وجوبها',
      'فصل في أهل الزكاة ومصارفها الثمانية وحكم نقلها لبلد آخر',
      'فرع في صدقة التطوع وفضل إسرارها على الأقارب وذوي الحاجة',
      'تنبيه في منع بني هاشم وبني المطلب من الزكاة المفروضة',
      'كتاب الصيام: شروط وجوبه وصحته وأركانه ومفطراته',
      'فرع في ثبوت هلال رمضان برؤية العدل وإكمال العدة',
      'تنبيه في لزوم تبييت النية وتعيينها لكل يوم من رمضان',
      'باب مفطرات الصوم ومكروهاتها ومستحباته',
      'مهمة في وصول عين إلى الجوف من منفذ مفتوح عمداً',
      'فصل في الأعذار المبيحة للفطر والقضاء وفدية العاجز والحامل والمرضع',
      'فرع في كفارة الجماع العمد في نهار رمضان',
      'فصل في صوم التطوع والأيام المسنونة والمنهي عن صيامها',
      'باب الاعتكاف في المساجد وشروطه وأركانه ومبطلاته ونواقضه',
      'تنبيه في نية الاعتكاف ومكثه في المسجد وقطع التتابع بالخروج',
      'كتاب الحج والعمرة: شروط الوجوب والاستطاعة وأركانهما',
      'باب مواقيت الحج الزمانية والمكانية والإحرام',
      'باب واجبات الحج وسننه ومحظورات الإحرام العشرة',
      'فصل في الدماء الواجبة في الإحرام والفدية والإحصار والفوات',
      'مهمة في الترتيب والتقدير في كفارات محظورات الإحرام',
      'باب الأضحية والعقيقة وأحكام الذكاة الشرعية وتذكية الجنين',
      'تنبيه في سن الأضحية وسلامتها من العيوب ووقت ذبحها',
      'كتاب البيوع والمعاملات المالية: أركان البيع وشروطه وسائر عقود المعاوضات',
      'باب البيوع وأحكام عقود المعاوضات وسائر المعاملات المالية',
      'فصل في أحكام الصيغة والمعاطاة والإيجاب والقبول والتعليق',
      'فصل في شروط المبيع والمعقود عليه وبيع الأعيان الغائبة والموصوفة في الذمة',
      'فصل في بيع الثمار والزرع والكلأ والجوائح وبيع العرايا',
      'فصل في البيوع المحرمة والمنهي عنها والباطلة والفاسدة',
      'فصل في التفليس والحجر وأحكام الحجر على السفيه والمجنون والصبي',
      'باب الربا وأحكامه وأقسامه الثلاثة: ربا الفضل واليد والنساء',
      'مهمة في علة الربا في النقدين والمطعومات وشروط التماثل والتقابض',
      'فصل في بيع النقدين والذهب بالفضة وأحكام الصرف في المجلس',
      'باب الخيار وأقسامه الثلاثة: خيار المجلس وخيار الشرط وخيار العيب',
      'فرع في التصرية ورد المبيع بالعيب والتخبير بالثمن والمرابحة',
      'باب بيع السلم وشروطه وقبض رأس المال في مجلس العقد',
      'باب القرض وأحكامه وشروطه وحرمة كل قرض جر منفعة',
      'باب الرهن وشروط المرهون والمرتهن والارتهان والعدل',
      'باب الضمان والكفالة بالبدن والمال وشروط الضامن والمضمون له',
      'باب الحوالة وشروط صحتها والاستحقاق وبراءة الذمة',
      'باب الصلح وأقسامه وأحكام الجوار والجدار والمرور والميزاب',
      'باب الوكالة وشروط الموكل والوكيل والتصرفات المأذونة والإنهاء',
      'باب الشركة وأقسامها الأربعة وشروط شركة العنان والرأسين',
      'باب المساقاة والمزارعة والمخابرة وإجارة الأرض الشجرية',
      'باب الإجارة والجعالة وشروطهما وأحكام الأجير الخاص والمشترك',
      'مهمة في ضمان الأجير واستحقاق الأجرة بالتمكين والعمل والاستئجارات',
      'باب إحياء الموات والمياه والتحجير وأحكام الإقطاع والمرافق',
      'باب الوقف وشروطه وأركانه وصيغه ولزومه ونظر الوقف',
      'باب الهبة والهدية والصدقة وأحكام الرجوع فيها من الآباء للأبناء',
      'باب اللقطة واللقيط وأحكام تعريفها وضمانها والتملك',
      'باب الوديعة وأحكام حفظ الأمانات وضمان التعدي والتلف',
      'باب الغصب وأحكام رد المغصوب وضمان المتلفات والزيادات',
      'باب الشفعة وشروط الأخذ بها للشريك المخالط في المشاع',
      'باب القراض والمضاربة وشروط رأس المال الحاضر وقسمة الربح',
      'كتاب الفرائض والمواريث: أسباب الإرث وموانعه الشرعية',
      'فصل في أصحاب الفروض المقدرة في كتاب الله',
      'فصل في العصبات بأنفسهم وبغيرهم ومع غيرهم وأحكام الحجب',
      'فصل في أصول المسائل والعول والرد والمناسخات وقسمة التركات',
      'مهمة في مخارج الفروض وأحكام المناسخة بالقسمة الحسابية',
      'باب الوصية وأحكامها وأركانها وحدود الثلث والوصي',
      'كتاب النكاح: فضله ومقدماته والخطبة وشروط صحة العقد',
      'باب أولياء النكاح وترتيبهم وشروط الكفاءة المعتبرة',
      'تنبيه في تزويج الحاكم عند عضل الولي أو غيبته',
      'باب الصداق والمهر وتسميته وأحكام مهر المثل وتفويض البضع',
      'باب وليمة العرس وآداب إجابة الدعوة وحكم الغناء والمعازف',
      'باب القسم بين الزوجات والعدل في المبيت وأحكام النشوز والشقاق',
      'مهمة في معالجة النشوز بالوعظ والهجر والضرب غير المبرح',
      'باب الخلع وشروطه والطلاق وألفاظه الصريحة والكنائية',
      'فرع في الرجعة وشروطها وحكم المطلقة رجعياً وبائناً',
      'باب الإيلاء والظهار وأحكام الكفارة المرتبة',
      'باب اللعان وأسبابه وكيفيته ونفي النسب وحد القذف',
      'باب العدة وأنواعها للمعتدة بالوفاة والأقراء والأشهر والحمل والإحداد',
      'باب الرضاع وشروطه الخمسة والتحريم باللبن وأحكام بنوة الرضاع',
      'باب النفقات: نفقة الزوجة المعسرة والموسرة ونفقة الأقارب والمماليك والبهائم',
      'تنبيه في سقوط نفقة الزوجة بالنشوز ووجوب الكسوة والمسكن',
      'باب الحضانة وشروط الحاضنة وترتيب مستحقيها بعد الفراق',
      'كتاب الجنايات والقصاص في النفس والأطراف وشروط استيفائه',
      'باب الديات: دية النفس الكاملة وديات الأعضاء والجراح والشجاج',
      'باب كفارة القتل والقسامة في دعوى الدم والشبهة',
      'كتاب الحدود: حد الزنا واللواط وثبوتهما وشروط الإحصان والرجم والجلد',
      'باب حد القذف وشروطه والمسقطات له',
      'باب حد السرقة وشروط النصاب والحرز وقطع اليد',
      'باب حد قطاع الطرق والحرابة والقتال',
      'باب حد شارب المسكر والتعزير في المعاصي التي لا حد فيها',
      'باب قتال أهل البغي وأحكام الردة واستتابة المرتد',
      'كتاب الجهاد في سبيل الله وأحكام الغنائم والفيء والجزية وعقد الذمة',
      'كتاب الصيد والذبائح وما يحل وما يحرم من الأطعمة والأشربة',
      'كتاب الأيمان والنذور: أنواع اليمين وكفارتها والنذر الواجب',
      'كتاب القضاء والشهادات: شروط القاضي وآداب الحكم والدعاوى والبينات',
      'مهمة في شروط الشاهد العدل واليمين المردودة والنكول',
      'كتاب العتق والتدبير والكتابة والاستيلاد وأحكام الولاء',
      'خاتمة الكتاب في النصائح والدعوات الجامعة المباركة',
    ],
  },
  {
    id: 'ianatuth-thalibin',
    name: 'I\'anatuth Thalibin',
    arabicName: 'إعانة الطالبين على حل ألفاظ فتح المعين',
    author: 'Sayyid Abu Bakar Syatha Ad-Dimyathi',
    keywords: [
      'إعانة',
      'اعانة',
      'الطالبين',
      'ianah',
      'ianatuth',
      'thalibin',
      'dimyathi',
      'دمياطي',
      'إعانة الطالبين',
    ],
    chapters: [
      'مقدمة الشارح وترجمة العلامة المليباري',
      'كتاب الصلاة: شروط وجوبها وأوقاتها وحكم تاركها',
      'باب الأذان والإقامة وسننهما وألفاظهما',
      'باب شروط صحة الصلاة الخمسة',
      'فصل في طهارة الحدث وأحكام الوضوء وفروضه الستة',
      'فصل في سنن الوضوء وآدابه وأذكاره المستحبة',
      'فصل في نواقض الوضوء وموجبات الغسل',
      'فصل في الغسل وفروضه وسننه الكاملة',
      'فصل في أسباب التيمم ومسوغاته وشروطه وأركانه',
      'فصل في أحكام المسح على الخفين والجبائر والضمائد',
      'فصل في النجاسات وأنواعها وطرق تطهيرها',
      'فصل في ستر العورة واستقبال القبلة في الصلاة',
      'باب أركان الصلاة السبعة عشر وشروطها',
      'فصل في سنن الصلاة: الأبعاض والهيئات والقنوت',
      'فصل في سجود السهو وسجود التلاوة والشكر',
      'فصل في مبطلات الصلاة ومكروهاتها',
      'باب صلاة النوافل: الرواتب والوتر والضحى والتراويح',
      'باب صلاة الجماعة وشروط الإمامة والقدوة',
      'باب صلاة المسافر: أحكام القصر والجمع في السفر',
      'باب صلاة الجمعة وشروط وجوبها وصحتها والخطبتين',
      'باب صلاة الخوف وصلاة العيدين والكسوف والاستسقاء',
      'باب أحكام الجنائز: الغسل والتكفين والصلاة والدفن',
      'كتاب الزكاة: شروط وجوبها وأصناف الأموال الزكوية',
      'باب زكاة النعم والذهب والفضة والمعادن والركاز',
      'باب زكاة التجارة والزروع والثمار',
      'باب زكاة الفطر ومقدارها ومصارف الزكاة الثمانية',
      'كتاب الصيام: شروطه وفرائضه وسننه ومفطراته',
      'باب صوم التطوع وأحكام الاعتكاف',
      'كتاب الحج والعمرة: شروطهما وأركانهما وواجباتهما',
      'باب محظورات الإحرام والدماء والفدية والأضحية والعقيقة',
      'كتاب البيوع والمعاملات المالية والربا والصرف',
      'باب الخيار والسلم والقرض والرهن والضمان والكفالة',
      'باب الحوالة والصلح والوكالة والشركة والمساقاة والإجارة',
      'باب إحياء الموات والوقف والهبة واللقطة والوديعة',
      'كتاب الفرائض والوصايا والميراث وقسمة التركات',
      'كتاب النكاح: أركانه وشروطه والمهر والوليمة',
      'باب القسم والنشوز والخلع والطلاق والرجعة والإيلاء والظهار',
      'باب اللعان والعدة والرضاع والنفقات والحضانة',
      'كتاب الجنايات والقصاص والديات والحدود والردة والتعزير',
      'كتاب الجهاد والجزية والغنائم والصيد والذبائح والأطعمة والأيمان',
      'كتاب القضاء والشهادات والدعاوى والبينات والعتق والتدبير',
      'خاتمة في فوائد فقهية ودعوات مباركة جامعة',
    ],
  },
  {
    id: 'nihayatuz-zain',
    name: 'Nihayatuz Zain',
    arabicName: 'نهاية الزين في إرشاد المبتدئين',
    author: 'Al-Allamah Syaikh Muhammad Nawawi Al-Bantani',
    keywords: [
      'nihayah',
      'nihayatuz',
      'نهاية',
      'الزين',
      'نهاية الزين',
      '0084',
      'نووي البنتني',
      'الجاوي',
      'الماليباري',
    ],
    chapterEntries: [
      { title: 'ترجمة المليباري صاحب المتن', startPage: 3 },
      { title: 'ترجمة نووي الجاوي صاحب الشرح', startPage: 3 },
      { title: 'خطبة الشارح', startPage: 5 },
      { title: 'خطبة الكتاب', startPage: 7 },
      { title: 'باب الصلاة', startPage: 11 },
      { title: 'فصل في مسائل منثورة', startPage: 15 },
      { title: 'فصل في كيفية الصلاة المتعلقة بواجب', startPage: 55 },
      { title: 'فصل في سجود السهو', startPage: 80 },
      { title: 'فصل في مفسدات الصلاة', startPage: 88 },
      { title: 'فصل في سنن الصلاة المكتوبة قبل الدخول فيها', startPage: 93 },
      { title: 'فصل في صلاة النفل', startPage: 97 },
      { title: 'فصل في الجماعة في الصلاة', startPage: 114 },
      { title: 'فصل في صلاة الجمعة', startPage: 132 },
      { title: 'فصل في الجنائز', startPage: 143 },
      { title: 'باب ما يحرم استعماله من اللباس والحلي وما لا يحرم', startPage: 161 },
      { title: 'باب الزكاة', startPage: 164 },
      { title: 'فصل في أداء الزكاة', startPage: 173 },
      { title: 'باب الصوم', startPage: 180 },
      { title: 'فصل في صوم التطوع', startPage: 191 },
      { title: 'باب الاعتكاف', startPage: 193 },
      { title: 'باب الحج والعمرة', startPage: 196 },
      { title: 'فصل في محظورات النسك', startPage: 209 },
      { title: 'فرع: في أحكام النذور', startPage: 216 },
      { title: 'باب البيوع والمعاملات المالية', startPage: 218 },
      { title: 'فصل في السلم والرهن والضمان والشركة والوكالة', startPage: 235 },
      { title: 'فصل في الإقرار والعارية والغصب والشفعة والقراض والمساقاة والإجارة', startPage: 258 },
      { title: 'باب الفرائض والوصايا والمواريث', startPage: 285 },
      { title: 'باب النكاح وما يتعلق به من أحكام العقد والصداق', startPage: 298 },
      { title: 'فصل في القسم والنشوز والخلع والطلاق والرجعة والعدة والنفقة', startPage: 320 },
      { title: 'كتاب الجنايات والديات والقصاص', startPage: 350 },
      { title: 'كتاب الحدود والتعزير والردة والجهاد', startPage: 368 },
      { title: 'كتاب الأقضية والشهادات والدعاوى والعتق', startPage: 382 },
    ],
    chapters: [
      'ترجمة المليباري صاحب المتن',
      'ترجمة نووي الجاوي صاحب الشرح',
      'خطبة الشارح',
      'خطبة الكتاب',
      'باب الصلاة',
      'فصل في مسائل منثورة',
      'فصل في كيفية الصلاة المتعلقة بواجب',
      'فصل في سجود السهو',
      'فصل في مفسدات الصلاة',
      'فصل في سنن الصلاة المكتوبة قبل الدخول فيها',
      'فصل في صلاة النفل',
      'فصل في الجماعة في الصلاة',
      'فصل في صلاة الجمعة',
      'فصل في الجنائز',
      'باب ما يحرم استعماله من اللباس والحلي وما لا يحرم',
      'باب الزكاة',
      'فصل في أداء الزكاة',
      'باب الصوم',
      'فصل في صوم التطوع',
      'باب الاعتكاف',
      'باب الحج والعمرة',
      'فصل في محظورات النسك',
      'فرع: في أحكام النذور',
      'باب البيوع والمعاملات المالية',
      'فصل في السلم والرهن والضمان والشركة والوكالة',
      'فصل في الإقرار والعارية والغصب والشفعة والقراض والمساقاة والإجارة',
      'باب الفرائض والوصايا والمواريث',
      'باب النكاح وما يتعلق به من أحكام العقد والصداق',
      'فصل في القسم والنشوز والخلع والطلاق والرجعة والعدة والنفقة',
      'كتاب الجنايات والديات والقصاص',
      'كتاب الحدود والتعزير والردة والجهاد',
      'كتاب الأقضية والشهادات والدعاوى والعتق',
    ],
  },
  {
    id: 'fathul-muin',
    name: 'Fathul Mu\'in',
    arabicName: 'فتح المعين بشرح قرة العين بمهمات الدين',
    author: 'Al-Allamah Zainuddin bin Abdul Aziz Al-Malibari',
    keywords: [
      'fathul muin',
      'fathul mu\'in',
      'fathul',
      'muin',
      'mu\'in',
      'فتح المعين',
      'قرة العين',
      'المليباري',
      'malibari',
    ],
    chapters: [
      'مقدمة المصنف وخطبة التحقيق والبيان في مهمات الدين',
      'كتاب الصلاة: شروط وجوب الصلاة وأوقاتها وحكم تاركها',
      'تنبيه في حكم تارك الصلاة كسلاً والتشديد في توبته',
      'مهمة في قضاء الصلوات الفائتة بالترتيب ووجوب المبادرة',
      'باب الأذان والإقامة وسننهما وألفاظهما المشروعة',
      'فرع في شروط المؤذن وسنن الإجابة والدعاء بعد الأذان',
      'تنبيه في كراهة أذان غير المتطهر وتلحين الأذان',
      'باب شروط صحة الصلاة الخمسة',
      'فصل في طهارة الحدث وأحكام الوضوء وفروضه الستة',
      'فرع في نية الوضوء ومقارنتها بغسل أول جزء من الوجه',
      'تنبيه في الشك في غسل بعض الأعضاء قبل الفراغ وبعده',
      'مهمة في أحكام مسح الرأس وغسل الرجلين إلى الكعبين والتثليث',
      'فصل في سنن الوضوء وآدابه وأذكاره المستحبة',
      'فرع في إسباغ الوضوء والسواك والترتيب والموالاة',
      'فائدة في ترتيب تقديم الميامن والمياسر وأذكار الأعضاء',
      'فصل في نواقض الوضوء وموجبات الحدث الأصغر',
      'فرع في الشك في الحدث أو الطهارة واستصحاب الأصل',
      'تنبيه في لمس المحارم والصغير والشعر والسن والظفر',
      'مهمة في زوال العقل بالنوم والإغماء والسكر',
      'فصل في موجبات الغسل وفروضه وسننه الكاملة',
      'فرع في الأغسال المسنونة وأحكام الجنابة والانغماس',
      'تنبيه في تعميم جميع البدن والشعر الظاهر والباطن بالماء',
      'فصل في أسباب التيمم ومسوغاته وشروطه وأركانه',
      'فرع في طلب الماء وضلاله وشرائه بثمن المثل ونقل التراب',
      'تنبيه في التيمم لكل فريضة وما يستباح به من النوافل',
      'فصل في أحكام المسح على الخفين والجبائر والضمائد',
      'فرع في شروط المسح ومدته للمقيم والمسافر وتنزيل الجبيرة',
      'مهمة في وجوب القضاء على صاحب الجبيرة إذا وضعت على غير طهر',
      'فصل في طهارة الخبث وإزالة النجاسات العينية والحكمية',
      'فرع في النجاسات المعفو عنها في الثوب والبدن والصلاة',
      'تنبيه في يسير الدم والقروح ودم البراغيث ونيم الذباب',
      'فرع في تطهير جلد الميتة بالدباغ وما يطهر بالاستحالة',
      'فصل في أحكام الحيض والنفاس والاستحاضة',
      'فرع في المحرمات بالحدثين والحيض والنفاس والجنابة',
      'مهمة في ضابط النقاء والدم المتقطع وأحكام المستحاضة المتحيرة',
      'فصل في ستر العورة وحدودها للرجل والمرأة في الصلاة',
      'فرع في الصلاة في الثوب المغصوب أو النجس وحكم العريان',
      'تنبيه في شروط الستر من الأعلى والجوانب دون الأسفل',
      'فصل في استقبال القبلة وطرق معرفتها بالدلائل والقبل',
      'فرع في صلاة شدة الخوف والنافلة في السفر إلى غير القبلة',
      'تنبيه في حكم الاجتهاد في القبلة وتغير الاجتهاد في الصلاة',
      'باب أركان الصلاة السبعة عشر وتفاصيلها',
      'فصل في شروط تكبيرة الإحرام ومقارنة النية الحقيقية والعرفية',
      'مهمة في اشتراط إسماع النفس لجميع التكبير والقراءة والأذكار الواجبة',
      'فصل في شروط صحة قراءة الفاتحة وتشديداتها السبع عشرة',
      'فرع في أحكام البسملة وقراءة السورة بعد الفاتحة للإمام والمنفرد',
      'تنبيه في اللحن المغير للمعنى والمبطل للصلاة في الفاتحة',
      'فصل في أحكام الركوع والاعتدال والسجود والطمأنينة المفروضة',
      'فرع في شروط السجود على الجبهة مكشوفة ومباشرة الأعضاء السبعة',
      'تنبيه في ارتفاع الأسافل على الأعالي والتحامل على الجبهة',
      'فصل في الجلوس بين السجدتين والتشهد الأخير والصلاة على النبي والتسليم',
      'فصل في سنن الصلاة: الأبعاض والهيئات ودعاء القنوت',
      'فرع في جلسة الاستراحة ورفع اليدين وهيئة التورك والافتراش',
      'مهمة في حكم جهر المأموم والمنفرد والإسرار وأوقاتهما',
      'فصل في سجود السهو وأسبابه ومواضعه وأحكامه',
      'فرع في سجدات التلاوة في الصلاة وخارجها وسجدة الشكر',
      'تنبيه في ترتب السجود على ترك بعض المأمورات وفعل بعض المنهيات',
      'فصل في مبطلات الصلاة ومكروهاتها وقواطع النية',
      'فرع في الأفعال الكثيرة والمفهمة وحكم الالتفات في الصلاة',
      'مهمة في ابتلاع النخامة وبقايا الطعام وحكم الحركة الخفيفة',
      'باب صلاة النوافل: الرواتب المؤكدة والوتر والضحى والتهجد والتراويح',
      'فرع في صلاة الاستخارة والحاجة والتسبيح وركعتي الوضوء والإحرام',
      'تنبيه في كراهة النوافل المطلقة في أوقات الكراهة الخمسة',
      'باب صلاة الجماعة وفضلها وشروط الإمامة والقدوة',
      'فرع في شروط القدوة وموقف المأموم من الإمام وقطع القدوة للمفارقة',
      'مهمة في حكم متابعة الإمام والمسابقة والموافقة والتخلف بركنين',
      'فرع في الأعذار المبيحة لترك الجماعة والجمعة',
      'باب صلاة المسافر: أحكام القصر والجمع في السفر الطويل',
      'فرع في شروط القصر والجمع تقديماً وتأخيراً',
      'تنبيه في نية السفر المباح ومفارقة بنيان البلد ونية الإقامة',
      'باب صلاة الجمعة وشروط وجوبها وصحتها وأركان الخطبتين',
      'فرع في سنن الجمعة وآداب التبكير والغسل وقراءة سورة الكهف',
      'مهمة في شروط العدد الأربعين وكونهم مستوطنين وأحكام الخطبتين',
      'باب صلاة الخوف وصلاة العيدين وصلاة الكسوفين والاستسقاء',
      'باب أحكام الجنائز: غسل الميت وتكفينه والصلاة عليه ودفنه',
      'فرع في الشهداء وأحكام التعزية وزيارة القبور ونقل الميت',
      'تنبيه في حرمة النياحة وشق الجيوب وحكم حمل الجنازة وآداب الدفن',
      'كتاب الزكاة: شروط وجوبها وأصناف الأموال الزكوية',
      'باب زكاة النعم: الإبل والبقر والغنم وخلطة الشيوع والأوصاف',
      'باب زكاة الذهب والفضة والحلي المباح والمعادن والركاز',
      'تنبيه في نصاب الذهب والفضة وشروط الحول وقطع الحول بالفرار',
      'باب زكاة الزروع والثمار وعروض التجارة والربح',
      'مهمة في تقويم عروض التجارة بالنقد الغالب ومقدار الخمس في الركاز',
      'باب زكاة الفطر ومقدارها ووقت إخراجها وشروط وجوبها',
      'فصل في أهل الزكاة ومصارفها الثمانية وحكم نقلها لبلد آخر',
      'فرع في صدقة التطوع وفضل إسرارها على الأقارب وذوي الحاجة',
      'تنبيه في منع بني هاشم وبني المطلب من الزكاة المفروضة',
      'كتاب الصيام: شروط وجوبه وصحته وأركانه ومفطراته',
      'فرع في ثبوت هلال رمضان برؤية العدل وإكمال العدة',
      'تنبيه في لزوم تبييت النية وتعيينها لكل يوم من رمضان',
      'باب مفسدات الصيام ومفطراته ومكروهاته ومستحباته',
      'مهمة في وصول عين إلى الجوف من منفذ مفتوح عمداً',
      'فرع في الأعذار المبيحة للفطر والقضاء وفدية العاجز والحامل والمرضع',
      'فرع في كفارة الجماع العمد في نهار رمضان',
      'فرع في صيام التطوع والأيام المسنونة والمنهي عن صيامها',
      'باب الاعتكاف في المساجد وشروطه وأركانه ونواقضه',
      'تنبيه في نية الاعتكاف ومكثه في المسجد وقطع التتابع بالخروج',
      'كتاب الحج والعمرة: شروط الوجوب والاستطاعة وأركانهما',
      'باب مواقيت الحج الزمانية والمكانية والإحرام',
      'باب واجبات الحج وسننه ومحظورات الإحرام العشرة',
      'فرع في الدماء الواجبة في الإحرام والفدية والإحصار والفوات',
      'مهمة في الترتيب والتقدير في كفارات محظورات الإحرام',
      'باب الأضحية والعقيقة وأحكام الذكاة الشرعية وتذكية الجنين',
      'تنبيه في سن الأضحية وسلامتها من العيوب ووقت ذبحها',
      'كتاب البيوع والمعاملات المالية: أركان البيع وشروطه',
      'فرع في بيع الأعيان الغائبة والموصوفة في الذمة والمعاطاة',
      'تنبيه في شروط الإيجاب والقبول واتصال الكلام وعدم التعليق',
      'باب الربا وأقسامه الثلاثة: ربا الفضل واليد والنساء وأحكام الصرف',
      'مهمة في علة الربا في النقدين والمطعومات وشروط التماثل والتقابض',
      'باب الخيار: خيار المجلس والشرط وخيار العيب ورد المبيع',
      'فرع في بيع الثمار والزرع والجوائح وبيع العرايا',
      'باب السلم وشروطه وأحكامه وقبض رأس المال في المجلس',
      'باب القرض والرهن والضمان والكفالة بالبدن والمال',
      'تنبيه في حرمة كل قرض جر منفعة مشروطة للمقرض',
      'باب الحوالة وشروط صحتها وبراءة الذمة',
      'باب الصلح وأقسامه وأحكام الجوار وتنازع الأملاك',
      'باب الوكالة وشروط الموكل والوكيل والتصرفات المأذونة',
      'باب الشركة وأقسامها: شركة العنان والأبدان والمفاوضة والوجوه',
      'باب المساقاة والمزارعة والمخابرة وإجارة الأرض',
      'باب الإجارة والجعالة وشروطهما وأحكام الأجير الخاص والمشترك',
      'مهمة في ضمان الأجير واستحقاق الأجرة بالتمكين والعمل',
      'باب إحياء الموات والمياه والتحجير وأحكام الإقطاع',
      'باب الوقف وشروطه وأركانه وصيغه ولزومه للموقوف عليهم',
      'باب الهبة والهدية والصدقة وأحكام الرجوع فيها للأبناء',
      'باب اللقطة واللقيط وأحكام الوديعة وضمان الأمانات',
      'باب الغصب والشفعة وشروط الأخذ بالشفعة للشريك',
      'باب القراض والمضاربة وشروط رأس المال والربح',
      'كتاب الفرائض والمواريث: أسباب الإرث وموانعه الشرعية',
      'فصل في أصحاب الفروض المقدرة في كتاب الله',
      'فصل في العصبات بأنفسهم وبغيرهم ومع غيرهم وأحكام الحجب',
      'فصل في أصول المسائل والعول والرد والمناسخات وقسمة التركات',
      'مهمة في مخارج الفروض وأحكام المناسخة بالقسمة الحسابية',
      'باب الوصية وأحكامها وأركانها وحدود الثلث والوصي',
      'كتاب النكاح: فضله ومقدماته والخطبة وشروط صحة العقد',
      'باب أولياء النكاح وترتيبهم وشروط الكفاءة المعتبرة',
      'تنبيه في تزويج الحاكم عند عضل الولي أو غيبته',
      'باب الصداق والمهر وتسميته وأحكام مهر المثل وتفويض البضع',
      'باب وليمة العرس وآداب إجابة الدعوة وحكم الغناء والمعازف',
      'باب القسم بين الزوجات والعدل في المبيت وأحكام النشوز والشقاق',
      'مهمة في معالجة النشوز بالوعظ والهجر والضرب غير المبرح',
      'باب الخلع وشروطه والطلاق وألفاظه الصريحة والكنائية',
      'فرع في الرجعة وشروطها وحكم المطلقة رجعياً وبائناً',
      'باب الإيلاء والظهار وأحكام الكفارة المرتبة',
      'باب اللعان وأسبابه وكيفيته ونفي النسب وحد القذف',
      'باب العدة وأنواعها للمعتدة بالوفاة والأقراء والأشهر والحمل والإحداد',
      'باب الرضاع وشروطه الخمسة والتحريم باللبن وأحكام بنوة الرضاع',
      'باب النفقات: نفقة الزوجة المعسرة والموسرة ونفقة الأقارب والمماليك والبهائم',
      'تنبيه في سقوط نفقة الزوجة بالنشوز ووجوب الكسوة والمسكن',
      'باب الحضانة وشروط الحاضنة وترتيب مستحقيها بعد الفراق',
      'كتاب الجنايات والقصاص في النفس والأطراف وشروط استيفائه',
      'باب الديات: دية النفس الكاملة وديات الأعضاء والجراح والشجاج',
      'باب كفارة القتل والقسامة في دعوى الدم والشبهة',
      'كتاب الحدود: حد الزنا واللواط وثبوتهما وشروط الإحصان والرجم والجلد',
      'باب حد القذف وشروطه والمسقطات له',
      'باب حد السرقة وشروط النصاب والحرز وقطع اليد',
      'باب حد قطاع الطرق والحرابة والقتال',
      'باب حد شارب المسكر والتعزير في المعاصي التي لا حد فيها',
      'باب قتال أهل البغي وأحكام الردة واستتابة المرتد',
      'كتاب الجهاد في سبيل الله وأحكام الغنائم والفيء والجزية وعقد الذمة',
      'كتاب الصيد والذبائح وما يحل وما يحرم من الأطعمة والأشربة',
      'كتاب الأيمان والنذور: أنواع اليمين وكفارتها والنذر الواجب',
      'كتاب القضاء والشهادات: شروط القاضي وآداب الحكم والدعاوى والبينات',
      'مهمة في شروط الشاهد العدل واليمين المردودة والنكول',
      'كتاب العتق والتدبير والكتابة والاستيلاد وأحكام الولاء',
      'خاتمة الكتاب في النصائح والدعوات الجامعة المباركة',
    ],
  },
  {
    id: 'safinatun-najah',
    name: 'Safinatun Najah',
    arabicName: 'سفينة النجاة فيما يجب على العبد لمولاه',
    author: 'Al-Allamah Syaikh Salim bin Sumair Al-Hadhrami',
    keywords: ['safinah', 'safinatun', 'سفينة', 'نجاة', 'سفينة النجاة', 'سفينه', 'hadhrami'],
    chapters: [
      'مقدمة الكتاب وفصل أركان الإسلام الخمسة',
      'فصل في أركان الإيمان الستة',
      'فصل في معنى لا إله إلا الله',
      'فصل في علامات البلوغ في الذكر والأنثى',
      'فصل في شروط إجزاء الاستنجاء بالحجر',
      'فصل في فروض الوضوء الستة ونيته',
      'فصل في أقسام الماء وأحكامه الطاهر والطهور والمتنجس',
      'فصل في موجبات الغسل الستة ومفروضاته',
      'فصل في شروط صحة الوضوء والغسل',
      'فصل في نواقض الوضوء ومبطلاته الأربعة',
      'فصل في محرمات الحدث الأصغر والحدث الأكبر والحيض',
      'فصل في أسباب التيمم ومسوغاته الثلاثة',
      'فصل في شروط التيمم وفروضه ومبطلاته',
      'فصل في النجاسات وأقسامها المغلظة والمخففة والمتوسطة',
      'فصل في كيفية تطهير النجاسات',
      'فصل في أحكام الحيض والنفاس والاستحاضة وأقلها وأكثرها',
      'فصل في أعذار الصلاة المسقطة والمبيحة للتقديم والتأخير',
      'فصل في شروط صحة الصلاة الثمانية',
      'فصل في أحداث الصلاة ومبطلاتها',
      'فصل في أركان الصلاة السبعة عشر',
      'فصل في نية الصلاة وشروط تكبيرة الإحرام',
      'فصل في شروط صحة الفاتحة وتشديداتها',
      'فصل في سنن الصلاة: أبعاضها وهيئاتها',
      'فصل في سجود السهو وأسبابه الأربعة',
      'فصل في سجدات التلاوة والشكر',
      'فصل في أوقات الصلاة والتحريم',
      'فصل في صلاة الجماعة وشروط القدوة والإمامة',
      'فصل في صلاة المسافر: القصر والجمع في السفر',
      'فصل في صلاة الجمعة وشروط وجوبها وإقامتها',
      'فصل في أحكام الجنائز: الغسل والتكفين والصلاة والدفن',
      'فصل في أحكام الزكاة ومصارفها الثمانية',
      'فصل في أحكام الصيام وشروطه ومفطراته',
      'فصل في كفارة الفطر وقضاء رمضان والفدية',
      'فصل في الاعتكاف وشروطه',
      'خاتمة في التوبة النصوح والوصايا النافعة',
    ],
  },
  {
    id: 'kasyifatus-saja',
    name: 'Kasyifatus Saja',
    arabicName: 'كاشفة السجا في شرح سفينة النجا',
    author: 'Al-Allamah Syaikh Muhammad Nawawi Al-Bantani',
    keywords: ['kasyifatus', 'kasyifah', 'كاشفة', 'السجا', 'كاشفة السجا', 'نووي البنتني'],
    chapters: [
      'مقدمة الشارح العلامة نووي البنتني',
      'فصل في أركان الإسلام الخمسة وبيان أسرارها',
      'فصل في أركان الإيمان الستة وأصول العقيدة',
      'فصل في كلمة التوحيد وشروطها',
      'فصل في علامات البلوغ وأحكام التكليف',
      'فصل في آداب الاستنجاء والاستطابة بالحجر والماء',
      'فصل في فروض الوضوء وسننه الكاملة',
      'فصل في أقسام المياه وأحكام الماء القليل والكثير',
      'فصل في موجبات الغسل الأكبر ومفروضاته وسننه',
      'فصل في شروط صحة الطهارة من الوضوء والغسل',
      'فصل في نواقض الوضوء وأسباب الحدث الأصغر',
      'فصل في محرمات الحدثين والحيض والنفاس',
      'فصل في أسباب التيمم ومسوغاته وشروطه وأركانه',
      'فصل في أنواع النجاسات وطرق تطهير العينية والحكمية',
      'فصل في أحكام الحيض والنفاس والاستحاضة وطهر المرأة',
      'فصل في أعذار الصلاة المبيحة للجمع والتقديم',
      'فصل في شروط صحة الصلاة الثمانية وقبولها',
      'فصل في أركان الصلاة السبعة عشر وتفاصيلها',
      'فصل في شروط تكبيرة الإحرام وأذكار الافتتاح',
      'فصل في شروط قراءة الفاتحة وتشديداتها السبع عشرة',
      'فصل في الركوع والاعتدال والسجود والطمأنينة',
      'فصل في التشهد الأخير والصلاة على النبي والتسليم',
      'فصل في سنن الصلاة: الأبعاض والهيئات ودعاء القنوت',
      'فصل في سجود السهو وأحكامه ومواضعه',
      'فصل في أوقات الصلاة المكروهة والمحرمة',
      'فصل في صلاة الجماعة وفضلها وشروط الإمام والمأموم',
      'فصل في صلاة المسافر: رخص القصر والجمع وشروطهما',
      'فصل في صلاة الجمعة وفرائضها والخطبتين',
      'فصل في الجنائز: غسل الميت وتكفينه والصلاة عليه ودفنه',
      'فصل في زكاة الأموال وزكاة الفطر ومصارفها الثمانية',
      'فصل في فرائض الصيام وسننه ومفسداته وأحكام القضاء',
      'فصل في كفارات الإفطار العمد والفدية',
      'فصل في الاعتكاف في المساجد وشروطه ومبطلاته',
      'خاتمة جامعة في محاسبة النفس والتوبة والاستغفار',
    ],
  },
  {
    id: 'fathul-qarib',
    name: 'Fathul Qarib (Taqrib)',
    arabicName: 'فتح القريب المجيب في شرح ألفاظ التقريب',
    author: 'Al-Allamah Ibnu Qasim Al-Ghazi / Al-Qadhi Abu Syuja\'',
    keywords: [
      'fathul qarib',
      'qarib',
      'taqrib',
      'تقريب',
      'قريب',
      'غاية الاختصار',
      'فتح القريب',
      'ابن قاسم',
      'أبي شجاع',
    ],
    chapters: [
      'ترجمة المصنف والشارح: الشيخ محمد نووي البنتني والشيخ زين الدين المليباري',
      'كتاب الطهارة: أقسام المياه وما يطهر وما لا يطهر',
      'فصل في آنية الذهب والفضة والسواك وسننه',
      'فصل في فروض الوضوء وسننه ونواقضه',
      'فصل في موجبات الغسل وفروضه وسننه',
      'فصل في المسح على الخفين وشروطه ومدته',
      'فصل في التيمم وشرائطه وفرائضه وسننه ومبطلاته',
      'فصل في إزالة النجاسات وأقسامها',
      'فصل في أحكام الحيض والنفاس والاستحاضة',
      'كتاب الصلاة: مواقيت الصلاة المفروضة وشروط وجوبها',
      'فصل في شروط صحة الصلاة وأركانها وسننها',
      'فصل في سجود السهو ومواضعه وسجدات التلاوة والشكر',
      'فصل في الأوقات التي تكره فيها الصلاة',
      'فصل في صلاة الجماعة وشروط الإمامة',
      'فصل في صلاة المسافر: أحكام القصر والجمع',
      'فصل في صلاة الجمعة وشروط وجوبها وصحتها وأركان الخطبتين',
      'فصل في صلاة العيدين وصلاة الكسوفين وصلاة الاستسقاء',
      'فصل في صلاة الخوف وأحوالها',
      'فصل في أحكام اللباس والحرير وخاتم الذهب',
      'فصل في أحكام الجنائز والغسل والتكفين والصلاة والدفن',
      'كتاب الزكاة: شروط وجوب الزكاة وأصنافها الخمسة',
      'فصل في زكاة المواشي والذهب والفضة والزروع والتجارة',
      'فصل في زكاة الفطر وقدرها ومصارف الزكاة الثمانية',
      'كتاب الصيام: شرائط وجوب الصيام وفرائضه ومفطراته',
      'فصل في مستحبات الصيام وصوم التطوع وفدية العاجز',
      'فصل في أحكام الاعتكاف وشروطه',
      'كتاب الحج والعمرة: شرائط الوجوب وأركانهما وواجباتهما',
      'فصل في سنن الحج ومحظورات الإحرام والدماء الواجبة',
      'فصل في الأضحية والعقيقة وأحكام الذبائح',
      'كتاب البيوع والمعاملات المالية: أنواع البيوع وشروط العقد',
      'فصل في الربا وأحكام الصرف وخيار المجلس والشرط والعيب',
      'فصل في بيع السلم وشرائطه وأحكام الرهن',
      'فصل في الحوالة والضمان والكفالة والشركة والوكالة',
      'فصل في الإقرار والعارية والغصب والشفعة',
      'فصل في القراض والمساقاة والإجارة والجعالة',
      'فصل in المزارعة والمخابرة وإحياء الموات والوقف',
      'فصل في الهبة واللقطة واللقيط والوديعة',
      'كتاب الفرائض والوصايا والمواريث وأصحاب الفروض',
      'فصل في الحجب والرد والعول والمناسخات والوصية',
      'كتاب النكاح وما يتعلق به من أحكام الخطبة والصداق والوليمة',
      'فصل في القسم والنشوز والخلع والطلاق والرجعة',
      'فصل في الإيلاء والظهار والكفارات واللعان والعدة والاستبراء',
      'فصل في الرضاع ونفقة الزوجة والأقارب والحضانة',
      'كتاب الجنايات: القصاص في النفس والأطراف وشروطه',
      'فصل في الديات وأنواعها وكفارة القتل والقسامة',
      'كتاب الحدود: حد الزنا والقذف والسرقة وقطع الطريق والمسكر والردة',
      'كتاب الجهاد: شروط وجوبه وأحكام الأسرى والغنائم والجزية',
      'كتاب الصيد والذبائح والأطعمة والأشربة المحرمة والمباحة',
      'كتاب الأيمان والنذور وأحكام كفارة اليمين',
      'كتاب الأقضية والشهادات والقسمة والدعاوى والبينات',
      'كتاب العتق والتدبير والكتابة وأمهات الأولاد',
    ],
  },
  {
    id: 'minhajut-thalibin',
    name: 'Minhajut Thalibin',
    arabicName: 'منهاج الطالبين وعمدة المفتين في فقه الإمام الشافعي',
    author: 'Al-Imam Yahya bin Syaraf An-Nawawi',
    keywords: ['minhaj', 'thalibin', 'منهاج', 'الطالبين', 'النووي', 'nawawi'],
    chapters: [
      'مقدمة الإمام النووي وخطبة المنهاج',
      'كتاب الطهارة: المياه والوضوء والغسل',
      'باب المسح على الخفين والتيمم وإزالة النجاسة',
      'باب الحيض والنفاس والاستحاضة',
      'كتاب الصلاة: المواقيت والأذان وشروط الصلاة',
      'باب صفة الصلاة وأركانها وسننها',
      'باب سجود السهو والتلاوة وصلاة التطوع',
      'باب صلاة الجماعة والإمامة',
      'باب صلاة المسافر والجمعة والخوف والعيدين والكسوف والاستسقاء',
      'باب أحكام الجنائز والدفن',
      'كتاب الزكاة: زكاة النعم والنقدين والزروع والتجارة والفطر',
      'باب قسم الصدقات ومصارف الزكاة',
      'كتاب الصيام والاعتكاف',
      'كتاب الحج والعمرة والمناسك',
      'باب الإحرام ومحظوراته والدماء الواجبة',
      'كتاب البيوع وأحكام العقود والربا والخيار',
      'باب السلم والرهن والتفليس والحجر والصلح والحوالة والضمان والشركة',
      'باب الوكالة والإقرار والعارية والغصب والشفعة والقراض والمساقاة والإجارة',
      'باب إحياء الموات والوقف والهبة واللقطة واللقيط والوديعة',
      'كتاب الفرائض والوصايا',
      'كتاب النكاح والصداق والقسم والنشوز والخلع والطلاق والرجعة',
      'باب الإيلاء والظهار واللعان والعدة والرضاع والنفقات والحضانة',
      'كتاب الجنايات والديات والقسامة وكفارة القتل',
      'كتاب الحدود: الزنا والقذف والسرقة والحرابة والمسكر والردة والبغاة',
      'كتاب الجهاد والجزية والهدنة والغنائم',
      'كتاب الصيد والذبائح والأطعمة والأضحية والأيمان والنذور',
      'كتاب القضاء والشهادات والدعاوى والبينات',
      'كتاب العتق والتدبير والكتابة والاستيلاد',
    ],
  },
  {
    id: 'bidayatul-hidayah',
    name: 'Bidayatul Hidayah',
    arabicName: 'بداية الهداية في آداب السلوك والتقوى',
    author: 'Hujjatul Islam Al-Imam Abu Hamid Al-Ghazali',
    keywords: ['bidayah', 'bidayatul', 'بداية', 'الهداية', 'الغزالي', 'ghazali'],
    chapters: [
      'مقدمة الكتاب في طلب العلم والنية الصادقة',
      'القسم الأول في الطاعات: آداب الاستيقاظ من النوم',
      'آداب دخول الخلاء والاستنجاء',
      'آداب الوضوء وأذكاره عند كل عضو',
      'آداب الغسل والتيمم',
      'آداب الخروج إلى المسجد والمكث فيه',
      'آداب ما بعد طلوع الشمس إلى الزوال',
      'آداب الاستعداد لسائر الصلوات الخمس',
      'آداب النوم والاستعداد للموت',
      'آداب الصلاة وأسرار أركانها والخشوع',
      'آداب الإمامة والقدوة وصلاة الجمعة',
      'آداب الصيام والإفطار',
      'القسم الثاني في اجتناب المعاصي: حفظ العين من النظر المحرم',
      'حفظ الأذن من استماع الغيبة والباطل',
      'حفظ اللسان من الكذب والغيبة والنميمة والمراء والمدح والمزاح',
      'حفظ البطن من الشبهات والحرام',
      'حفظ الفرج واليدين والرجلين',
      'معاصي القلب: الحسد والرياء والعجب والكبر',
      'القسم الثالث في آداب الصحبة والمعاشرة: صحبة الأستاذ والعالم',
      'آداب صحبة المتعلم والعامي والأصحاب والإخوان',
      'آداب معاشرة سائر الخلق والأقارب',
      'خاتمة الكتاب في جوامع الآداب والوصايا',
    ],
  },
  {
    id: 'riyadhus-shalihin',
    name: 'Riyadhus Shalihin',
    arabicName: 'رياض الصالحين من كلام سيد المرسلين',
    author: 'Al-Imam Yahya bin Syaraf An-Nawawi',
    keywords: ['riyadh', 'riyadlus', 'الصالحين', 'رياض', 'رياض الصالحين', 'nawawi'],
    chapters: [
      'باب الإخلاص وإحضار النية في جميع الأعمال',
      'باب التوبة والاستغفار',
      'باب الصبر على طاعة الله والبلاء',
      'باب الصدق والأمانة',
      'باب المراقبة وتقوى الله تعالى',
      'باب اليقين والتوكل على الله',
      'باب الاستقامة ولزوم السنة',
      'باب التفكر في عظيم خلق الله وفناء الدنيا',
      'باب المبادرة إلى الخيرات',
      'باب المجاهدة ومحاسبة النفس',
      'باب الحث على الازدياد من الخير في أواخر العمر',
      'باب بيان كثرة طرق الخير',
      'باب الاقتصاد في الطاعة',
      'باب المحافظة على الأعمال الصالحة',
      'باب الأمر بالمحافظة على السنة وآدابها',
      'باب وجوب الانقياد لحكم الله تعالى',
      'باب النهي عن البدع ومحدثات الأمور',
      'باب الأمر بالمعروف والنهي عن المنكر',
      'باب تغليظ عقوبة من أمر بمعروف ولم يفعله',
      'باب الأمر بأداء الأمانة وحرمة الظلم',
      'باب بر الوالدين وصلة الأرحام',
      'باب تحريم العقوق وقطيعة الرحم',
      'باب فضل الإحسان إلى البنات واليتامى والضعفاء',
      'باب الوصية بالنساء وحسن معاشرتهن',
      'باب حقوق الزوج على المرأة',
      'باب النفقة على العيال والخدم',
      'باب حق الجار والوصية به',
      'باب كظم الغيظ والحلم والعفو والرفق',
      'باب الستر على المسلمين وقضاء حوائجهم',
      'باب الشفاعة والإصلاح بين الناس',
      'باب فضل ضعفة المسلمين والفقراء والخاملين',
      'باب ملاطفة اليتيم والمسكين والضعفاء',
      'باب التواضع وخفض الجناح للمؤمنين',
      'باب تحريم الكبر والإعجاب بالنفس',
      'باب حسن الخلق والحياء والأدب',
      'باب صيام رمضان والنوافل وفضل ليلة القدر',
      'باب الاعتكاف والحج والجهاد في سبيل الله',
      'باب فضل العلم وتلاوة القرآن العظيم',
      'باب الأذكار والدعوات والاستغفار في سائر الأحوال',
      'خاتمة في جوامع الأدعية النبوية المباركة',
    ],
  },
  {
    id: 'bulughul-maram',
    name: 'Bulughul Maram',
    arabicName: 'بلوغ المرام من أدلة الأحكام',
    author: 'Al-Hafizh Ibnu Hajar Al-Asqalani',
    keywords: ['bulugh', 'maram', 'بلوغ', 'المرام', 'بلوغ المرام', 'ابن حجر', 'asqalani'],
    chapters: [
      'كتاب الطهارة: باب المياه والآنية',
      'باب إزالة النجاسة وبيانها',
      'باب الوضوء ونواقضه',
      'باب الغسل وحكم الجنب',
      'باب التيمم والمسح على الخفين',
      'باب الحيض والنفاس',
      'كتاب الصلاة: باب المواقيت والأذان',
      'باب شروط الصلاة وصفة الصلاة',
      'باب سجود السهو وصلاة التطوع',
      'باب صلاة الجماعة والإمامة والمسافر',
      'باب صلاة الجمعة والخوف والعيدين والكسوف والاستسقاء',
      'كتاب الجنائز: الغسل والتكفين والصلاة والدفن',
      'كتاب الزكاة: زكاة الأموال والفطر وقسم الصدقات',
      'كتاب الصيام: صيام الفرض والتطوع والاعتكاف',
      'كتاب الحج والعمرة: فضله والمواقيت والإحرام والمناسك',
      'كتاب البيوع: شروط البيع والربا والخيار والسلم والرهن',
      'باب الحوالة والضمان والشركة والوكالة والمساقاة والإجارة',
      'كتاب النكاح: شروطه والكفاءة والصداق والوليمة والطلاق والرجعة والعدة',
      'كتاب الجنايات: القصاص والديات والقسامة والحدود والجهاد',
      'كتاب الأطعمة والصيد والذبائح والأضحية والأيمان والنذور',
      'كتاب القضاء والشهادات والدعاوى والبينات والعتق',
      'كتاب الجامع: باب الأدب والبر والصلة والزهد والورع والذكر والدعاء',
    ],
  },
  {
    id: 'talimul-mutaallim',
    name: 'Ta\'limul Muta\'allim',
    arabicName: 'تعليم المتعلم طريق التعلم',
    author: 'Al-Imam Burhanul Islam Az-Zarnuji',
    keywords: ['talim', 'ta\'lim', 'mutaallim', 'تعليم', 'المتعلم', 'zarnuji', 'الزرنوجي'],
    chapters: [
      'فصل في ماهية العلم والفقه وفضلهما',
      'فصل في النية في حال التعلم وإخلاص القصد',
      'فصل في اختيار العلم والأستاذ والشريك والثبات',
      'فصل في تعظيم العلم وأهله وتوقير المعلم والكتب',
      'فصل في الجد والمواظبة وعلو الهمة وملازمة الدرس',
      'فصل في بداية السبق وقدره وترتيبه في الأيام',
      'فصل في التوكل على الله تعالى وترك الهم للرزق',
      'فصل في وقت التحصيل وساعات المذاكرة',
      'فصل في الشفقة والنصيحة والابتعاد عن الحسد',
      'فصل في الاستفادة واقتباس الفوائد وكتابتها',
      'فصل في الورع في حالة التعلم والاحتراز من الشبهات',
      'فصل فيما يورث الحفظ وفيما يورث النسيان',
      'فصل فيما يجلب الرزق وفيما يمنعه وما يزيد في العمر',
      'خاتمة الكتاب في الدعوات والأذكار للتحصيل والتوفيق',
    ],
  },
  {
    id: 'al-hikam',
    name: 'Al-Hikam Al-Atha\'iyyah',
    arabicName: 'الحكم العطائية مع المناجاة الإلهية',
    author: 'Al-Imam Ibnu Atha\'illah As-Sakandari',
    keywords: ['hikam', 'athaillah', 'الحكم', 'العطائية', 'ابن عطاء الله', 'sakandari'],
    chapters: [
      'حكم التجريد والأسباب والاعتماد على الأعمال',
      'إرادة العبد وإرادة الرب وسوابق الهمم',
      'راحة القلب من التدبير وفضل الافتقار',
      'إجابة الدعاء ومواعيد العطاء والمنع',
      'نور البصيرة وشواهد القدرة الإلهية',
      'خمود الأكوان وظهور نور المكون سبحانه',
      'حقائق الأعمال وصورها وأرواحها في الإخلاص',
      'دفن الوجود في أرض الخمول وأثره',
      'العزلة والتفكر وتنوير مرائي القلوب',
      'أنواع الواردات والأحوال وحفظ السرائر',
      'حقيقة الرجاء والخوف وقبض القلوب وبسطها',
      'أسرار العطاء والمنع ومعرفة النعم في البلاء',
      'المناجاة الإلهية والضراعة عند عتبة الربوبية',
    ],
  },
  {
    id: 'sullamut-taufiq',
    name: 'Sullamut Taufiq',
    arabicName: 'سلم التوفيق إلى محبة الله على التحقيق',
    author: 'Al-Habib Abdullah bin Husain bin Thahir Ba\'alawi',
    keywords: ['sullam', 'taufiq', 'سلم التوفيق', 'ابن طاهر', 'baalawi'],
    chapters: [
      'مقدمة في أصول الإيمان والعقيدة والواجبات العينية',
      'بيان أنواع الردة وأسباب الكفر والتحذير منها',
      'أحكام الطهارة وفروض الوضوء والغسل وشروطهما',
      'أحكام الصلاة وشروطها وأركانها ومبطلاتها',
      'صلاة الجماعة والجمعة وأحكام تارك الصلاة',
      'أحكام الزكاة والصدقات والورع في المال',
      'أحكام الصيام وشروطه والاعتكاف والحج والعمرة',
      'أحكام المعاملات والبيوع والربا والغش',
      'معاصي القلب: الحسد والكبر والرياء والعجب',
      'معاصي اللسان: الغيبة والنميمة والكذب والسب واليمين الغموس',
      'معاصي العين والأذن واليد والرجل والبطن والفرج وسائر البدن',
      'خاتمة في التوبة النصوح والاستغفار وشروط قبولها',
    ],
  },
  {
    id: 'risalatul-jamiah',
    name: 'Ar-Risalah Al-Jami\'ah',
    arabicName: 'الرسالة الجامعة والتذكرة النافعة',
    author: 'Al-Imam Ahmad bin Zain Al-Habsyi',
    keywords: ['jamiah', 'jami\'ah', 'جامعة', 'الرسالة الجامعة', 'الحبشي', 'habsyi'],
    chapters: [
      'مقدمة الكتاب وأركان الإسلام والإيمان',
      'فصل في الإخلاص وصدق النية ومراقبة الله',
      'فصل في أحكام الطهارة والوضوء والغسل',
      'فصل في الصلاة المفروضة وشروطها وأركانها ومبطلاتها',
      'فصل في صلاة الجماعة وسنن الصلوات الرواتب',
      'فصل في أحكام الزكاة والصيام وحج بيت الله الحرام',
      'فصل في معاصي القلب وحفظ الباطن',
      'فصل في معاصي الجوارح السبعة: اللسان والعين والأذن واليد والبطن والفرج والرجل',
      'خاتمة في التوبة النصوح والدعوات المباركة',
    ],
  },
  {
    id: 'aqidatul-awam',
    name: 'Aqidatul Awam',
    arabicName: 'منظومة عقيدة العوام في أصول الإيمان',
    author: 'Al-Allamah As-Sayyid Ahmad Al-Marzuqi Al-Maliki',
    keywords: ['aqidat', 'awam', 'عقيدة', 'العوام', 'المرزوقي', 'marzuqi'],
    chapters: [
      'مقدمة المنظومة والبسملة والحمدلة',
      'الصفات الواجبة لله تعالى العشرين وصفاته المستحيلة والجائزة',
      'صفات الرسل عليهم الصلاة والسلام الواجبة والمستحيلة والجائزة',
      'أسماء الرسل الخمسة والعشرين المذكورين في القرآن',
      'أسماء الملائكة العشرة ووظائفهم',
      'الكتب السماوية الأربعة المنزلة على الأنبياء',
      'الإيمان باليوم الآخر والحشر والحساب والميزان والجنة والنار',
      'نسب النبي صلى الله عليه وسلم وأولاده وزوجاته أمهات المؤمنين',
      'أعمام النبي وعماته ومرضعته صلى الله عليه وسلم',
      'معجزة الإسراء والمعراج وفرض الصلوات الخمس',
      'خاتمة المنظومة وتاريخ نظمها والوصية بحفظها',
    ],
  },
  {
    id: 'nadhom-imrithi',
    name: 'Nadhom Al-Imrithi',
    arabicName: 'نظم الدرة البهية في متممة الآجرومية',
    author: 'Al-Imam Syarafuddin Yahya Al-Imrithi',
    keywords: ['imrithi', 'imriti', 'عمريطي', 'العمريطي', 'الدرة البهية'],
    chapters: [
      'مقدمة الناظم والحمد والثناء',
      'باب الكلام وأقسامه الثلاثة: اسم وفعل وحرف',
      'باب الإعراب وعلاماته الأصلية والفرعية',
      'باب علامات الرفع: الضمة والواو والألف والنون',
      'باب علامات النصب: الفتحة والألف والكسرة والياء وحذف النون',
      'باب علامات الخفض: الكسرة والياء والفتحة',
      'باب علامات الجزم: السكون والحذف',
      'باب النكرة والمعرفة وأنواع المعارف الستة',
      'باب الأفعال: الماضي والمضارع والأمر وإعرابها',
      'باب نواصب الفعل المضارع وجوازمه',
      'باب مرفوعات الأسماء: الفاعل ونائب الفاعل',
      'باب المبتدأ والخبر وأنواعهما',
      'باب العوامل الداخلة على المبتدأ والخبر: كان وأخواتها وإن وأخواتها وظن وأخواتها',
      'باب النعت والعطف والتوكيد والبدل',
      'باب منصوبات الأسماء: المفعول به والمصدر وظرف الزمان وظرف المكان',
      'باب الحال والتمييز والاستثناء وغيره',
      'باب لا النافية للجنس والمنادى والمفعول من أجله والمفعول معه',
      'باب المخفوضات من الأسماء: المخفوض بالحرف والمخفوض بالإضافة والخاتمة',
    ],
  },
  {
    id: 'uqudul-lujjain',
    name: 'Uqudul Lujjain',
    arabicName: 'عقود اللجين في بيان حقوق الزوجين',
    author: 'Al-Allamah Syaikh Muhammad Nawawi Al-Bantani',
    keywords: ['uqud', 'lujjain', 'عقود', 'اللجين', 'عقود اللجين', 'نووي البنتني'],
    chapters: [
      'مقدمة المصنف في مقاصد النكاح والوفاق',
      'الباب الأول: في حقوق الزوج على زوجته ووجوب طاعته بالمعروف',
      'فصل في التحذير الشديد من عقوق الزوج ومخالفته',
      'الباب الثاني: في حقوق الزوجة على زوجها وحسن معاشرتها',
      'فصل في النفقة والكسوة والمبيت والعدل بين الزوجات',
      'الباب الثالث: في فضيلة صلاة المرأة في بيتها وسترها',
      'الباب الرابع: في تحريم نظر الرجل إلى الأجنبية ونظرها إليه وعفة الفرج',
      'خاتمة الكتاب في وصايا جامعة لحياة أسرية مباركة ودعوات',
    ],
  },
];

/**
 * Intelligent detector and generator for Kitab chapters.
 * Extracts real PDF outlines, printed Fihris pages, running text headings,
 * or classical Islamic book structures.
 */
export async function detectOrGenerateKitabChapters(
  pdfDoc: any | null,
  title: string,
  totalPages: number
): Promise<KitabChapter[]> {
  const normTitle = normalizeArabicTitle(title);
  const cleanTitleNoSpaces = normTitle.replace(/\s+/g, '');

  // 1. First, check if book matches our rich classical Turats library (e.g. Nihayatuz Zain 46 chapters, Tsamratu ar-Raudhah 36 chapters, etc.)
  let matchedTemplate: TuratsKitabTemplate | null = null;
  for (const tpl of POPULAR_TURATS_TEMPLATES) {
    const matched = tpl.keywords.some((kw) => {
      const normKw = normalizeArabicTitle(kw);
      const kwNoSpaces = normKw.replace(/\s+/g, '');
      return (
        normTitle.includes(normKw) ||
        normKw.includes(normTitle) ||
        (kwNoSpaces.length >= 3 && cleanTitleNoSpaces.includes(kwNoSpaces)) ||
        (cleanTitleNoSpaces.length >= 3 && kwNoSpaces.includes(cleanTitleNoSpaces))
      );
    });
    if (matched) {
      matchedTemplate = tpl;
      break;
    }
  }

  // 2. If PDF has real embedded bookmarks, check if they are rich
  if (pdfDoc) {
    const minRequired = matchedTemplate ? Math.floor(matchedTemplate.chapters.length * 0.8) : 4;

    try {
      const outlineChapters = await extractChaptersFromPdfDoc(pdfDoc);
      if (outlineChapters && outlineChapters.length >= minRequired) {
        return outlineChapters;
      }
    } catch (e) {
      console.warn('Error reading outline:', e);
    }

    // 3. Try scanning printed Fihris pages in PDF
    try {
      const fihrisFromPdf = await scanPrintedFihrisPages(pdfDoc);
      if (fihrisFromPdf && fihrisFromPdf.length >= 2) {
        return fihrisFromPdf;
      }
    } catch (e) {
      console.warn('Error scanning printed fihris page:', e);
    }
  }

  // 4. If matched with our classical Turats library, return its full authentic chapters!
  if (matchedTemplate) {
    if ((matchedTemplate as any).chapterEntries) {
      return (matchedTemplate as any).chapterEntries.map((e: any, idx: number) => ({
        id: `${matchedTemplate!.id}-${idx + 1}`,
        number: String(idx + 1).padStart(2, '0'),
        title: e.title,
        startPage: e.startPage,
      }));
    }

    const numCh = matchedTemplate.chapters.length;
    const pagesStep = Math.max(1, Math.floor(totalPages / numCh));
    const rawTemplateChapters: KitabChapter[] = matchedTemplate.chapters.map((chName, idx) => ({
      id: `${matchedTemplate!.id}-${idx + 1}`,
      number: String(idx + 1).padStart(2, '0'),
      title: chName,
      startPage: idx === 0 ? 1 : Math.min(totalPages, Math.max(2, Math.round(idx * pagesStep))),
    }));

    if (pdfDoc) {
      return await autoAlignChaptersWithPdfPages(pdfDoc, rawTemplateChapters, totalPages);
    }
    return rawTemplateChapters;
  }

  // 5. If unlisted book and PDF is loaded, scan full-text headings across all pages
  if (pdfDoc) {
    try {
      const scannedChapters: KitabChapter[] = [];
      const pagesToScan = Math.min(pdfDoc.numPages, 400);

      for (let i = 1; i <= pagesToScan; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;
        if (items && items.length > 0) {
          const lineBuckets: { y: number; text: string }[] = [];
          for (const item of items) {
            if ('str' in item && item.str.trim().length > 0) {
              const y = Math.round(item.transform[5]);
              const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 6);
              if (existing) {
                existing.text += (existing.text.endsWith(' ') ? '' : ' ') + item.str;
              } else {
                lineBuckets.push({ y, text: item.str });
              }
            }
          }
          lineBuckets.sort((a, b) => b.y - a.y);
          const lines = lineBuckets.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean);

          for (const line of lines) {
            const cleanLine = stripArabicTashkeel(line.trim());
            const isArabicHeading =
              /^[\(\[\{]?(كتاب|الكتاب|باب|الباب|فصل|الفصل|مقدمة|المقدمة|خاتمة|الخاتمة|تنبيه|تنبيهات|فائدة|فوائد|فرع|فروع|مسألة|مسائل|بحث|مطلب|مطالب|مقصد|مقاصد|قاعدة|القاعدة|أصل|الأصل|مبحث|المبحث|قسم|القسم|ضابط|الضابط|نظم|المنظومة|شرح|بيان|القول في|تتمة|التتمة)\s*(\S+|$)/i.test(cleanLine);
            const isLatinHeading =
              /^(bab|fasal|fasl|pasal|bagian|juz|chapter|kitab|muqaddimah|khatimah|kaidah)\b/i.test(cleanLine);

            if ((isArabicHeading || isLatinHeading) && cleanLine.length >= 3 && cleanLine.length <= 110) {
              const pureTitle = extractArabicTitleOnly(line.trim());
              if (pureTitle.length >= 2 && !scannedChapters.some((c) => c.startPage === i || c.title === pureTitle)) {
                scannedChapters.push({
                  id: `ch-scan-${i}-${scannedChapters.length}`,
                  number: String(scannedChapters.length + 1).padStart(2, '0'),
                  title: pureTitle,
                  startPage: i,
                });
              }
            }
          }
        }
      }

      if (scannedChapters.length >= 3) {
        scannedChapters.sort((a, b) => a.startPage - b.startPage);
        return scannedChapters.map((ch, idx) => ({
          ...ch,
          number: String(idx + 1).padStart(2, '0'),
        }));
      }
    } catch (e) {
      console.warn('Error scanning pages for chapters:', e);
    }
  }

  // 6. Default smart multi-chapter breakdown in pure Arabic for ANY general unlisted PDF
  const numChapters = Math.min(10, Math.max(4, Math.ceil(totalPages / 12)));
  const step = Math.max(1, Math.floor(totalPages / numChapters));

  const arabicOrdinals = [
    'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
    'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر'
  ];

  const generated: KitabChapter[] = [
    {
      id: `gen-${Date.now()}-1`,
      number: '01',
      title: 'مقدمة الكتاب وفاتحة النوازل',
      startPage: 1
    }
  ];

  for (let c = 2; c <= numChapters; c++) {
    const sPage = Math.min(totalPages, (c - 1) * step + 1);
    if (sPage > generated[generated.length - 1].startPage) {
      const ordinal = arabicOrdinals[c - 1] || `${c}`;
      generated.push({
        id: `gen-${Date.now()}-${c}`,
        number: String(c).padStart(2, '0'),
        title: `الفصل ${ordinal} · المبحث والمسائل`,
        startPage: sPage,
      });
    }
  }

  return generated;
}

/**
 * Extracts text & structure from a real PDF file and converts it into a Tang Ketab PocketBook document
 */
export async function convertPdfFileToKitab(
  file: File,
  options: PdfConversionOptions = {}
): Promise<KitabDocument> {
  const rawBuffer = await file.arrayBuffer();
  const storageBuffer = rawBuffer.slice(0);
  const pdfBlobKey = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const kitabId = pdfBlobKey;
  await savePdfArrayBuffer(pdfBlobKey, storageBuffer);

  const uint8Data = new Uint8Array(rawBuffer);
  const cleanData = sanitizePdfBytes(uint8Data);
  const hasEncryption = pdfHasEncryptTag(cleanData);
  let pdfDoc: any = null;

  // Attempt 1: Standard enhanced task with CMap, fonts, and empty/user password
  try {
    const loadingTask = createPdfLoadingTask(cleanData, options.password);
    pdfDoc = await loadingTask.promise;
  } catch (loadErr: any) {
    console.warn('Advanced PDF loading attempt failed, trying robust compatibility modes...', loadErr);

    // Attempt 2: Direct getDocument with local options (bypassing any external CDN issues)
    try {
      const fallbackTask = pdfjsLib.getDocument({
        data: cleanData,
        isEvalSupported: false,
        stopAtErrors: false,
        useSystemFonts: true,
        password: options.password || '',
      });
      fallbackTask.onPassword = (cb: any) => cb(options.password || '');
      pdfDoc = await fallbackTask.promise;
    } catch (fallbackErr: any) {
      console.warn('Fallback 1 failed, trying stream-safe mode...', fallbackErr);

      // Attempt 3: Stream-safe and range-disabled mode for damaged or unbuffered PDFs
      try {
        const streamTask = pdfjsLib.getDocument({
          data: cleanData,
          disableRange: true,
          disableStream: true,
          isEvalSupported: false,
          stopAtErrors: false,
          password: options.password || '',
        });
        streamTask.onPassword = (cb: any) => cb(options.password || '');
        pdfDoc = await streamTask.promise;
      } catch (streamErr: any) {
        // ONLY if the PDF file genuinely has an /Encrypt dictionary AND requires a real user password:
        if (
          hasEncryption &&
          (streamErr?.name === 'PasswordException' ||
            streamErr?.message?.toLowerCase().includes('password') ||
            fallbackErr?.name === 'PasswordException' ||
            loadErr?.name === 'PasswordException')
        ) {
          throw new Error('PDF_PASSWORD_REQUIRED');
        }

        throw new Error(
          streamErr?.message || fallbackErr?.message || loadErr?.message
            ? `Gagal membaca format PDF: ${streamErr?.message || fallbackErr?.message || loadErr?.message}`
            : 'Dokumen PDF tidak dapat dimuat. Pastikan berkas adalah PDF yang valid.'
        );
      }
    }
  }

  // Cache opened document for instantaneous reader opening
  if (pdfDoc) {
    globalPdfDocCache.set(pdfBlobKey, pdfDoc);
  }

  const numPages = Math.max(1, pdfDoc.numPages || 1);
  const cleanFileName = file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim();

  // Extract or generate comprehensive detailed Arabic Fihris immediately upon upload
  let chapters: KitabChapter[] = [];
  try {
    chapters = await detectOrGenerateKitabChapters(pdfDoc, cleanFileName, numPages);
  } catch (err) {
    console.warn('Initial chapter extraction failed:', err);
  }

  if (!chapters || chapters.length === 0) {
    chapters = [
      {
        id: `ch-init-1`,
        number: '01',
        title: 'مقدمة الكتاب وفاتحة النوازل',
        startPage: 1,
      },
    ];
  }

  const pages: KitabPage[] = [];
  let currentChapterTitle = chapters[0]?.title || 'مقدمة الكتاب';

  // For high performance and crash-prevention on large PDFs (e.g. 500+ pages),
  // extract text content deeply for up to first 40 pages, while preserving
  // full canvas visual rendering for all pages.
  const maxPagesToExtractText = Math.min(numPages, 40);

  for (let i = 1; i <= numPages; i++) {
    if (options.onProgress && i % 4 === 0) {
      options.onProgress(i, numPages);
    }

    const matchedOutlineChapter = chapters.find((ch) => ch.startPage === i);
    if (matchedOutlineChapter) {
      currentChapterTitle = matchedOutlineChapter.title;
    }

    const paragraphs: string[] = [];

    if (i <= maxPagesToExtractText) {
      try {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();

        const lineBuckets: { y: number; text: string }[] = [];
        for (const item of textContent.items) {
          if ('str' in item && item.str.trim().length > 0) {
            const y = Math.round(item.transform[5]);
            const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 5);
            if (existing) {
              existing.text += (existing.text.endsWith(' ') ? '' : ' ') + item.str;
            } else {
              lineBuckets.push({ y, text: item.str });
            }
          }
        }

        lineBuckets.sort((a, b) => b.y - a.y);
        const rawLines = lineBuckets.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean);

        let bufferParagraph = '';
        for (const line of rawLines) {
          if (!bufferParagraph) {
            bufferParagraph = line;
          } else if (bufferParagraph.length < 260 && !/[.!?:”"']$/.test(bufferParagraph)) {
            bufferParagraph += ' ' + line;
          } else if (bufferParagraph.length < 180) {
            bufferParagraph += ' ' + line;
          } else {
            paragraphs.push(bufferParagraph);
            bufferParagraph = line;
          }
        }
        if (bufferParagraph) {
          paragraphs.push(bufferParagraph);
        }
      } catch (pageErr) {
        console.warn(`Text extraction skipped for page ${i}:`, pageErr);
      }
    }

    if (paragraphs.length === 0) {
      paragraphs.push(
        `[Halaman ${i} · Naskah Kitab Dokumen PDF Asli]`
      );
    }

    pages.push({
      pageNumber: i,
      chapterTitle: currentChapterTitle,
      paragraphs,
      footnote: `Diekstrak dari berkas PDF "${file.name}" · Lembar ${i} dari ${numPages}`,
    });
  }

  // 3. If still <= 1 chapter, run smart detector for this specific book
  if (chapters.length <= 1) {
    try {
      const finalChapters = await detectOrGenerateKitabChapters(
        pdfDoc,
        options.customTitle || cleanFileName,
        numPages
      );
      if (finalChapters && finalChapters.length > 0) {
        chapters = finalChapters;
      }
    } catch (detectErr) {
      console.warn('Final chapter detection fallback:', detectErr);
    }
  }

  const fileSizeKB = Math.max(1, Math.round(file.size / 1024));
  const fileSizeLabel =
    fileSizeKB > 1024
      ? `PDF Terunggah (${(fileSizeKB / 1024).toFixed(1)} MB)`
      : `PDF Terunggah (${fileSizeKB} KB)`;

  const pdfUrl = await uploadPdfToStorage(kitabId, file);

  return {
    id: kitabId,
    catalogNumber: `TK-PDF.${String(Math.floor(100 + Math.random() * 899))}`,
    title: options.customTitle?.trim() || cleanFileName || 'Kitab PDF Pribadi',
    subtitle:
      options.customSubtitle?.trim() ||
      `Dikonversi ke format PocketBook dari berkas ${file.name} (${numPages} Halaman)`,
    author: options.customAuthor?.trim() || 'Koleksi PDF Pribadi',
    category: options.customCategory?.trim() || 'Maktabah PDF',
    language: 'Dokumen PDF · PocketBook',
    totalPages: numPages,
    lastReadPage: 1,
    bookmarks: [1],
    addedAt: 'Baru saja diunggah',
    isUploadedPdf: true,
    fileSizeLabel,
    coverTone: options.coverTone || 'terracotta',
    chapters,
    pages,
    pdfBlobKey,
    pdfUrl,
  };
}

/**
 * Renders a single page from an uploaded PDF stored in IndexedDB onto a target HTMLCanvasElement
 */
export async function renderPdfPageToCanvas(
  pdfBlobKey: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.35
): Promise<boolean> {
  const buffer = await loadPdfArrayBuffer(pdfBlobKey);
  if (!buffer) return false;

  const loadingTask = createPdfLoadingTask(new Uint8Array(buffer.slice(0)));
  const pdfDoc = await loadingTask.promise;
  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) return false;

  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return false;

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  return true;
}

/**
 * Creates a valid, multi-page binary PDF file in memory so the user can test
 * the full PDF-to-PocketBook upload and conversion pipeline with 1 click.
 */
export function createSampleKitabPdfFile(): File {
  const pageTexts = [
    [
      'Bab I: Risalah Adab Membaca Kitab Tang Ketab Pocket',
      'Bismillahirrahmanirrahim. Segala puji bagi Allah yang telah menurunkan hikmah.',
      'Naskah PDF ini dibuat sebagai contoh nyata dokumen kitab pribadi yang diunggah',
      'ke dalam aplikasi Tang Ketab Pocket lalu langsung disajikan dalam lembar asli.',
      'Setiap halaman PDF dibaca secara langsung beresolusi tinggi agar Anda dapat',
      'menikmati tata letak asli dokumen secara utuh dan mantap.'
    ],
    [
      'Bab II: Tatacara Memberi Makna dan Catatan Hasyiyah',
      'Dalam tradisi keilmuan klasik, seorang santri atau peneliti tidak pernah membaca',
      'kitab dengan tangan kosong. Ia selalu menyiapkan pena untuk menuliskan dhabt',
      '(catatan ketepatan bacaan) serta syarah ringkas di pinggir halaman.',
      'Gunakan fitur Catatan Hasyiyah di sebelah kanan layar untuk mengikat setiap',
      'faidah baru yang Anda temukan pada halaman ke-2 ini.'
    ],
    [
      'Bab III: Mengatur Wirid Bacaan Harian di Tang Ketab',
      'Keunggulan utama antarmuka Tang Ketab Pocket dibandingkan pembaca PDF biasa',
      'adalah fokus halaman demi halaman. Anda dapat memilih mode Lembaran Ganda',
      'layaknya kitab terbuka di atas rehal kayu, atau mode satu halaman penuh.',
      'Setiap berkas PDF disajikan secara aman dan tersimpan rapi di peramban Anda.'
    ],
    [
      'Bab IV: Khatimah dan Doa Penutup Majelis',
      'Semoga ikhtiar menghimpun kitab-kitab PDF pribadi ke dalam pustaka Tang Ketab',
      'ini menjadikan ilmu lebih terjaga, tersusun rapi, dan mudah dirujuk kembali',
      'kapan pun dibutuhkan. Tammat bil khair wal barakah.'
    ]
  ];

  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObjId = addObj(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>`
  );

  const pageObjIds: number[] = [];
  const contentObjIds: number[] = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const lines = pageTexts[i];
    const streamCommands: string[] = ['BT', `/F1 14 Tf`, '54 720 Td', '22 TL'];
    lines.forEach((line, idx) => {
      const escaped = line.replace(/([()\\])/g, '\\$1');
      if (idx === 0) {
        streamCommands.push(`(${escaped}) Tj T* T*`);
      } else {
        streamCommands.push(`(${escaped}) Tj T*`);
      }
    });
    streamCommands.push('ET');
    const streamData = streamCommands.join('\n');
    const contentId = addObj(
      `<< /Length ${streamData.length} >>\nstream\n${streamData}\nendstream`
    );
    contentObjIds.push(contentId);
  }

  const pagesRootId = objects.length + 1 + pageTexts.length;

  for (let i = 0; i < pageTexts.length; i++) {
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjIds[i]} 0 R >>`
    );
    pageObjIds.push(pageId);
  }

  const kidsArray = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  const actualPagesRootId = addObj(
    `<< /Type /Pages /Kids [${kidsArray}] /Count ${pageObjIds.length} >>`
  );

  const catalogId = addObj(
    `<< /Type /Catalog /Pages ${actualPagesRootId} 0 R >>`
  );

  let pdfContent = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdfContent.length);
    pdfContent += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = pdfContent.length;
  pdfContent += `xref\n0 ${objects.length + 1}\n`;
  pdfContent += `0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdfContent += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdfContent += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const blob = new Blob([pdfContent], { type: 'application/pdf' });
  return new File([blob], 'Risalah-Tang-Ketab-Contoh.pdf', {
    type: 'application/pdf',
  });
}

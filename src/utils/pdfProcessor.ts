import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { KitabChapter, KitabDocument, KitabPage } from '../types/kitab';

// Configure PDF.js worker using local Vite asset URL
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

export async function getOrLoadPdfDoc(blobKey: string, rawBuffer?: ArrayBuffer): Promise<any> {
  if (globalPdfDocCache.has(blobKey)) {
    return globalPdfDocCache.get(blobKey);
  }
  let buffer = rawBuffer;
  if (!buffer) {
    buffer = (await loadPdfArrayBuffer(blobKey)) || undefined;
  }
  if (!buffer) return null;

  try {
    const task = createPdfLoadingTask(new Uint8Array(buffer));
    const doc = await task.promise;
    globalPdfDocCache.set(blobKey, doc);
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
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
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

export interface TuratsKitabTemplate {
  id: string;
  name: string;
  arabicName: string;
  author: string;
  keywords: string[];
  chapters: string[];
}

export function normalizeArabicTitle(str: string): string {
  return stripArabicTashkeel(str)
    .toLowerCase()
    .replace(/[أإآء]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[-_\s]+/g, ' ')
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
    id: 'an-nashaih-ad-diniyyah',
    name: 'An-Nashaih Ad-Diniyyah',
    arabicName: 'النصائح الدينية والوصايا الإيمانية',
    author: 'Al-Imam Al-Habib Abdullah bin Alawi Al-Haddad',
    keywords: [
      'نصائح',
      'النصائح',
      'الدينية',
      'الدينيه',
      'nashaih',
      'nasihat',
      'nashoih',
      'nashoihat',
      'nashoihuddiniyah',
      'nashaihud',
      'diniyah',
      'diniyyah',
      'haddad',
      'حداد',
      'الوصايا',
      'الوصايا الإيمانية',
    ],
    chapters: [
      'مقدمة الكتاب وخطبة المصنف',
      'فصل في التقوى وحقيقتها وفضلها وثمارها',
      'فصل في عقيدة أهل السنة والجماعة وأصول الإيمان',
      'فصل في الصلاة المكتوبة وشروطها وسننها والخشوع فيها',
      'فصل في المحافظة على صلاة الجماعة في المساجد',
      'فصل في صلاة النوافل والسنن الرواتب وقيام الليل',
      'فصل في الزكاة والصدقات والورع في جمع المال وإنفاقه',
      'فصل في الصيام وآدابه وفضل شهر رمضان المبارك',
      'فصل في حفظ الجوارح السبعة عن الآثام والمعاصي',
      'فصل في فضل القرآن الكريم وتلاوته وتدبر آياته',
      'فصل في الذكر والدعاء والاستغفار في سائر الأوقات',
      'فصل في الحج والعمرة وزيارة قبر النبي صلى الله عليه وسلم',
      'فصل في الأمر بالمعروف والنهي عن المنكر والدعوة إلى الله',
      'فصل في الجهاد في سبيل الله ومجاهدة النفس والهوى',
      'فصل في النصيحة لعامة المسلمين وخاصتهم وولاتهم',
      'فصل في بر الوالدين وصلة الأرحام والإحسان إليهما',
      'فصل في حقوق الأولاد والأهل والزوجين والمماليك',
      'فصل في حقوق الجيران والأصحاب والفقراء والمساكين',
      'فصل في حفظ اللسان عن الغيبة والنميمة والكذب والفحش',
      'فصل في حفظ القلب عن الحسد والغل والكبر والرياء والعجب',
      'فصل في الإخلاص وصدق النية في جميع الأقوال والأعمال',
      'فصل في الزهد في الدنيا وقصر الأمل ومحاسبة النفس',
      'فصل في الصبر على البلاء والشكر على النعماء والرضا بالقضاء',
      'فصل في التوكل على الله وحسن الظن به واليقين',
      'فصل في الخوف والرجاء والمحبة لله ولرسوله',
      'فصل في التوبة النصوح والاستغفار وشروط قبولها',
      'فصل في الموت وأهوال القبر والبعث والنشور',
      'فصل في الجنة ونعيمها والنار وعذابها ورؤية وجه الله الكريم',
      'خاتمة الكتاب في الوصايا النافعة والدعوات الجامعة المباركة',
    ],
  },
  {
    id: 'fathul-muin',
    name: 'Fathul Mu\'in',
    arabicName: 'فتح المعين بشرح قرة العين',
    author: 'Syaikh Zainuddin bin Abdul Aziz Al-Malibari',
    keywords: ['fathul muin', 'fathul mu\'in', 'فتح المعين', 'قرة العين'],
    chapters: [
      'مقدمة الكتاب',
      'باب الصلاة',
      'باب الزكاة',
      'باب الصوم',
      'باب الحج',
      'باب البيع والمعاملات',
      'باب الفرائض والوصايا',
      'باب النكاح',
      'باب الجنايات والأقضية',
    ],
  },
  {
    id: 'safinatun-najah',
    name: 'Safinatun Najah',
    arabicName: 'سفينة النجاة فيما يجب على العبد لمولاه',
    author: 'Syaikh Salim bin Sumair Al-Hadhrami',
    keywords: ['safinah', 'safinatun', 'سفينة', 'نجاة'],
    chapters: [
      'أركان الإسلام والإيمان',
      'علامات البلوغ',
      'أحكام الطهارة والاستنجاء',
      'فروض الوضوء ونواقضه',
      'موجبات الغسل وفروضه',
      'شروط التيمم وأركانه',
      'أنواع النجاسات',
      'شروط الصلاة وأركانها',
      'سجود السهو وصلاة الجماعة',
      'أحكام الجنائز',
      'أحكام الصيام والزكاة',
    ],
  },
  {
    id: 'fathul-qarib',
    name: 'Fathul Qarib (Taqrib)',
    arabicName: 'فتح القريب المجيب في شرح ألفاظ التقريب',
    author: 'Ibnu Qasim Al-Ghazi / Abu Syuja\'',
    keywords: ['fathul qarib', 'qarib', 'taqrib', 'تقريب', 'قريب', 'غاية الاختصار'],
    chapters: [
      'كتاب الطهارة',
      'كتاب الصلاة',
      'كتاب الزكاة',
      'كتاب الصيام',
      'كتاب الحج',
      'كتاب البيوع',
      'كتاب الفرائض والوصايا',
      'كتاب النكاح',
      'كتاب الجنايات',
      'كتاب الحدود',
      'كتاب الجهاد',
      'كتاب الأيمان والنذور',
      'كتاب الأقضية والشهادات',
    ],
  },
  {
    id: 'al-ajurrumiyyah',
    name: 'Matan Al-Ajurrumiyyah',
    arabicName: 'متن الآجرومية في علم النحو',
    author: 'Ibnu Ajurrum Ash-Shanhaji',
    keywords: ['jurumiy', 'jurmiyah', 'ajurrum', 'آجرومية', 'جرومية'],
    chapters: [
      'باب الكلام',
      'باب الإعراب وعلاماته',
      'باب الأفعال',
      'باب مرفوعات الأسماء',
      'باب منصوبات الأسماء',
      'باب مخفوضات الأسماء',
    ],
  },
  {
    id: 'kasyifatus-saja',
    name: 'Kasyifatus Saja',
    arabicName: 'كاشفة السجا في شرح سفينة النجا',
    author: 'Syaikh Nawawi Al-Bantani',
    keywords: ['kasyifatus', 'kasyifah', 'كاشفة', 'السجا'],
    chapters: [
      'مقدمة الشارح',
      'أركان الإسلام وأصول العقيدة',
      'أحكام الطهارة وأسرار الوضوء',
      'موجبات الغسل والتيمم',
      'أحكام النجاسات وإزالتها',
      'شروط الصلاة وأركانها وسننها',
      'صلاة الجماعة والقصر والجمع',
      'أحكام الجنائز والخاتمة',
    ],
  },
  {
    id: 'bidayatul-hidayah',
    name: 'Bidayatul Hidayah',
    arabicName: 'بداية الهداية في آداب السلوك',
    author: 'Hujjatul Islam Imam Al-Ghazali',
    keywords: ['bidayah', 'bidayatul', 'بداية', 'الهداية'],
    chapters: [
      'مقدمة الكتاب في طلب العلم',
      'القسم الأول في الطاعات',
      'آداب الاستيقاظ ودخول الخلاء',
      'آداب الوضوء والصلاة',
      'ترتيب الأوقات والوظائف',
      'القسم الثاني في اجتناب المعاصي',
      'حفظ العين والأذن واللسان والبطن',
      'حفظ الفرج واليدين والرجلين والقلب',
      'القسم الثالث في آداب الصحبة والمعاشرة',
    ],
  },
  {
    id: 'riyadhus-shalihin',
    name: 'Riyadhus Shalihin',
    arabicName: 'رياض الصالحين من كلام سيد المرسلين',
    author: 'Al-Imam Yahya bin Syaraf An-Nawawi',
    keywords: ['riyadh', 'riyadlus', 'الصالحين', 'رياض'],
    chapters: [
      'باب الإخلاص وإحضار النية',
      'باب التوبة والاستغفار',
      'باب الصبر',
      'باب الصدق',
      'باب المراقبة والتقوى',
      'باب اليقين والتوكل',
      'باب الاستقامة',
      'باب الأمر بالمعروف والنهي عن المنكر',
      'باب الأذكار والدعوات',
    ],
  },
  {
    id: 'bulughul-maram',
    name: 'Bulughul Maram',
    arabicName: 'بلوغ المرام من أدلة الأحكام',
    author: 'Al-Hafizh Ibnu Hajar Al-Asqalani',
    keywords: ['bulugh', 'maram', 'بلوغ', 'المرام'],
    chapters: [
      'كتاب الطهارة',
      'كتاب الصلاة',
      'كتاب الجنائز والزكاة',
      'كتاب الصيام والحج',
      'كتاب البيوع',
      'كتاب النكاح والجنايات',
      'كتاب الجامع في الآداب والأذكار',
    ],
  },
  {
    id: 'talimul-mutaallim',
    name: 'Ta\'limul Muta\'allim',
    arabicName: 'تعليم المتعلم طريق التعلم',
    author: 'Syaikh Az-Zarnuji',
    keywords: ['talim', 'ta\'lim', 'mutaallim', 'تعليم', 'المتعلم', 'zarnuji'],
    chapters: [
      'فصل في ماهية العلم وفضله',
      'فصل في النية في حال التعلم',
      'فصل في اختيار العلم والأستاذ والشريك',
      'فصل في تعظيم العلم وأهله',
      'فصل في الجد والمواظبة والهمة',
      'فصل في التوكل ووقت التحصيل',
      'فصل في الورع وأسباب الحفظ',
    ],
  },
  {
    id: 'al-hikam',
    name: 'Al-Hikam',
    arabicName: 'الحكم العطائية',
    author: 'Syaikh Ibnu Atha\'illah As-Sakandari',
    keywords: ['hikam', 'athaillah', 'الحكم'],
    chapters: [
      'الاعتماد على فضل الله',
      'التجريد والأسباب',
      'نور البصيرة واليقين',
      'حقوق الأوقات والأحوال',
      'إخلاص السرائر',
      'المناجاة الإلهية',
    ],
  },
  {
    id: 'sullamut-taufiq',
    name: 'Sullamut Taufiq',
    arabicName: 'سلم التوفيق إلى محبة الله على التحقيق',
    author: 'Habib Abdullah bin Husain bin Thahir',
    keywords: ['sullam', 'taufiq', 'سلم التوفيق'],
    chapters: [
      'أصول الدين والعقيدة',
      'أحكام الطهارة والصلاة',
      'الزكاة والصيام والحج',
      'المعاملات ومعاصي القلب',
      'معاصي الجوارح واللسان',
    ],
  },
  {
    id: 'risalatul-jamiah',
    name: 'Ar-Risalah Al-Jami\'ah',
    arabicName: 'الرسالة الجامعة والتذكرة النافعة',
    author: 'Al-Imam Ahmad bin Zain Al-Habsyi',
    keywords: ['jamiah', 'jami\'ah', 'جامعة', 'الرسالة الجامعة'],
    chapters: [
      'مقدمة الكتاب وأركان الإسلام',
      'أحكام الطهارة والصلوات المفروضة',
      'مبطلات الصلاة ومفسداتها',
      'الزكاة والصوم والحج',
      'معاصي القلب وسائر الجوارح',
      'خاتمة في التوبة والاستغفار',
    ],
  },
  {
    id: 'aqidatul-awam',
    name: 'Aqidatul Awam',
    arabicName: 'عقيدة العوام',
    author: 'Syaikh Ahmad Al-Marzuqi Al-Maliki',
    keywords: ['aqidat', 'awam', 'عقيدة', 'العوام'],
    chapters: [
      'الصفات الواجبة والمستحيلة والجائزة لله تعالى',
      'صفات الرسل وأسماء الأنبياء',
      'الملائكة والكتب السماوية واليوم الآخر',
      'آل البيت وذرية النبي صلى الله عليه وسلم',
      'الإسراء والمعراج وخاتمة المنظومة',
    ],
  },
  {
    id: 'nadhom-imrithi',
    name: 'Nadhom Al-Imrithi',
    arabicName: 'نظم الدرة البهية في متممة الآجرومية (العمريطي)',
    author: 'Syaikh Syarafuddin Yahya Al-Imrithi',
    keywords: ['imrithi', 'imriti', 'عمريطي', 'العمريطي'],
    chapters: [
      'مقدمة ونظم باب الكلام',
      'باب الإعراب وعلاماته',
      'باب النكرة والمعرفة',
      'باب الأفعال وإعرابها',
      'باب مرفوعات الأسماء',
      'باب منصوبات الأسماء',
      'باب المخفوضات من الأسماء والخاتمة',
    ],
  },
  {
    id: 'uqudul-lujjain',
    name: 'Uqudul Lujjain',
    arabicName: 'عقود اللجين في بيان حقوق الزوجين',
    author: 'Syaikh Nawawi Al-Bantani',
    keywords: ['uqud', 'lujjain', 'عقود', 'اللجين'],
    chapters: [
      'حقوق الزوج على الزوجة',
      'فضيلة طاعة الزوج والتحذير من عقوقه',
      'حقوق الزوجة على الزوج والنفقة',
      'صلاة المرأة في بيتها وحجابها',
      'تحريم نظر الأجنبي والأجنبية',
      'خاتمة في آداب المعاشرة الزوجية',
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
  // 1. Try extracting real embedded PDF bookmarks/outlines
  if (pdfDoc) {
    try {
      const outlineChapters = await extractChaptersFromPdfDoc(pdfDoc);
      if (outlineChapters && outlineChapters.length > 0) {
        return outlineChapters;
      }
    } catch (e) {
      console.warn('Error reading outline:', e);
    }

    // 2. Try scanning printed Fihris / Table of Contents page inside the PDF
    try {
      const fihrisFromPdf = await scanPrintedFihrisPages(pdfDoc);
      if (fihrisFromPdf && fihrisFromPdf.length > 0) {
        return fihrisFromPdf;
      }
    } catch (e) {
      console.warn('Error scanning printed fihris page:', e);
    }

    // 3. Try scanning text on pages for Arabic & Latin headings
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

  // 4. Classical Arabic kitab matching by title / content
  const normTitle = normalizeArabicTitle(title);

  for (const tpl of POPULAR_TURATS_TEMPLATES) {
    const matched = tpl.keywords.some((kw) => {
      const normKw = normalizeArabicTitle(kw);
      return normTitle.includes(normKw) || normKw.includes(normTitle);
    });

    if (matched) {
      const numCh = tpl.chapters.length;
      const pagesStep = Math.max(1, Math.floor(totalPages / numCh));
      return tpl.chapters.map((chName, idx) => ({
        id: `${tpl.id}-${idx + 1}`,
        number: String(idx + 1).padStart(2, '0'),
        title: chName,
        startPage: idx === 0 ? 1 : Math.min(totalPages, Math.max(2, Math.round(idx * pagesStep))),
      }));
    }
  }

  // 5. Default smart multi-chapter breakdown in pure Arabic for ANY general or unlisted PDF
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

  // 1. First, attempt to extract authentic embedded PDF outline / bookmarks
  let chapters: KitabChapter[] = [];
  try {
    chapters = await extractChaptersFromPdfDoc(pdfDoc);
  } catch (err) {
    console.warn('Outline extraction failed:', err);
  }

  // If no bookmarks, try scanning printed Fihris
  if (chapters.length === 0) {
    try {
      chapters = await scanPrintedFihrisPages(pdfDoc);
    } catch (err) {
      console.warn('Printed fihris scan failed:', err);
    }
  }

  const hasOutline = chapters.length > 0;
  const pages: KitabPage[] = [];
  const headingRegex =
    /^(bab|fasal|fasl|pasal|bagian|juz|chapter|kitab|muqaddimah|khatimah|kaidah)\b|^(كتاب|الكتاب|باب|الباب|فصل|الفصل|مقدمة|المقدمة|خاتمة|الخاتمة|تنبيه|فائدة|فرع|مسألة|بحث|مقصد|مطلب)/i;

  let currentChapterTitle = chapters[0]?.title || 'Muqaddimah & Halaman Awal';

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

        // If no outline existed, scan page lines across initial pages for headings
        if (!hasOutline && rawLines.length > 0) {
          for (const line of rawLines) {
            const cleanHeading = stripArabicTashkeel(line.trim());
            if (headingRegex.test(cleanHeading) && cleanHeading.length >= 3 && cleanHeading.length < 110) {
              if (!chapters.some((c) => c.startPage === i || c.title === line)) {
                currentChapterTitle = line;
                chapters.push({
                  id: `ch-scan-${i}-${chapters.length}`,
                  number: String(chapters.length + 1).padStart(2, '0'),
                  title: line,
                  startPage: i,
                });
                break;
              }
            }
          }
        }

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

  return {
    id: `kitab-pdf-${Date.now()}`,
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

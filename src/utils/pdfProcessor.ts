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
 * Scans printed Fihris / Table of Contents pages in the PDF (first 25 and last 35 pages)
 */
async function scanPrintedFihrisPages(pdfDoc: any): Promise<KitabChapter[]> {
  try {
    const numPages = pdfDoc.numPages;
    const candidatePages: number[] = [];
    for (let p = 1; p <= Math.min(25, numPages); p++) candidatePages.push(p);
    for (let p = Math.max(26, numPages - 35); p <= numPages; p++) {
      if (!candidatePages.includes(p)) candidatePages.push(p);
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
          const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 5);
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
        fullPageText.includes('table of contents');

      if (isFihrisPage) {
        for (const rawLine of lines) {
          const cleanLine = stripArabicTashkeel(rawLine);
          // Don't treat the title of the fihris header itself as a chapter
          if (/^(فهرس|الفهرس|المحتويات|جدول المحتويات|daftar isi)/i.test(cleanLine.trim()) && cleanLine.length < 25) {
            continue;
          }

          // Look for line containing title and page number
          const matchNum = cleanLine.match(/([0-9٠-٩]+)[\s._\-—…:·|/]*$/) || cleanLine.match(/^[\s._\-—…:·|/]*([0-9٠-٩]+)/);
          if (matchNum) {
            const parsedPage = parseEasternArabicNumber(matchNum[1]);
            if (parsedPage && parsedPage >= 1 && parsedPage <= numPages) {
              const titleOnly = cleanLine
                .replace(/[0-9٠-٩]+/g, '')
                .replace(/[._\-—…:·|/]+/g, ' ')
                .replace(/\b(hal|halaman|p|page|ص)\b/gi, '')
                .trim();

              if (titleOnly.length >= 3 && titleOnly.length <= 110) {
                if (!fihrisChapters.some((c) => c.startPage === parsedPage || c.title === titleOnly)) {
                  fihrisChapters.push({
                    id: `ch-fihris-${parsedPage}-${fihrisChapters.length}`,
                    number: String(fihrisChapters.length + 1).padStart(2, '0'),
                    title: titleOnly,
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

export const POPULAR_TURATS_TEMPLATES: TuratsKitabTemplate[] = [
  {
    id: 'an-nashaih-ad-diniyyah',
    name: 'An-Nashaih Ad-Diniyyah',
    arabicName: 'النصائح الدينية والوصايا الإيمانية',
    author: 'Al-Imam Al-Habib Abdullah bin Alawi Al-Haddad',
    keywords: ['نصائح', 'النصائح', 'الدينية', 'الدينيه', 'nashaih', 'nasihat', 'haddad', 'حداد'],
    chapters: [
      'Muqaddimah & Khutbatul Kitab (مقدمة الكتاب)',
      'Fashl I: Hakikat Taqwa & Keutamaannya (فصل في التقوى)',
      'Fashl II: Aqidah Ahlus Sunnah wal Jama\'ah (فصل في عقيدة أهل السنة والجماعة)',
      'Fashl III: Shalat Maktubah, Sunnah & Khusyu\' (فصل في الصلاة والخشوع)',
      'Fashl IV: Zakat, Sedekah & Harta Halal (فصل في الزكاة والصدقات والورع)',
      'Fashl V: Puasa Ramadhan & Menjaga Hati (فصل في الصيام وحفظ الجوارح)',
      'Fashl VI: Ibadah Haji & Ziarah ke Madinah (فصل في الحج والعمرة والزيارة)',
      'Fashl VII: Amar Ma\'ruf Nahi Munkar & Dakwah (فصل في الأمر بالمعروف والنهي عن المنكر)',
      'Fashl VIII: Jihad & Nasihat bagi Kaum Muslimin (فصل في الجهاد والنصيحة للمسلمين)',
      'Fashl IX: Hak Sesama Muslim, Kerabat & Orang Tua (فصل في بر الوالدين وحقوق المسلمين)',
      'Fashl X: Ikhlas, Mahabbah & Tazkiyatun Nafs (فصل في الإخلاص وسلامة الصدر)',
      'Fashl XI: Taubat Nasuha, Khauf-Raja\' & Khatimah (فصل في التوبة والمحاسبة والخاتمة)',
    ],
  },
  {
    id: 'fathul-muin',
    name: 'Fathul Mu\'in',
    arabicName: 'فتح المعين بشرح قرة العين',
    author: 'Syaikh Zainuddin bin Abdul Aziz Al-Malibari',
    keywords: ['fathul muin', 'fathul mu\'in', 'فتح المعين', 'قرة العين'],
    chapters: [
      'Muqaddimah & Khutbatul Kitab (مقدمة الكتاب)',
      'Bab I: Ash-Shalah / Fiqih Shalat (باب الصلاة)',
      'Bab II: Az-Zakah / Kewajiban Zakat (باب الزكاة)',
      'Bab III: Ash-Shaum / Fiqih Puasa (باب الصوم)',
      'Bab IV: Al-Hajj / Ibadah Haji (باب الحج)',
      'Bab V: Al-Buyu\' / Akad Muamalah & Jual Beli (باب البيع)',
      'Bab VI: Al-Faraidh & Wasiat (باب الفرائض والوصايا)',
      'Bab VII: An-Nikah / Hukum Keluarga (باب النكاح)',
      'Bab VIII: Al-Jinayat, Hudud & Qadha (باب الجنايات والأقضية)',
    ],
  },
  {
    id: 'safinatun-najah',
    name: 'Safinatun Najah',
    arabicName: 'سفينة النجاة فيما يجب على العبد لمولاه',
    author: 'Syaikh Salim bin Sumair Al-Hadhrami',
    keywords: ['safinah', 'safinatun', 'سفينة', 'نجاة'],
    chapters: [
      'Fashl: Rukun Islam & Rukun Iman (أركان الإسلام والإيمان)',
      'Fashl: Tanda-tanda Baligh (علامات البلوغ)',
      'Fashl: Thaharah, Istinja & Bersuci (أحكام الطهارة والاستنجاء)',
      'Fashl: Fardhu Wudhu & Pembatalnya (فروض الوضوء ونواقضه)',
      'Fashl: Mandi Wajib & Sebab-sebabnya (موجبات الغسل وفروضه)',
      'Fashl: Tayammum & Syarat-syaratnya (شروط التيمم وأركانه)',
      'Fashl: Macam-macam Najis & Penyuciannya (أنواع النجاسات)',
      'Fashl: Shalat, Syarat Sah & Rukun-rukunnya (شروط الصلاة وأركانها)',
      'Fashl: Sujud Sahwi & Shalat Berjamaah (سجود السهو وصلاة الجماعة)',
      'Fashl: Pengurusan Jenazah (أحكام الجنائز)',
      'Fashl: Puasa Ramadhan & Zakat Fitrah (أحكام الصيام والزكاة)',
    ],
  },
  {
    id: 'fathul-qarib',
    name: 'Fathul Qarib (Taqrib)',
    arabicName: 'فتح القريب المجيب في شرح ألفاظ التقريب',
    author: 'Ibnu Qasim Al-Ghazi / Abu Syuja\'',
    keywords: ['fathul qarib', 'qarib', 'taqrib', 'تقريب', 'قريب', 'غاية الاختصار'],
    chapters: [
      'Kitab Thaharah / Bersuci (كتاب الطهارة)',
      'Kitab Shalah / Shalat (كتاب الصلاة)',
      'Kitab Zakah / Zakat (كتاب الزكاة)',
      'Kitab Shiyam / Puasa (كتاب الصيام)',
      'Kitab Hajj / Haji (كتاب الحج)',
      'Kitab Buyu\' / Transaksi Jual Beli (كتاب البيوع)',
      'Kitab Faraidh & Wasaya (كتاب الفرائض والوصايا)',
      'Kitab Nikah / Pernikahan (كتاب النكاح)',
      'Kitab Jinayat / Pidana (كتاب الجنايات)',
      'Kitab Hudud / Batasan Hukum (كتاب الحدود)',
      'Kitab Jihad fi Sabilillah (كتاب الجهاد)',
      'Kitab Ayman & Nudzur (كتاب الأيمان والنذور)',
      'Kitab Qadha & Syahadat (كتاب الأقضية والشهادات)',
    ],
  },
  {
    id: 'al-ajurrumiyyah',
    name: 'Matan Al-Ajurrumiyyah',
    arabicName: 'متن الآجرومية في علم النحو',
    author: 'Ibnu Ajurrum Ash-Shanhaji',
    keywords: ['jurumiy', 'jurmiyah', 'ajurrum', 'آجرومية', 'جرومية'],
    chapters: [
      'Bab I: Al-Kalam & Unsur Kalimat (باب الكلام)',
      'Bab II: Al-I\'rab & Tanda-Tandanya (باب الإعراب)',
      'Bab III: Al-Af\'al / Macam Kata Kerja (باب الأفعال)',
      'Bab IV: Marfu\'atil Asma\' / Isim yang Dirofa\'kan (باب مرفوعات الأسماء)',
      'Bab V: Manshubatil Asma\' / Isim yang Dinashobkan (باب منصوبات الأسماء)',
      'Bab VI: Makhfudhatil Asma\' / Isim yang Dijarkan (باب مخفوضات الأسماء)',
    ],
  },
  {
    id: 'kasyifatus-saja',
    name: 'Kasyifatus Saja',
    arabicName: 'كاشفة السجا في شرح سفينة النجا',
    author: 'Syaikh Nawawi Al-Bantani',
    keywords: ['kasyifatus', 'kasyifah', 'كاشفة', 'السجا'],
    chapters: [
      'Muqaddimah & Biografi Syaikh Salim (مقدمة الشارح)',
      'Bab I: Rukun Islam & Ushul Aqidah (أركان الإسلام وأصول العقيدة)',
      'Bab II: Thaharah, Istinja & Rahasia Wudhu (أحكام الطهارة وأسرار الوضوء)',
      'Bab III: Mandi Janabah & Masail Tayammum (موجبات الغسل والتيمم)',
      'Bab IV: Hadas, Najis & Adab Menghilangkannya (أحكام النجاسات وإزالتها)',
      'Bab V: Syarat, Rukun & Sunnah Shalat (شروط الصلاة وأركانها وسننها)',
      'Bab VI: Shalat Berjamaah, Qashar & Jamak (صلاة الجماعة والقصر والجمع)',
      'Bab VII: Shalat Jenazah & Doa Penutup (أحكام الجنائز والخاتمة)',
    ],
  },
  {
    id: 'bidayatul-hidayah',
    name: 'Bidayatul Hidayah',
    arabicName: 'بداية الهداية في آداب السلوك',
    author: 'Hujjatul Islam Imam Al-Ghazali',
    keywords: ['bidayah', 'bidayatul', 'بداية', 'الهداية'],
    chapters: [
      'Muqaddimah & Niat Menuntut Ilmu (مقدمة الكتاب في طلب العلم)',
      'Qism I: Adab Taat & Wirid Sehari-hari (القسم الأول في الطاعات)',
      'Adab Bangun Tidur & Masuk Kamar Mandi (آداب الاستيقاظ ودخول الخلاء)',
      'Adab Berwudhu & Shalat Subuh (آداب الوضوء والصلاة)',
      'Adab Menjaga Waktu dari Fajar hingga Isya (ترتيب الأوقات والوظائف)',
      'Qism II: Menjauhi Maksiat Anggota Tubuh (القسم الثاني في اجتناب المعاصي)',
      'Menjaga Mata, Telinga, Lisan & Perut (حفظ العين والأذن واللسان والبطن)',
      'Menjaga Kemaluan, Tangan, Kaki & Hati (حفظ الفرج واليدين والرجلين والقلب)',
      'Qism III: Adab Pergaulan Bersama Makhluk (القسم الثالث في آداب الصحبة)',
    ],
  },
  {
    id: 'riyadhus-shalihin',
    name: 'Riyadhus Shalihin',
    arabicName: 'رياض الصالحين من كلام سيد المرسلين',
    author: 'Al-Imam Yahya bin Syaraf An-Nawawi',
    keywords: ['riyadh', 'riyadlus', 'الصالحين', 'رياض'],
    chapters: [
      'Bab Ikhlas & Niat (باب الإخلاص وإحضار النية)',
      'Bab Taubat & Istighfar (باب التوبة والاستغفار)',
      'Bab Sabar & Ketabahan (باب الصبر)',
      'Bab Shiddiq & Kejujuran (باب الصدق)',
      'Bab Muraqabah & Taqwa (باب المراقبة والتقوى)',
      'Bab Yakin & Tawakkal (باب اليقين والتوكل)',
      'Bab Istiqamah & Amal Shalih (باب الاستقامة)',
      'Bab Adab Bergaul & Amar Ma\'ruf (باب الأمر بالمعروف)',
      'Bab Akhlaq, Dzikir & Doa (باب الأذكار والدعوات)',
    ],
  },
  {
    id: 'bulughul-maram',
    name: 'Bulughul Maram',
    arabicName: 'بلوغ المرام من أدلة الأحكام',
    author: 'Al-Hafizh Ibnu Hajar Al-Asqalani',
    keywords: ['bulugh', 'maram', 'بلوغ', 'المرام'],
    chapters: [
      'Kitab Thaharah (كتاب الطهارة)',
      'Kitab Shalah (كتاب الصلاة)',
      'Kitab Janaiz & Zakah (كتاب الجنائز والزكاة)',
      'Kitab Shiyam & Hajj (كتاب الصيام والحج)',
      'Kitab Buyu\' & Muamalah (كتاب البيوع)',
      'Kitab Nikah & Jinayat (كتاب النكاح والجنايات)',
      'Kitab Al-Jami\' / Akhlaq & Doa (كتاب الجامع)',
    ],
  },
  {
    id: 'talimul-mutaallim',
    name: 'Ta\'limul Muta\'allim',
    arabicName: 'تعليم المتعلم طريق التعلم',
    author: 'Syaikh Az-Zarnuji',
    keywords: ['talim', 'ta\'lim', 'mutaallim', 'تعليم', 'المتعلم', 'zarnuji'],
    chapters: [
      'Fashl: Hakikat Ilmu & Keutamaannya (ماهية العلم وفضله)',
      'Fashl: Niat dalam Belajar (النية في حال التعلم)',
      'Fashl: Memilih Guru & Teman (اختيار العلم والأستاذ والشريك)',
      'Fashl: Menghormati Ilmu & Ahlinya (تعظيم العلم وأهله)',
      'Fashl: Kesungguhan & Kontinuitas (الجد والمواظبة)',
      'Fashl: Tawakkal & Waktu Belajar (التوكل ووقت التحصيل)',
      'Fashl: Wara\' & Sebab Menghafal (الورع وأسباب الحفظ)',
    ],
  },
  {
    id: 'al-hikam',
    name: 'Al-Hikam',
    arabicName: 'الحكم العطائية',
    author: 'Syaikh Ibnu Atha\'illah As-Sakandari',
    keywords: ['hikam', 'athaillah', 'الحكم'],
    chapters: [
      'Fashl I: Bersandar pada Karunia Allah (الاعتماد على فضل الله)',
      'Fashl II: Tajrid & Asbab (التجريد والأسباب)',
      'Fashl III: Cahaya Hati & Bashirah (نور البصيرة)',
      'Fashl IV: Adab Menyikapi Ujian & Waktu (حقوق الأوقات)',
      'Fashl V: Ikhlas & Rahasia Qalbu (إخلاص السرائر)',
      'Fashl VI: Munajat & Penutup (المناجاة الإلهية)',
    ],
  },
  {
    id: 'sullamut-taufiq',
    name: 'Sullamut Taufiq',
    arabicName: 'سلم التوفيق إلى محبة الله على التحقيق',
    author: 'Habib Abdullah bin Husain bin Thahir',
    keywords: ['sullam', 'taufiq', 'سلم التوفيق'],
    chapters: [
      'Fashl I: Ushuluddin & Aqidah (أصول الدين والعقيدة)',
      'Fashl II: Thaharah & Shalat (أحكام الطهارة والصلاة)',
      'Fashl III: Zakat, Puasa & Haji (الزكاة والصيام والحج)',
      'Fashl IV: Muamalah & Menjaga Hati (المعاملات ومعاصي القلب)',
      'Fashl V: Menjaga Lisan & Anggota Tubuh (معاصي الجوارح واللسان)',
    ],
  },
  {
    id: 'risalatul-jamiah',
    name: 'Ar-Risalah Al-Jami\'ah',
    arabicName: 'الرسالة الجامعة والتذكرة النافعة',
    author: 'Al-Imam Ahmad bin Zain Al-Habsyi',
    keywords: ['jamiah', 'jami\'ah', 'جامعة', 'الرسالة الجامعة'],
    chapters: [
      'Muqaddimah & Rukun Islam (مقدمة الكتاب وأركان الإسلام)',
      'Fashl: Bersuci, Wudhu & Shalat (أحكام الطهارة والصلوات المفروضة)',
      'Fashl: Hal-Hal Pembatal Shalat (مبطلات الصلاة ومفسداتها)',
      'Fashl: Zakat, Puasa & Rukun Haji (الزكاة والصوم والحج)',
      'Fashl: Maksiat Hati & Anggota Badan (معاصي القلب وسائر الجوارح)',
      'Khatimah: Taubat & Istighfar (خاتمة في التوبة والاستغفار)',
    ],
  },
  {
    id: 'aqidatul-awam',
    name: 'Aqidatul Awam',
    arabicName: 'عقيدة العوام',
    author: 'Syaikh Ahmad Al-Marzuqi Al-Maliki',
    keywords: ['aqidat', 'awam', 'عقيدة', 'العوام'],
    chapters: [
      'Nadhom 01-15: Sifat Wajib, Mustahil & Jaiz bagi Allah',
      'Nadhom 16-28: Sifat Para Rasul & Nama-Nama Nabi',
      'Nadhom 29-38: Malaikat, Kitab Suci & Hari Akhir',
      'Nadhom 39-50: Keluarga & Keturunan Nabi SAW',
      'Nadhom 51-57: Isra\' Mi\'raj & Penutup Mandhumah',
    ],
  },
  {
    id: 'nadhom-imrithi',
    name: 'Nadhom Al-Imrithi',
    arabicName: 'نظم الدرة البهية في متممة الآجرومية (العمريطي)',
    author: 'Syaikh Syarafuddin Yahya Al-Imrithi',
    keywords: ['imrithi', 'imriti', 'عمريطي', 'العمريطي'],
    chapters: [
      'Muqaddimah & Bab Al-Kalam (مقدمة ونظم باب الكلام)',
      'Bab Al-I\'rab & Tanda-Tandanya (باب الإعراب وعلاماته)',
      'Bab An-Nakirah wal Ma\'rifah (باب النكرة والمعرفة)',
      'Bab Al-Af\'al / Kata Kerja (باب الأفعال)',
      'Bab I\'rabil Af\'al (باب إعراب الأفعال)',
      'Bab Marfu\'atil Asma\' (باب مرفوعات الأسماء)',
      'Bab Manshubatil Asma\' (باب منصوبات الأسماء)',
      'Bab Makhfudhatil Asma\' & Penutup (باب المخفوضات والخاتمة)',
    ],
  },
  {
    id: 'uqudul-lujjain',
    name: 'Uqudul Lujjain',
    arabicName: 'عقود اللجين في بيان حقوق الزوجين',
    author: 'Syaikh Nawawi Al-Bantani',
    keywords: ['uqud', 'lujjain', 'عقود', 'اللجين'],
    chapters: [
      'Muqaddimah & Hak Suami atas Istri (حقوق الزوج على الزوجة)',
      'Fashl I: Keutamaan Istri yang Taat (فضيلة طاعة الزوج)',
      'Fashl II: Hak Istri atas Suami (حقوق الزوجة على الزوج والنفقة)',
      'Fashl III: Keutamaan Shalat di Rumah bagi Wanita (صلاة المرأة في بيتها)',
      'Fashl IV: Larangan Memandang Non-Mahram (تحريم نظر الأجنبي والأجنبية)',
      'Khatimah: Adab Rumah Tangga Islami (خاتمة في آداب المعاشرة)',
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
      const pagesToScan = Math.min(pdfDoc.numPages, 160);

      for (let i = 1; i <= pagesToScan; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;
        if (items && items.length > 0) {
          const lineBuckets: { y: number; text: string }[] = [];
          for (const item of items) {
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
          const lines = lineBuckets.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean);

          for (const line of lines) {
            const cleanLine = stripArabicTashkeel(line.trim());
            const isArabicHeading =
              /^(كتاب|الكتاب|باب|الباب|فصل|الفصل|مقدمة|المقدمة|خاتمة|الخاتمة|تنبيه|فائدة|فوائد|فرع|فروع|مسألة|مسائل|بحث|مطلب|مقصد|قاعدة|القاعدة)\s*(\S+|$)/i.test(cleanLine);
            const isLatinHeading =
              /^(bab|fasal|fasl|pasal|bagian|juz|chapter|kitab|muqaddimah|khatimah|kaidah)\b/i.test(cleanLine);

            if ((isArabicHeading || isLatinHeading) && cleanLine.length >= 3 && cleanLine.length <= 110) {
              if (!scannedChapters.some((c) => c.startPage === i || c.title === line.trim())) {
                scannedChapters.push({
                  id: `ch-scan-${i}-${scannedChapters.length}`,
                  number: String(scannedChapters.length + 1).padStart(2, '0'),
                  title: line.trim(),
                  startPage: i,
                });
                break;
              }
            }
          }
        }
      }

      if (scannedChapters.length >= 2) {
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
      return normTitle.includes(normKw);
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

  // 5. Default smart multi-chapter breakdown for ANY general or unlisted PDF
  const cleanTitle = title.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]+/g, ' ').trim();
  const numChapters = Math.min(8, Math.max(3, Math.ceil(totalPages / 15)));
  const step = Math.max(1, Math.floor(totalPages / numChapters));
  const generated: KitabChapter[] = [
    { id: `gen-${cleanTitle.slice(0, 6)}-1`, number: '01', title: `Muqaddimah & Awal Naskah (${cleanTitle.slice(0, 30)})`, startPage: 1 }
  ];

  for (let c = 2; c <= numChapters; c++) {
    const sPage = Math.min(totalPages, (c - 1) * step + 1);
    if (sPage > generated[generated.length - 1].startPage) {
      generated.push({
        id: `gen-${cleanTitle.slice(0, 6)}-${c}`,
        number: String(c).padStart(2, '0'),
        title: `Bagian ${String(c).padStart(2, '0')} · Halaman ${sPage}`,
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

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

export async function savePdfArrayBuffer(key: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(buffer, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB storage fallback:', err);
  }
}

export async function loadPdfArrayBuffer(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export interface PdfConversionOptions {
  customTitle?: string;
  customSubtitle?: string;
  customAuthor?: string;
  customCategory?: string;
  coverTone?: KitabDocument['coverTone'];
  onProgress?: (currentPage: number, totalPages: number) => void;
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

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(rawBuffer) });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pages: KitabPage[] = [];
  const chapters: KitabChapter[] = [];
  let currentChapterTitle = 'Bagian I · Naskah Utama';

  for (let i = 1; i <= numPages; i++) {
    if (options.onProgress) {
      options.onProgress(i, numPages);
    }

    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();

    // Reconstruct lines based on Y coordinate transforms
    const lineBuckets: { y: number; text: string }[] = [];
    for (const item of textContent.items) {
      if ('str' in item && item.str.trim().length > 0) {
        const y = Math.round(item.transform[5]);
        const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 4);
        if (existing) {
          existing.text += (existing.text.endsWith(' ') ? '' : ' ') + item.str;
        } else {
          lineBuckets.push({ y, text: item.str });
        }
      }
    }

    lineBuckets.sort((a, b) => b.y - a.y);
    const rawLines = lineBuckets.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean);

    if (rawLines.length > 0) {
      const firstLine = rawLines[0];
      const isHeading =
        /^(bab|fasal|muqaddimah|kaidah|bagian|chapter|juz)\b/i.test(firstLine) ||
        (i === 1 && firstLine.length < 75);

      if (isHeading) {
        currentChapterTitle = firstLine;
        chapters.push({
          id: `ch-${i}`,
          number: String(chapters.length + 1).padStart(2, '0'),
          title: firstLine,
          startPage: i,
        });
      }
    }

    if (chapters.length === 0 && i === 1) {
      chapters.push({
        id: 'ch-1',
        number: '01',
        title: 'Muqaddimah & Halaman Awal',
        startPage: 1,
      });
    }

    const paragraphs: string[] = [];
    let bufferParagraph = '';

    for (const line of rawLines) {
      if (!bufferParagraph) {
        bufferParagraph = line;
      } else if (
        bufferParagraph.length < 260 &&
        !/[.!?:”"']$/.test(bufferParagraph)
      ) {
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

    if (paragraphs.length === 0) {
      paragraphs.push(
        `[Halaman ${i} merupakan halaman ilustrasi/pindaian gambar. Gunakan tombol "Lembar PDF Asli" di bilah atas pembaca untuk melihat tampilan visual asli halaman ini secara penuh.]`
      );
    }

    pages.push({
      pageNumber: i,
      chapterTitle: currentChapterTitle,
      paragraphs,
      footnote: `Diekstrak dari berkas PDF "${file.name}" · Lembar ${i} dari ${numPages}`,
    });
  }

  if (chapters.length === 1 && numPages >= 4) {
    for (let p = 3; p <= numPages; p += 3) {
      chapters.push({
        id: `ch-auto-${p}`,
        number: String(chapters.length + 1).padStart(2, '0'),
        title: `Fasal Lanjutan · Halaman ${p}`,
        startPage: p,
      });
    }
  }

  const cleanFileName = file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
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

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
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

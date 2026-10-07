import { FihrisEntry, FihrisMetadata, FihrisValidationStatus, HeadingLevel, KitabChapter } from '../types/kitab';

/**
 * High-Accuracy Auto Fihris Engine for Arabic Turats / Kitab Kuning PDF
 * 
 * Complies with strict accuracy requirements:
 * 1. Distinction between printedPage and pdfPage (1-based index)
 * 2. Arabic normalization strictly for matching, preserving exact originalTitle
 * 3. Multi-page fihris detection (start & end of book)
 * 4. Structural heading recognition (كتاب → باب → فصل → فرع → تنبيه/فائدة)
 * 5. Windowed page validation [pdfPage - 2 ... pdfPage + 2]
 * 6. Non-linear page mapping based on detected physical page anchors
 * 7. Verification statuses: 'verified' | 'review' | 'unverified' (No guessing!)
 */

// Eastern Arabic / Arabic-Indic digits conversion
const EASTERN_TO_WESTERN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Converts any Arabic-Indic or Western digit string into a valid integer.
 */
export function parseArabicOrWesternNumber(str: string): number | null {
  if (!str) return null;
  const western = str.replace(/[٠-٩۰-۹]/g, (d) => EASTERN_TO_WESTERN_DIGITS[d] || d);
  const match = western.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return isNaN(num) ? null : num;
}

/**
 * Strips Arabic diacritics / tashkeel and tatweel
 */
export function stripArabicTashkeelAndTatweel(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // Tashkeel & Quranic marks
    .replace(/\u0640/g, '') // Tatweel / Kashida
    .trim();
}

/**
 * Normalizes Arabic text exclusively for internal comparison and fuzzy token matching.
 * Preserves the original unchanged for display.
 */
export function normalizeArabicForComparison(text: string): string {
  if (!text) return '';
  let norm = stripArabicTashkeelAndTatweel(text);
  // Normalize Alef variants
  norm = norm.replace(/[إأآٱ]/g, 'ا');
  // Normalize Ya and Alif Maqsurah
  norm = norm.replace(/ى/g, 'ي');
  // Normalize Ta Marbutah to Ha for token equality
  norm = norm.replace(/ة/g, 'ه');
  // Remove non-alphanumeric punctuation except Arabic letters
  norm = norm.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ');
  // Collapse whitespace
  return norm.replace(/\s+/g, ' ').trim();
}

/**
 * Classifies heading level in classical Islamic books hierarchy
 */
export function classifyHeadingLevel(rawTitle: string): HeadingLevel {
  const norm = normalizeArabicForComparison(rawTitle);
  if (norm.startsWith('كتاب')) return 'kitab';
  if (norm.startsWith('باب')) return 'bab';
  if (norm.startsWith('فصل')) return 'fasl';
  if (norm.startsWith('فرع')) return 'far';
  if (norm.startsWith('تنبيه')) return 'tanbih';
  if (norm.startsWith('فائده') || norm.startsWith('فوائد')) return 'faidah';
  if (norm.startsWith('خاتمه')) return 'khatimah';
  if (norm.startsWith('مقدمه')) return 'muqaddimah';
  if (norm.startsWith('مساله') || norm.startsWith('مسائل')) return 'masalah';
  return 'other';
}

export interface ExtractedLine {
  text: string;
  y: number;
  x?: number;
  fontSize?: number;
}

/**
 * Scans candidate pages to detect where the Fihris (Table of Contents) is located.
 * In Arabic Turats, Fihris is usually placed at the very end of the book (last 1-25 pages)
 * or after the Muqaddimah (pages 2-25).
 */
export async function detectFihrisPages(pdfDoc: any): Promise<number[]> {
  const numPages = pdfDoc.numPages;
  const candidatePages: number[] = [];

  // For small books (<= 50 pages), check all pages
  if (numPages <= 50) {
    for (let p = 1; p <= numPages; p++) candidatePages.push(p);
  } else {
    // Check end of the book first (last 30 pages) - very common in Turats
    const backStart = Math.max(1, numPages - 35);
    for (let p = numPages; p >= backStart; p--) candidatePages.push(p);

    // Also check beginning of the book (pages 2 to 25)
    for (let p = 2; p <= Math.min(25, numPages); p++) {
      if (!candidatePages.includes(p)) candidatePages.push(p);
    }
  }

  const fihrisPages: number[] = [];

  for (const pageNum of candidatePages) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      if (!textContent.items || textContent.items.length === 0) continue;

      const lines = extractLinesFromTextContent(textContent);
      const fullText = lines.map((l) => l.text).join(' ');
      const normText = normalizeArabicForComparison(fullText);

      // Check explicit fihris markers
      const hasExplicitTitle =
        normText.includes('فهرس') ||
        normText.includes('فهرست') ||
        normText.includes('المحتويات') ||
        normText.includes('جدول المحتويات') ||
        normText.includes('جدول الموضوعات') ||
        normText.includes('daftar isi');

      // Check structural line density: lines with dotted leaders or numbers + headings
      let leaderCount = 0;
      let headingWithNumberCount = 0;

      for (const line of lines) {
        const text = line.text;
        const normLine = normalizeArabicForComparison(text);
        if (/[.·…—\-_]{3,}/.test(text) && /[0-9٠-٩]+/.test(text)) {
          leaderCount++;
        }
        if (
          /[0-9٠-٩]+/.test(text) &&
          (normLine.includes('باب') ||
            normLine.includes('فصل') ||
            normLine.includes('كتاب') ||
            normLine.includes('فرع') ||
            normLine.includes('مساله') ||
            normLine.includes('تنبيه') ||
            normLine.includes('مقدمه') ||
            normLine.includes('خاتمه'))
        ) {
          headingWithNumberCount++;
        }
      }

      // If explicit title or high density of table-of-contents lines
      if (hasExplicitTitle || leaderCount >= 3 || headingWithNumberCount >= 3) {
        fihrisPages.push(pageNum);
      }
    } catch (e) {
      console.warn(`[Auto-Fihris] Error scanning page ${pageNum} for fihris markers:`, e);
    }
  }

  // Sort identified fihris pages in natural reading order
  fihrisPages.sort((a, b) => a - b);

  // Group adjacent pages to find continuous fihris section
  return fihrisPages;
}

/**
 * Groups raw PDF text items into ordered horizontal lines.
 */
export function extractLinesFromTextContent(textContent: any): ExtractedLine[] {
  const lineBuckets: { y: number; x: number; text: string; fontSize: number }[] = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str.trim().length > 0) {
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      const fontSize = Math.round(Math.hypot(item.transform[0], item.transform[1]));

      const existing = lineBuckets.find((b) => Math.abs(b.y - y) <= 5);
      if (existing) {
        // RTL / LTR: concatenate with space
        existing.text += (existing.text.endsWith(' ') ? '' : ' ') + item.str;
        existing.x = Math.min(existing.x, x);
      } else {
        lineBuckets.push({ y, x, text: item.str, fontSize });
      }
    }
  }

  // Sort top-to-bottom (Y descending in PDF coordinate space)
  lineBuckets.sort((a, b) => b.y - a.y);
  return lineBuckets.map((b) => ({
    text: b.text.replace(/\s+/g, ' ').trim(),
    y: b.y,
    x: b.x,
    fontSize: b.fontSize,
  })).filter((l) => l.text.length > 0);
}

/**
 * Extracts raw fihris entries from detected fihris pages with high precision.
 * Handles:
 * - Dotted leaders: "باب الصلاة ............. ٩١"
 * - Eastern & Western numerals
 * - Clean title separation without inventing or dropping headings
 */
export function extractEntriesFromFihrisLines(
  lines: ExtractedLine[],
  sourceFihrisPage: number,
  numPages: number
): FihrisEntry[] {
  const entries: FihrisEntry[] = [];

  for (const line of lines) {
    const raw = line.text.trim();
    const cleanNorm = normalizeArabicForComparison(raw);

    // Skip the generic Fihris header line itself
    if (
      /^(فهرس|الفهرس|المحتويات|جدول المحتويات|فهرست|daftar isi)/i.test(cleanNorm) &&
      cleanNorm.length < 30
    ) {
      continue;
    }

    // Two-Column Layout Detection on single line
    // If line has two distinct title-dots-number groups separated by large spacing
    const splitRegex = /([^\d٠-٩.·…—\-]{2,}?[.·…—\-]{2,}\s*[0-9٠-٩]+)/g;
    const matches = raw.match(splitRegex);

    const segments = matches && matches.length >= 2 ? matches : [raw];

    for (const segment of segments) {
      const parsed = parseSingleFihrisSegment(segment, sourceFihrisPage, numPages);
      if (parsed) {
        // Prevent duplicate entries
        const isDuplicate = entries.some(
          (e) => e.printedPage === parsed.printedPage && e.normalizedTitle === parsed.normalizedTitle
        );
        if (!isDuplicate) {
          entries.push(parsed);
        }
      }
    }
  }

  return entries;
}

/**
 * Parses an individual fihris line segment into a structured FihrisEntry.
 */
function parseSingleFihrisSegment(
  segment: string,
  sourceFihrisPage: number,
  numPages: number
): FihrisEntry | null {
  const raw = segment.trim();
  if (raw.length < 3) return null;

  // Patterns for extracting page numbers in Arabic Fihris:
  // 1. Title followed by dots / leader and trailing number: "باب الصلاة ..... ٩١"
  // 2. Title with trailing number: "باب الصلاة ٩١"
  // 3. Leading number followed by title: "٩١ باب الصلاة"
  // 4. "ص" notation: "باب الصلاة ص: ٩١"
  const trailingLeaderMatch = raw.match(/^(.*?)[.·…—\-_:·|/]+\s*([0-9٠-٩]+)\s*$/);
  const trailingNumMatch = raw.match(/^(.*?)\s+([0-9٠-٩]+)\s*$/);
  const leadingNumMatch = raw.match(/^([0-9٠-٩]+)\s+[.·…—\-_:·|/]*\s*(.*)$/);
  const saheefahMatch = raw.match(/^(.*?)\s*(?:ص|صحيفة|صفحة|hal)\s*[:.]*\s*([0-9٠-٩]+)\s*$/i);

  let rawTitle = '';
  let numStr = '';

  if (trailingLeaderMatch) {
    rawTitle = trailingLeaderMatch[1];
    numStr = trailingLeaderMatch[2];
  } else if (saheefahMatch) {
    rawTitle = saheefahMatch[1];
    numStr = saheefahMatch[2];
  } else if (trailingNumMatch) {
    rawTitle = trailingNumMatch[1];
    numStr = trailingNumMatch[2];
  } else if (leadingNumMatch) {
    numStr = leadingNumMatch[1];
    rawTitle = leadingNumMatch[2];
  } else {
    // Check if there is any number inside the line
    const generalNumMatch = raw.match(/([0-9٠-٩]+)/);
    if (generalNumMatch) {
      numStr = generalNumMatch[1];
      rawTitle = raw.replace(/[0-9٠-٩]+/g, '').replace(/[.·…—\-_:·|/]+/g, ' ');
    }
  }

  if (!numStr || !rawTitle) return null;

  const printedPage = parseArabicOrWesternNumber(numStr);
  if (!printedPage || printedPage < 1) return null;

  // Clean raw title but preserve exact original Arabic text verbatim
  let originalTitle = rawTitle
    .replace(/[.·…—\-_:·|/]+/g, ' ')
    .replace(/\b(ص|صحيفة|صفحة|hal|page)\b/gi, '')
    .trim();

  // Strip excessive whitespace
  originalTitle = originalTitle.replace(/\s+/g, ' ');

  if (originalTitle.length < 2) return null;

  const normalizedTitle = normalizeArabicForComparison(originalTitle);
  const level = classifyHeadingLevel(originalTitle);

  return {
    id: `fihris-p${printedPage}-${Math.random().toString(36).substring(2, 7)}`,
    originalTitle,
    normalizedTitle,
    printedPage,
    pdfPage: printedPage, // Will be mapped and validated subsequently
    sourceFihrisPage,
    confidence: 0.85,
    validationStatus: 'unverified',
    level,
  };
}

/**
 * Samples physical printed page numbers across the PDF to build an accurate page map:
 * printedPage -> pdfPage (without relying on a static global formula).
 */
export async function buildPageMapAnchors(
  pdfDoc: any,
  sampleStep: number = 8
): Promise<{ printed: number; pdf: number }[]> {
  const anchors: { printed: number; pdf: number }[] = [];
  const numPages = pdfDoc.numPages;

  // Sample pages across the book
  for (let p = 1; p <= numPages; p += sampleStep) {
    try {
      const page = await pdfDoc.getPage(p);
      const textContent = await page.getTextContent();
      if (!textContent.items || textContent.items.length === 0) continue;

      const lines = extractLinesFromTextContent(textContent);
      if (lines.length === 0) continue;

      // Look at the top 2 lines (header) and bottom 2 lines (footer) for isolated page numbers
      const edgeLines = [
        ...lines.slice(0, 2),
        ...lines.slice(Math.max(2, lines.length - 2)),
      ];

      for (const edge of edgeLines) {
        // Isolated single number, e.g. "91" or "٩١" or "- ٩١ -"
        const isolatedNum = edge.text.match(/^[-–—\s]*([0-9٠-٩]{1,4})[-–—\s]*$/);
        if (isolatedNum) {
          const parsed = parseArabicOrWesternNumber(isolatedNum[1]);
          if (parsed && parsed >= 1 && parsed <= numPages + 50) {
            // Check plausibility (printed page should be close to PDF page index)
            const diff = Math.abs(p - parsed);
            if (diff < 50) {
              anchors.push({ printed: parsed, pdf: p });
              break;
            }
          }
        }
      }
    } catch {
      // Continue sampling next page
    }
  }

  return anchors;
}

/**
 * Estimates the most accurate initial PDF page index for a printed page
 * using nearby verified anchors.
 */
export function estimatePdfPageFromAnchors(
  printedPage: number,
  anchors: { printed: number; pdf: number }[],
  fallbackOffset: number = 0,
  maxPdfPages: number
): number {
  if (anchors.length === 0) {
    return Math.min(maxPdfPages, Math.max(1, printedPage + fallbackOffset));
  }

  // Find the closest anchor
  let bestAnchor = anchors[0];
  let minDiff = Math.abs(anchors[0].printed - printedPage);

  for (const anc of anchors) {
    const diff = Math.abs(anc.printed - printedPage);
    if (diff < minDiff) {
      minDiff = diff;
      bestAnchor = anc;
    }
  }

  const offset = bestAnchor.pdf - bestAnchor.printed;
  const estimated = printedPage + offset;
  return Math.min(maxPdfPages, Math.max(1, estimated));
}

/**
 * Validates a fihris entry by searching a window of PDF pages [est - 2 ... est + 2]
 * for the actual heading text, key tokens, and structural presence.
 * 
 * Never hallucinates:
 * - Exact / high token match -> 'verified'
 * - Inconclusive -> 'review'
 * - Completely out of bounds -> 'unverified'
 */
export async function validateFihrisEntryInPdfWindow(
  entry: FihrisEntry,
  pdfDoc: any,
  initialPdfPage: number,
  windowRadius: number = 2
): Promise<FihrisEntry> {
  const numPages = pdfDoc.numPages;
  const targetWindow: number[] = [];

  for (let w = -windowRadius; w <= windowRadius; w++) {
    const p = initialPdfPage + w;
    if (p >= 1 && p <= numPages) {
      targetWindow.push(p);
    }
  }

  const normEntryTitle = entry.normalizedTitle;
  // Significant tokens (length >= 3, excluding ubiquitous particles)
  const tokens = normEntryTitle
    .split(' ')
    .filter((tok) => tok.length >= 2 && !['في', 'من', 'عن', 'على', 'الي', 'إلى', 'مع', 'ما', 'هو', 'هي'].includes(tok));

  let bestMatchedPage: number | null = null;
  let bestScore = 0;
  let matchedExcerpt = '';

  for (const pageNum of targetWindow) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      if (!textContent.items || textContent.items.length === 0) continue;

      const lines = extractLinesFromTextContent(textContent);
      const pageNormText = normalizeArabicForComparison(lines.map((l) => l.text).join(' '));

      // 1. Exact Substring Match on Page
      if (pageNormText.includes(normEntryTitle)) {
        bestMatchedPage = pageNum;
        bestScore = 1.0;
        matchedExcerpt = `تطابق تام للعنوان في الصفحة ${pageNum}`;
        break;
      }

      // 2. Line Heading Match (top 5 lines of the page or prominent lines)
      const topLines = lines.slice(0, 6);
      for (const line of topLines) {
        const normLine = normalizeArabicForComparison(line.text);
        if (normLine.includes(normEntryTitle) || (normLine.length > 3 && normEntryTitle.includes(normLine))) {
          bestMatchedPage = pageNum;
          bestScore = 0.95;
          matchedExcerpt = line.text;
          break;
        }
      }
      if (bestScore >= 0.95) break;

      // 3. Token Overlap Score
      if (tokens.length > 0) {
        let matchedCount = 0;
        for (const tok of tokens) {
          const tokNoAl = tok.startsWith('ال') ? tok.slice(2) : tok;
          if (pageNormText.includes(tok) || (tokNoAl.length >= 3 && pageNormText.includes(tokNoAl))) {
            matchedCount++;
          }
        }
        const score = matchedCount / tokens.length;
        if (score > bestScore && score >= 0.65) {
          bestScore = score;
          bestMatchedPage = pageNum;
          matchedExcerpt = `تطابق جزئي للكلمات المفتاحية (${Math.round(score * 100)}%)`;
        }
      }
    } catch {
      // Continue searching next page in window
    }
  }

  // Determine final validation status according to strict guidelines
  if (bestMatchedPage && bestScore >= 0.85) {
    return {
      ...entry,
      pdfPage: bestMatchedPage,
      confidence: Math.round(bestScore * 100) / 100,
      validationStatus: 'verified',
      matchedTextInTarget: matchedExcerpt,
      matchWindowPages: targetWindow,
    };
  } else if (bestMatchedPage && bestScore >= 0.6) {
    return {
      ...entry,
      pdfPage: bestMatchedPage,
      confidence: Math.round(bestScore * 100) / 100,
      validationStatus: 'review',
      matchedTextInTarget: matchedExcerpt,
      matchWindowPages: targetWindow,
      notes: 'تطابق تقريبي؛ يُرجى التحقق اليدوي من بداية الباب',
    };
  } else {
    // No definitive match in window -> mark as review with initial best estimate
    return {
      ...entry,
      pdfPage: initialPdfPage,
      confidence: 0.5,
      validationStatus: 'review',
      matchWindowPages: targetWindow,
      notes: 'لم يتم العثور على العنوان بشكل مؤكد في نافذة الصفحات المحيطة؛ وضع للمراجعة اليدوية',
    };
  }
}

/**
 * Main High-Accuracy Auto-Fihris Runner.
 * Executes detection, entry extraction, page mapping, and window validation.
 */
export async function runAutoFihrisEngine(
  pdfDoc: any,
  bookTitle: string,
  bookAuthor?: string,
  onProgress?: (step: string, percent: number) => void
): Promise<FihrisMetadata> {
  const numPages = pdfDoc.numPages;

  onProgress?.('جارٍ البحث عن صفحات الفهرس المطبوع...', 15);
  const tocPages = await detectFihrisPages(pdfDoc);

  if (tocPages.length === 0) {
    console.warn('[Auto-Fihris] No printed Fihris pages detected. Returning empty fihris metadata.');
    return {
      bookTitle,
      author: bookAuthor,
      tocPages: [],
      entries: [],
    };
  }

  onProgress?.(`تم العثور على صفحات الفهرس (${tocPages.join(', ')}). جارٍ استخراج الأبواب...`, 35);
  let rawEntries: FihrisEntry[] = [];

  for (const pageNum of tocPages) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      if (!textContent.items) continue;

      const lines = extractLinesFromTextContent(textContent);
      const entriesFromPage = extractEntriesFromFihrisLines(lines, pageNum, numPages);
      rawEntries.push(...entriesFromPage);
    } catch (err) {
      console.warn(`[Auto-Fihris] Error extracting lines from fihris page ${pageNum}:`, err);
    }
  }

  // Deduplicate entries while preserving sequence
  const uniqueEntries: FihrisEntry[] = [];
  for (const entry of rawEntries) {
    const exists = uniqueEntries.some(
      (e) => e.printedPage === entry.printedPage && e.normalizedTitle === entry.normalizedTitle
    );
    if (!exists) {
      uniqueEntries.push(entry);
    }
  }

  onProgress?.('جارٍ بناء خريطة أرقام الصفحات الحقيقية (Page Map)...', 55);
  const anchors = await buildPageMapAnchors(pdfDoc, 10);

  // Calculate average initial offset from anchors or first entries
  let initialOffset = 0;
  if (anchors.length > 0) {
    const offsets = anchors.map((a) => a.pdf - a.printed);
    initialOffset = Math.round(offsets.reduce((acc, v) => acc + v, 0) / offsets.length);
  }

  onProgress?.('جارٍ التحقق الدقيق من مطابقة الأبواب في صفحات الكتاب...', 75);
  const validatedEntries: FihrisEntry[] = [];

  for (let i = 0; i < uniqueEntries.length; i++) {
    const entry = uniqueEntries[i];
    const initialEstimatedPdf = estimatePdfPageFromAnchors(
      entry.printedPage,
      anchors,
      initialOffset,
      numPages
    );

    const validated = await validateFihrisEntryInPdfWindow(
      entry,
      pdfDoc,
      initialEstimatedPdf,
      2 // window radius +/- 2 pages
    );
    validatedEntries.push(validated);

    if (i % 5 === 0) {
      const pct = 75 + Math.round((i / uniqueEntries.length) * 20);
      onProgress?.(`تم فحص ${i + 1} من ${uniqueEntries.length} بابًا...`, pct);
    }
  }

  // Sort validated entries strictly by PDF page order
  validatedEntries.sort((a, b) => a.pdfPage - b.pdfPage);

  onProgress?.('اكتملت معالجة الفهرس بنجاح.', 100);

  return {
    bookTitle,
    author: bookAuthor,
    tocPages,
    estimatedOffset: initialOffset,
    entries: validatedEntries,
  };
}

/**
 * Converts FihrisMetadata into compatible KitabChapter array for Tang Ketab Reader.
 */
export function convertFihrisEntriesToChapters(entries: FihrisEntry[]): KitabChapter[] {
  return entries.map((e, idx) => ({
    id: e.id,
    number: String(idx + 1).padStart(2, '0'),
    title: e.originalTitle,
    startPage: e.pdfPage,
    printedPage: e.printedPage,
    originalTitle: e.originalTitle,
    normalizedTitle: e.normalizedTitle,
    sourceFihrisPage: e.sourceFihrisPage,
    confidence: e.confidence,
    validationStatus: e.validationStatus,
    level: e.level,
  }));
}

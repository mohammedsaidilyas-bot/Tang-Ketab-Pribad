import { Capacitor } from '@capacitor/core';
import * as original from './pdfProcessorOriginal';

export * from './pdfProcessorOriginal';

/** True when this device already has a local PDF copy in IndexedDB. */
export async function isPdfCached(blobKey?: string): Promise<boolean> {
  if (!blobKey) return false;
  const buffer = await original.loadPdfArrayBuffer(blobKey);
  return Boolean(buffer && buffer.byteLength > 0);
}

/**
 * Explicit first-use download. The PDF is downloaded from the shared Firebase
 * Storage URL and persisted in IndexedDB. Subsequent reader opens use the
 * local copy and do not need another download.
 */
export async function downloadPdfForDevice(
  blobKey: string,
  url: string,
  onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
  if (!blobKey || !url) {
    throw new Error('Identitas kitab atau URL PDF tidak tersedia.');
  }

  const existing = await original.loadPdfArrayBuffer(blobKey);
  if (existing && existing.byteLength > 0) {
    onProgress?.(100);
    return existing;
  }

  onProgress?.(5);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gagal mengunduh PDF (${response.status}).`);
  }

  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('PDF yang diterima kosong.');
    await original.savePdfArrayBuffer(blobKey, buffer);
    onProgress?.(100);
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) {
        onProgress?.(Math.min(99, Math.round((received / total) * 100)));
      }
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (!merged.byteLength) throw new Error('PDF yang diterima kosong.');
  await original.savePdfArrayBuffer(blobKey, merged.buffer);
  onProgress?.(100);
  return merged.buffer;
}

/**
 * Native-safe PDF loader. On Android/iOS the WebView fetches the shared
 * Firebase Storage URL once, stores it locally, and PDF.js reads the local
 * bytes afterwards. On web the existing proxy/direct fallback is retained.
 */
export async function getOrLoadPdfDoc(
  blobKey?: string,
  urlOrRawBuffer?: string | ArrayBuffer
): Promise<any> {
  const cacheKey = blobKey || (typeof urlOrRawBuffer === 'string' ? urlOrRawBuffer : '');
  if (cacheKey && original.globalPdfDocCache.has(cacheKey)) {
    return original.globalPdfDocCache.get(cacheKey);
  }

  if (!Capacitor.isNativePlatform()) {
    return original.getOrLoadPdfDoc(blobKey, urlOrRawBuffer);
  }

  let buffer: ArrayBuffer | undefined =
    typeof urlOrRawBuffer === 'object' ? urlOrRawBuffer : undefined;

  if (!buffer && blobKey) {
    buffer = (await original.loadPdfArrayBuffer(blobKey)) || undefined;
  }

  if (!buffer && typeof urlOrRawBuffer === 'string' && urlOrRawBuffer && blobKey) {
    try {
      buffer = await downloadPdfForDevice(blobKey, urlOrRawBuffer, (percent) => {
        console.log(`[Native PDF Loader] Download ${percent}%`);
      });
    } catch (error) {
      console.warn('[Native PDF Loader] Shared PDF download failed:', error);
    }
  }

  if (!buffer) {
    return original.getOrLoadPdfDoc(blobKey, urlOrRawBuffer);
  }

  try {
    const doc = await original.createPdfLoadingTask(new Uint8Array(buffer)).promise;
    if (cacheKey) {
      original.globalPdfDocCache.set(cacheKey, doc);
    }
    return doc;
  } catch (error) {
    console.error('[Native PDF Loader] PDF.js failed:', error);
    return null;
  }
}

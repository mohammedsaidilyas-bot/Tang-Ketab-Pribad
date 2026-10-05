import { Capacitor } from '@capacitor/core';
import * as original from './pdfProcessorOriginal';

export * from './pdfProcessorOriginal';

/**
 * Native-safe PDF loader.
 * On Android/iOS, CapacitorHttp overrides fetch so Firebase Storage URLs
 * can be downloaded as bytes without relying on the WebView's CORS rules.
 * The bytes are then handed to the existing PDF.js pipeline.
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

  if (!buffer && typeof urlOrRawBuffer === 'string' && urlOrRawBuffer) {
    try {
      console.log(`[Native PDF Loader] Downloading PDF directly: ${urlOrRawBuffer}`);
      const response = await fetch(urlOrRawBuffer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      buffer = await response.arrayBuffer();
      if (!buffer.byteLength) {
        throw new Error('PDF response is empty');
      }
      console.log(`[Native PDF Loader] Downloaded ${buffer.byteLength} bytes`);
      if (blobKey) {
        await original.savePdfArrayBuffer(blobKey, buffer);
      }
    } catch (error) {
      console.warn('[Native PDF Loader] Cloud download failed:', error);
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

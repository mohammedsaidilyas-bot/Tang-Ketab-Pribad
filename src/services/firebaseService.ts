import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);

// One shared Storage bucket for the whole application.
export const storage = getStorage(app);
export const auth = getAuth(app);

// This project uses a named Firestore database.
const firestoreDatabaseId = (firebaseConfig as any).firestoreDatabaseId as string | undefined;
export const db = firestoreDatabaseId
  ? getFirestore(app, firestoreDatabaseId)
  : getFirestore(app);

const authReady = auth.currentUser
  ? Promise.resolve(auth.currentUser)
  : signInAnonymously(auth).catch((err) => {
      console.warn('[Auth] Anonymous authentication unavailable:', err?.message || err);
      return null;
    });

/**
 * Firestore is the shared catalog only. PDF bytes, page cache, bookmarks and
 * last-read position are deliberately kept on each device.
 */
function toSharedKitab(kitab: KitabDocument): Record<string, unknown> {
  const {
    pages: _pages,
    pdfBlobKey: _pdfBlobKey,
    bookmarks: _bookmarks,
    lastReadPage: _lastReadPage,
    ...metadata
  } = kitab;
  return JSON.parse(JSON.stringify(metadata));
}

function fromSharedKitab(data: Record<string, any>): KitabDocument {
  return {
    ...data,
    // Every device derives the same local cache key from the shared kitab id.
    // This value is NOT written to Firestore.
    pdfBlobKey: String(data.id || ''),
    pages: [],
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    bookmarks: [],
    lastReadPage: 1,
    isUploadedPdf: Boolean(data.isUploadedPdf),
  } as KitabDocument;
}

export async function uploadPdfToStorage(
  kitabId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  try {
    await authReady;

    if (!file || file.size <= 0) {
      throw new Error('Berkas PDF kosong atau tidak dapat dibaca oleh perangkat.');
    }

    const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
    onProgress?.(5);

    console.log('[Admin Upload] Shared kitab upload started', {
      path: storageRef.fullPath,
      size: file.size,
      type: file.type || 'application/pdf',
    });

    const bytes = new Uint8Array(await file.arrayBuffer());
    onProgress?.(15);

    const result = await uploadBytes(storageRef, bytes, {
      contentType: 'application/pdf',
      contentDisposition: 'inline',
      // Allow the same installed app to reuse cached copies for one hour.
      cacheControl: 'public,max-age=3600',
    });

    onProgress?.(85);
    const cloudUrl = await getDownloadURL(result.ref);
    onProgress?.(100);

    console.log('[Admin Upload] Shared PDF is now available:', cloudUrl);
    return cloudUrl;
  } catch (firebaseErr: any) {
    console.error('[Admin Upload] Firebase Storage upload failed:', firebaseErr);

    const code = firebaseErr?.code || 'storage/unknown';
    const serverResponse = firebaseErr?.serverResponse;
    const message = String(firebaseErr?.message || 'Unknown Firebase Storage error');

    if (code === 'storage/unknown' || code === 'storage/bucket-not-found') {
      throw new Error(
        'Firebase Storage belum aktif/terhubung pada project. Buka Firebase Console → Storage → Get started, lalu pastikan bucket project aktif.'
      );
    }

    if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
      throw new Error(
        'Akses Firebase Storage ditolak. Pastikan Storage Rules mengizinkan hanya akun admin untuk mengunggah ke folder kitabs/.'
      );
    }

    throw new Error(`Gagal mengunggah PDF ke cloud [${code}]: ${serverResponse || message}`);
  }
}

export async function getStoragePdfUrl(kitabId: string): Promise<string | null> {
  try {
    await authReady;
    return await getDownloadURL(ref(storage, `kitabs/${kitabId}.pdf`));
  } catch (error) {
    console.warn('[Storage] Shared PDF URL not found:', kitabId, error);
    return null;
  }
}

/**
 * Returns the shared PDF bytes. The caller stores them in IndexedDB on the
 * current device. It is intentionally separate from Firestore metadata.
 */
export async function downloadSharedPdf(
  kitabId: string,
  pdfUrl?: string,
  onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
  await authReady;
  const url = pdfUrl || (await getStoragePdfUrl(kitabId));
  if (!url) {
    throw new Error('PDF kitab belum tersedia di penyimpanan pusat.');
  }

  onProgress?.(5);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gagal mengunduh PDF (${response.status}).`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = await response.arrayBuffer();
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
      if (contentLength > 0) {
        onProgress?.(Math.min(99, Math.round((received / contentLength) * 100)));
      }
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(100);
  return buffer.buffer;
}

export async function saveKitabToFirestore(kitab: KitabDocument) {
  await authReady;
  await setDoc(doc(db, 'kitabs', kitab.id), toSharedKitab(kitab), { merge: true });
}

export async function deleteKitabFromFirestore(kitabId: string) {
  await authReady;
  await deleteDoc(doc(db, 'kitabs', kitabId));
}

export function subscribeToKitabs(callback: (kitabs: KitabDocument[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'kitabs'),
    (snapshot) => {
      const items = snapshot.docs
        .map((item) => fromSharedKitab({ id: item.id, ...item.data() }))
        .filter((item) => item.isUploadedPdf && Boolean(item.pdfUrl));
      callback(items);
    },
    (error) => {
      console.error('[Registry] Shared kitab subscription failed:', error);
      callback([]);
    }
  );
}

export async function saveNoteToFirestore(note: HasyiyahNote) {
  await authReady;
  await setDoc(doc(db, 'notes', note.id), JSON.parse(JSON.stringify(note)), { merge: true });
}

export async function deleteNoteFromFirestore(noteId: string) {
  await authReady;
  await deleteDoc(doc(db, 'notes', noteId));
}

export function subscribeToNotes(callback: (notes: HasyiyahNote[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'notes'),
    (snapshot) => callback(snapshot.docs.map((item) => item.data() as HasyiyahNote)),
    (error) => {
      console.error('[Notes] Shared notes subscription failed:', error);
      callback([]);
    }
  );
}

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

// Use the bucket declared by Firebase's own web configuration. Do not pass a
// second bucket argument here: Capacitor/WebView builds can otherwise produce
// an opaque storage/unknown error when the configured bucket is the new
// *.firebasestorage.app bucket name.
export const storage = getStorage(app);
export const auth = getAuth(app);

// IMPORTANT: this project uses a named Firestore database.
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
  const totalPages = Math.max(1, Number(data.totalPages) || 1);
  const pages = Array.isArray(data.pages) && data.pages.length > 0
    ? data.pages
    : Array.from({ length: totalPages }, (_, index) => ({
        pageNumber: index + 1,
        chapterTitle: '',
        paragraphs: [],
      }));

  return {
    ...data,
    pages,
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

    console.log('[Upload] Starting Firebase Storage upload', {
      path: storageRef.fullPath,
      size: file.size,
      type: file.type || 'application/pdf',
    });

    const bytes = new Uint8Array(await file.arrayBuffer());
    onProgress?.(15);

    const result = await uploadBytes(storageRef, bytes, {
      contentType: 'application/pdf',
      contentDisposition: 'inline',
      cacheControl: 'public,max-age=3600',
    });

    onProgress?.(85);
    const cloudUrl = await getDownloadURL(result.ref);
    onProgress?.(100);

    console.log('[Upload] Firebase Storage upload complete:', cloudUrl);
    return cloudUrl;
  } catch (firebaseErr: any) {
    console.error('[Upload] Firebase Storage upload failed:', firebaseErr);

    const code = firebaseErr?.code || 'storage/unknown';
    const serverResponse = firebaseErr?.serverResponse;
    const message = String(firebaseErr?.message || 'Unknown Firebase Storage error');

    // Give the admin a useful diagnosis instead of the generic
    // "storage/unknown" message returned by some Android WebView builds.
    if (code === 'storage/unknown' || code === 'storage/bucket-not-found') {
      throw new Error(
        'Firebase Storage belum aktif/terhubung pada project. Buka Firebase Console → Storage → Get started, lalu pastikan bucket project gen-lang-client-0238728154 aktif. Setelah itu coba unggah kembali.'
      );
    }

    if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
      throw new Error(
        'Akses Firebase Storage ditolak. Pastikan Authentication dan Storage Rules mengizinkan pengguna aplikasi untuk mengunggah ke folder kitabs/.'
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
    console.warn('[Storage] PDF URL not found:', kitabId, error);
    return null;
  }
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
        .filter((item) => item.isUploadedPdf);
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

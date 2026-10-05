import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
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
export const storage = getStorage(app);
export const auth = getAuth(app);

// IMPORTANT: this project uses a named Firestore database. The old code used
// getFirestore(app), which connects to the default database and therefore made
// each APK appear to have an empty/shared catalogue even though the web app had
// data in the named database.
const firestoreDatabaseId = (firebaseConfig as any).firestoreDatabaseId as string | undefined;
export const db = firestoreDatabaseId
  ? getFirestore(app, firestoreDatabaseId)
  : getFirestore(app);

// Authenticate anonymously so Firebase Storage and Firestore have valid credentials.
const authReady = auth.currentUser
  ? Promise.resolve(auth.currentUser)
  : signInAnonymously(auth).catch((err) => {
      console.log('[Auth] Anonymous authentication note:', err?.message || err);
      return null;
    });

/**
 * Firestore is the shared catalogue for ALL users.
 * The PDF itself lives in Firebase Storage; Firestore stores only shared
 * catalogue metadata and the download URL. Per-user reading state and large
 * local-only fields are intentionally excluded.
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
  // The actual PDF is shared through Firebase Storage, so we deliberately do
  // not store hundreds of rendered page objects in Firestore. The reader,
  // however, needs a page descriptor for every PDF page. Recreate lightweight
  // descriptors here; the visible page image is rendered directly from the
  // cloud PDF by PDF.js.
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
    const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: 'application/pdf',
    });

    const cloudUrl = await new Promise<string>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const percent = snapshot.totalBytes > 0
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;
          onProgress?.(percent);
        },
        reject,
        async () => {
          try {
            resolve(await getDownloadURL(uploadTask.snapshot.ref));
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    onProgress?.(100);
    return cloudUrl;
  } catch (firebaseErr: any) {
    console.error('[Upload] Firebase Storage upload failed:', firebaseErr);
    throw new Error(`Gagal mengunggah PDF ke cloud: ${firebaseErr?.message || 'unknown error'}`);
  }
}

export async function getStoragePdfUrl(kitabId: string): Promise<string | null> {
  try {
    await authReady;
    return await getDownloadURL(ref(storage, `kitabs/${kitabId}.pdf`));
  } catch {
    return null;
  }
}

/** Save a kitab to the one shared named Firestore catalogue. */
export async function saveKitabToFirestore(kitab: KitabDocument) {
  await authReady;
  await setDoc(doc(db, 'kitabs', kitab.id), toSharedKitab(kitab), { merge: true });
}

export async function deleteKitabFromFirestore(kitabId: string) {
  await authReady;
  await deleteDoc(doc(db, 'kitabs', kitabId));
}

/** Real-time global catalogue. Any published/admin upload appears on every connected user. */
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

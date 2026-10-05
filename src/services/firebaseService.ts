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
export const db = getFirestore(app);

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
 * catalogue metadata and the download URL. Per-user reading state (bookmarks,
 * lastReadPage) and large/local-only fields are intentionally excluded.
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
    pages: [],
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    bookmarks: [],
    lastReadPage: 1,
    isUploadedPdf: Boolean(data.isUploadedPdf),
  } as KitabDocument;
}

// Upload PDFs to Firebase Storage. The Storage path is shared, not user-specific.
export async function uploadPdfToStorage(
  kitabId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  console.log(`Starting PDF upload for kitab: ${kitabId}, size: ${file.size} bytes`);

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
        (error) => reject(error),
        async () => {
          try {
            resolve(await getDownloadURL(uploadTask.snapshot.ref));
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    console.log(`[Upload] Firebase Storage upload completed: ${cloudUrl}`);
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
    const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
    return await getDownloadURL(storageRef);
  } catch {
    return null;
  }
}

/** Save a kitab to the ONE shared catalogue used by every installation. */
export async function saveKitabToFirestore(kitab: KitabDocument) {
  try {
    await authReady;
    await setDoc(doc(db, 'kitabs', kitab.id), toSharedKitab(kitab), { merge: true });
    console.log(`[Registry] Shared kitab saved: ${kitab.id}`);
  } catch (e) {
    console.error('[Registry] Failed to save shared kitab:', e);
  }
}

export async function deleteKitabFromFirestore(kitabId: string) {
  try {
    await authReady;
    await deleteDoc(doc(db, 'kitabs', kitabId));
  } catch (e) {
    console.error('[Registry] Failed to delete shared kitab:', e);
  }
}

/** Real-time global catalogue. Any admin upload appears on every connected user. */
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
  try {
    await authReady;
    await setDoc(doc(db, 'notes', note.id), JSON.parse(JSON.stringify(note)), { merge: true });
  } catch (e) {
    console.error('[Notes] Failed to save note:', e);
  }
}

export async function deleteNoteFromFirestore(noteId: string) {
  try {
    await authReady;
    await deleteDoc(doc(db, 'notes', noteId));
  } catch (e) {
    console.error('[Notes] Failed to delete note:', e);
  }
}

export function subscribeToNotes(callback: (notes: HasyiyahNote[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'notes'),
    (snapshot) => {
      callback(snapshot.docs.map((item) => item.data() as HasyiyahNote));
    },
    (error) => {
      console.error('[Notes] Shared notes subscription failed:', error);
      callback([]);
    }
  );
}

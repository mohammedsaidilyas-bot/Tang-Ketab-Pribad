import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Authenticate anonymously so Firebase Storage has valid credentials.
const authReady = auth.currentUser
  ? Promise.resolve(auth.currentUser)
  : signInAnonymously(auth).catch((err) => {
      console.log('[Auth] Anonymous authentication note:', err?.message || err);
      return null;
    });

// Upload PDFs to Firebase Storage and optionally mirror them to the web server.
// IMPORTANT: the returned URL must be the Firebase URL so the Android APK can
// reopen the book even though it does not run the Express /api server.
export async function uploadPdfToStorage(
  kitabId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  console.log(`Starting PDF upload for kitab: ${kitabId}, size: ${file.size} bytes`);

  let serverUrl = '';
  try {
    const resp = await fetch(`/api/upload-pdf?kitabId=${encodeURIComponent(kitabId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    });
    if (resp.ok) {
      const data = await resp.json();
      serverUrl = data.url || `/api/pdf/${kitabId}`;
      console.log(`[Upload] Server mirror upload successful: ${serverUrl}`);
    }
  } catch (serverErr) {
    // Expected in the Android APK because there is no local Express server.
    console.log('[Upload] Server mirror unavailable; continuing with Firebase Storage.');
  }

  if (!storage) {
    if (serverUrl) return serverUrl;
    throw new Error('Firebase Storage belum tersedia.');
  }

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
    // Web deployments can still use the server copy, but never return a fake
    // /api URL in the APK when Firebase upload failed.
    if (serverUrl) return serverUrl;
    throw new Error(`Gagal mengunggah PDF ke cloud: ${firebaseErr?.message || 'unknown error'}`);
  }
}

export async function getStoragePdfUrl(kitabId: string): Promise<string | null> {
  // Firebase is the portable source of truth for Android and web.
  if (storage) {
    try {
      const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
      return await getDownloadURL(storageRef);
    } catch {
      // Continue to the server mirror fallback.
    }
  }

  try {
    const checkResp = await fetch(`/api/has-pdf/${encodeURIComponent(kitabId)}`);
    if (checkResp.ok) {
      const data = await checkResp.json();
      if (data.exists) return `/api/pdf/${kitabId}`;
    }
  } catch {
    // ignore
  }

  return null;
}

// Server-side registry persistence for web deployments.
export async function saveKitabToFirestore(kitab: KitabDocument) {
  try {
    const resp = await fetch('/api/kitabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kitab),
    });
    if (!resp.ok) console.warn('Failed to save kitab to server registry:', resp.statusText);
  } catch (e) {
    console.log('[Registry] Server registry unavailable in standalone APK.');
  }
}

export async function deleteKitabFromFirestore(kitabId: string) {
  try {
    await fetch(`/api/kitabs/${encodeURIComponent(kitabId)}`, { method: 'DELETE' });
  } catch (e) {
    console.log('[Registry] Server delete unavailable in standalone APK.');
  }
}

export async function saveNoteToFirestore(note: HasyiyahNote) {
  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    });
  } catch (e) {
    console.log('[Notes] Server registry unavailable in standalone APK.');
  }
}

export async function deleteNoteFromFirestore(noteId: string) {
  try {
    await fetch(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  } catch (e) {
    console.log('[Notes] Server delete unavailable in standalone APK.');
  }
}

export function subscribeToKitabs(callback: (kitabs: KitabDocument[]) => void) {
  let isCancelled = false;
  const fetchKitabs = async () => {
    try {
      const resp = await fetch('/api/kitabs');
      if (resp.ok) {
        const items: KitabDocument[] = await resp.json();
        if (!isCancelled && Array.isArray(items) && items.length > 0) callback(items);
      }
    } catch {
      // Standalone APK intentionally has no /api server; localStorage remains authoritative.
    }
  };
  fetchKitabs();
  const interval = setInterval(fetchKitabs, 4000);
  return () => {
    isCancelled = true;
    clearInterval(interval);
  };
}

export function subscribeToNotes(callback: (notes: HasyiyahNote[]) => void) {
  let isCancelled = false;
  const fetchNotes = async () => {
    try {
      const resp = await fetch('/api/notes');
      if (resp.ok) {
        const items: HasyiyahNote[] = await resp.json();
        if (!isCancelled && Array.isArray(items)) callback(items);
      }
    } catch {
      // Standalone APK intentionally has no /api server.
    }
  };
  fetchNotes();
  const interval = setInterval(fetchNotes, 4000);
  return () => {
    isCancelled = true;
    clearInterval(interval);
  };
}

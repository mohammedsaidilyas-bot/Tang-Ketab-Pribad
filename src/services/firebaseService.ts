import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Authenticate anonymously so Firebase Storage has valid credentials
signInAnonymously(auth).catch((err) => {
  console.log('[Auth] Anonymous authentication note:', err?.message || err);
});

// Dual-layer PDF upload helper: uploads to Server Disk and Firebase Storage
export async function uploadPdfToStorage(
  kitabId: string, 
  file: File, 
  onProgress?: (percent: number) => void
): Promise<string> {
  console.log(`Starting PDF upload for kitab: ${kitabId}, size: ${file.size} bytes`);
  let serverUrl = '';

  // 1. Upload to Server Storage Endpoint (Primary & Instant)
  try {
    const resp = await fetch(`/api/upload-pdf?kitabId=${encodeURIComponent(kitabId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
      },
      body: file,
    });
    if (resp.ok) {
      const data = await resp.json();
      serverUrl = data.url || `/api/pdf/${kitabId}`;
      console.log(`[Upload] Server disk upload successful: ${serverUrl}`);
      if (onProgress) onProgress(100);
    }
  } catch (serverErr) {
    console.warn('[Upload] Server disk upload error:', serverErr);
  }

  const finalUrl = serverUrl || `/api/pdf/${kitabId}`;

  // 2. Non-blocking best-effort sync to Firebase Storage
  if (storage) {
    try {
      const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
      uploadBytesResumable(storageRef, file, {
        contentType: 'application/pdf',
      }).then(async (snapshot) => {
        const cloudUrl = await getDownloadURL(snapshot.ref);
        console.log(`[Upload] Background Firebase Storage sync completed: ${cloudUrl}`);
      }).catch((err) => {
        console.warn('[Upload] Non-blocking Firebase Storage background note:', err?.message || err);
      });
    } catch (e: any) {
      console.warn('[Upload] Firebase Storage exception:', e);
    }
  }

  return finalUrl;
}

export async function getStoragePdfUrl(kitabId: string): Promise<string | null> {
  // 1. Check Server Disk first
  try {
    const checkResp = await fetch(`/api/has-pdf/${encodeURIComponent(kitabId)}`);
    if (checkResp.ok) {
      const data = await checkResp.json();
      if (data.exists) {
        return `/api/pdf/${kitabId}`;
      }
    }
  } catch {
    // ignore
  }

  // 2. Check Firebase Storage
  if (storage) {
    try {
      const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
      return await getDownloadURL(storageRef);
    } catch (e) {
      // not found in Firebase Storage
    }
  }

  return null;
}

// Quota-free Server-Side JSON Registry Persistence for Kitabs & Notes
export async function saveKitabToFirestore(kitab: KitabDocument) {
  try {
    console.log(`[Server Storage] Saving kitab "${kitab.title}" (${kitab.id}) to quota-free server registry.`);
    const resp = await fetch('/api/kitabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kitab),
    });
    if (!resp.ok) {
      console.warn('Failed to save kitab to server registry:', resp.statusText);
    }
  } catch (e) {
    console.error('Error saving kitab to server registry:', e);
  }
}

export async function deleteKitabFromFirestore(kitabId: string) {
  try {
    await fetch(`/api/kitabs/${encodeURIComponent(kitabId)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.error('Error deleting kitab from server registry:', e);
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
    console.error('Error saving note to server registry:', e);
  }
}

export async function deleteNoteFromFirestore(noteId: string) {
  try {
    await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.error('Error deleting note from server registry:', e);
  }
}

export function subscribeToKitabs(callback: (kitabs: KitabDocument[]) => void) {
  let isCancelled = false;

  const fetchKitabs = async () => {
    try {
      const resp = await fetch('/api/kitabs');
      if (resp.ok) {
        const items: KitabDocument[] = await resp.json();
        if (!isCancelled && Array.isArray(items) && items.length > 0) {
          callback(items);
        }
      }
    } catch (err) {
      console.warn('Kitabs sync polling warning:', err);
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
        if (!isCancelled && Array.isArray(items)) {
          callback(items);
        }
      }
    } catch (err) {
      console.warn('Notes sync polling warning:', err);
    }
  };

  fetchNotes();
  const interval = setInterval(fetchNotes, 4000);

  return () => {
    isCancelled = true;
    clearInterval(interval);
  };
}

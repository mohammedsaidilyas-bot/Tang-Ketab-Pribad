import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Authenticate anonymously so Firebase Storage and Firestore requests have valid credentials
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

  // 1. Upload to Server Storage Endpoint
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
      if (onProgress) onProgress(50);
    }
  } catch (serverErr) {
    console.warn('[Upload] Server disk upload error, continuing to cloud storage...', serverErr);
  }

  // 2. Upload to Firebase Storage
  if (storage) {
    try {
      const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: 'application/pdf',
        customMetadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString()
        }
      });

      return await new Promise<string>((resolve) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 50 + 50;
            if (onProgress) onProgress(Math.min(100, progress));
          },
          (error) => {
            console.warn('[Upload] Firebase Storage upload error, using server URL fallback:', error);
            if (serverUrl) {
              resolve(serverUrl);
            } else {
              resolve(`/api/pdf/${kitabId}`);
            }
          },
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              console.log(`[Upload] Firebase Storage upload successful. URL: ${url}`);
              resolve(url);
            } catch {
              resolve(serverUrl || `/api/pdf/${kitabId}`);
            }
          }
        );
      });
    } catch (e: any) {
      console.warn('[Upload] Firebase Storage exception, using server storage fallback:', e);
    }
  }

  if (serverUrl) {
    if (onProgress) onProgress(100);
    return serverUrl;
  }

  return `/api/pdf/${kitabId}`;
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

export async function saveKitabToFirestore(kitab: KitabDocument) {
  try {
    console.log(`Firestore Write: Saving kitab "${kitab.title}" (${kitab.id}). Cloud PDF: ${!!kitab.pdfUrl}`);
    const docRef = doc(db, 'kitabs', kitab.id);
    let dataToSave = JSON.parse(JSON.stringify(kitab));

    // Ensure we don't accidentally save local blob keys to cloud if they shouldn't be there
    // but we MUST save the pdfUrl
    if (kitab.pdfUrl) {
      dataToSave.pdfUrl = kitab.pdfUrl;
    }

    // Check for document size limit (1MB). If too big, prune the pages text
    // as it's the largest part and we have the PDF file anyway.
    const estimatedSize = JSON.stringify(dataToSave).length;
    if (estimatedSize > 850000) { // ~850KB threshold to be safe
      console.warn(`Kitab "${kitab.title}" document is large (${estimatedSize} bytes). Pruning page text to fit Firestore limit.`);
      dataToSave.pages = dataToSave.pages.map((p: any) => ({
        ...p,
        paragraphs: [`[Teks halaman dikurangi demi sinkronisasi awan · Silakan baca visual PDF asli]`]
      }));
    }

    await setDoc(docRef, dataToSave);
  } catch (e) {
    console.error('Error saving kitab to Firestore:', e);
  }
}

export async function deleteKitabFromFirestore(kitabId: string) {
  try {
    const docRef = doc(db, 'kitabs', kitabId);
    await deleteDoc(docRef);
  } catch (e) {
    console.error('Error deleting kitab from Firestore:', e);
  }
}

export async function saveNoteToFirestore(note: HasyiyahNote) {
  try {
    const docRef = doc(db, 'notes', note.id);
    await setDoc(docRef, JSON.parse(JSON.stringify(note)));
  } catch (e) {
    console.error('Error saving note to Firestore:', e);
  }
}

export async function deleteNoteFromFirestore(noteId: string) {
  try {
    const docRef = doc(db, 'notes', noteId);
    await deleteDoc(docRef);
  } catch (e) {
    console.error('Error deleting note from Firestore:', e);
  }
}

export function subscribeToKitabs(callback: (kitabs: KitabDocument[]) => void) {
  const colRef = collection(db, 'kitabs');
  return onSnapshot(colRef, (snapshot) => {
    const items: KitabDocument[] = [];
    snapshot.forEach((docSnap) => {
      items.push(docSnap.data() as KitabDocument);
    });
    if (items.length > 0) {
      callback(items);
    }
  }, (err) => {
    console.warn('Firestore kitabs sync warning:', err);
  });
}

export function subscribeToNotes(callback: (notes: HasyiyahNote[]) => void) {
  const colRef = collection(db, 'notes');
  return onSnapshot(colRef, (snapshot) => {
    const items: HasyiyahNote[] = [];
    snapshot.forEach((docSnap) => {
      items.push(docSnap.data() as HasyiyahNote);
    });
    callback(items);
  }, (err) => {
    console.warn('Firestore notes sync warning:', err);
  });
}

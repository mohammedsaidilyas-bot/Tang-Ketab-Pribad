import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Firestore CRUD helpers for Kitabs and Notes
export async function uploadPdfToStorage(
  kitabId: string, 
  file: File, 
  onProgress?: (percent: number) => void
): Promise<string> {
  if (!storage) {
    console.warn('Firebase Storage is not initialized.');
    return '';
  }
  try {
    console.log(`Starting PDF upload for kitab: ${kitabId}, size: ${file.size} bytes`);
    const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
    
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: 'application/pdf',
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString()
      }
    });

    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (onProgress) onProgress(progress);
        }, 
        (error) => {
          console.error('Upload failed:', error);
          reject(new Error(`Gagal mengunggah PDF: ${error.message}`));
        }, 
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          console.log(`PDF upload successful. URL: ${url}`);
          resolve(url);
        }
      );
    });
  } catch (e: any) {
    console.error('Error in uploadPdfToStorage:', e);
    throw new Error(`Gagal mengunggah PDF: ${e.message || 'Kesalahan jaringan'}`);
  }
}

export async function getStoragePdfUrl(kitabId: string): Promise<string | null> {
  if (!storage) return null;
  try {
    const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
    return await getDownloadURL(storageRef);
  } catch (e) {
    return null;
  }
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

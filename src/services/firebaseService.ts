import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { KitabDocument, HasyiyahNote } from '../types/kitab';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Firestore CRUD helpers for Kitabs and Notes
export async function uploadPdfToStorage(kitabId: string, file: File): Promise<string> {
  if (!storage) {
    console.warn('Firebase Storage is not initialized.');
    return '';
  }
  const storageRef = ref(storage, `kitabs/${kitabId}.pdf`);
  const snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
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

// Firestore CRUD helpers for Kitabs and Notes
export async function saveKitabToFirestore(kitab: KitabDocument) {
  try {
    const docRef = doc(db, 'kitabs', kitab.id);
    await setDoc(docRef, JSON.parse(JSON.stringify(kitab)));
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

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyAziP_2HxsFH7RXeo5RNq8qvaawMamnYAQ",
  authDomain: "shivam-staff-ff7d5.firebaseapp.com",
  projectId: "shivam-staff-ff7d5",
  storageBucket: "shivam-staff-ff7d5.firebasestorage.app",
  messagingSenderId: "133240405311",
  appId: "1:133240405311:web:55a32b1783802aa3e6e78a",
  measurementId: "G-HBBGMGR6R5"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// OFFLINE-FIRST (Boss order 2026-10-27: "internet naa ho aur dashboard khula
// ho tab bhi wo kaam kare net aane par wapis Firestore par data bhej de"):
// persistentLocalCache = IndexedDB disk cache — offline READS cache se milte
// hai, WRITES SDK queue me durable (browser refresh par bhi safe), net aane
// par SDK khud sync karta hai. Multi-tab manager = ek se zyada dashboard tab
// chale to bhi cache conflict-free. Fallback: unsupported browser par default.
let dbInst: ReturnType<typeof getFirestore>;
try {
  dbInst = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch {
  dbInst = getFirestore(app);
}
export const db = dbInst;

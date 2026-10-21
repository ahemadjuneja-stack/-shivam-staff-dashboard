import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
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
export const db = getFirestore(app);

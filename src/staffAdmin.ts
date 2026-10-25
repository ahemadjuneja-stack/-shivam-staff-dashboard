// STAFF ADMIN HELPERS (Boss order 2026-10-26: dashboard se staff registration)
//
// Firebase Auth me doosre user ka account client-side se banane ka safe pattern:
// ek temporary secondary app instance banate hain — createUser us par hota hai,
// boss ka main login session untouched rehta hai, temp app delete.
//
// PASSWORD SCHEME (staff app Auth.tsx jaisa hi):
//   email    = {mobile}@shivamstaff.app
//   password = sv{pin}shivam
// users doc me PIN bhi store hota hai — isliye dashboard baad me PIN reset
// kar sakta hai (purane stored PIN se temporary sign-in, phir updatePassword).

import {
  initializeApp,
  deleteApp,
  type FirebaseApp
} from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword
} from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { firebaseConfig, db } from './firebase';
import type { UserRole } from './types';

export const getEmail = (phone: string) => `${phone.trim()}@shivamstaff.app`;
export const derivePassword = (pin: string) => `sv${pin.trim()}shivam`;

export interface RegisterStaffInput {
  name: string;
  mobile: string;
  pin: string;
  role: UserRole;
  city: string;
  xlCities: string[];
}

export interface AdminResult {
  ok: boolean;
  message: string;
  warning?: boolean;
}

// Temporary secondary app — boss ka session break nahi hota
async function withTempAuth<T>(fn: (tempAuth: ReturnType<typeof getAuth>) => Promise<T>): Promise<T> {
  let tempApp: FirebaseApp | null = null;
  try {
    tempApp = initializeApp(firebaseConfig, 'shivam-admin-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const tempAuth = getAuth(tempApp);
    const result = await fn(tempAuth);
    await signOutTemp(tempAuth);
    return result;
  } finally {
    if (tempApp) {
      try { await deleteApp(tempApp); } catch { /* ignore */ }
    }
  }
}

async function signOutTemp(tempAuth: ReturnType<typeof getAuth>) {
  try { await tempAuth.signOut(); } catch { /* ignore */ }
}

function friendlyAuthError(err: any): string {
  const code = String(err?.code || '');
  if (code === 'auth/weak-password') return 'That PIN creates a password that is too weak. Please use a different 4-digit PIN.';
  if (code === 'auth/too-many-requests') return 'Too many attempts for this mobile number right now. Please wait a minute and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check the internet connection and try again.';
  return err?.message || 'Registration failed. Please try again.';
}

// Find the users doc for a mobile number (any status)
async function findUserDocByPhone(mobile: string): Promise<{ id: string; data: any } | null> {
  const q = query(collection(db, 'users'), where('phone', '==', mobile.trim()));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const d = snap.docs[0];
    return { id: d.id, data: d.data() };
  }
  return null;
}

// REGISTER STAFF (dashboard-side, active immediately — boss approved by default)
export async function registerStaff(input: RegisterStaffInput): Promise<AdminResult> {
  const name = input.name.trim();
  const mobile = input.mobile.trim();
  const pin = input.pin.trim();
  const city = input.city.trim() || 'Main';
  const email = getEmail(mobile);
  const password = derivePassword(pin);

  const profileData = {
    name,
    phone: mobile,
    mobile,
    pin,
    status: 'active' as const,
    role: input.role,
    city,
    allowedCategories: [],
    xlCities: input.role === 'sales' ? input.xlCities : [],
    approvedAt: Date.now(),
    registeredVia: 'dashboard'
  };

  try {
    await withTempAuth(async (tempAuth) => {
      const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), { ...profileData, createdAt: Date.now() });
    });
    return {
      ok: true,
      message: `${name} registered successfully — account is active now. Staff can log in with mobile ${mobile} + the PIN you set.`
    };
  } catch (err: any) {
    if (String(err?.code || '') === 'auth/email-already-in-use') {
      // Phone pehle se Auth me hai — stored PIN se takeover karke naya PIN set karte hain
      const existing = await findUserDocByPhone(mobile);
      if (existing && existing.data?.pin) {
        try {
          await withTempAuth(async (tempAuth) => {
            const cred = await signInWithEmailAndPassword(tempAuth, email, derivePassword(String(existing.data.pin)));
            await updatePassword(cred.user, password);
          });
          await updateDoc(doc(db, 'users', existing.id), {
            ...profileData,
            createdAt: existing.data.createdAt || Date.now()
          });
          return {
            ok: true,
            message: `${name} re-activated — login PIN updated to the new PIN. Account is active now.`
          };
        } catch {
          // Stored PIN se sign-in nahi hua — details update kar do, purana PIN chalega
          await updateDoc(doc(db, 'users', existing.id), {
            name,
            phone: mobile,
            mobile,
            status: 'active',
            role: input.role,
            city,
            xlCities: input.role === 'sales' ? input.xlCities : [],
            approvedAt: Date.now(),
            registeredVia: 'dashboard'
          });
          return {
            ok: true,
            warning: true,
            message: `${name} re-activated, but the PIN could NOT be changed (previous PIN was different). Staff must log in with their previous PIN.`
          };
        }
      }
      return {
        ok: false,
        message: 'This mobile number already has an account that could not be taken over. If the staff registered from their own phone, approve them from Verifications & Approvals instead.'
      };
    }
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// EDIT STAFF DETAILS (name / city)
export async function updateStaffDetails(uid: string, name: string, city: string): Promise<AdminResult> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      name: name.trim(),
      city: city.trim() || 'Main',
      updatedAt: Date.now(),
      updatedVia: 'dashboard'
    });
    return { ok: true, message: 'Staff details updated successfully.' };
  } catch (err: any) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

// CHANGE STAFF PIN (stored purane PIN se temp sign-in, phir password reset)
export async function changeStaffPin(uid: string, storedPin: string, newPin: string): Promise<AdminResult> {
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (!userDoc.exists()) return { ok: false, message: 'Staff record not found.' };
    const mobile = String(userDoc.data()?.phone || userDoc.data()?.mobile || '');
    if (!mobile) return { ok: false, message: 'This staff has no mobile number on record — PIN cannot be changed.' };

    const email = getEmail(mobile);
    await withTempAuth(async (tempAuth) => {
      const cred = await signInWithEmailAndPassword(tempAuth, email, derivePassword(storedPin));
      await updatePassword(cred.user, derivePassword(newPin));
    });
    await updateDoc(doc(db, 'users', uid), { pin: newPin.trim(), pinUpdatedAt: Date.now() });
    return { ok: true, message: 'PIN changed successfully. Staff can log in with the new PIN.' };
  } catch {
    return {
      ok: false,
      message: 'PIN change failed — the PIN stored on file does not match the actual login PIN. Staff must keep using their current PIN.'
    };
  }
}

// DELETE STAFF (soft delete: directory se gayab + login blocked + number reusable)
export async function deleteStaff(uid: string, name: string): Promise<AdminResult> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      status: 'deleted',
      deletedAt: Date.now(),
      deletedVia: 'dashboard'
    });
    return {
      ok: true,
      message: `${name} deleted. Their app login is blocked and the mobile number is free for future registration.`
    };
  } catch (err: any) {
    return { ok: false, message: friendlyAuthError(err) };
  }
}

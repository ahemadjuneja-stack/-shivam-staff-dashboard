import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

import LiveScreen from './screens/Live';
import ApprovalsScreen from './screens/Approvals';
import WorkersScreen from './screens/Workers';
import HisabAdminScreen from './screens/HisabAdmin';
import SettingsScreen from './screens/Settings';

type AdminTab = 'live' | 'approvals' | 'workers' | 'hisab' | 'settings';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('live');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const adminDoc = await getDoc(doc(db, 'admins', user.uid));
          setIsAdmin(adminDoc.exists());
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleDemoLogin = () => {
    setAuthError('');
    const mockUser: any = {
      uid: 'demo-shivam-owner-uid',
      email: 'owner@shivam.com',
      displayName: 'Shivam Owner',
      isDemo: true
    };
    setCurrentUser(mockUser);
    setIsAdmin(true);
  };

  const handleLogout = async () => {
    try {
      if (!(currentUser as any)?.isDemo) {
        await signOut(auth);
      }
    } catch (e) {
      console.warn('Sign out error:', e);
    } finally {
      setCurrentUser(null);
      setIsAdmin(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      if (isRegisterMode) {
        const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
        // Pehli baar account banane par admin document create karne ka prayas
        await setDoc(doc(db, 'admins', res.user.uid), {
          name: 'Owner',
          email: res.user.email,
          createdAt: Date.now()
        });
        setIsAdmin(true);
      } else {
        const res = await signInWithEmailAndPassword(auth, email.trim(), password);
        const adminDoc = await getDoc(doc(db, 'admins', res.user.uid));
        setIsAdmin(adminDoc.exists());
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication error. Details check karein.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
          <p className="text-sm font-semibold tracking-wide text-slate-400">Loading Shivam Staff Dashboard...</p>
        </div>
      </div>
    );
  }

  // Owner Login Screen
  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-black tracking-wider text-white">SHIVAM STAFF</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-indigo-400">
              Owner PC Admin Dashboard
            </p>
          </div>

          {authError && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400">Owner Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@shivam.com"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="regSwitch"
                checked={isRegisterMode}
                onChange={(e) => setIsRegisterMode(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="regSwitch" className="text-xs text-slate-400 cursor-pointer">
                Pehli baar? Naya owner account banayein
              </label>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="mt-2 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50"
            >
              {authLoading ? 'Signing in...' : isRegisterMode ? 'Create Owner Account' : 'Sign In to Dashboard'}
            </button>
          </form>

          <div className="relative my-5 flex items-center justify-center">
            <div className="border-t border-slate-800 w-full"></div>
            <span className="bg-slate-900 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 absolute">
              OR PREVIEW MODE
            </span>
          </div>

          <button
            type="button"
            onClick={handleDemoLogin}
            className="w-full rounded-xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/80 via-slate-900 to-indigo-950/80 px-4 py-3 text-sm font-bold text-indigo-300 shadow-lg shadow-indigo-950/50 hover:border-indigo-400 hover:text-white transition flex items-center justify-center gap-2 group"
          >
            <span className="text-base group-hover:scale-125 transition-transform">⚡</span>
            <span>Instant Demo Owner Login</span>
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            One-click admin preview: Bypasses Firebase Auth restrictions to test all 5 tabs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-3.5 backdrop-blur">
        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-black tracking-wider text-white">SHIVAM STAFF</h1>
            <span className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Dashboard</span>
          </div>

          <nav className="flex items-center gap-1">
            {[
              { id: 'live' as AdminTab, label: 'LIVE' },
              { id: 'approvals' as AdminTab, label: 'Verifications' },
              { id: 'workers' as AdminTab, label: 'Workers + Stars' },
              { id: 'hisab' as AdminTab, label: 'Hisab Upload' },
              { id: 'settings' as AdminTab, label: 'Settings' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-semibold text-white">
              {currentUser.email} {(currentUser as any)?.isDemo && <span className="text-[10px] text-indigo-400 font-mono">(Demo)</span>}
            </p>
            <p className={`text-[10px] font-bold ${isAdmin ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isAdmin ? 'ADMIN AUTHENTICATED' : 'ADMIN DOC MISSING'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Admin UID Warning Banner */}
      {!isAdmin && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-center text-xs text-amber-300">
          ⚠️ <strong>Admin check failed:</strong> Aapka UID Firestore ke <code>admins</code> collection me nahi mila. 
          Settings tab me jakar "Mujhe Admin Banao" button dabayein ya console se UID add karein.
        </div>
      )}

      {/* Main Tab Screens */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {activeTab === 'live' && <LiveScreen />}
        {activeTab === 'approvals' && <ApprovalsScreen />}
        {activeTab === 'workers' && <WorkersScreen />}
        {activeTab === 'hisab' && <HisabAdminScreen />}
        {activeTab === 'settings' && <SettingsScreen currentUser={currentUser} onAdminUpdated={() => setIsAdmin(true)} />}
      </main>
    </div>
  );
}

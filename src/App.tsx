import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User
} from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  Table,
  Users,
  Activity,
  FileSpreadsheet,
  Settings,
  Menu,
  X,
  LogOut,
  ShieldAlert,
  MapPinOff
} from 'lucide-react';

import HisabXLScreen from './HisabXL';
import WorkersScreen from './screens/Workers';
import LiveScreen from './screens/Live';
import HisabAdminScreen from './screens/HisabAdmin';
import SettingsScreen from './screens/Settings';
import OutsideScreen from './screens/Outside';
import OutsideAlertPopup from './OutsidePopup';
import StaffSpace from './screens/StaffSpace';
import SalesmanXL from './screens/SalesmanXL';
import { UserProfile } from './types';
import ShivamLogo from './components/ShivamLogo';

type NavTab = 'hisabxl' | 'workers' | 'live' | 'outside' | 'hisab' | 'settings';
type SessionRole = 'manager' | 'staff' | 'salesman' | null;

// Tab persistence — Boss order: refresh par jis page par tha wahi page khule,
// home par redirect NAHI. Last active tab localStorage me save hota hai.
const TAB_PERSIST_KEY = 'shivam-dash-active-tab';
const VALID_TABS: NavTab[] = ['hisabxl', 'workers', 'live', 'outside', 'hisab', 'settings'];

// Bade sidebar icon tiles — Boss order: har nav item ka apna colored logo block,
// upar se niche tak pure panel me adjust
const TILE_STYLES: Record<string, string> = {
  emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  sky: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
  amber: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
  rose: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
  teal: 'bg-teal-500/15 border-teal-500/30 text-teal-400',
  purple: 'bg-purple-500/15 border-purple-500/30 text-purple-400'
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionRole, setSessionRole] = useState<SessionRole>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [accessDenied, setAccessDenied] = useState<boolean>(false);

  // Navigation state - Hisab XL is the default tab shown after manager/admin login
  // Restore last active tab on refresh (Boss order: wahi page rahe)
  const [activeTab, setActiveTabState] = useState<NavTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_PERSIST_KEY) as NavTab | null;
      if (saved && VALID_TABS.includes(saved)) return saved;
    } catch { /* storage unavailable */ }
    return 'hisabxl';
  });
  const setActiveTab = (tab: NavTab) => {
    setActiveTabState(tab);
    try { localStorage.setItem(TAB_PERSIST_KEY, tab); } catch { /* storage unavailable */ }
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [outsideCount, setOutsideCount] = useState(0);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      if (user) {
        try {
          // Parallel Firestore reads — refresh par session restore almost half time leta hai
          const [adminDoc, userDoc] = await Promise.all([
            getDoc(doc(db, 'admins', user.uid)),
            getDoc(doc(db, 'users', user.uid))
          ]);
          if (adminDoc.exists()) {
            setCurrentUser(user);
            setSessionRole('manager');
            setUserProfile(null);
            setAccessDenied(false);
          } else {
            if (userDoc.exists()) {
              const profile = { uid: userDoc.id, ...(userDoc.data() as Omit<UserProfile, 'uid'>) };
              if (profile.status === 'active') {
                const role = (profile.role || '').toLowerCase();
                if (role === 'manager' || role === 'sales_manager') {
                  setCurrentUser(user);
                  setSessionRole('manager');
                  setUserProfile(profile);
                  setAccessDenied(false);
                } else if (role === 'worker') {
                  setCurrentUser(user);
                  setSessionRole('staff');
                  setUserProfile(profile);
                  setAccessDenied(false);
                } else if (role === 'sales' || role === 'salesman') {
                  setCurrentUser(user);
                  setSessionRole('salesman');
                  setUserProfile(profile);
                  setAccessDenied(false);
                } else {
                  await signOut(auth);
                  setCurrentUser(null);
                  setSessionRole(null);
                  setUserProfile(null);
                  setAccessDenied(true);
                }
              } else {
                await signOut(auth);
                setCurrentUser(null);
                setSessionRole(null);
                setUserProfile(null);
                setAccessDenied(true);
              }
            } else {
              await signOut(auth);
              setCurrentUser(null);
              setSessionRole(null);
              setUserProfile(null);
              setAccessDenied(true);
            }
          }
        } catch {
          await signOut(auth);
          setCurrentUser(null);
          setSessionRole(null);
          setUserProfile(null);
          setAccessDenied(true);
        }
      } else {
        setCurrentUser(null);
        setSessionRole(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Real-time pending registration count badge for the Staff Management tab
  // (approvals are handled inside Staff Management now — no separate tab)
  useEffect(() => {
    if (!currentUser || sessionRole !== 'manager') return;
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('status', '==', 'pending')),
      (snap) => {
        setPendingCount(snap.size || 0);
      },
      () => {
        setPendingCount(0);
      }
    );
    return () => unsub();
  }, [currentUser, sessionRole]);

  // Outside Alerts badge: OPEN (abhi bahar — live) + pending outside_logs + pending duty_gaps
  useEffect(() => {
    if (!currentUser || sessionRole !== 'manager') return;
    let oLogs = 0;
    let pLogs = 0;
    let pGaps = 0;
    const recalc = () => setOutsideCount(oLogs + pLogs + pGaps);
    const un0 = onSnapshot(query(collection(db, 'outside_logs'), where('status', '==', 'open')),
      (s) => { oLogs = s.size || 0; recalc(); }, () => { oLogs = 0; recalc(); });
    const un1 = onSnapshot(query(collection(db, 'outside_logs'), where('status', '==', 'pending')),
      (s) => { pLogs = s.size || 0; recalc(); }, () => { pLogs = 0; recalc(); });
    const un2 = onSnapshot(query(collection(db, 'duty_gaps'), where('status', '==', 'pending')),
      (s) => { pGaps = s.size || 0; recalc(); }, () => { pGaps = 0; recalc(); });
    return () => { un0(); un1(); un2(); };
  }, [currentUser, sessionRole]);

  // Home = Hisab XL (Boss order: logo click har screen se home par le jaye)
  const goHome = () => setActiveTab('hisabxl');

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Sign out error:', e);
    } finally {
      setCurrentUser(null);
      setSessionRole(null);
      setUserProfile(null);
      setAccessDenied(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    setAccessDenied(false);

    try {
      const res = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = res.user;
      const [adminDoc, userDoc] = await Promise.all([
        getDoc(doc(db, 'admins', user.uid)),
        getDoc(doc(db, 'users', user.uid))
      ]);
      if (adminDoc.exists()) {
        setCurrentUser(user);
        setSessionRole('manager');
        setUserProfile(null);
      } else {
        if (userDoc.exists()) {
          const profile = { uid: userDoc.id, ...(userDoc.data() as Omit<UserProfile, 'uid'>) };
          if (profile.status === 'active') {
            const role = (profile.role || '').toLowerCase();
            if (role === 'manager' || role === 'sales_manager') {
              setCurrentUser(user);
              setSessionRole('manager');
              setUserProfile(profile);
            } else if (role === 'worker') {
              setCurrentUser(user);
              setSessionRole('staff');
              setUserProfile(profile);
            } else if (role === 'sales' || role === 'salesman') {
              setCurrentUser(user);
              setSessionRole('salesman');
              setUserProfile(profile);
            } else {
              await signOut(auth);
              setCurrentUser(null);
              setSessionRole(null);
              setUserProfile(null);
              setAccessDenied(true);
            }
          } else {
            await signOut(auth);
            setCurrentUser(null);
            setSessionRole(null);
            setUserProfile(null);
            setAccessDenied(true);
          }
        } else {
          await signOut(auth);
          setCurrentUser(null);
          setSessionRole(null);
          setUserProfile(null);
          setAccessDenied(true);
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      setAuthError(error.message || 'Authentication failed. Please check your details and try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // 1. Loading State: Full screen BRAND loader during auth/session check
  // (parallel Firestore reads = fast restore + official SHIVAM shine while waiting)
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-7">
          <ShivamLogo size="xl" />
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent"></div>
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-500">Loading Dashboard...</p>
        </div>
      </div>
    );
  }

  // 2. Hard Access Denied Standalone Screen
  if (accessDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-rose-900/50 bg-slate-900 p-8 shadow-2xl text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-xs text-rose-300 bg-rose-500/10 p-3.5 rounded-xl border border-rose-500/20 font-medium">
            This account is not active or not authorized. You have been signed out.
          </p>
          <button
            type="button"
            onClick={() => setAccessDenied(false)}
            className="w-full rounded-xl bg-slate-800 border border-slate-700 py-3 text-xs font-bold text-white hover:bg-slate-700 transition"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // 3. Unauthenticated Login Screen
  if (!currentUser || !sessionRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur">
          <div className="mb-7 text-center flex flex-col items-center">
            <ShivamLogo size="lg" subtitle="Manager Dashboard" />
          </div>

          {authError && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@shivam.com"
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

            <button
              type="submit"
              disabled={authLoading}
              className="mt-2 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50"
            >
              {authLoading ? 'Signing in...' : 'Sign In to Dashboard'}
            </button>

            <p className="mt-4 text-center text-xs text-slate-500 font-medium">
              Staff accounts are managed by admin from Staff Management.
            </p>
          </form>
        </div>
      </div>
    );
  }

  // 4. Role-based Routing: Staff View ("My Space")
  if (sessionRole === 'staff') {
    return (
      <StaffSpace
        currentUser={currentUser}
        userProfile={userProfile}
        onLogout={handleLogout}
      />
    );
  }

  // 5. Role-based Routing: Salesman View ("XL")
  if (sessionRole === 'salesman') {
    return (
      <SalesmanXL
        currentUser={currentUser}
        userProfile={userProfile}
        onLogout={handleLogout}
      />
    );
  }

  // 6. Role-based Routing: Manager / Owner Full Dashboard
  const navItems = [
    {
      id: 'hisabxl' as NavTab,
      title: 'Hisab XL',
      icon: <Table className="h-6 w-6" />,
      color: 'emerald' as const
    },
    {
      id: 'workers' as NavTab,
      title: 'Staff Management',
      icon: <Users className="h-6 w-6" />,
      color: 'sky' as const,
      badge: pendingCount > 0 ? pendingCount : null
    },
    {
      id: 'live' as NavTab,
      title: 'Live Attendance',
      icon: <Activity className="h-6 w-6" />,
      color: 'amber' as const
    },
    {
      id: 'outside' as NavTab,
      title: 'Outside Alerts',
      icon: <MapPinOff className="h-6 w-6" />,
      color: 'rose' as const,
      badge: outsideCount > 0 ? outsideCount : null
    },
    {
      id: 'hisab' as NavTab,
      title: 'Hisab Upload & Miracle',
      icon: <FileSpreadsheet className="h-6 w-6" />,
      color: 'teal' as const
    },
    {
      id: 'settings' as NavTab,
      title: 'Settings & GPS',
      icon: <Settings className="h-6 w-6" />,
      color: 'purple' as const
    }
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'hisabxl':
        return <HisabXLScreen />;
      case 'workers':
        return <WorkersScreen />;
      case 'live':
        return <LiveScreen />;
      case 'outside':
        return <OutsideScreen />;
      case 'hisab':
        return <HisabAdminScreen />;
      case 'settings':
        return <SettingsScreen currentUser={currentUser} />;
      default:
        return <HisabXLScreen />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* GLOBAL OUTSIDE POPUP (Boss order 2026-10-26): staff 100m bahar jate hi
          har tab par modal — kon gaya + stopwatch set. Sirf manager session. */}
      <OutsideAlertPopup />

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        ></div>
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-slate-800 bg-slate-900/95 backdrop-blur transition-transform duration-300 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header — click = Home (Boss order) */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <button
            onClick={() => { goHome(); setMobileMenuOpen(false); }}
            title="Go to Home"
            className="flex flex-col items-start rounded-lg hover:opacity-80 transition"
          >
            <span className="shivam-silver shivam-silver-shine text-lg tracking-[0.28em] font-bold leading-none">
              S H I V A M
            </span>
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-indigo-400 mt-1">Manager Dashboard</p>
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Item List — bade colored icon tiles (Boss order) */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
          {navItems.map((item) => {
            const isSelected = activeTab === item.id;
            const tile = TILE_STYLES[item.color];
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 rounded-2xl p-2.5 text-left transition ${
                  isSelected
                    ? 'bg-indigo-600 shadow-lg shadow-indigo-600/25'
                    : 'hover:bg-slate-800/80'
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                    isSelected ? 'border-white/30 bg-white/15 text-white' : tile
                  }`}
                >
                  {item.icon}
                </span>
                <span
                  className={`flex-1 text-xs font-bold leading-snug ${
                    isSelected ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  {item.title}
                </span>
                {item.badge && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-slate-950">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer User Profile */}
        <div className="border-t border-slate-800 p-4 bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="truncate">
              <p className="text-xs font-bold text-white truncate">{userProfile?.name || currentUser.email}</p>
              <p className="text-[10px] font-bold text-purple-400">
                MANAGER VERIFIED
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-2.5 sm:gap-4">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* SHIVAM logo on EVERY screen — click = Home (Boss order) */}
            <button
              onClick={goHome}
              title="Go to Home"
              className="flex items-center hover:opacity-80 transition"
            >
              <span className="shivam-silver shivam-silver-shine text-sm sm:text-lg tracking-[0.28em] font-bold leading-none whitespace-nowrap">
                S H I V A M
              </span>
            </button>
            <span className="hidden sm:block h-6 w-px bg-slate-700"></span>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white truncate">
                {navItems.find((n) => n.id === activeTab)?.title || 'Dashboard'}
              </h2>
              <p className="hidden md:block text-[11px] text-slate-400">Shivam Staff Management &amp; Enterprise Control Panel</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Sync Active
            </span>
          </div>
        </header>

        {/* Dynamic Screen Content */}
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

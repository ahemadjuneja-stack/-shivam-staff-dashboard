import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User
} from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot, disableNetwork, enableNetwork } from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  Table,
  Users,
  Activity,
  FileSpreadsheet,
  Settings,
  ChevronsRight,
  LogOut,
  ShieldAlert,
  MapPinOff,
  Route,
  Truck
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
import ToursScreen from './screens/Tours';
import TourHisabScreen from './screens/TourHisab';
import { UserProfile } from './types';
import { initOutboxEngine, flushOutbox } from './lib/outbox';
import { classifySessionError } from './lib/sessionGuard';
import ShivamLogo from './components/ShivamLogo';

type NavTab = 'hisabxl' | 'tour' | 'workers' | 'tours' | 'live' | 'outside' | 'hisab' | 'settings';
type SessionRole = 'manager' | 'staff' | 'salesman' | null;

// Tab persistence — Boss order: refresh par jis page par tha wahi page khule,
// home par redirect NAHI. Last active tab localStorage me save hota hai.
const TAB_PERSIST_KEY = 'shivam-dash-active-tab';
const VALID_TABS: NavTab[] = ['hisabxl', 'tour', 'workers', 'tours', 'live', 'outside', 'hisab', 'settings'];

// Bade sidebar icon tiles — Boss order: har nav item ka apna colored logo block,
// upar se niche tak pure panel me adjust
const TILE_STYLES: Record<string, string> = {
  emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  sky: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
  amber: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
  rose: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
  teal: 'bg-teal-500/15 border-teal-500/30 text-teal-400',
  purple: 'bg-purple-500/15 border-purple-500/30 text-purple-400',
  fuchsia: 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-400',
  indigo: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400',
  cyan: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionRole, setSessionRole] = useState<SessionRole>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [accessDenied, setAccessDenied] = useState<boolean>(false);
  // Task 92: net slow par session ZINDA rakhta hai (reconnect screen) —
  // pehle yahi window forced-logout kar deti thi (Boss ka auto-logout bug)
  const [netHold, setNetHold] = useState<boolean>(false);

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [outsideCount, setOutsideCount] = useState(0);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    // OFFLINE-FIRST ENGINE (Boss order 2026-10-27): outbox flush — net aane
    // par journal writes Firestore par, online event + 90s loop + mount flush
    initOutboxEngine();
  }, []);

  useEffect(() => {
    // ===== BATTERY GUARD (Boss complaint 2026-10-27: 'app background me
    // battery bahut le raha hai' — Android: 11h30m background time) =====
    // App hidden = poora system SO jata hai:
    //   1. disableNetwork(db) — Firestore WebSocket DISCONNECT (listeners
    //      registered rehte hai, data flow band). Background me radio wakeup 0.
    //   2. Visible wapas = enableNetwork(db) — Firestore khud sab listeners
    //      RESYNC karta hai (guaranteed) + outbox journal flush.
    // Foreground behavior 100% same — sirf background me battery bachti hai.
    const onVis = () => {
      try {
        if (document.hidden) {
          disableNetwork(db);
        } else {
          enableNetwork(db);
          window.setTimeout(() => { flushOutbox(); }, 900);
        }
      } catch { /* ignore */ }
    };
    document.addEventListener('visibilitychange', onVis);
    if (typeof document !== 'undefined' && document.hidden) {
      try { disableNetwork(db); } catch { /* ignore */ }
    }
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    let alive = true;
    let retryTimer: number | undefined;
    const clearRetry = () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    // ============================================================
    // SESSION RESOLVER — AUTO-LOGOUT FIX (Task 92, Boss complaint:
    // "Ye dashboard apne aap logout kyo ho jaata hai?" — screenshot:
    // 'Access Denied — ... You have been signed out.')
    //
    // ROOT CAUSE: pehle ka code getDoc(admins/users) ke catch me KISI BHI
    // error par signOut kar deta tha. Battery-guard (app hidden =
    // disableNetwork) + tab kill + page reload = fresh load par getDoc
    // 'unavailable' throw karta tha (WebSocket reconnect hone tak) => app
    // KHUD Boss ko sign-out kar deti thi. Boss sach me logout hua hi nahi
    // tha — network slow tha.
    //
    // AB: (1) har getDoc fail par 3 retries (1s/2s/3s backoff) Loading
    // screen ke piche. (2) phir bhi net fail = session ZINDA rakho —
    // netHold 'reconnect' screen + background 6s retry loop jab tak
    // Firestore reachable. (3) sirf REAL denials par signOut: rules se
    // 'permission-denied' (sessionGuard classify) YA data check fail
    // (doc nahi / status inactive / role unknown — purane business rules
    // waise hi). Net ka intezaar logout nahi hai — honest behavior.
    // ============================================================
    const resolve = async (user: User, attempt = 0): Promise<'ok' | 'denied' | 'net'> => {
      try {
        // Parallel Firestore reads — refresh par session restore fast
        const [adminDoc, userDoc] = await Promise.all([
          getDoc(doc(db, 'admins', user.uid)),
          getDoc(doc(db, 'users', user.uid))
        ]);
        if (adminDoc.exists()) {
          setCurrentUser(user);
          setSessionRole('manager');
          setUserProfile(null);
          setAccessDenied(false);
          return 'ok';
        }
        if (userDoc.exists()) {
          const profile = { uid: userDoc.id, ...(userDoc.data() as Omit<UserProfile, 'uid'>) };
          if (profile.status === 'active') {
            const role = (profile.role || '').toLowerCase();
            if (role === 'manager' || role === 'sales_manager') {
              setCurrentUser(user);
              setSessionRole('manager');
              setUserProfile(profile);
              setAccessDenied(false);
              return 'ok';
            }
            if (role === 'worker') {
              setCurrentUser(user);
              setSessionRole('staff');
              setUserProfile(profile);
              setAccessDenied(false);
              return 'ok';
            }
            if (role === 'sales' || role === 'salesman') {
              setCurrentUser(user);
              setSessionRole('salesman');
              setUserProfile(profile);
              setAccessDenied(false);
              return 'ok';
            }
          }
        }
        return 'denied'; // doc nahi / inactive / role unknown — REAL denial
      } catch (err) {
        const kind = classifySessionError(err);
        if (kind === 'net' && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          if (!alive) return 'net';
          return resolve(user, attempt + 1);
        }
        return kind === 'net' ? 'net' : 'denied';
      }
    };

    const denyNow = () => {
      setNetHold(false);
      signOut(auth).catch(() => {});
      setCurrentUser(null);
      setSessionRole(null);
      setUserProfile(null);
      setAccessDenied(true);
    };

    const retryNet = (user: User) => {
      resolve(user).then((res) => {
        if (!alive) return;
        if (res === 'ok') {
          setNetHold(false);
          setLoading(false);
          return;
        }
        if (res === 'denied') {
          denyNow();
          setLoading(false);
          return;
        }
        retryTimer = window.setTimeout(() => {
          if (alive) retryNet(user);
        }, 6000);
      });
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      clearRetry();
      if (!user) {
        // signed out (manual logout YA real auth event) — sirf state clear.
        // accessDenied ko yahan touch NAHI karte (denyNow -> signOut -> yeh
        // branch fire hota hai; denied screen ko chhupana galat hoga).
        setCurrentUser(null);
        setSessionRole(null);
        setUserProfile(null);
        setNetHold(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setAuthError(''); // stale login-error text mat rakho (role resolve hoke dashboard jayega)
      resolve(user).then((res) => {
        if (!alive) return;
        if (res === 'ok') {
          setNetHold(false);
          setLoading(false);
          return;
        }
        if (res === 'denied') {
          denyNow();
          setLoading(false);
          return;
        }
        // NET — session zinda, reconnect screen + background retry
        setCurrentUser(user);
        setSessionRole(null);
        setUserProfile(null);
        setNetHold(true);
        setLoading(false);
        retryTimer = window.setTimeout(() => {
          if (alive) retryNet(user);
        }, 6000);
      });
    });
    return () => {
      alive = false;
      unsubscribe();
      clearRetry();
    };
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

  // Sidebar auto-hide rule (Boss order 2026-10-26): main screen (Hisab XL) par
  // rail hamesha visible — doosri screens par hide, edge button se wapas bahar
  const isHome = activeTab === 'hisabxl';

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

  // 2.5 NET HOLD — Task 92 (auto-logout fix): session ZINDA hai, sirf
  // internet wapas aane ka intezaar. Pehle YAHIN par net error aate hi
  // forced signOut ho jata tha ('Access Denied' screenshot = yahi tha).
  // Ab logout NAHI — amber reconnect spinner, background 6s retry loop,
  // net aate hi role resolve hoke dashboard khud khul jayega.
  if (netHold) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-7 px-6 text-center">
          <ShivamLogo size="xl" />
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-amber-400 border-t-transparent"></div>
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
            Internet slow hai — reconnect ho raha hai…
          </p>
          <p className="-mt-4 text-[10.5px] text-slate-600">
            Session safe hai, logout nahi hua. Net aate hi dashboard khulega.
          </p>
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
      title: 'Cash Counter',
      icon: <Table className="h-6 w-6" />,
      color: 'emerald' as const
    },
    {
      id: 'tour' as NavTab,
      title: 'Tour Hisab',
      icon: <Truck className="h-6 w-6" />,
      color: 'cyan' as const
    },
    {
      id: 'workers' as NavTab,
      title: 'Staff Management',
      icon: <Users className="h-6 w-6" />,
      color: 'sky' as const,
      badge: pendingCount > 0 ? pendingCount : null
    },
    {
      id: 'tours' as NavTab,
      title: 'Tours & Line Schedule',
      icon: <Route className="h-6 w-6" />,
      color: 'fuchsia' as const
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
      title: 'Cash Counter',
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
      case 'tour':
        return <TourHisabScreen />;
      case 'workers':
        return <WorkersScreen />;
      case 'tours':
        return <ToursScreen currentUser={currentUser} />;
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

      {/* Drawer Backdrop — sirf non-home screens par menu khule tab (outside tap = close) */}
      {!isHome && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        ></div>
      )}

      {/* Slim Icon Rail Sidebar (Boss redesign 2026-10-26):
          - Sare naam hata — sirf SHIVAM logo + niche chote font me naam
          - Sare nav buttons icon-only, top se bottom poora rail bharke (koi scroll/cut nahi)
          - Main screen (Hisab XL) par rail visible; doosri screens par auto-hide
          - Left-edge floating button (Android popup style) se kisi bhi screen par wapas bahar */}
      <aside
        className={` ${
          isHome ? 'relative z-50' : 'fixed inset-y-0 left-0 z-50'
        } w-20 shrink-0 flex flex-col border-r border-slate-800 bg-slate-900/95 backdrop-blur transition-transform duration-300 ${
          isHome ? 'translate-x-0' : drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand — sirf logo, niche chote font me naam (Boss order) */}
        <div className="flex justify-center border-b border-slate-800 px-2 pt-4 pb-3">
          <button
            onClick={() => { goHome(); setDrawerOpen(false); }}
            title="Go to Home"
            className="flex flex-col items-center gap-1.5 hover:opacity-80 transition"
          >
            <span className="shivam-silver shivam-silver-shine text-[11px] font-bold tracking-[0.2em] leading-none">
              SHIVAM
            </span>
            <span className="text-[7px] font-bold uppercase tracking-[0.16em] text-indigo-400">
              Manager
            </span>
          </button>
        </div>

        {/* Navigation — icon-only colored tiles, upar se niche last tak */}
        <div className="flex-1 flex flex-col items-center justify-evenly py-3">
          {navItems.map((item) => {
            const isSelected = activeTab === item.id;
            const tile = TILE_STYLES[item.color];
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setDrawerOpen(false);
                }}
                title={item.title}
                className="relative"
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border transition ${
                    isSelected
                      ? 'border-white/30 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : tile
                  }`}
                >
                  {item.icon}
                </span>
                {item.badge && (
                  <span className="absolute -top-1.5 -right-1.5 rounded-full bg-amber-500 px-1.5 py-px text-[9px] font-black text-slate-950">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer — sirf logout icon (naam/email hatay, minimal) */}
        <div className="flex justify-center border-t border-slate-800 px-2 py-3">
          <button
            onClick={handleLogout}
            title="Logout"
            className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 transition"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Floating Edge Button — Android popup style shortcut (Boss order):
          kisi bhi non-home screen par left edge se menu wapas bahar lane ke liye */}
      {!isHome && !drawerOpen && (
        <button
          onClick={() => setDrawerOpen(true)}
          title="Open Menu"
          className="fixed left-0 top-1/2 z-40 -translate-y-1/2 flex flex-col items-center rounded-r-xl border border-l-0 border-slate-600 bg-slate-800/95 py-4 px-1 text-slate-300 shadow-lg shadow-black/40 hover:bg-slate-700 hover:text-white transition animate-pulse"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-2.5 sm:gap-4">
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
        <main className="flex-1 p-6 w-full">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

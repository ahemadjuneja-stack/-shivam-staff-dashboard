import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  orderBy,
  limit
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useMyRole } from '../useMyRole';
import {
  ShopConfig,
  PunchRecord,
  WorkLog,
  StarEvent,
  Sheet,
  Customer,
  CustomerBill,
  PaymentMode,
  EntryKind,
  UserRole
} from '../types';
import {
  Clock,
  Briefcase,
  Star,
  User,
  LogOut,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  Plus,
  RefreshCw,
  Search,
  FileText,
  DollarSign,
  X
} from 'lucide-react';

interface StaffAppProps {
  onBackToDashboard?: () => void;
  isBossPreview?: boolean;
  previewUid?: string;
}

type StaffTab = 'duty' | 'sales' | 'stars' | 'profile';

export default function StaffApp({ onBackToDashboard, isBossPreview, previewUid }: StaffAppProps) {
  const {
    role,
    roleDef,
    roleLabel,
    badgeClass,
    dotColor,
    hasSalesAccess,
    isSalesManager,
    profile,
    loading: roleLoading
  } = useMyRole(previewUid);

  const [activeTab, setActiveTab] = useState<StaffTab>('duty');
  const [prevRole, setPrevRole] = useState<UserRole | null>(null);
  const [roleChangedBanner, setRoleChangedBanner] = useState<string | null>(null);

  // Live Role Change Detection & Instant Auto-Redirect
  useEffect(() => {
    if (roleLoading) return;
    if (prevRole !== null && prevRole !== role) {
      setRoleChangedBanner(`Aapka role update ho gaya hai: ${roleLabel}`);
      // If currently on sales tab but lost sales access, redirect immediately to duty tab
      if (activeTab === 'sales' && !hasSalesAccess) {
        setActiveTab('duty');
      }
    }
    setPrevRole(role);
  }, [role, hasSalesAccess, activeTab, roleLoading, prevRole, roleLabel]);

  // Shop & GPS config
  const [shopConfig, setShopConfig] = useState<ShopConfig | null>(null);
  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);
  const [distM, setDistM] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  // Punch history & Work logs
  const [myPunches, setMyPunches] = useState<PunchRecord[]>([]);
  const [myWorkLogs, setMyWorkLogs] = useState<WorkLog[]>([]);
  const [workLogText, setWorkLogText] = useState('');
  const [submittingLog, setSubmittingLog] = useState(false);

  // Star events & score
  const [myStarEvents, setMyStarEvents] = useState<StarEvent[]>([]);
  const [myStarScore, setMyStarScore] = useState<number>(3.0);

  // Sales Module State
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // New Collection Entry State
  const [entryKind, setEntryKind] = useState<EntryKind>('jama');
  const [entryAmount, setEntryAmount] = useState<string>('');
  const [entryMode, setEntryMode] = useState<PaymentMode>(1);
  const [entryNote, setEntryNote] = useState('');
  const [submittingEntry, setSubmittingEntry] = useState(false);

  // Toast
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type });
    setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  const [customerBills, setCustomerBills] = useState<CustomerBill[]>([]);

  const staffUid = previewUid || profile?.uid || auth.currentUser?.uid || '';
  const staffName = profile?.name || (previewUid ? 'Staff Member' : auth.currentUser?.email || 'Staff Member');

  // Fetch Customer Bills when customer is selected
  useEffect(() => {
    if (!selectedSheetId || !selectedCustomer?.code) {
      setCustomerBills([]);
      return;
    }
    const billsRef = collection(db, 'sheets', selectedSheetId, 'customers', selectedCustomer.code, 'bills');
    const unsub = onSnapshot(
      billsRef,
      (snap) => {
        const list: CustomerBill[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<CustomerBill, 'id'>) }));
        setCustomerBills(list);
      },
      () => setCustomerBills([])
    );
    return () => unsub();
  }, [selectedSheetId, selectedCustomer]);

  // 1. Fetch Shop Geofence Configuration
  useEffect(() => {
    getDoc(doc(db, 'config', 'shop'))
      .then((snap) => {
        if (snap.exists()) {
          setShopConfig(snap.data() as ShopConfig);
        }
      })
      .catch((e) => console.warn('Shop config fetch error:', e));
  }, []);

  // 2. Fetch My Punches
  useEffect(() => {
    if (!staffUid) return;
    const q = query(
      collection(db, 'punches'),
      where('uid', '==', staffUid),
      orderBy('at', 'desc'),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: PunchRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PunchRecord, 'id'>) }));
      setMyPunches(list);
    }, (err) => console.warn('punches error:', err));
    return () => unsub();
  }, [staffUid]);

  // 3. Fetch My Worklogs
  useEffect(() => {
    if (!staffUid) return;
    const q = query(
      collection(db, 'worklogs'),
      where('uid', '==', staffUid),
      orderBy('at', 'desc'),
      limit(15)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: WorkLog[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<WorkLog, 'id'>) }));
      setMyWorkLogs(list);
    }, (err) => console.warn('worklogs error:', err));
    return () => unsub();
  }, [staffUid]);

  // 4. Fetch My Star Events & Compute Score
  useEffect(() => {
    if (!staffUid) return;
    const q = query(
      collection(db, 'events'),
      where('uid', '==', staffUid),
      orderBy('at', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: StarEvent[] = [];
      let total = 3.0; // Base score
      snap.forEach((d) => {
        const ev = d.data() as StarEvent;
        list.push({ id: d.id, ...ev });
        total += Number(ev.delta || 0);
      });
      setMyStarEvents(list);
      setMyStarScore(total);
    }, (err) => console.warn('events error:', err));
    return () => unsub();
  }, [staffUid]);

  // 5. If Sales Access Granted: Fetch Miracle Sheets
  useEffect(() => {
    if (!hasSalesAccess) {
      setSheets([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'sheets'), (snap) => {
      const list: Sheet[] = [];
      snap.forEach((d) => {
        const s = { id: d.id, ...(d.data() as Omit<Sheet, 'id'>) };
        // Sales manager sees all sheets, salesman sees assigned sheets or all active
        if (isSalesManager || s.assignedTo === staffUid || !s.assignedTo) {
          list.push(s);
        }
      });
      setSheets(list);
      if (list.length > 0 && !selectedSheetId) {
        setSelectedSheetId(list[0].id);
      }
    });
    return () => unsub();
  }, [hasSalesAccess, isSalesManager, staffUid, selectedSheetId]);

  // 6. Fetch Customers for selected sheet
  useEffect(() => {
    if (!hasSalesAccess || !selectedSheetId) {
      setCustomers([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'sheets', selectedSheetId, 'customers'), (snap) => {
      const list: Customer[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }));
      setCustomers(list);
    }, (err) => console.warn('sheet customers error:', err));
    return () => unsub();
  }, [hasSalesAccess, selectedSheetId]);

  // Haversine distance calculator
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  };

  const handleCaptureGPS = () => {
    if (!navigator.geolocation) {
      showFeedback('Geolocation aapke browser me supported nahi hai', 'error');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLat(lat);
        setMyLng(lng);
        if (shopConfig && shopConfig.lat && shopConfig.lng) {
          const d = calculateDistance(lat, lng, shopConfig.lat, shopConfig.lng);
          setDistM(d);
        }
        setLocating(false);
        showFeedback('Live GPS location capture ho gayi!', 'success');
      },
      (err) => {
        setLocating(false);
        showFeedback(`GPS Error: ${err.message}`, 'error');
      },
      { enableHighAccuracy: true }
    );
  };

  const handlePunch = async (type: 'in' | 'out') => {
    if (myLat === null || myLng === null) {
      showFeedback('Pehle "Capture GPS" par tap karein!', 'error');
      return;
    }
    try {
      await addDoc(collection(db, 'punches'), {
        uid: staffUid,
        name: staffName,
        type,
        at: Date.now(),
        lat: myLat,
        lng: myLng,
        distM: distM ?? 0
      });
      showFeedback(`✓ Punch ${type.toUpperCase()} darj ho gaya!`, 'success');
    } catch (e: any) {
      showFeedback(`Punch error: ${e.message}`, 'error');
    }
  };

  const handleSubmitWorkLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workLogText.trim()) return;
    setSubmittingLog(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await addDoc(collection(db, 'worklogs'), {
        uid: staffUid,
        name: staffName,
        date: today,
        text: workLogText.trim(),
        status: 'pending',
        at: Date.now()
      });
      setWorkLogText('');
      showFeedback('✓ Daily work log submit ho gaya — Boss verification pending', 'success');
    } catch (e: any) {
      showFeedback(`Log submit error: ${e.message}`, 'error');
    } finally {
      setSubmittingLog(false);
    }
  };

  const handleCreateCollectionEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSalesAccess) {
      showFeedback('Aapke paas sales module access nahi hai', 'error');
      return;
    }
    if (!selectedSheetId) {
      showFeedback('Kripya Miracle Sheet select karein', 'error');
      return;
    }
    const amt = parseFloat(entryAmount);
    if (isNaN(amt) || amt <= 0) {
      showFeedback('Kripya valid amount dalein', 'error');
      return;
    }

    setSubmittingEntry(true);
    try {
      const entryData = {
        kind: entryKind,
        amount: amt,
        mode: entryMode,
        cid: selectedCustomer?.code || '',
        cname: selectedCustomer?.name || 'General Party',
        note: entryNote.trim(),
        byUid: staffUid,
        byName: staffName,
        at: Date.now(),
        miracle: false
      };

      // 1. Add to sheet's entries subcollection
      await addDoc(collection(db, 'sheets', selectedSheetId, 'entries'), entryData);

      // 2. Add to root entries collection for live monitoring
      await addDoc(collection(db, 'entries'), entryData);

      // 3. Update customer balance if selected
      if (selectedCustomer && selectedCustomer.id) {
        const delta = entryKind === 'jama' ? -amt : amt;
        const newBalance = (selectedCustomer.balance || 0) + delta;
        try {
          await updateDoc(doc(db, 'sheets', selectedSheetId, 'customers', selectedCustomer.id), {
            balance: newBalance,
            updatedAt: Date.now()
          });
        } catch {
          // fallback if non-critical
        }
      }

      setEntryAmount('');
      setEntryNote('');
      setSelectedCustomer(null);
      showFeedback(`✓ ₹${amt.toLocaleString('en-IN')} ki ${entryKind.toUpperCase()} entry darj ho gayi!`, 'success');
    } catch (err: any) {
      showFeedback(`Entry error: ${err.message}`, 'error');
    } finally {
      setSubmittingEntry(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Logout error:', e);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.code.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-2xl mx-auto shadow-2xl border-x border-slate-900 font-sans">
      {/* Toast Feedback */}
      {feedbackMsg && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-2xl px-4 py-3 shadow-2xl backdrop-blur-md text-xs font-bold transition-all border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Staff App Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black shadow-lg shadow-indigo-600/30">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white leading-none">{staffName}</h1>
              {/* Live Role Badge (Requested) */}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-pulse`} />
                {roleLabel}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
              <span>📱 {profile?.mobile || 'Shivam Staff'}</span>
              <span>•</span>
              <span className="text-amber-400 font-bold font-mono">★ {myStarScore.toFixed(1)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isBossPreview && onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-bold text-indigo-300 hover:bg-indigo-500/20 transition"
              title="Return to Owner Dashboard"
            >
              👔 Boss View
            </button>
          )}
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:text-white transition"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Live Role Change Reactive Banner */}
      {roleChangedBanner && (
        <div className="bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span>⚡ {roleChangedBanner}</span>
          </div>
          <button
            onClick={() => setRoleChangedBanner(null)}
            className="text-indigo-200 hover:text-white ml-2 p-0.5"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Instant Role Change Live Notice */}
      {role === 'none' && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-300 flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>Aapka role abhi <strong>'None'</strong> hai. Sales module locked hai. Boss dashboard se role badal sakte hain.</span>
        </div>
      )}

      {/* Main Staff Screen Content */}
      <main className="flex-1 p-4 pb-24 space-y-4 overflow-y-auto">
        {/* TAB 1: DUTY & PUNCH */}
        {activeTab === 'duty' && (
          <div className="space-y-4">
            {/* GPS Geofence Attendance Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Duty Attendance Punch</h3>
                </div>
                {distM !== null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    distM <= (shopConfig?.radius || 100)
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {distM <= (shopConfig?.radius || 100) ? 'Inside Shop' : `${distM}m away`}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-1 text-slate-400">
                <p>Shop: <strong className="text-slate-200">{shopConfig?.name || 'SHIVAM'}</strong> (Allowed Radius: {shopConfig?.radius || 100}m)</p>
                <p>
                  Current GPS:{' '}
                  {myLat !== null && myLng !== null ? (
                    <span className="font-mono text-emerald-400">{myLat.toFixed(5)}, {myLng.toFixed(5)}</span>
                  ) : (
                    <span className="text-amber-400 italic">Not captured yet</span>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCaptureGPS}
                disabled={locating}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-white hover:bg-slate-700 transition"
              >
                <MapPin className={`h-4 w-4 text-indigo-400 ${locating ? 'animate-bounce' : ''}`} />
                <span>{locating ? 'Locating GPS...' : '📍 Step 1: Capture Live GPS'}</span>
              </button>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handlePunch('in')}
                  className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 transition"
                >
                  🟢 Punch IN
                </button>
                <button
                  type="button"
                  onClick={() => handlePunch('out')}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition"
                >
                  🔴 Punch OUT
                </button>
              </div>
            </div>

            {/* Daily Work Log Form */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-400" />
                Submit Daily Work Log
              </h3>
              <form onSubmit={handleSubmitWorkLog} className="space-y-2.5">
                <textarea
                  rows={3}
                  required
                  value={workLogText}
                  onChange={(e) => setWorkLogText(e.target.value)}
                  placeholder="Aaj ka kaam report likhein (e.g. 15 dukano me collection kiya, stock arrange kiya)..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submittingLog}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500 transition disabled:opacity-50"
                >
                  {submittingLog ? 'Submitting...' : 'Submit Work Log'}
                </button>
              </form>
            </div>

            {/* Recent Work Logs Status */}
            {myWorkLogs.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-2.5">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">My Work Logs History</h4>
                <div className="space-y-2">
                  {myWorkLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs flex justify-between items-start gap-2">
                      <div>
                        <p className="text-[10px] text-slate-400 font-mono">{log.date}</p>
                        <p className="text-slate-200 mt-0.5 text-[11px]">"{log.text}"</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 capitalize ${
                        log.status === 'approved'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : log.status === 'rejected'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SALES & MIRACLE (GATED BEHIND hasSalesAccess) */}
        {activeTab === 'sales' && (
          <div className="space-y-4">
            {!hasSalesAccess ? (
              /* LOCKED STATE: When role is 'worker' or 'none' */
              <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-8 text-center space-y-4 shadow-xl">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Lock className="h-7 w-7" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-white">Sales Module Locked</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Ye section (sheets, customers, collection entries, bills) sirf <strong>Salesman</strong> aur <strong>Sales Manager</strong> ke liye accessible hai.
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs">
                  <span className="text-slate-400">Aapka current role:</span>
                  <span className={`font-bold px-2.5 py-0.5 rounded-full border text-[11px] ${badgeClass}`}>
                    {roleLabel}
                  </span>
                </div>

                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3.5 text-xs text-indigo-300 font-medium">
                  💡 Jaise hi Boss Staff Directory se aapka role <strong>Salesman</strong> ya <strong>Sales Manager</strong> karenge, ye module bina logout ya app restart ke turant live unlock ho jayega!
                </div>
              </div>
            ) : (
              /* UNLOCKED STATE: Sales Module for Salesman & Sales Manager */
              <div className="space-y-4">
                {/* Miracle Sheet Selector */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-emerald-400" />
                      Miracle Sheets &amp; City Accounts
                    </h3>
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      ✓ Unlocked
                    </span>
                  </div>

                  {sheets.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2">Koi active sheet uplabdh nahi hai. Boss se sheet upload karne ko kahein.</p>
                  ) : (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                      {sheets.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedSheetId(s.id);
                            setSelectedCustomer(null);
                          }}
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold border transition ${
                            selectedSheetId === s.id
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/20'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                          }`}
                        >
                          🏙️ {s.city} ({s.month})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* New Collection Entry (Jama / Kharcha) Form */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    New Collection Entry (Jama / Kharcha)
                  </h3>

                  <form onSubmit={handleCreateCollectionEntry} className="space-y-3">
                    {/* Selected Customer indicator */}
                    {selectedCustomer ? (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold text-white">{selectedCustomer.name} ({selectedCustomer.code})</p>
                            <p className="text-[11px] text-emerald-300 mt-0.5">
                              Current Balance: ₹{selectedCustomer.balance?.toLocaleString('en-IN') || 0}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomer(null)}
                            className="text-slate-400 hover:text-white text-xs underline"
                          >
                            Change Party
                          </button>
                        </div>

                        {/* Customer Bill History (Miracle Bills) */}
                        {customerBills.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-emerald-500/20">
                            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                              Bill History ({customerBills.length})
                            </p>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                              {customerBills.map((b) => (
                                <div key={b.id} className="flex justify-between text-[11px] text-slate-300 bg-slate-900/60 px-2 py-1 rounded">
                                  <span>Bill #{b.no} ({b.date})</span>
                                  <span className="font-mono font-bold text-white">₹{b.amount.toLocaleString('en-IN')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <label className="text-[11px] font-bold text-slate-300">Customer Chunein (Optional / Direct Search):</label>
                        <div className="relative mt-1">
                          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                          <input
                            type="text"
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            placeholder="Customer name ya code search karein..."
                            className="w-full rounded-xl border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                        {customerSearch && (
                          <div className="mt-1 rounded-xl border border-slate-800 bg-slate-950 p-2 max-h-36 overflow-y-auto space-y-1 text-xs">
                            {filteredCustomers.slice(0, 8).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCustomer(c);
                                  setCustomerSearch('');
                                }}
                                className="w-full text-left p-1.5 rounded hover:bg-slate-800 flex justify-between text-slate-200"
                              >
                                <span>{c.name} ({c.code})</span>
                                <span className="font-mono text-emerald-400">₹{c.balance?.toLocaleString('en-IN') || 0}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Entry Kind & Amount */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-bold text-slate-300">Type</label>
                        <select
                          value={entryKind}
                          onChange={(e) => setEntryKind(e.target.value as EntryKind)}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs font-bold text-white focus:outline-none"
                        >
                          <option value="jama">Jama (Collection)</option>
                          <option value="kharcha">Kharcha (Expense)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-slate-300">Amount (₹)</label>
                        <input
                          type="number"
                          required
                          value={entryAmount}
                          onChange={(e) => setEntryAmount(e.target.value)}
                          placeholder="0.00"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs font-bold text-white focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Payment Mode */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-300">Payment Mode</label>
                      <div className="mt-1 grid grid-cols-3 gap-2">
                        {[
                          { val: 1 as PaymentMode, label: 'Cash' },
                          { val: 2 as PaymentMode, label: 'UPI' },
                          { val: 3 as PaymentMode, label: 'Cheque' }
                        ].map((m) => (
                          <button
                            key={m.val}
                            type="button"
                            onClick={() => setEntryMode(m.val)}
                            className={`py-2 rounded-xl border text-xs font-bold transition ${
                              entryMode === m.val
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Note */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-300">Remarks / Note</label>
                      <input
                        type="text"
                        value={entryNote}
                        onChange={(e) => setEntryNote(e.target.value)}
                        placeholder="Receipt no, bill reference, party remark..."
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingEntry}
                      className="w-full rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition disabled:opacity-50"
                    >
                      {submittingEntry ? 'Saving Entry...' : `Save ₹${entryAmount || '0'} Entry`}
                    </button>
                  </form>
                </div>

                {/* Customer Directory View */}
                {customers.length > 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-3">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Customers in Selected Sheet ({customers.length})
                    </h3>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {customers.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => setSelectedCustomer(c)}
                          className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between text-xs ${
                            selectedCustomer?.id === c.id
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <div>
                            <span className="font-bold">{c.name}</span>
                            <span className="text-[10px] text-slate-400 ml-1.5 font-mono">({c.code})</span>
                          </div>
                          <span className="font-mono font-bold text-emerald-400">
                            ₹{c.balance?.toLocaleString('en-IN') || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: STARS & PERFORMANCE */}
        {activeTab === 'stars' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center space-y-2 shadow-lg">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">My Current Star Rating</p>
              <h2 className="text-4xl font-black text-amber-400 font-mono">★ {myStarScore.toFixed(1)}</h2>
              <p className="text-[11px] text-slate-400">Base Rating: 3.0 ★ • Verified work logs se stars badhte hain</p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg space-y-2.5">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Star History Events</h3>
              {myStarEvents.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">Abhi koi special star adjustments nahi hain.</p>
              ) : (
                <div className="space-y-2">
                  {myStarEvents.map((ev, i) => (
                    <div key={ev.id || i} className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between text-xs">
                      <div>
                        <p className="text-slate-200 font-medium">{ev.note || ev.type}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {ev.at ? new Date(ev.at).toLocaleDateString() : ''}
                        </p>
                      </div>
                      <span className={`font-mono font-bold text-sm ${ev.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {ev.delta > 0 ? `+${ev.delta}` : ev.delta} ★
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg space-y-3">
              <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <div className="h-12 w-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-indigo-600/30">
                  {staffName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{staffName}</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                      {roleLabel}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      ACTIVE
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Mobile:</span>
                  <span className="font-mono">{profile?.mobile || 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">City / Base:</span>
                  <span>{profile?.city || 'Head Office'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">UID:</span>
                  <span className="font-mono text-[10px] text-slate-400">{staffUid}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Role Status:</span>
                  <span className="text-emerald-400 font-bold">Real-time Live Sync</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition flex items-center justify-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 inset-x-0 max-w-2xl mx-auto z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-3 py-2 flex items-center justify-around">
        <button
          type="button"
          onClick={() => setActiveTab('duty')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'duty' ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span className="text-[10px]">Duty/Punch</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sales')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition relative ${
            activeTab === 'sales' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {hasSalesAccess ? (
            <Briefcase className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4 text-amber-400" />
          )}
          <span className="text-[10px] flex items-center gap-1">
            Sales {!hasSalesAccess && '🔒'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stars')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'stars' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Star className="h-4 w-4" />
          <span className="text-[10px]">My Stars</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'profile' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <User className="h-4 w-4" />
          <span className="text-[10px]">Profile</span>
        </button>
      </nav>
    </div>
  );
}

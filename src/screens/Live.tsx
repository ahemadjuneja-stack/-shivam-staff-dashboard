import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { PunchRecord, LedgerEntry, ViolationRecord } from '../types';

export default function LiveScreen() {
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [usingDemoData, setUsingDemoData] = useState(false);

  // Default demo data for preview
  const demoPunches: PunchRecord[] = [
    { id: 'p1', uid: 'u1', name: 'Ramesh Patel (Sales)', type: 'in', at: Date.now() - 3600000 * 3, lat: 24.2585, lng: 72.1950, dist: 12 },
    { id: 'p2', uid: 'u2', name: 'Vikram Thakor (Worker)', type: 'in', at: Date.now() - 3600000 * 2, lat: 24.2587, lng: 72.1948, dist: 35 },
    { id: 'p3', uid: 'u3', name: 'Kamlesh Suthar (Worker)', type: 'out', at: Date.now() - 3600000 * 1, lat: 24.2589, lng: 72.1945, dist: 45 },
  ];

  const demoEntries: LedgerEntry[] = [
    { id: 'l1', kind: 'jama', cname: 'Shree Ganesh Traders (Deesa)', amount: 25000, cash: 25000, mode: 1, byUid: 'u1', byName: 'Ramesh Patel', at: Date.now() - 1800000, miracle: true },
    { id: 'l2', kind: 'jama', cname: 'Ambica Cosmetics (Palanpur)', amount: 14500, mode: 2, byUid: 'u1', byName: 'Ramesh Patel', at: Date.now() - 3600000, miracle: true },
    { id: 'l3', kind: 'jama', cname: 'Kisan Medical (Unjha)', amount: 32000, mode: 3, note: 'HDFC Chq #440219', byUid: 'u4', byName: 'Amit Sharma', at: Date.now() - 7200000, miracle: false },
    { id: 'l4', kind: 'kharcha', amount: 850, cash: 850, mode: 1, note: 'Petrol & Toll Tax', byUid: 'u1', byName: 'Ramesh Patel', at: Date.now() - 9000000, miracle: false }
  ];

  const demoViolations: ViolationRecord[] = [
    { id: 'v1', uid: 'u2', kind: 'location-off', reason: 'Phone location turned off during work shift', at: Date.now() - 5400000 }
  ];

  useEffect(() => {
    // Attempt Firestore listeners
    let unsubPunches: any;
    let unsubEntries: any;
    let unsubViolations: any;

    try {
      const qPunches = query(collection(db, 'punches'), orderBy('at', 'desc'), limit(20));
      unsubPunches = onSnapshot(qPunches, (snap) => {
        if (!snap.empty) {
          const list: PunchRecord[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PunchRecord, 'id'>) }));
          setPunches(list);
          setUsingDemoData(false);
        } else {
          setPunches(demoPunches);
          setUsingDemoData(true);
        }
      }, () => {
        setPunches(demoPunches);
        setUsingDemoData(true);
      });

      const qEntries = query(collection(db, 'ledger'), orderBy('at', 'desc'), limit(30));
      unsubEntries = onSnapshot(qEntries, (snap) => {
        if (!snap.empty) {
          const list: LedgerEntry[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<LedgerEntry, 'id'>) }));
          setEntries(list);
        } else {
          setEntries(demoEntries);
        }
      }, () => {
        setEntries(demoEntries);
      });

      const qViolations = query(collection(db, 'violations'), orderBy('at', 'desc'), limit(10));
      unsubViolations = onSnapshot(qViolations, (snap) => {
        if (!snap.empty) {
          const list: ViolationRecord[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<ViolationRecord, 'id'>) }));
          setViolations(list);
        } else {
          setViolations(demoViolations);
        }
      }, () => {
        setViolations(demoViolations);
      });
    } catch {
      setPunches(demoPunches);
      setEntries(demoEntries);
      setViolations(demoViolations);
      setUsingDemoData(true);
    }

    return () => {
      if (unsubPunches) unsubPunches();
      if (unsubEntries) unsubEntries();
      if (unsubViolations) unsubViolations();
    };
  }, []);

  const totalJama = entries
    .filter((e) => e.kind === 'jama')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const cashTotal = entries
    .filter((e) => e.kind === 'jama' && e.mode === 1)
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const upiTotal = entries
    .filter((e) => e.kind === 'jama' && e.mode === 2)
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const chqTotal = entries
    .filter((e) => e.kind === 'jama' && e.mode === 3)
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const kharchaTotal = entries
    .filter((e) => e.kind === 'kharcha')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <h2 className="text-base font-bold text-white tracking-wide">LIVE OPERATIONS MONITOR</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time staff punch attendance, live collection entries (Cash/UPI/Cheque), and GPS violation alerts.
          </p>
        </div>
        {usingDemoData && (
          <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-bold text-indigo-300">
            Preview Demo Feed Active
          </span>
        )}
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Jama</p>
          <p className="mt-1 text-xl font-black text-emerald-400">₹{totalJama.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Today's Total Collection</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cash</p>
          <p className="mt-1 text-xl font-black text-amber-300">₹{cashTotal.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Physical Cash in Hand</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">UPI / QR</p>
          <p className="mt-1 text-xl font-black text-indigo-400">₹{upiTotal.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Direct Bank Credit</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cheque</p>
          <p className="mt-1 text-xl font-black text-sky-400">₹{chqTotal.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Depositable Cheques</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Kharcha (Expense)</p>
          <p className="mt-1 text-xl font-black text-rose-400">₹{kharchaTotal.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Fuel / Freight / Daily</p>
        </div>
      </div>

      {/* Violation Alert Banner if any */}
      {violations.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>GPS / Shift Alert:</strong> {violations[0].reason} ({new Date(violations[0].at).toLocaleTimeString()})
            </span>
          </div>
          <span className="font-mono text-[10px] text-amber-400 uppercase">Alert Active</span>
        </div>
      )}

      {/* 2-Column Split: Left = Live Attendance Punches, Right = Live Payments Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Attendance Punches (5 Cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>🕒</span> Attendance Live Punches ({punches.length})
            </h3>
            <span className="text-[10px] text-slate-500">Auto-refreshing</span>
          </div>

          <div className="space-y-2.5">
            {punches.map((p, idx) => (
              <div
                key={p.id || idx}
                className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 flex items-center justify-between hover:border-slate-700 transition shadow"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        p.type === 'in' ? 'bg-emerald-400' : 'bg-slate-500'
                      }`}
                    ></span>
                    <p className="text-xs font-bold text-white">{p.name || 'Staff Member'}</p>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • Dist: {Math.round(p.dist)}m from shop
                  </p>
                </div>
                <span
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase ${
                    p.type === 'in'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  PUNCH {p.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Live Payment & Jama Feed (7 Cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>💵</span> Live Collections &amp; Ledger Feed ({entries.length})
            </h3>
            <span className="text-[10px] text-slate-500">Field Updates</span>
          </div>

          <div className="space-y-2.5">
            {entries.map((e, idx) => (
              <div
                key={e.id || idx}
                className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 flex items-start justify-between hover:border-slate-700 transition shadow"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded ${
                        e.kind === 'jama'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {e.kind.toUpperCase()}
                    </span>
                    <h4 className="text-xs font-bold text-white">
                      {e.kind === 'jama' ? e.cname || 'Customer Payment' : e.note || 'Expense Record'}
                    </h4>
                    {e.miracle && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300 border border-indigo-500/30">
                        MIRACLE MATCH
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-3">
                    <span>By: <strong className="text-slate-300">{e.byName}</strong></span>
                    <span>•</span>
                    <span>Mode: <strong className="text-indigo-300">{e.mode === 1 ? 'Cash' : e.mode === 2 ? 'UPI' : 'Cheque'}</strong></span>
                    <span>•</span>
                    <span>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  {e.note && e.kind === 'jama' && (
                    <p className="text-[10px] text-slate-500 mt-0.5">Note: {e.note}</p>
                  )}
                </div>

                <div className="text-right">
                  <p
                    className={`text-sm font-black ${
                      e.kind === 'jama' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {e.kind === 'jama' ? '+' : '-'}₹{e.amount.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Recorded</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

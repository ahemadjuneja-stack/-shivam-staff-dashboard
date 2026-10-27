import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  updateDoc,
  doc,
  runTransaction,
  deleteField
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { OutsideLog, DutyGap } from '../types';
import {
  MapPinOff,
  Clock,
  CheckCircle2,
  XCircle,
  Smartphone,
  RefreshCw,
  AlertTriangle,
  Timer,
  WifiOff
} from 'lucide-react';

// ============================================================
// OUTSIDE ALERTS + INTEGRITY (Boss order 2026-10-26)
// Staff app se aane wale 3 signals ka control panel:
//   1. OUTSIDE LOGS — net band karke shop se 100m+ bahar gaya. Manager:
//        YES  = "shop ke kaam se gaya tha" (koi cut nahi)
//        NO   = rejected -> staff app khud -5 credit cut karta hai (Boss 3-5 rule)
//   2. DUTY GAPS — ON duty me app 20 min+ band tha (force-close trick).
//      Evidence only — decision manager ka.
//   3. DEVICE REPORT — har staff ka lastSeen/app version/sync health
//      (pending writes = outbox me atke writes ka count).
// GPS teleport / low-accuracy flags bhi dikhaye jate hain (fake GPS catch).
// ============================================================

interface DeviceReport {
  uid: string;
  name: string;
  role: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  lastSeenAt?: number;
  syncHealth?: { pending?: number; failed?: number; at?: number };
}

const fmtDT = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fmtMin = (min: number): string => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const agoStr = (ms: number | undefined): string => {
  if (!ms) return 'never';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ============================================================
// TOUR PAUSE/RESUME (Boss order 2026-10-27):
// "Juned ke pass Staff se Salesman roll diya hai to ab wo time period me
//  nahi aata jab tak wo tour me hai aur jab tak uska role badla nahi jaata.
//  Jab uska role badla jaye to wapis wahi se shuru hoga uska time duty
//  jaha se wo chod kar agaya tha."
// RULE: role = salesman (sales)  -> open outside logs FREEZE (stopwatch ruk)
//       role = staff (worker)    -> WAHI SE resume (pause time count NAHI)
// EFFECTIVE ELAPSED (pause-safe, code-only):
//   now - fromAt - pauseMs - (pausedAt ? now - pausedAt : 0)
// pausedAt present = frozen (pausedExtra badhta rahega, elapsed same rahega)
// ============================================================
export const elapsedMsOf = (log: { fromAt: number; pauseMs?: number; pausedAt?: number }, now: number): number => {
  const pausedExtra = typeof log.pausedAt === 'number' ? Math.max(0, now - log.pausedAt) : 0;
  return Math.max(0, now - log.fromAt - (log.pauseMs || 0) - pausedExtra);
};

// Idempotent pause: sirf tab jab pausedAt absent ho (race-safe)
export async function pauseOutsideLog(logId: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'outside_logs', logId);
    const s = await tx.get(ref);
    if (!s.exists() || s.data().status !== 'open') return;
    if (typeof s.data().pausedAt === 'number') return; // already paused
    tx.update(ref, { pausedAt: Date.now(), pauseMs: Number(s.data().pauseMs) || 0 });
  });
}

// Idempotent resume: pauseMs += (now - pausedAt), pausedAt delete
// -> elapsed EXACT wahi point se chalu hota hai jaha freeze hua tha
export async function resumeOutsideLog(logId: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'outside_logs', logId);
    const s = await tx.get(ref);
    if (!s.exists()) return;
    const d = s.data();
    if (typeof d.pausedAt !== 'number') return; // already running
    tx.update(ref, {
      pauseMs: (Number(d.pauseMs) || 0) + Math.max(0, Date.now() - Number(d.pausedAt)),
      pausedAt: deleteField()
    });
  });
}

export default function OutsideScreen() {
  const [logs, setLogs] = useState<OutsideLog[]>([]);
  const [gaps, setGaps] = useState<DutyGap[]>([]);
  const [devices, setDevices] = useState<DeviceReport[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>('');
  // LIVE stopwatch tick (open events ka elapsed har second update)
  const [, setTick] = useState(0);
  const [mins, setMins] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, 1000); // BATTERY GUARD: hidden = tick skip
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'outside_logs'), orderBy('fromAt', 'desc'), limit(120)), (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OutsideLog, 'id'>) })));
      }, () => {}),
      onSnapshot(query(collection(db, 'duty_gaps'), orderBy('fromAt', 'desc'), limit(80)), (snap) => {
        setGaps(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DutyGap, 'id'>) })));
      }, () => {}),
      onSnapshot(query(collection(db, 'users'), limit(200)), (snap) => {
        setDevices(snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            name: String(data.name || d.id),
            role: String(data.role || ''),
            deviceModel: data.deviceModel ? String(data.deviceModel) : undefined,
            osVersion: data.osVersion ? String(data.osVersion) : undefined,
            appVersion: data.appVersion ? String(data.appVersion) : undefined,
            lastSeenAt: typeof data.lastSeenAt === 'number' ? data.lastSeenAt : undefined,
            syncHealth: (data.syncHealth && typeof data.syncHealth === 'object')
              ? (data.syncHealth as DeviceReport['syncHealth'])
              : undefined
          };
        }));
      }, () => {})
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const openLogs = logs.filter((l) => l.status === 'open');
  const pendingLogs = logs.filter((l) => l.status === 'pending');
  const reviewedLogs = logs.filter((l) => l.status === 'approved' || l.status === 'rejected').slice(0, 30);
  const pendingGaps = gaps.filter((g) => g.status === 'pending');
  const staffDevices = devices.filter((d) => d.role === 'worker' || d.role === 'sales' || d.role === 'salesman');

  // uid -> role map (self-heal ke liye)
  const rolesByUid = useMemo(() => {
    const m: Record<string, string> = {};
    devices.forEach((d) => { m[d.uid] = (d.role || '').toLowerCase(); });
    return m;
  }, [devices]);

  // SELF-HEAL TOUR PAUSE/RESUME (Boss order 2026-10-27): users role live
  // onSnapshot se aata hai — role change turant reflect:
  //   owner role = sales  -> saare open logs FREEZE (naya time count nahi)
  //   owner role = worker -> paused logs WAHI SE resume
  // Transactions idempotent hain — staff app bhi same kaam karta hai,
  // double-pause/double-resume IMPOSSIBLE (pausedAt guard).
  useEffect(() => {
    openLogs.forEach((log) => {
      if (!log.id) return;
      const role = rolesByUid[log.uid] || '';
      if (role === 'sales' || role === 'salesman') {
        if (typeof log.pausedAt === 'number') return; // already paused
        pauseOutsideLog(log.id).catch(() => {});
      } else if (role === 'worker') {
        if (typeof log.pausedAt !== 'number') return; // already running
        resumeOutsideLog(log.id).catch(() => {});
      }
    });
  }, [openLogs, rolesByUid]);

  // allowed minutes set (STOPWATCH — sirf dashboard se timer lag sakta hai)
  const setAllowed = async (log: OutsideLog) => {
    if (!log.id || busyId) return;
    const allowedMin = Math.max(1, Math.min(240, Math.round(Number(mins[log.id] || 15) || 15)));
    setBusyId(log.id);
    try {
      await updateDoc(doc(db, 'outside_logs', log.id), {
        allowedMin,
        allowedSetAt: Date.now(),
        allowedSetBy: auth.currentUser?.email || 'manager'
      });
      setMsg(`Stopwatch set: ${log.name} ko ${allowedMin} min bola gaya — on-time wapas (+5) / late (-4) auto.`);
      setTimeout(() => setMsg(''), 4500);
    } catch (err) {
      setMsg('Failed: ' + (err as Error).message);
      setTimeout(() => setMsg(''), 4000);
    } finally {
      setBusyId(null);
    }
  };

  const review = async (log: OutsideLog, approve: boolean) => {
    if (!log.id || busyId) return;
    const durTxt = log.status === 'open'
      ? `${Math.round(elapsedMsOf(log, Date.now()) / 60000)} min se bahar hai (abhi bhi)`
      : `${fmtMin(log.outsideMin || 0)} bahar tha`;
    if (!approve) {
      const ok = window.confirm(
        `NO confirm: ${log.name} ${durTxt}.\n` +
        'Staff app will AUTO-cut credit points (taskScore -5, Boss 3-5 rule).'
      );
      if (!ok) return;
    }
    setBusyId(log.id);
    try {
      await updateDoc(doc(db, 'outside_logs', log.id), {
        status: approve ? 'approved' : 'rejected',
        reviewedAt: Date.now(),
        reviewedBy: auth.currentUser?.email || 'manager'
      });
      setMsg(approve ? 'Approved — koi cut nahi hoga.' : 'Rejected — staff app pe auto cut apply ho jayega.');
      setTimeout(() => setMsg(''), 4000);
    } catch (err) {
      setMsg('Failed: ' + (err as Error).message);
      setTimeout(() => setMsg(''), 4000);
    } finally {
      setBusyId(null);
    }
  };

  const noteGap = async (gap: DutyGap) => {
    if (!gap.id || busyId) return;
    setBusyId(gap.id);
    try {
      await updateDoc(doc(db, 'duty_gaps', gap.id), { status: 'noted', notedAt: Date.now() });
    } finally {
      setBusyId(null);
    }
  };

  const totalPending = openLogs.length + pendingLogs.length + pendingGaps.length;
  const flagChip = (f: string): { label: string; cls: string } =>
    f === 'gps_teleport'
      ? { label: 'GPS TELEPORT', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-400' }
      : f === 'gps_low_accuracy'
        ? { label: 'LOW GPS ACCURACY', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' }
        : { label: f.toUpperCase(), cls: 'border-slate-500/30 bg-slate-500/10 text-slate-400' };

  return (
    <div className="space-y-6">
      {/* Header stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <MapPinOff className="h-4 w-4 text-rose-400" /> Outside Pending
          </div>
          <div className="mt-1 text-2xl font-black text-white">{pendingLogs.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Timer className="h-4 w-4 text-amber-400" /> Duty Gaps
          </div>
          <div className="mt-1 text-2xl font-black text-white">{pendingGaps.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Smartphone className="h-4 w-4 text-sky-400" /> Devices Live
          </div>
          <div className="mt-1 text-2xl font-black text-white">{staffDevices.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <WifiOff className="h-4 w-4 text-purple-400" /> Unsynced Writes
          </div>
          <div className="mt-1 text-2xl font-black text-white">
            {staffDevices.reduce((n, d) => n + (Number(d.syncHealth?.pending) || 0), 0)}
          </div>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* LIVE OUTSIDE (open events) — staff ABHI bahar hai: live stopwatch + timer set */}
      {openLogs.length > 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-slate-900">
          <div className="flex items-center justify-between border-b border-rose-500/25 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500"></span>
              </span>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">LIVE — Abhi Bahar Hai ({openLogs.length})</h3>
            </div>
            <span className="text-[10px] font-semibold text-slate-500">stopwatch timer sirf dashboard se lagta hai • salesman role = auto pause</span>
          </div>
          <div className="divide-y divide-slate-800">
            {openLogs.map((log) => {
              const paused = typeof log.pausedAt === 'number';
              const elapsedMs = elapsedMsOf(log, Date.now());
              const elapsedMin = Math.floor(elapsedMs / 60000);
              const over = !paused && typeof log.allowedMin === 'number' && elapsedMs > log.allowedMin * 60000;
              const remaining = typeof log.allowedMin === 'number' ? Math.max(0, log.allowedMin - elapsedMin) : null;
              return (
                <div key={log.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{log.name}</span>
                      {paused ? (
                        <span className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-300">
                          PAUSED — TOUR MODE ({elapsedMin} min freeze)
                        </span>
                      ) : (
                        <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-400">
                          {elapsedMin} min se BAHAR
                        </span>
                      )}
                      {typeof log.allowedMin === 'number' && (
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${
                          over ? 'animate-pulse border-rose-500/40 bg-rose-500/15 text-rose-300' : paused ? 'border-slate-500/30 bg-slate-500/10 text-slate-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {over ? `TIME OVER (bola tha ${log.allowedMin}m)` : paused ? `TIMER FROZEN — ${remaining}m baaki (bola tha ${log.allowedMin}m)` : `${remaining}m baaki (bola tha ${log.allowedMin}m)`}
                        </span>
                      )}
                      {(log.flags || []).map((f) => {
                        const c = flagChip(f);
                        return (
                          <span key={f} className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${c.cls}`}>{c.label}</span>
                        );
                      })}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDT(log.fromAt)} se {paused ? 'freeze hai (tour)' : 'chal raha hai'}</span>
                      {typeof log.lat === 'number' && typeof log.lng === 'number' && (
                        <span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" />{log.lat.toFixed(4)}, {log.lng.toFixed(4)}</span>
                      )}
                    </div>
                    {paused && (
                      <div className="mt-1.5 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-1.5 text-[10.5px] font-semibold text-sky-300/90">
                        Salesman tour mode — time freeze. Role staff hote hi isi time ({elapsedMin} min) se resume hoga, pause ka time count NAHI hoga.
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!paused && typeof log.allowedMin !== 'number' && (
                      <>
                        {[10, 15, 20, 30].map((n) => (
                          <button
                            key={n}
                            onClick={() => setMins((m) => ({ ...m, [log.id!]: String(n) }))}
                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black transition ${
                              Number(mins[log.id ?? ''] || 15) === n
                                ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {n}m
                          </button>
                        ))}
                        <input
                          type="number"
                          min={1}
                          max={240}
                          value={mins[log.id ?? ''] ?? '15'}
                          onChange={(e) => setMins((m) => ({ ...m, [log.id!]: e.target.value }))}
                          className="w-14 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-white focus:border-indigo-500 focus:outline-none"
                        />
                        <button
                          onClick={() => setAllowed(log)}
                          disabled={busyId === log.id}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 disabled:opacity-50 transition"
                        >
                          {busyId === log.id ? '...' : 'Timer Set'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => review(log, true)}
                      disabled={busyId === log.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-50 transition"
                    >
                      <CheckCircle2 className="h-4 w-4" /> YES
                    </button>
                    <button
                      onClick={() => review(log, false)}
                      disabled={busyId === log.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/20 hover:bg-rose-500 disabled:opacity-50 transition"
                    >
                      <XCircle className="h-4 w-4" /> NO
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending outside logs (closed, review waiting) — YES / NO review */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <MapPinOff className="h-4 w-4 text-rose-400" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Outside Alerts</h3>
            {totalPending > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-slate-950">{totalPending} NEW</span>
            )}
          </div>
          <span className="text-[10px] font-semibold text-slate-500">NO = auto -5 credit (staff app)</span>
        </div>
        {pendingLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            Koi closed outside alert nahi. Open events upar LIVE section me hain.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {pendingLogs.map((log) => (
              <div key={log.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">{log.name}</span>
                    <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-400">
                      {fmtMin(log.outsideMin || 0)} BAHAR
                    </span>
                    {typeof log.allowedMin === 'number' && (
                      <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-black text-indigo-300">
                        TIMER: {log.allowedMin}m
                      </span>
                    )}
                    {(log.flags || []).map((f) => {
                      const c = flagChip(f);
                      return (
                        <span key={f} className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${c.cls}`}>{c.label}</span>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDT(log.fromAt)} → {log.toAt ? fmtDT(log.toAt) : 'open'}</span>
                    {typeof log.lat === 'number' && typeof log.lng === 'number' && (
                      <span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" />{log.lat.toFixed(4)}, {log.lng.toFixed(4)}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => review(log, true)}
                    disabled={busyId === log.id}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-50 transition"
                  >
                    <CheckCircle2 className="h-4 w-4" /> YES (Kaam tha)
                  </button>
                  <button
                    onClick={() => review(log, false)}
                    disabled={busyId === log.id}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/20 hover:bg-rose-500 disabled:opacity-50 transition"
                  >
                    <XCircle className="h-4 w-4" /> NO (Auto -5)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Duty gaps — app band tha evidence */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Duty Gaps (App Band)</h3>
          </div>
          <span className="text-[10px] font-semibold text-slate-500">ON duty me app 20+ min band tha</span>
        </div>
        {gaps.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">Koi gap nahi mila.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {gaps.slice(0, 40).map((g) => (
              <div key={g.id} className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">{g.name}</span>
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-400">
                      {fmtMin(g.gapMin)} SILENT
                    </span>
                    {g.status === 'noted' && (
                      <span className="rounded-md border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-black text-slate-400">NOTED</span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {fmtDT(g.fromAt)} → {fmtDT(g.toAt)} (duty ON thi, app band)
                  </div>
                </div>
                {g.status === 'pending' && (
                  <button
                    onClick={() => noteGap(g)}
                    disabled={busyId === g.id}
                    className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition"
                  >
                    Mark Noted
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviewed history */}
      {reviewedLogs.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-3.5">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Reviewed History</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {reviewedLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 text-[12px]">
                  <span className="font-bold text-slate-200">{l.name}</span>
                  <span className="text-slate-500"> — {fmtMin(l.outsideMin || 0)} • {fmtDT(l.fromAt)}
                    {typeof l.allowedMin === 'number' ? ` (timer ${l.allowedMin}m)` : ''}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {l.cutApplied && (
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${
                      (l.cutPoints || 0) >= 0
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    }`}>
                      {l.cutReason === 'outside_ontime' ? 'ON-TIME'
                        : l.cutReason === 'outside_late' ? 'LATE'
                        : l.cutReason === 'outside_no_notice' ? 'NO NOTICE'
                        : 'CUT'} {(l.cutPoints || 0) >= 0 ? `+${l.cutPoints}` : l.cutPoints}
                    </span>
                  )}
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                    l.status === 'approved'
                      ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border border-rose-500/30 bg-rose-500/10 text-rose-400'
                  }`}>
                    {l.status === 'approved' ? 'APPROVED' : 'REJECTED'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device report — live sync health per staff */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Device Report (Live)</h3>
          </div>
          <span className="text-[10px] font-semibold text-slate-500">staff app har 5 min report karta hai</span>
        </div>
        {staffDevices.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">Koi device report nahi.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {staffDevices.map((d) => {
              const pending = Number(d.syncHealth?.pending) || 0;
              const failed = Number(d.syncHealth?.failed) || 0;
              return (
                <div key={d.uid} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-white">{d.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {[d.deviceModel, d.osVersion, d.appVersion ? `v${d.appVersion}` : null].filter(Boolean).join(' • ') || 'report pending'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {failed > 0 && (
                      <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-400">
                        {failed} FAILED
                      </span>
                    )}
                    {pending > 0 ? (
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-400">
                        {pending} PENDING SYNC
                      </span>
                    ) : (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                        ALL SYNCED
                      </span>
                    )}
                    <span className="w-16 text-right text-[11px] font-semibold text-slate-400">{agoStr(d.lastSeenAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

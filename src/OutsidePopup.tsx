import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, updateDoc, doc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { OutsideLog } from './types';
import { MapPinOff, TimerReset, X } from 'lucide-react';

// ============================================================
// GLOBAL OUTSIDE POPUP (Boss order 2026-10-26):
// "Shop par se koi bhi staff member on duty 100 mitter ke bahar jaye to
//  dashboard par popup aana chahiye, ke kon bahar gaya hai, agar wo bina
//  bataye gaya hai to points down honge"
//
// Staff app geofence OPEN event likhta hai (status:'open') — ye popup HAR
// dashboard tab par turant aa jata hai (real-time). Manager yahin se
// "bola hua time" (allowed minutes) set karta hai — STOPWATCH shuru
// (sirf dashboard se timer lag sakta hai). Wapas aane par staff app khud
// compare karega: on-time = +5, late = -4, bina-bataye = -5 (Boss 3-5 rule).
// ============================================================

const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

export default function OutsideAlertPopup() {
  const [openLogs, setOpenLogs] = useState<OutsideLog[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [mins, setMins] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Live elapsed — har second update
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'outside_logs'), where('status', '==', 'open')),
      (snap) => {
        setOpenLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OutsideLog, 'id'>) })));
      },
      () => setOpenLogs([])
    );
    return () => unsub();
  }, []);

  const visible = useMemo(
    () => openLogs.filter((l) => l.id && !dismissed.includes(l.id!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openLogs, dismissed, tick]
  );

  const setAllowedMin = async (log: OutsideLog) => {
    if (!log.id) return;
    const raw = Number(mins[log.id] || 15);
    const allowedMin = Math.max(1, Math.min(240, Math.round(raw || 15)));
    setBusy(log.id);
    try {
      await updateDoc(doc(db, 'outside_logs', log.id), {
        allowedMin,
        allowedSetAt: Date.now(),
        allowedSetBy: auth.currentUser?.email || 'manager'
      });
    } catch {
      // silent — Outside Alerts screen se bhi set ho sakta hai
    } finally {
      setBusy(null);
    }
  };

  if (visible.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-500/40 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-rose-500/30 bg-rose-500/10 px-5 py-3.5">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500"></span>
          </span>
          <h3 className="text-sm font-black uppercase tracking-wider text-rose-300">
            OUTSIDE ALERT ({visible.length})
          </h3>
          <button
            onClick={() => setDismissed((d) => [...d, ...visible.map((v) => v.id!).filter(Boolean)])}
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Dismiss (staff wapas aayega to record auto-close)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto">
          {visible.map((log) => {
            const elapsedMs = Date.now() - (log.fromAt || Date.now());
            const over = typeof log.allowedMin === 'number' && elapsedMs > log.allowedMin * 60000;
            return (
              <div key={log.id} className="space-y-3 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-black text-white">{log.name}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-rose-300">
                      Shop ke {Math.round(elapsedMs / 60000)} min se 100m+ BAHAR hai (on duty)
                    </div>
                  </div>
                  <div className={`shrink-0 rounded-xl border px-3 py-2 text-center font-mono text-lg font-black tabular-nums ${
                    over
                      ? 'animate-pulse border-rose-500/40 bg-rose-500/15 text-rose-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  }`}>
                    {fmtElapsed(elapsedMs)}
                  </div>
                </div>

                {typeof log.allowedMin === 'number' ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-[11.5px] font-semibold text-slate-300">
                    Stopwatch set: <b className="text-white">{log.allowedMin} min</b> bola tha —
                    {over ? (
                      <span className="text-rose-300"> time OVER hai, wapas nahi aaya</span>
                    ) : (
                      <span className="text-emerald-300"> abhi {Math.max(0, Math.ceil(log.allowedMin - elapsedMs / 60000))} min baaki</span>
                    )}
                    . Wapas aane par points auto up/down honge.
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                      <TimerReset className="h-3.5 w-3.5" />
                      STOPWATCH TIMER SET KAREIN (bola hua time)
                    </div>
                    <div className="mt-2 flex items-center gap-2">
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
                        className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-white focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        onClick={() => setAllowedMin(log)}
                        disabled={busy === log.id}
                        className="ml-auto rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[11px] font-black text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 disabled:opacity-50 transition"
                      >
                        {busy === log.id ? '...' : 'Timer Set'}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      Time se pehle wapas aaya = points UP • late / bina bataye = points DOWN (auto)
                    </p>
                  </div>
                )}

                {typeof log.lat === 'number' && typeof log.lng === 'number' && (
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                    <MapPinOff className="h-3 w-3" />
                    GPS: {log.lat.toFixed(4)}, {log.lng.toFixed(4)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-800 bg-slate-900/95 px-5 py-3 text-[10.5px] font-semibold text-slate-500">
          Record close ho jayega jab staff shop wapas aayega (GPS auto-detect) — Outside Alerts tab me pura history.
        </div>
      </div>
    </div>
  );
}

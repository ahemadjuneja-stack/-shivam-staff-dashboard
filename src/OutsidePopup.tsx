import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { OutsideLog } from './types';
import { elapsedMsOf } from './screens/Outside';
import { MapPinOff, X } from 'lucide-react';

// ============================================================
// SIDE OUTSIDE-ALERT NOTIFICATIONS (Boss order 2026-10-27):
// 1. Popup SCREEN BLOCK nahi karega — SIDE me notification stack
//    (bottom-right, non-blocking — kaam me rukawat nahi)
// 2. EK STAFF = EK POPUP (naam dedupe) — do log gaye to do cards,
//    ek hi naam ke 5-5 popup KABHI nahi (count badge ×N dikhega)
// 3. Popup SIRF TAB dikhe jab ALLOWED TIME KHATAM ho jaye —
//    manager ne timing laga di aur waqt baaki hai = koi popup nahi.
//    Timer set nahi hai to 15 min default grace ke baad hi dikhega.
// 4. HAR REFRESH par wahi popup dobara NAHI aayega — dismiss
//    localStorage me persist hota hai; naya outside event hi
//    firse popup layega (purana dismiss hone ke baad bhi).
// ============================================================

const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const DEFAULT_GRACE_MIN = 15;
const LS_KEY = 'ob-side-dismissed-v1'; // { [name]: dismissTimestampMs }

type DismissMap = Record<string, number>;

const loadDismissed = (): DismissMap => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as DismissMap) : {};
  } catch {
    return {};
  }
};

interface PersonAlert {
  name: string;
  freshCount: number;
  latest: OutsideLog; // sabse naya over event (fromAt max)
  worstElapsedMs: number; // in fresh over logs me max elapsed
  anyPaused: boolean;
  allowedMin: number; // latest log ka grace
}

export default function OutsideAlertPopup() {
  const [openLogs, setOpenLogs] = useState<OutsideLog[]>([]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => loadDismissed());
  const [tick, setTick] = useState(0);

  // Live elapsed — har second update (frozen timer tick par bhi badhta nahi)
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, 1000); // BATTERY GUARD: hidden = tick skip
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

  // OVER-LIMIT LOGS ONLY: elapsed > (allowedMin ?? 15 min) —
  // timing set hai aur waqt baaki hai to popup BILKUL nahi.
  // Paused (tour) log bhi tabhi dikhe jab uska frozen time grace cross karta ho.
  const personAlerts = useMemo<PersonAlert[]>(() => {
    const now = Date.now();
    const byName = new Map<string, OutsideLog[]>();
    for (const log of openLogs) {
      const paused = typeof log.pausedAt === 'number';
      const elapsedMs = elapsedMsOf(log, now);
      const graceMin = typeof log.allowedMin === 'number' ? log.allowedMin : DEFAULT_GRACE_MIN;
      if (elapsedMs <= graceMin * 60000) continue; // waqt baaki — koi popup nahi
      const key = (log.name || 'Unknown').trim();
      const arr = byName.get(key) || [];
      arr.push(log);
      byName.set(key, arr);
    }

    const out: PersonAlert[] = [];
    byName.forEach((logs, name) => {
      const dismissedAt = dismissed[name] || 0;
      // Naya event hi popup layega: dismiss ke BAAD start hua log?
      const fresh = logs.filter((l) => (l.fromAt || 0) > dismissedAt);
      if (fresh.length === 0) return;
      fresh.sort((a, b) => (b.fromAt || 0) - (a.fromAt || 0));
      const worst = fresh.reduce((mx, l) => Math.max(mx, elapsedMsOf(l, now)), 0);
      const latest = fresh[0];
      out.push({
        name,
        freshCount: fresh.length,
        latest,
        worstElapsedMs: worst,
        anyPaused: fresh.some((l) => typeof l.pausedAt === 'number'),
        allowedMin: typeof latest.allowedMin === 'number' ? latest.allowedMin : DEFAULT_GRACE_MIN
      });
    });
    out.sort((a, b) => b.worstElapsedMs - a.worstElapsedMs);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLogs, dismissed, tick]);

  const persistDismiss = (map: DismissMap) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch {
      // storage blocked — sirf session-level dismiss
    }
  };

  const dismissPerson = (name: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [name]: Date.now() };
      persistDismiss(next);
      return next;
    });
  };

  const dismissAll = () => {
    const now = Date.now();
    setDismissed((prev) => {
      const next = { ...prev };
      for (const p of personAlerts) next[p.name] = now;
      persistDismiss(next);
      return next;
    });
  };

  if (personAlerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[350px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
      {personAlerts.length > 1 && (
        <button
          onClick={dismissAll}
          className="pointer-events-auto self-end rounded-lg border border-slate-600/70 bg-slate-900/95 px-3 py-1 text-[10px] font-bold text-slate-400 shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:text-white"
        >
          Sab dismiss ({personAlerts.length})
        </button>
      )}

      {personAlerts.map((p) => {
        const totalMin = Math.round(p.worstElapsedMs / 60000);
        const overByMin = Math.max(1, totalMin - p.allowedMin);
        return (
          <div
            key={p.name}
            className="pointer-events-auto overflow-hidden rounded-2xl border border-rose-500/40 bg-slate-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
          >
            {/* Header — person + count + badges */}
            <div className="flex items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-3.5 py-2">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
              </span>
              <span className="truncate text-[13px] font-black text-white">{p.name}</span>
              {p.freshCount > 1 && (
                <span className="shrink-0 rounded-md border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-black text-rose-300">
                  ×{p.freshCount}
                </span>
              )}
              {p.anyPaused && (
                <span className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-black text-sky-300">
                  TOUR PAUSE
                </span>
              )}
              <button
                onClick={() => dismissPerson(p.name)}
                title="Dismiss — naya event aane par fir popup aayega"
                className="ml-auto shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Body — frozen/over time + summary */}
            <div className="space-y-1.5 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Time OVER — allowed {p.allowedMin} min
                </span>
                <span className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-[13px] font-black tabular-nums text-rose-300">
                  {fmtElapsed(p.worstElapsedMs)}
                </span>
              </div>
              <p className="text-[11px] font-semibold leading-snug text-rose-300/90">
                {totalMin} min se shop ke bahar ({overByMin} min zyada)
                {p.anyPaused ? ' • tour pause: time freeze' : ''}
              </p>
              {typeof p.latest.lat === 'number' && typeof p.latest.lng === 'number' && (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <MapPinOff className="h-3 w-3" />
                  GPS: {p.latest.lat.toFixed(4)}, {p.latest.lng.toFixed(4)}
                </div>
              )}
            </div>

            <div className="border-t border-slate-800/80 bg-slate-950/60 px-3.5 py-1.5 text-[9.5px] font-semibold text-slate-500">
              Outside Alerts tab me details • wapas aate hi auto-close
            </div>
          </div>
        );
      })}
    </div>
  );
}

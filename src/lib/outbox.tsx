// ============================================================
// OUTBOX ENGINE — offline-first write layer (Boss order 2026-10-27)
// "agar internet naa ho aur dashboard khula ho tab bhi wo kaam kare
//  net aane par wapis Firestore par data bhej de"
//
// 3-LAYER DATA SAFETY:
//   L1: Firestore persistentLocalCache (IndexedDB) — offline READS cached,
//       writes SDK queue me durable (refresh par bhi safe), net aane par
//       SDK khud sync karta hai
//   L2: Outbox journal (localStorage, obJournal.ts) — HAR write journal-FIRST,
//       flush engine FIFO replay karta hai (app-clear/crash bhi recover)
//   L3: opId embedded in payload — replay idempotent, merge writes duplicate-proof
//
// IMPORTANT: offline me Firestore write promise resolve NAHI hota (server ack
// wait) — isliye har write 8s timeout race me hai; timeout par journal entry
// rehti hai, flush engine (online event / 90s loop) baad me replay karega.
// ============================================================
import { useEffect, useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  OutboxEntry, journalPush, journalRemove, journalPending,
  readJournal, lastSyncAt, markSynced, newOpId,
  journalMarkDead, journalDeadList, journalClearDead
} from './obJournal';
import { classifyWriteErr, sanitizeOutboxPayload, shortErrReason } from './obHeal';

const WRITE_TIMEOUT_MS = 8000;

function notify() {
  try { window.dispatchEvent(new Event('ob-changed')); } catch { /* ignore */ }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('write-timeout')), ms))
  ]);
}

// ---------- core writes (JOURNAL FIRST) ----------

export async function obSet(
  col: string,
  docId: string,
  payload: Record<string, unknown>,
  opts?: { merge?: boolean; opId?: string }
) {
  const opId = opts?.opId || newOpId();
  // SELF-HEAL (Task 95): payload write-time par hi sanitize — undefined/NaN
  // fields Firestore invalid-argument throw karte the aur entry FIFO me
  // HAMESHA ke liye phans jati thi (SYNC PENDING har screen par bug)
  const entry: OutboxEntry = {
    opId, col, docId,
    payload: sanitizeOutboxPayload({ ...payload, opId }) as Record<string, unknown>,
    merge: opts?.merge !== false, // default MERGE (field-level, destructive nahi)
    at: Date.now(),
    tries: 0
  };
  journalPush(entry); // 1. JOURNAL FIRST — data safe kisi bhi haal me
  notify();
  try {
    // 2. Firestore write (SDK apni queue me bhi dalta hai — double path, idempotent)
    await withTimeout(setDoc(doc(db, col, docId), entry.payload!, { merge: entry.merge }), WRITE_TIMEOUT_MS);
    journalRemove(opId); // 3. server ack -> journal clear
    notify();
  } catch {
    // offline/timeout — journal me safe, flush replay karega
    notify();
  }
}

export async function obSetPath(
  segs: string[],
  payload: Record<string, unknown>,
  opts?: { merge?: boolean; opId?: string }
) {
  const opId = opts?.opId || newOpId();
  // journal me col = slash-path (replay doc(db, col, docId) valid odd-segment doc banta hai)
  // SELF-HEAL (Task 95): sanitize at entry-time (Task 95 comment obSet me)
  const entry: OutboxEntry = {
    opId,
    col: segs.slice(0, -1).join('/'),
    docId: segs[segs.length - 1],
    payload: sanitizeOutboxPayload({ ...payload, opId }) as Record<string, unknown>,
    merge: opts?.merge !== false,
    at: Date.now(),
    tries: 0
  };
  journalPush(entry); // 1. JOURNAL FIRST
  notify();
  try {
    // 2. Firestore write — subcollection path (hisab/{monthId}/sheets/{name})
    await withTimeout(
      setDoc(doc(db, segs[0], ...segs.slice(1)), entry.payload!, { merge: entry.merge }),
      WRITE_TIMEOUT_MS
    );
    journalRemove(opId); // 3. server ack -> journal clear
    notify();
  } catch {
    // offline/timeout — journal me safe, flush replay karega
    notify();
  }
}

export async function obDel(col: string, docId: string) {
  const entry: OutboxEntry = { opId: newOpId('obd'), col, docId, payload: undefined, merge: false, at: Date.now(), tries: 0 };
  journalPush(entry);
  notify();
  try {
    await withTimeout(deleteDoc(doc(db, col, docId)), WRITE_TIMEOUT_MS);
    journalRemove(entry.opId);
    notify();
  } catch {
    notify();
  }
}

// REFRESH-SAFETY (Boss order 2026-10-27): pendingOpsForDoc ab obJournal.ts me
// rehta hai (pure layer, node-testable) — neeche re-export for convenience.
export { pendingOpsForDoc } from './obJournal';

// ---------- flush engine (FIFO replay — order preserved, same-doc ops sequence safe) ----------

let flushing = false;

export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  // BATTERY GUARD (Boss 2026-10-27): app background me koi network write
  // attempt nahi — journal entries safe rehti hai, app khulne par flush.
  if (typeof document !== 'undefined' && document.hidden) return 0;
  flushing = true;
  let done = 0;
  try {
    for (const e of readJournal()) {
      if (e.dead) continue; // SELF-HEAL: quarantined entry kabhi replay nahi
      try {
        if (e.payload) {
          await withTimeout(setDoc(doc(db, e.col, e.docId), e.payload, { merge: e.merge }), WRITE_TIMEOUT_MS);
        } else {
          await withTimeout(deleteDoc(doc(db, e.col, e.docId)), WRITE_TIMEOUT_MS);
        }
        journalRemove(e.opId);
        done++;
      } catch (err) {
        // ===== SELF-HEAL (Task 95) =====
        // PERMANENT fail (invalid-argument / permission-denied / ...):
        // pehle SANITIZED payload se ek retry (undefined/NaN fields ka ilaaj);
        // phir bhi fail = QUARANTINE (dead mark) aur FIFO AGLE entry par —
        // ek mara-hua write ab puri queue BLOCK nahi karta.
        // TRANSIENT (net/timeout) = FIFO break (order preserve) — purana rule.
        if (classifyWriteErr(err) === 'dead') {
          let healed = false;
          if (e.payload) {
            try {
              const clean = sanitizeOutboxPayload(e.payload) as Record<string, unknown>;
              await withTimeout(setDoc(doc(db, e.col, e.docId), clean, { merge: e.merge }), WRITE_TIMEOUT_MS);
              journalRemove(e.opId);
              done++;
              healed = true;
            } catch { healed = false; }
          }
          if (!healed) {
            journalMarkDead(e.opId, shortErrReason(err));
            notify();
          }
          continue; // FIFO aage badho — queue kabhi block nahi
        }
        break; // transient — FIFO rok do (order preserve); net aane par dobara
      }
    }
    if (done > 0) {
      markSynced(Date.now());
      notify();
    }
  } finally {
    flushing = false;
  }
  return done;
}

let engineOn = false;

export function initOutboxEngine() {
  if (engineOn || typeof window === 'undefined') return;
  engineOn = true;
  window.addEventListener('online', () => { setTimeout(() => flushOutbox(), 800); });
  // 20s loop — pending ho to jaldi flush (flushOutbox khud hidden/offline
  // guard karta hai — background me zero cost). Purana 90s tha: stuck write
  // ka banner 1.5 min tak dikhta rehta tha.
  window.setInterval(() => { if (navigator.onLine) flushOutbox(); }, 20_000);
  if (navigator.onLine) window.setTimeout(() => flushOutbox(), 2500);
}

// ---------- UI status hook (OFFLINE banner + pending chip) ----------

export function useOutboxStatus(): { online: boolean; pending: number; lastSync: number; dead: number } {
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState<number>(journalPending());
  const [lastSync, setLastSync] = useState<number>(lastSyncAt());
  const [dead, setDead] = useState<number>(journalDeadList().length);
  useEffect(() => {
    const up = () => {
      setOnline(navigator.onLine);
      setPending(journalPending());
      setLastSync(lastSyncAt());
      setDead(journalDeadList().length);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    window.addEventListener('ob-changed', up);
    // BATTERY GUARD: background me 4s poll band — localStorage reads + re-render 0
    const t = window.setInterval(() => { if (!document.hidden) up(); }, 4000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', up);
      window.removeEventListener('ob-changed', up);
      window.clearInterval(t);
    };
  }, []);
  return { online, pending, lastSync, dead };
}

// Shared banner (CounterBook + TourHisab + TourPaste + HisabXL) — OFFLINE /
// SYNC PENDING / DEAD-WRITE notice (Task 95 self-heal UI)
export function OutboxBanner() {
  const { online, pending, dead } = useOutboxStatus();
  if (online && pending === 0 && dead === 0) return null;
  const deadList = dead > 0 ? journalDeadList() : [];
  const clearDead = () => {
    if (!window.confirm(`${deadList.length} purana write Firestore par nahi ja sakta tha (format/rules issue). Clear karne par ye journal se hamesha ke liye hat jayega — Firestore ka data isse koi farak nahi padta. Clear karein?`)) return;
    journalClearDead();
    notify();
  };
  const copyDead = () => {
    try {
      const dump = deadList.map((d) => ({ col: d.col, doc: d.docId, err: d.err, payload: d.payload })).map((x) => JSON.stringify(x)).join('\n');
      navigator.clipboard?.writeText(dump);
    } catch { /* ignore */ }
  };
  return (
    <div className="space-y-2">
      {dead > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-[11.5px] font-bold text-rose-300">
          <span className="inline-flex h-2 w-2 rounded-full bg-rose-400" />
          <span>
            {dead} PURANA write Firestore par nahi ja paya ({deadList[0]?.err || 'format issue'}) — baki sab sync hai, data SAFE hai. Ye ab queue block nahi karta.
          </span>
          <button onClick={copyDead} className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-200 hover:bg-rose-500/20">COPY</button>
          <button onClick={clearDead} className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-black text-rose-100 hover:bg-rose-500/30">CLEAR</button>
        </div>
      )}
      {(pending > 0 || !online) && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[11.5px] font-bold ${
          online
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
        }`}>
          <span className={`inline-flex h-2 w-2 rounded-full ${online ? 'bg-amber-400' : 'animate-pulse bg-rose-400'}`} />
          {online
            ? <>SYNC PENDING — {pending} write(s) Firestore par bheje jayenge (net me rukawat hai, data SAFE hai)</>
            : <>OFFLINE MODE — dashboard poora kaam kar raha hai, data LOCAL me SAFE hai. Net aane par Firestore par khud sync ho jayega.</>}
          {pending > 0 && !online && (
            <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-black text-rose-300">
              {pending} PENDING
            </span>
          )}
        </div>
      )}
    </div>
  );
}

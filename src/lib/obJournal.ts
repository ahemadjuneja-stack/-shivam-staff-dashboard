// ============================================================
// OUTBOX JOURNAL — pure localStorage layer (ZERO imports, node-testable)
// Boss order 2026-10-27: "data safe rahna chahiye kisi bhi haal me..
// agar internet naa ho aur dashboard khula ho tab bhi wo kaam kare
// net aane par wapis Firestore par data bhej de"
//
// JOURNAL-FIRST WRITE PATTERN (staff app sync.ts jaisa hi):
//   1. HAR write pehle localStorage journal me (durable — refresh/crash-safe)
//   2. Firestore write try hota hai
//   3. Success par journal entry remove
//   4. Offline/timeout par entry journal me rahegi — flush engine replay karega
// Same payload merge replay = idempotent (opId embedded) — duplicate kabhi
// nahi banta, data kabhi nahi lost.
// ============================================================

const OB_KEY = 'shivam_dash_outbox_v1';
export const LAST_SYNC_KEY = 'shivam_dash_last_sync_v1';

export interface OutboxEntry {
  opId: string; // replay-safe idempotency marker (payload me bhi embed hota hai)
  col: string;
  docId: string;
  payload?: Record<string, unknown>; // undefined = DELETE op
  merge: boolean;
  at: number;
  tries: number;
  // SELF-HEAL (Task 95): permanently-fail entry quarantine — FIFO queue
  // block na ho. dead=true entries flush ME KABHI replay nahi hoti, data
  // localStorage me safe rehta hai (inspection/clear UI banner se).
  dead?: boolean;
  err?: string;   // short reason (banner me dikhta hai)
  deadAt?: number;
}

// localStorage shim for node-test env
const store = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
      return (globalThis as { __OB_STORE__?: Record<string, string> }).__OB_STORE__?.[key] ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, val: string) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, val);
        return;
      }
      const g = globalThis as { __OB_STORE__?: Record<string, string> };
      if (!g.__OB_STORE__) g.__OB_STORE__ = {};
      g.__OB_STORE__[key] = val;
    } catch {
      // quota/full — ignore (in-flight Firestore queue fallback)
    }
  }
};

export function readJournal(): OutboxEntry[] {
  try {
    const raw = store.getItem(OB_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as OutboxEntry[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.opId === 'string' && typeof e.col === 'string' && typeof e.docId === 'string');
  } catch {
    return [];
  }
}

function writeJournal(list: OutboxEntry[]) {
  // cap: 500 entries (roz ka hisab — kabhi itna bhi nahi jayega, safety cap)
  store.setItem(OB_KEY, JSON.stringify(list.slice(-500)));
}

export function journalPush(entry: OutboxEntry): OutboxEntry[] {
  const list = readJournal();
  // dedupe: same opId dobara push nahi (replay-safe)
  const idx = list.findIndex((x) => x.opId === entry.opId);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  writeJournal(list);
  return list;
}

export function journalRemove(opId: string): OutboxEntry[] {
  const list = readJournal().filter((x) => x.opId !== opId);
  writeJournal(list);
  return list;
}

export function journalPending(): number {
  // dead (quarantined) entries pending NAHI gini jati — warna banner phir
  // bhi har screen par dikhta (Task 95 root complaint)
  return readJournal().filter((e) => !e.dead).length;
}

// ---------- SELF-HEAL (Task 95): quarantine helpers ----------

export function journalMarkDead(opId: string, err: string): OutboxEntry[] {
  const list = readJournal();
  for (const e of list) {
    if (e.opId === opId) { e.dead = true; e.err = err; e.deadAt = Date.now(); }
  }
  writeJournal(list);
  return list;
}

export function journalDeadList(): OutboxEntry[] {
  return readJournal().filter((e) => !!e.dead);
}

export function journalClearDead(): OutboxEntry[] {
  const list = readJournal().filter((e) => !e.dead);
  writeJournal(list);
  return list;
}

// REFRESH-SAFETY (Boss order 2026-10-27: "kitna bhi refresh karo jo likh diya
// wo jab tak change na kare jaana nahi chahiye"): batata hai is doc ke liye
// journal me UNSENT write pending hai ya nahi. Load path ise padhta hai —
// pending ho to LOCAL state (mirror) authoritative hai, Firestore purana ho
// sakta hai (write abhi flush nahi hua). obSetPath entries ka col = slash-path.
// NOTE: dead entries bhi gini jati hai — data-safety view (sheet ka write
// permanently fail hua to LOCAL mirror hi authoritative rahega hamesha).
export function pendingOpsForDoc(col: string, docId: string): number {
  return readJournal().filter((e) => e.col === col && e.docId === docId && !!e.payload).length;
}

export function journalClear() {
  writeJournal([]);
}

export function newOpId(prefix = 'ob'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function lastSyncAt(): number {
  return Number(store.getItem(LAST_SYNC_KEY) || 0);
}

export function markSynced(at: number) {
  store.setItem(LAST_SYNC_KEY, String(at));
}

// ============================================================
// HISAB MIRROR — localStorage working copy of edited XL sheets
// (Task 70, Boss order: "bilkul XL jaisa home" + data safety)
//
// KYUN: Firestore persistent cache (L1) offline READS deta hai SIRF
// un docs ke liye jo kabhi sync ho chuke hain. Naya month OFFLINE me
// banaya aur edit kiya -> Firestore doc kabhi bana hi nahi -> refresh
// par data gayab dikhta (journal me to hai par UI load use nahi karta).
// Mirror us gap ko band karta hai:
//   L1 Firestore IndexedDB cache  -> synced sheets offline bhi dikhte hain
//   L2 Outbox journal             -> writes durable, flush replay
//   L3 opId idempotent replay     -> duplicate-proof
//   L4 THIS MIRROR                -> edited sheets ka last state, refresh-safe
// Load order: Firestore -> MIRROR -> fresh template. Save: mirror + outbox.
// ============================================================

const KEY_PREFIX = 'shivam_hisab_mirror_v1';
const MONTH_KEY_PREFIX = 'shivam_hisab_month_v1';
const MAX_MONTHS = 3; // purane months ki mirror prune (current + pichle 2 kaafi)

// node-test shim (obJournal jaisa hi)
const store = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
      return (globalThis as { __HM_STORE__?: Record<string, string> }).__HM_STORE__?.[key] ?? null;
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
      const g = globalThis as { __HM_STORE__?: Record<string, string> };
      if (!g.__HM_STORE__) g.__HM_STORE__ = {};
      g.__HM_STORE__[key] = val;
    } catch {
      // quota/full — ignore (outbox journal + Firestore queue dono fallback hain)
    }
  },
  removeItem(key: string) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
      const g = globalThis as { __HM_STORE__?: Record<string, string> };
      if (g.__HM_STORE__) delete g.__HM_STORE__[key];
    } catch {
      // ignore
    }
  }
};

export interface MirroredSheet {
  grid: (string | number | null)[][];
  merges: string[];
  cols: (number | null)[];
  at: number;
}

interface MonthMirror {
  sheets: Record<string, MirroredSheet>;
  updatedAt: number;
}

function monthKey(monthId: string): string {
  return `${KEY_PREFIX}:${monthId}`;
}

function readMonth(monthId: string): MonthMirror {
  try {
    const raw = store.getItem(monthKey(monthId));
    if (!raw) return { sheets: {}, updatedAt: 0 };
    const parsed = JSON.parse(raw) as MonthMirror;
    if (!parsed || typeof parsed !== 'object' || !parsed.sheets || typeof parsed.sheets !== 'object') {
      return { sheets: {}, updatedAt: 0 };
    }
    return parsed;
  } catch {
    return { sheets: {}, updatedAt: 0 };
  }
}

function writeMonth(monthId: string, mirror: MonthMirror) {
  store.setItem(monthKey(monthId), JSON.stringify(mirror));
  pruneOldMonths(monthId);
}

// Sirf recent MAX_MONTHS months ki mirror rakho (purane = Firestore par already safe)
function pruneOldMonths(currentMonthId: string) {
  try {
    const all = mirrorListMonths().filter((m) => m !== currentMonthId);
    const sorted = all.sort((a, b) => b.localeCompare(a)); // "YYYY-MM" lexicographic = chronological
    for (const old of sorted.slice(MAX_MONTHS - 1)) {
      store.removeItem(monthKey(old));
    }
  } catch {
    // ignore
  }
}

// ---- sheet mirror ----

export function mirrorGetSheet(monthId: string, sheetName: string): MirroredSheet | null {
  const m = readMonth(monthId);
  const s = m.sheets[sheetName];
  if (!s || !Array.isArray(s.grid)) return null;
  return s;
}

export function mirrorSetSheet(
  monthId: string,
  sheetName: string,
  data: { grid: (string | number | null)[][]; merges: string[]; cols: (number | null)[] }
) {
  const m = readMonth(monthId);
  m.sheets[sheetName] = { grid: data.grid, merges: data.merges || [], cols: data.cols || [], at: Date.now() };
  m.updatedAt = Date.now();
  writeMonth(monthId, m);
}

// ---- month doc mirror (synthetic month create hua tha ya nahi, yaad rakhta hai) ----

export interface MirroredMonthDoc {
  label: string;
  sheetNames: string[];
  at: number;
}

export function mirrorGetMonthDoc(monthId: string): MirroredMonthDoc | null {
  try {
    const raw = store.getItem(`${MONTH_KEY_PREFIX}:${monthId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MirroredMonthDoc;
    if (!parsed || typeof parsed.label !== 'string' || !Array.isArray(parsed.sheetNames)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mirrorSetMonthDoc(monthId: string, doc: { label: string; sheetNames: string[] }) {
  store.setItem(`${MONTH_KEY_PREFIX}:${monthId}`, JSON.stringify({ ...doc, at: Date.now() }));
}

export function mirrorListMonths(): string[] {
  const out: string[] = [];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(KEY_PREFIX + ':')) out.push(k.slice(KEY_PREFIX.length + 1));
      }
    } else {
      const g = globalThis as { __HM_STORE__?: Record<string, string> };
      if (g.__HM_STORE__) {
        for (const k of Object.keys(g.__HM_STORE__)) {
          if (k.startsWith(KEY_PREFIX + ':')) out.push(k.slice(KEY_PREFIX.length + 1));
        }
      }
    }
  } catch {
    // ignore
  }
  return out;
}

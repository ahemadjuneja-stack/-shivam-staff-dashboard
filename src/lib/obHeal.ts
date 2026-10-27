// ============================================================
// OUTBOX SELF-HEAL (Task 95, Boss complaint 2026-10-28: "Dashboard me har
// screen par ye kyo aa raha hai ke net nahi data ruka hua hai sync pending?")
//
// ROOT CAUSE (code-trace): outbox journal me agar koi write PERMANENT fail
// hota hai (invalid payload — undefined/NaN field, rules deny) to wo entry
// FIFO flush engine me HAMESHA ke liye phas jati thi:
//   - obSet() catch sab kuch silently karta tha -> journal entry kabhi clear
//     nahi hoti
//   - flushOutbox() har failure par `break` (FIFO order preserve) -> ek
//     mara-hua entry PURI QUEUE block kar deta hai -> "SYNC PENDING — 1
//     write(s)" HAR SCREEN par hamesha dikhta rehta hai
//
// ILAAJ (3 layers):
//   1. SANITIZE at write-time — undefined/NaN/Infinity fields payload se
//      nikal do (Firestore invalid-argument ka #1 source) — naye stuck
//      writes hi na bane
//   2. CLASSIFY + RETRY — flush me failure par error classify: PERMANENT
//      (invalid-argument / permission-denied / failed-precondition) par
//      ek baar SANITIZED retry; phir bhi fail = entry QUARANTINE (dead
//      mark) aur FIFO AGLE entries par aage badhta hai — queue kabhi
//      block nahi
//   3. TRANSIENT (timeout/unavailable/net) = pehle jaisa FIFO break —
//      order preserve, net aane par dobara
//
// Pure functions — node-testable (scripts/test_obHeal.ts).
// ============================================================

/** Firestore error ka code nikalo (FirebaseError.code jaise
 *  'firestore/permission-denied' ya 'permission-denied', warna message) */
export function errCodeOf(e: unknown): string {
  if (!e) return '';
  const anyE = e as { code?: unknown; message?: unknown };
  if (typeof anyE.code === 'string' && anyE.code) return anyE.code;
  if (typeof anyE.message === 'string') return anyE.message;
  return String(e);
}

/**
 * Write error PERMANENT hai ya TRANSIENT?
 * - PERMANENT (dead): retry karne se kabhi nahi hoga — invalid payload,
 *   rules deny, precondition fail. Sanitize-retry se theek ho sakta hai
 *   (undefined/NaN fields), warna quarantine.
 * - TRANSIENT: net/timeout — FIFO break + baad me replay (purana behavior).
 */
export function classifyWriteErr(e: unknown): 'dead' | 'transient' {
  const s = errCodeOf(e).toLowerCase();
  if (s.includes('permission-denied')) return 'dead';
  if (s.includes('invalid-argument')) return 'dead';
  if (s.includes('failed-precondition')) return 'dead';
  if (s.includes('unimplemented')) return 'dead';
  // message-based fallback (FirebaseError.code na mile to):
  if (/unsupported field value|invalid (document|field|argument)|not a valid|cannot write/.test(s)) return 'dead';
  // timeout/unavailable/network/internal/unknown... = transient (retry-able)
  return 'transient';
}

/**
 * Deep-sanitize payload: undefined wali keys DROP, NaN/Infinity -> 0 (money/
 * counter context — 0 hi safe hai), arrays me bad holes drop, nested objects
 * recurse. Firestore invalid-argument ka ilaaj write-time par hi.
 * (JSON.parse(JSON.stringify(x)) bhi undefined kaata tha par NaN -> null
 * banata tha aur Date objects ko string — ye targeted aur kam destructive.)
 */
export function sanitizeOutboxPayload<T>(p: T): T {
  if (p === null || p === undefined) return p;
  if (Array.isArray(p)) {
    const out: unknown[] = [];
    for (const it of p) {
      if (it === undefined) continue;            // bad array item drop
      if (typeof it === 'number' && !Number.isFinite(it)) { out.push(0); continue; }
      out.push(sanitizeOutboxPayload(it));
    }
    return out as unknown as T;
  }
  if (typeof p === 'object') {
    // Date object Firestore SDK khud handle karta hai — touch mat karo
    if (p instanceof Date) return p;
    const src = p as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v === undefined) continue;             // undefined key drop (Firestore mana)
      if (typeof v === 'number' && !Number.isFinite(v)) { out[k] = 0; continue; } // NaN/Inf -> 0 (money shape preserve)
      out[k] = sanitizeOutboxPayload(v);
    }
    return out as unknown as T;
  }
  if (typeof p === 'number' && (Number.isNaN(p) || !Number.isFinite(p))) return 0 as unknown as T;
  return p;
}

/** dead-entry ka short reason (banner me dikhane ke liye) */
export function shortErrReason(e: unknown): string {
  const s = errCodeOf(e) || 'unknown';
  const one = s.split('\n')[0].slice(0, 120);
  if (one.includes('permission-denied')) return 'Firestore rules ne mana kiya';
  if (one.includes('invalid-argument') || /unsupported field/i.test(one)) return 'Data format issue (auto-clean fail)';
  if (one.includes('failed-precondition')) return 'Firestore precondition fail';
  return one || 'unknown';
}

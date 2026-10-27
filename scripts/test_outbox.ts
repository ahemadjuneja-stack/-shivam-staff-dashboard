// OUTBOX JOURNAL TESTS (Task 69 — offline-first data safety)
// Run: npx tsx scripts/test_outbox.ts
import {
  OutboxEntry, journalPush, journalRemove, journalPending,
  readJournal, journalClear, newOpId, markSynced, lastSyncAt
} from '../src/lib/obJournal';

// localStorage shim (node env) — obJournal globalThis.__OB_STORE__ use karta hai
(globalThis as { __OB_STORE__?: Record<string, string> }).__OB_STORE__ = {};

let pass = 0, fail = 0;
const T = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
};

console.log('=== OUTBOX JOURNAL TESTS ===');
journalClear();

// 1. empty journal
T('empty journal = 0 pending', journalPending() === 0 && readJournal().length === 0);

// 2. push single entry
const e1: OutboxEntry = { opId: 'ob-1', col: 'hisab', docId: 'cb-2026-10-27', payload: { entries: [1], opId: 'ob-1' }, merge: true, at: Date.now(), tries: 0 };
journalPush(e1);
T('push 1 -> pending 1', journalPending() === 1);
T('readback matches payload', readJournal()[0].payload?.entries !== undefined);

// 3. FIFO order
const e2: OutboxEntry = { opId: 'ob-2', col: 'hisab', docId: 'cb-audit-x', payload: { opId: 'ob-2' }, merge: true, at: Date.now() + 1, tries: 0 };
const e3: OutboxEntry = { opId: 'obd-3', col: 'hisab', docId: 'th-123', merge: false, at: Date.now() + 2, tries: 0 }; // delete op (no payload)
journalPush(e2); journalPush(e3);
const l3 = readJournal();
T('FIFO order preserved', l3[0].opId === 'ob-1' && l3[1].opId === 'ob-2' && l3[2].opId === 'obd-3');
T('delete op (no payload) stored', l3[2].payload === undefined);

// 4. dedupe same opId (replay-safe push)
const e1b: OutboxEntry = { ...e1, payload: { entries: [1, 2], opId: 'ob-1' } };
journalPush(e1b);
T('same opId overwrite (no dup)', journalPending() === 3);
T('overwritten payload wins', (readJournal().find((x) => x.opId === 'ob-1')?.payload?.entries as unknown[] | undefined)?.length === 2);

// 5. remove
journalRemove('ob-2');
T('remove -> pending 2', journalPending() === 2);
journalRemove('never-existed');
T('remove unknown = no-op', journalPending() === 2);

// 6. clear
journalClear();
T('clear -> 0 pending', journalPending() === 0);

// 7. corrupt JSON recovery
(globalThis as { __OB_STORE__?: Record<string, string> }).__OB_STORE__!['shivam_dash_outbox_v1'] = '{corrupt{{';
T('corrupt journal -> safe empty', readJournal().length === 0 && journalPending() === 0);
journalClear();

// 8. malformed entries filtered
(globalThis as { __OB_STORE__?: Record<string, string> }).__OB_STORE__!['shivam_dash_outbox_v1'] = JSON.stringify([
  { garbage: true }, null, { opId: 'ok-1', col: 'hisab', docId: 'cb-x', merge: true, at: 1, tries: 0 }
]);
T('malformed entries filtered out', readJournal().length === 1 && readJournal()[0].opId === 'ok-1');
journalClear();

// 9. opId uniqueness
const ids = new Set(Array.from({ length: 200 }, () => newOpId()));
T('200 opIds all unique', ids.size === 200);

// 10. lastSync markers
T('lastSyncAt default 0', lastSyncAt() === 0);
markSynced(1698340000000);
T('markSynced -> readback', lastSyncAt() === 1698340000000);

console.log(`\n=== ${pass}/${pass + fail} PASS ===`);
if (fail > 0) process.exit(1);

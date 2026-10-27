import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import {
  Wallet, Plus, Trash2, Lock, Unlock, Download, ChevronLeft, ChevronRight,
  Calculator, Package, BellRing, ScrollText, CheckCircle2, AlertTriangle,
  X, Landmark, ShoppingBag, Receipt, Banknote, CalendarDays
} from 'lucide-react';
import { db, auth } from '../firebase';
import { obSet, OutboxBanner } from '../lib/outbox';
import {
  CbDay, CbEntry, CbEntryType, CbSettings, CbAuditRec, CbParcelMode, CbCategory, CbUdhariMode
} from '../types';
import { fmtChart, parseChartInput, todayStr, shiftDateStr, shortDate, paiseToChart } from '../lib/cbMoney';
import * as XLSX from 'xlsx-js-style';

// ============================================================
// COUNTER BOOK — chart ka digital roop (Task 67)
// NOTATION: CHART /10 system. 200 = Rs.2000, 345.6 = Rs.3456.
// Storage: integer paise. Display: paise/1000 (max 1 decimal).
// Salesman/Tour Hisab alag system hai (real rupees) — yahan
// kahin bhi real-rupee display NAHI (sirf ek help chip).
// ============================================================

const who = () => auth.currentUser?.email?.split('@')[0] || 'manager';
const dayId = (date: string) => 'cb-' + date;
const SETTINGS_ID = 'cb-settings';
const DEPTS: { id: 1 | 2; name: string; sub: string; cls: string; ring: string; text: string }[] = [
  { id: 1, name: 'Dept 1 — Cosmetic', sub: 'CO', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', ring: 'ring-emerald-500/40', text: 'text-emerald-400' },
  { id: 2, name: 'Dept 2 — Imitation', sub: 'IM', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-400', ring: 'ring-sky-500/40', text: 'text-sky-400' }
];
const EXPENSE_HEADS = ['Tea / Snacks', 'Auto / Tempo', 'Phone / Recharge', 'Labour / Packing', 'Tea Stall', 'Market Work', 'Other'];
const PARCEL_MODES: CbParcelMode[] = ['In Hand', 'Transport', 'Courier', 'Other Party', 'Riksha'];

interface Totals {
  saleP: number; recvP: number; depP: number; expnP: number; counterP: number;
}

function dayTotals(day: CbDay, dept: 1 | 2): Totals {
  let saleP = 0, recvP = 0, depP = 0, expnP = 0;
  for (const e of day.entries || []) {
    if (e.dept !== dept) continue;
    if (e.type === 'cashSale') saleP += e.amtP;
    else if (e.type === 'udhari' && e.mode === 'Cash') recvP += e.amtP;
    else if (e.type === 'deposit') depP += e.amtP;
    else if (e.type === 'expense') expnP += e.amtP;
  }
  return { saleP, recvP, depP, expnP, counterP: (dept === 1 ? day.carryP1 : day.carryP2) + saleP + recvP - depP - expnP };
}

const num10 = (p: number) => Math.round((p / 1000) * 10) / 10; // chart number for Excel cells
const tTime = (at: number) => new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function CounterBookScreen() {
  const [date, setDate] = useState<string>(todayStr());
  const [day, setDay] = useState<CbDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<CbSettings | null>(null);
  const [view, setView] = useState<'counter' | 'parcel' | 'haste' | 'audit'>('counter');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [audit, setAudit] = useState<CbAuditRec[]>([]);
  const [form, setForm] = useState<{ type: CbEntryType; dept: 1 | 2 } | null>(null);
  const [showClose, setShowClose] = useState(false);
  const ensuring = useRef<string>('');

  const say = (t: 'ok' | 'err', m: string) => {
    setMsg({ t, m });
    setTimeout(() => setMsg((p) => (p?.m === m ? null : p)), 4000);
  };

  // ---- settings (create defaults on first ever use — fresh start 2000+2000) ----
  // OFFLINE-SAFE (Boss order 2026-10-27): net na ho to LOCAL defaults se kaam
  // (koi blind write nahi — server settings overwrite risk ZERO). First-ever
  // create sirf jab getDoc ne positively bataya ki doc hi nahi hai.
  useEffect(() => {
    (async () => {
      try {
        const ref = doc(db, 'hisab', SETTINGS_ID);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setSettings(snap.data() as CbSettings);
        } else {
          const def: CbSettings = { kind: 'cb-settings', openingP1: 200000, openingP2: 200000, minCounterP: 200000 };
          await obSet('hisab', SETTINGS_ID, { ...def }, { merge: true, opId: 'cb-settings-init' });
          await logAudit('settings', 'Counter Book first-time init: opening 200 + 200 (chart), min counter 200');
          setSettings(def);
        }
      } catch {
        // OFFLINE: getDoc unavailable — LOCAL defaults (deterministic 200+200),
        // write skip (overwrite-safe). Net aane par reload par sync ho jayega.
        setSettings({ kind: 'cb-settings', openingP1: 200000, openingP2: 200000, minCounterP: 200000 });
      }
    })();
  }, []);

  const logAudit = async (action: CbAuditRec['action'], detail: string) => {
    try {
      const rec: CbAuditRec = { kind: 'cb-audit', at: Date.now(), by: who(), action, detail };
      await obSet('hisab', `cb-audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, { ...rec });
    } catch { /* audit is best-effort; never block money ops */ }
  };

  const loadAudit = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'hisab'), where('kind', '==', 'cb-audit')));
      const list: CbAuditRec[] = [];
      snap.forEach((d) => list.push(d.data() as CbAuditRec));
      list.sort((a, b) => b.at - a.at);
      setAudit(list.slice(0, 60));
    } catch { setAudit([]); }
  };

  useEffect(() => { if (view === 'audit') loadAudit(); }, [view]);

  // ---- load (or lazily create) the day doc ----
  // OFFLINE-SAFE: getDoc unavailable (never-cached doc + net off) -> null ->
  // create flow chalta hai (cached day-list se carry, warna opening defaults).
  // Day doc create deterministic id (cb-YYYY-MM-DD) + opId = replay-safe.
  const loadDay = async (d: string) => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'hisab', dayId(d))).catch(() => null); // offline/unavailable = null
      if (snap && snap.exists()) { setDay(snap.data() as CbDay); setLoading(false); return; }
      // create with carry from last locked day (or fresh opening)
      if (ensuring.current === d) return;
      ensuring.current = d;
      let set = settings;
      if (!set) {
        const sSnap = await getDoc(doc(db, 'hisab', SETTINGS_ID));
        set = sSnap.exists() ? (sSnap.data() as CbSettings) : { kind: 'cb-settings', openingP1: 200000, openingP2: 200000, minCounterP: 200000 };
      }
      let carryP1 = set.openingP1, carryP2 = set.openingP2;
      let note = `Fresh start — opening ${fmtChart(set.openingP1)} + ${fmtChart(set.openingP2)} (chart)`;
      try {
        const all = await getDocs(query(collection(db, 'hisab'), where('kind', '==', 'cb-day')));
        const locked: CbDay[] = [];
        all.forEach((x) => { const v = x.data() as CbDay; if (v.date < d && v.status === 'locked') locked.push(v); });
        locked.sort((a, b) => b.date.localeCompare(a.date));
        const prev = locked[0];
        if (prev) {
          const ct = prev.closeTotals;
          carryP1 = ct?.nextCarryP1 ?? dayTotals(prev, 1).counterP;
          carryP2 = ct?.nextCarryP2 ?? dayTotals(prev, 2).counterP;
          note = `Carried from ${shortDate(prev.date)} close`;
        }
      } catch { /* fall back to opening */ }
      const fresh: CbDay = { kind: 'cb-day', date: d, status: 'open', carryP1, carryP2, carryNote: note, entries: [], createdAt: Date.now() };
      await obSet('hisab', dayId(d), { ...fresh }, { merge: true, opId: `cb-day-create-${d}` });
      setDay(fresh);
    } catch (e) {
      say('err', 'Load failed: ' + (e as Error).message);
    } finally {
      ensuring.current = '';
      setLoading(false);
    }
  };

  useEffect(() => { loadDay(date); /* eslint-disable-next-line */ }, [date, settings]);

  // ---- derived totals ----
  const t1 = useMemo(() => (day ? dayTotals(day, 1) : null), [day]);
  const t2 = useMemo(() => (day ? dayTotals(day, 2) : null), [day]);
  const locked = day?.status === 'locked';
  const minP = settings?.minCounterP ?? 200000;

  // ---- mutations ----
  const addEntry = async (e: CbEntry) => {
    if (!day || locked) return say('err', 'Day is locked — unlock first');
    if ((day.entries?.length || 0) >= 400) return say('err', 'Entry limit reached for this day');
    // 2000-minimum rule on office deposit (chart 200)
    if (e.type === 'deposit') {
      const t = e.dept === 1 ? t1 : t2;
      if (t && t.counterP - e.amtP < minP) {
        return say('err', `Office deposit blocked — counter would fall below ${fmtChart(minP)} (chart). Deposit less.`);
      }
    }
    try {
      // OUTBOX journal-first (offline-safe) — entries field merge, local view
      // turant update (Firestore SDK offline mutations cache me reflect hote hai)
      await obSet('hisab', dayId(date), { entries: [...(day.entries || []), e] });
      const label = e.type === 'cashSale' ? 'cash sale' : e.type === 'udhari' ? `udhari ${e.mode} ${e.name || ''}` : e.type === 'deposit' ? 'office deposit' : e.type === 'expense' ? `expense ${e.head || ''}` : e.type === 'parcel' ? `parcel ${e.mode} ${e.name || ''}` : `haste ${e.name || ''}`;
      await logAudit('add', `D${e.dept} ${label} ${fmtChart(e.amtP)} (${date})`);
      setForm(null);
      say('ok', 'Entry added' + (navigator.onLine ? '' : ' (offline — net aane par sync)'));
      await loadDay(date);
    } catch (err) { say('err', 'Save failed: ' + (err as Error).message); }
  };

  const delEntry = async (id: string) => {
    if (!day || locked) return;
    const e = (day.entries || []).find((x) => x.id === id);
    if (!e) return;
    if (e.type === 'deposit' && !window.confirm('Delete this office deposit entry?')) return;
    try {
      await obSet('hisab', dayId(date), { entries: (day.entries || []).filter((x) => x.id !== id) });
      await logAudit('delete', `D${e.dept} ${e.type} ${fmtChart(e.amtP)} removed (${date})`);
      say('ok', 'Entry removed');
      await loadDay(date);
    } catch (err) { say('err', 'Delete failed: ' + (err as Error).message); }
  };

  const toggleStatus = async (id: string) => {
    if (!day || locked) return;
    const entries = (day.entries || []).map((x) => (x.id === id ? { ...x, status: x.status === 'done' ? 'pending' : 'done' } : x));
    try {
      await obSet('hisab', dayId(date), { entries });
      await loadDay(date);
    } catch (err) { say('err', 'Update failed: ' + (err as Error).message); }
  };

  const lockDay = async (g1P: number | null, g2P: number | null) => {
    if (!day || !t1 || !t2) return;
    const ct = {
      exp1P: t1.counterP, exp2P: t2.counterP,
      sale1P: t1.saleP, sale2P: t2.saleP, recv1P: t1.recvP, recv2P: t2.recvP,
      dep1P: t1.depP, dep2P: t2.depP, expn1P: t1.expnP, expn2P: t2.expnP,
      nextCarryP1: g1P ?? t1.counterP, nextCarryP2: g2P ?? t2.counterP,
      d1DiffP: g1P === null ? 0 : g1P - t1.counterP, d2DiffP: g2P === null ? 0 : g2P - t2.counterP
    };
    try {
      await obSet('hisab', dayId(date), {
        status: 'locked', lockedAt: Date.now(), lockedBy: who(),
        closeTotals: ct,
        ...(g1P !== null || g2P !== null ? { gini: { d1P: g1P ?? t1.counterP, d2P: g2P ?? t2.counterP, at: Date.now(), by: who() } } : {})
      });
      await logAudit('lock', `Day ${date} locked. Expected ${fmtChart(t1.counterP)}/${fmtChart(t2.counterP)}, next carry ${fmtChart(ct.nextCarryP1)}/${fmtChart(ct.nextCarryP2)}`);
      say('ok', 'Day closed & locked — carry-forward set' + (navigator.onLine ? '' : ' (offline — net aane par sync)'));
      setShowClose(false);
      await loadDay(date);
    } catch (err) { say('err', 'Lock failed: ' + (err as Error).message); }
  };

  const unlockDay = async () => {
    if (!day) return;
    if (!window.confirm('Unlock this day? Entries will be editable again (recorded in audit log).')) return;
    try {
      await obSet('hisab', dayId(date), { status: 'open', lockedAt: null, lockedBy: null });
      await logAudit('unlock', `Day ${date} UNLOCKED by ${who()}`);
      say('ok', 'Day unlocked');
      await loadDay(date);
    } catch (err) { say('err', 'Unlock failed: ' + (err as Error).message); }
  };

  // ---- month backup (CHART notation — pure /10, boss ka chart mirror) ----
  const backupMonth = async () => {
    try {
      const month = date.slice(0, 7);
      const snap = await getDocs(query(collection(db, 'hisab'), where('kind', '==', 'cb-day')));
      const days: CbDay[] = [];
      snap.forEach((x) => { const v = x.data() as CbDay; if (v.date?.startsWith(month)) days.push(v); });
      if (!days.length) return say('err', 'No data for ' + month);
      days.sort((a, b) => a.date.localeCompare(b.date));
      const wb = XLSX.utils.book_new();
      const hasteRows: (string | number)[][] = [['DATE', 'HASTE', 'CITY', 'PARTY', 'AMOUNT (CHART)', 'VAYDA DATE', 'STATUS']];
      const parcelRows: (string | number)[][] = [['DATE', 'MODE', 'DEPT', 'CITY', 'PARTY', 'CO/IM/HG', 'BILL IN', 'BILL AMT (CHART)', 'STATUS']];
      for (const d of days) {
        const dd = Number(d.date.slice(8, 10));
        const rows: (string | number)[][] = [[`DAY ${dd} — ${d.date} (${d.status.toUpperCase()})`, '', '', '', '', '', '']];
        rows.push(['TIME', 'TYPE', 'DEPT', 'NAME/PARTY', 'BILL NO', 'MODE/HEAD', 'AMOUNT (CHART)', 'BY']);
        let s1 = 0, r1 = 0, dp1 = 0, ex1 = 0, s2 = 0, r2 = 0, dp2 = 0, ex2 = 0;
        for (const e of d.entries || []) {
          const T = dayTotals; void T;
          if (e.type === 'cashSale') { if (e.dept === 1) s1 += e.amtP; else s2 += e.amtP; }
          if (e.type === 'udhari' && e.mode === 'Cash') { if (e.dept === 1) r1 += e.amtP; else r2 += e.amtP; }
          if (e.type === 'deposit') { if (e.dept === 1) dp1 += e.amtP; else dp2 += e.amtP; }
          if (e.type === 'expense') { if (e.dept === 1) ex1 += e.amtP; else ex2 += e.amtP; }
          if (e.type === 'haste') { hasteRows.push([d.date, e.name || '', e.city || '', e.party || '', num10(e.amtP), e.vaydaDate || '', (e.status || 'pending').toUpperCase()]); continue; }
          if (e.type === 'parcel') { parcelRows.push([d.date, e.mode || '', 'D' + e.dept, e.city || '', e.name || '', e.cat || '', e.billNo || '', num10(e.amtP), (e.status || 'pending').toUpperCase()]); continue; }
          rows.push([tTime(e.at), e.type.toUpperCase(), 'D' + e.dept, e.name || e.party || '', e.billNo || '', e.mode || e.head || '', num10(e.amtP), e.by]);
        }
        const c1 = dayTotals(d, 1), c2 = dayTotals(d, 2);
        rows.push([]);
        rows.push(['TOTALS (CHART)', 'D1: Sale', num10(s1), 'Recv', num10(r1), 'Deposit', num10(dp1), 'Expense', num10(ex1), 'CLOSE', num10(c1.counterP)]);
        rows.push(['', 'D2: Sale', num10(s2), 'Recv', num10(r2), 'Deposit', num10(dp2), 'Expense', num10(ex2), 'CLOSE', num10(c2.counterP)]);
        if (d.gini) rows.push(['GINI COUNTED', 'D1', num10(d.gini.d1P), 'D2', num10(d.gini.d2P), 'BY', d.gini.by]);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, String(dd));
      }
      const sumRows: (string | number)[][] = [['DATE', 'D1 OPEN', 'D1 SALE', 'D1 RECV', 'D1 DEP', 'D1 EXP', 'D1 CLOSE', 'D2 OPEN', 'D2 SALE', 'D2 RECV', 'D2 DEP', 'D2 EXP', 'D2 CLOSE']];
      for (const d of days) {
        const c1 = dayTotals(d, 1), c2 = dayTotals(d, 2);
        sumRows.push([d.date, num10(d.carryP1), num10(c1.saleP), num10(c1.recvP), num10(c1.depP), num10(c1.expnP), num10(c1.counterP), num10(d.carryP2), num10(c2.saleP), num10(c2.recvP), num10(c2.depP), num10(c2.expnP), num10(c2.counterP)]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hasteRows), 'Haste');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(parcelRows), 'Parcel');
      XLSX.writeFile(wb, `CounterBook-${month}.xlsx`);
      say('ok', `Backup downloaded (${days.length} days, chart notation)`);
    } catch (err) { say('err', 'Backup failed: ' + (err as Error).message); }
  };

  // ================= render =================
  return (
    <div className="space-y-5">
      <OutboxBanner />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-white">
            <Wallet className="h-5 w-5 text-indigo-400" /> COUNTER BOOK
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-400">CHART /10 NOTATION</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">Chart system: 200 = ₹2,000 · 345.6 = ₹3,456 (1 unit = ₹10). Salesman hisab alag system — yahan mix nahi hota.</p>
        </div>
        <button onClick={backupMonth} className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20">
          <Download className="h-4 w-4" /> Month XL Backup
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-semibold ${msg.t === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
          {msg.m}
        </div>
      )}

      {/* Date nav */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3">
        <button onClick={() => setDate((d) => shiftDateStr(d, -1))} className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700"><ChevronLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5">
          <CalendarDays className="h-4 w-4 text-indigo-400" />
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent text-sm font-bold text-white focus:outline-none" />
        </div>
        <button onClick={() => setDate((d) => shiftDateStr(d, 1))} className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700"><ChevronRight className="h-4 w-4" /></button>
        <button onClick={() => setDate(todayStr())} className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20">Today</button>
        {day && (
          <span className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${locked ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}`}>
            {locked ? <Lock className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {locked ? 'LOCKED — CLOSED' : 'OPEN'}
          </span>
        )}
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          ['counter', 'Cash Counter', <Calculator key="i" className="h-4 w-4" />],
          ['parcel', 'Parcel Register', <Package key="i" className="h-4 w-4" />],
          ['haste', 'Haste & Reminder', <BellRing key="i" className="h-4 w-4" />],
          ['audit', 'Audit Log', <ScrollText key="i" className="h-4 w-4" />]
        ] as [typeof view, string, React.ReactNode][]).map(([v, label, icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition ${view === v ? 'border-indigo-500 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
            {icon} {label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {locked ? (
            <button onClick={unlockDay} className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20"><Unlock className="h-4 w-4" /> Unlock Day</button>
          ) : (
            <button onClick={() => setShowClose(true)} disabled={!day} className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500 disabled:opacity-40"><Lock className="h-4 w-4" /> Day Close & Lock</button>
          )}
        </div>
      </div>

      {loading && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-xs font-bold text-slate-500">Loading day book...</div>}

      {/* ============ CASH COUNTER VIEW ============ */}
      {!loading && day && t1 && t2 && view === 'counter' && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {DEPTS.map((D) => {
              const t = D.id === 1 ? t1 : t2;
              const list = (day.entries || []).filter((e) => e.dept === D.id && e.type !== 'parcel' && e.type !== 'haste').sort((a, b) => b.at - a.at);
              return (
                <div key={D.id} className={`rounded-2xl border bg-slate-900 p-4 ${D.id === 1 ? 'border-emerald-500/20' : 'border-sky-500/20'}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className={`rounded-lg border px-3 py-1 text-xs font-black ${D.cls}`}>{D.name}</span>
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">MIN {fmtChart(minP)}</span>
                  </div>
                  {/* LIVE COUNTER — chart units */}
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Cash In Hand (Chart)</p>
                    <p className={`mt-1 text-4xl font-black tabular-nums ${t.counterP < minP ? 'text-rose-400' : 'text-white'}`}>{fmtChart(t.counterP)}</p>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">open {fmtChart(D.id === 1 ? day.carryP1 : day.carryP2)} · sale {fmtChart(t.saleP)} · recv {fmtChart(t.recvP)} · dep −{fmtChart(t.depP)} · exp −{fmtChart(t.expnP)}</p>
                  </div>
                  {/* actions */}
                  {!locked && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={() => setForm({ type: 'cashSale', dept: D.id })} className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"><Plus className="h-4 w-4" /> Cash Sale</button>
                      <button onClick={() => setForm({ type: 'udhari', dept: D.id })} className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"><Receipt className="h-4 w-4" /> Udhari Receipt</button>
                      <button onClick={() => setForm({ type: 'deposit', dept: D.id })} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white hover:bg-amber-500"><Landmark className="h-4 w-4" /> Office Deposit</button>
                      <button onClick={() => setForm({ type: 'expense', dept: D.id })} className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white hover:bg-rose-500"><Banknote className="h-4 w-4" /> Expense</button>
                    </div>
                  )}
                  {/* entries */}
                  <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {list.length === 0 && <p className="py-4 text-center text-xs text-slate-600">No entries yet</p>}
                    {list.map((e) => (
                      <div key={e.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${e.type === 'cashSale' ? 'bg-emerald-500/15 text-emerald-400' : e.type === 'udhari' ? 'bg-indigo-500/15 text-indigo-300' : e.type === 'deposit' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-300'}`}>
                          {e.type === 'cashSale' ? 'SALE' : e.type === 'udhari' ? 'UDHARI' : e.type === 'deposit' ? 'DEPOSIT' : 'EXPENSE'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-white">{e.name || e.head || '—'}{e.billNo ? ` · ${e.billNo}` : ''}</p>
                          <p className="text-[10px] text-slate-500">{tTime(e.at)} · {e.by}{e.type === 'udhari' ? ` · ${e.mode}` : ''}</p>
                        </div>
                        <span className={`text-sm font-black tabular-nums ${e.type === 'deposit' || e.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {e.type === 'deposit' || e.type === 'expense' ? '−' : '+'}{fmtChart(e.amtP)}
                        </span>
                        {!locked && <button onClick={() => delEntry(e.id)} className="text-slate-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {day.carryNote && <p className="text-center text-[11px] font-semibold text-slate-500">{day.carryNote}</p>}
        </>
      )}

      {/* ============ PARCEL REGISTER ============ */}
      {!loading && day && view === 'parcel' && (
        <ParcelView day={day} locked={locked} onAdd={() => setForm({ type: 'parcel', dept: 1 })} onToggle={toggleStatus} onDelete={delEntry} />
      )}

      {/* ============ HASTE & REMINDER ============ */}
      {!loading && day && view === 'haste' && (
        <HasteView day={day} locked={locked} onAdd={() => setForm({ type: 'haste', dept: 1 })} onToggle={toggleStatus} onDelete={delEntry} />
      )}

      {/* ============ AUDIT LOG ============ */}
      {view === 'audit' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">Audit Log (append-only)</h3>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {audit.length === 0 && <p className="py-4 text-center text-xs text-slate-600">No audit records</p>}
            {audit.map((a, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${a.action === 'lock' ? 'bg-rose-500/15 text-rose-300' : a.action === 'unlock' ? 'bg-amber-500/15 text-amber-400' : a.action === 'add' ? 'bg-emerald-500/15 text-emerald-400' : a.action === 'delete' ? 'bg-rose-500/15 text-rose-400' : 'bg-slate-700 text-slate-300'}`}>{a.action.toUpperCase()}</span>
                <span className="flex-1 text-xs text-slate-300">{a.detail}</span>
                <span className="text-[10px] text-slate-500">{new Date(a.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {a.by}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ ENTRY MODAL ============ */}
      {form && !locked && (
        <EntryModal
          form={form}
          minCounterP={minP}
          counterP={(form.dept === 1 ? t1?.counterP : t2?.counterP) ?? 0}
          onClose={() => setForm(null)}
          onSave={addEntry}
        />
      )}

      {/* ============ DAY CLOSE MODAL ============ */}
      {showClose && day && t1 && t2 && (
        <CloseModal date={date} t1={t1} t2={t2} carryP1={day.carryP1} carryP2={day.carryP2} minP={minP}
          onClose={() => setShowClose(false)} onLock={lockDay} />
      )}
    </div>
  );
}

// ================= PARCEL REGISTER VIEW =================
function ParcelView({ day, locked, onAdd, onToggle, onDelete }: {
  day: CbDay; locked: boolean; onAdd: () => void; onToggle: (id: string) => void; onDelete: (id: string) => void;
}) {
  const list = (day.entries || []).filter((e) => e.type === 'parcel').sort((a, b) => b.at - a.at);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Package className="h-4 w-4 text-purple-400" /> Parcel Register — {shortDate(day.date)}</h3>
        {!locked && <button onClick={onAdd} className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500"><Plus className="h-4 w-4" /> Add Parcel</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-800/60 text-[10px] uppercase text-slate-400">
            <tr><th className="p-2.5">Mode</th><th className="p-2.5">Dept</th><th className="p-2.5">City</th><th className="p-2.5">Party</th><th className="p-2.5">CO/IM/HG</th><th className="p-2.5">Bill In</th><th className="p-2.5 text-right">Bill Amt (Chart)</th><th className="p-2.5">Status</th><th className="p-2.5"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {list.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-slate-600">No parcels today</td></tr>}
            {list.map((e) => (
              <tr key={e.id} className="hover:bg-slate-800/30">
                <td className="p-2.5 font-bold text-white">{e.mode}</td>
                <td className="p-2.5">D{e.dept}</td>
                <td className="p-2.5">{e.city || '—'}</td>
                <td className="p-2.5 font-semibold text-white">{e.name || '—'}</td>
                <td className="p-2.5">{e.cat || '—'}</td>
                <td className="p-2.5">{e.billNo || '—'}</td>
                <td className="p-2.5 text-right font-black tabular-nums text-amber-300">{fmtChart(e.amtP)}</td>
                <td className="p-2.5">
                  <button onClick={() => onToggle(e.id)} disabled={locked}
                    className={`rounded px-2 py-1 text-[10px] font-black ${e.status === 'done' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'} disabled:opacity-50`}>
                    {(e.status || 'pending') === 'done' ? 'DISPATCHED' : 'PENDING'}
                  </button>
                </td>
                <td className="p-2.5">{!locked && <button onClick={() => onDelete(e.id)} className="text-slate-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================= HASTE & REMINDER VIEW =================
function HasteView({ day, locked, onAdd, onToggle, onDelete }: {
  day: CbDay; locked: boolean; onAdd: () => void; onToggle: (id: string) => void; onDelete: (id: string) => void;
}) {
  const today = todayStr();
  const list = (day.entries || []).filter((e) => e.type === 'haste').sort((a, b) => b.at - a.at);
  const overdue = (e: CbEntry) => e.status !== 'done' && !!e.vaydaDate && e.vaydaDate <= today;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><BellRing className="h-4 w-4 text-amber-400" /> Haste & Reminder — {shortDate(day.date)}</h3>
        {!locked && <button onClick={onAdd} className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-500"><Plus className="h-4 w-4" /> Add Haste</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-800/60 text-[10px] uppercase text-slate-400">
            <tr><th className="p-2.5">Haste</th><th className="p-2.5">City</th><th className="p-2.5">Party</th><th className="p-2.5 text-right">Amount (Chart)</th><th className="p-2.5">Vayda Date</th><th className="p-2.5">Note</th><th className="p-2.5">Status</th><th className="p-2.5"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {list.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-600">No haste entries today</td></tr>}
            {list.map((e) => (
              <tr key={e.id} className={`hover:bg-slate-800/30 ${overdue(e) ? 'bg-rose-500/5' : ''}`}>
                <td className="p-2.5 font-bold text-white">{e.name || '—'}</td>
                <td className="p-2.5">{e.city || '—'}</td>
                <td className="p-2.5">{e.party || '—'}</td>
                <td className="p-2.5 text-right font-black tabular-nums text-amber-300">{fmtChart(e.amtP)}</td>
                <td className={`p-2.5 font-semibold ${overdue(e) ? 'text-rose-400' : ''}`}>{e.vaydaDate || '—'}{overdue(e) ? ' ⚠' : ''}</td>
                <td className="p-2.5 text-slate-400">{e.note || '—'}</td>
                <td className="p-2.5">
                  <button onClick={() => onToggle(e.id)} disabled={locked}
                    className={`rounded px-2 py-1 text-[10px] font-black ${e.status === 'done' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-300'} disabled:opacity-50`}>
                    {e.status === 'done' ? 'PAID' : 'PENDING'}
                  </button>
                </td>
                <td className="p-2.5">{!locked && <button onClick={() => onDelete(e.id)} className="text-slate-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">Red = vayda date nikal gayi, payment pending. Full-month list Month XL Backup ke Haste sheet me.</p>
    </div>
  );
}

// ================= ENTRY MODAL =================
function EntryModal({ form, onClose, onSave, minCounterP, counterP }: {
  form: { type: CbEntryType; dept: 1 | 2 };
  onClose: () => void;
  onSave: (e: CbEntry) => void;
  minCounterP: number;
  counterP: number;
}) {
  const isParcel = form.type === 'parcel';
  const isHaste = form.type === 'haste';
  const [dept, setDept] = useState<1 | 2>(form.dept);
  const [amount, setAmount] = useState('');        // chart input
  const [name, setName] = useState('');
  const [billNo, setBillNo] = useState('');
  const [bill, setBill] = useState('');            // udhari bill amt (chart)
  const [less, setLess] = useState('');            // udhari less (chart)
  const [mode, setMode] = useState<string>(form.type === 'udhari' ? 'Cash' : 'In Hand');
  const [head, setHead] = useState(EXPENSE_HEADS[0]);
  const [city, setCity] = useState('');
  const [cat, setCat] = useState<CbCategory>('CO');
  const [vayda, setVayda] = useState('');
  const [party, setParty] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const netPreview = useMemo(() => {
    const b = parseChartInput(bill) ?? 0;
    const l = parseChartInput(less) ?? 0;
    return b - l;
  }, [bill, less]);

  const submit = () => {
    setErr('');
    const amtP = parseChartInput(amount);
    if (isHaste || isParcel || form.type === 'udhari') {
      // non-counter or computed amounts
    } else if (amtP === null || amtP <= 0) { setErr('Amount galat — max 1 decimal (e.g. 345.6)'); return; }
    if (form.type === 'deposit' && amtP !== null && counterP - amtP < minCounterP) {
      setErr(`Counter ${fmtChart(minCounterP)} se kam ho jayega — deposit rok diya`);
      return;
    }
    let finalAmtP = amtP ?? 0;
    if (form.type === 'udhari') {
      if (parseChartInput(bill) === null || parseChartInput(bill)! <= 0) { setErr('Bill amount galat'); return; }
      finalAmtP = netPreview;
      if (finalAmtP < 0) { setErr('Less > Bill nahi ho sakta'); return; }
      if (!name.trim()) { setErr('Party name likho'); return; }
    }
    if ((isHaste) && !name.trim()) { setErr('Haste ka naam likho'); return; }
    if (isParcel && !name.trim()) { setErr('Party likho'); return; }
    const e: CbEntry = {
      id: `e${Date.now()}${Math.floor(Math.random() * 1e4)}`,
      type: form.type, dept,
      amtP: finalAmtP,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(billNo.trim() ? { billNo: billNo.trim() } : {}),
      ...(form.type === 'udhari' ? { billP: parseChartInput(bill)!, lessP: parseChartInput(less) ?? 0, mode: mode as CbUdhariMode } : {}),
      ...(form.type === 'expense' ? { head } : {}),
      ...(isParcel ? { mode, ...(city.trim() ? { city: city.trim() } : {}), cat } : {}),
      ...(isHaste ? { ...(city.trim() ? { city: city.trim() } : {}), ...(party.trim() ? { party: party.trim() } : {}), ...(vayda ? { vaydaDate: vayda } : {}) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      status: isParcel || isHaste ? 'pending' : undefined,
      by: who(), at: Date.now()
    };
    onSave(e);
  };

  const title = form.type === 'cashSale' ? 'Cash Sale' : form.type === 'udhari' ? 'Udhari Receipt' : form.type === 'deposit' ? 'Office Deposit' : form.type === 'expense' ? 'Expense' : form.type === 'parcel' ? 'Parcel Entry' : 'Haste / Reminder';
  const AMT_PH = 'e.g. 345.6  (= Rs.3,456)';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {/* dept toggle */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          {DEPTS.map((D) => (
            <button key={D.id} onClick={() => setDept(D.id)}
              className={`rounded-xl border py-2.5 text-xs font-black transition ${dept === D.id ? `ring-2 ${D.ring} ${D.cls}` : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
              {D.name}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* amount field (all types — haste/parcel = parcel bill amt / haste amount) */}
          <div>
            <label className="text-xs font-semibold text-slate-400">{isHaste ? 'Amount (Chart)' : isParcel ? 'Bill Amount (Chart)' : form.type === 'udhari' ? 'Net Cash/Receipt (auto)' : 'Amount (Chart)'}</label>
            {form.type === 'udhari' ? (
              <input readOnly value={fmtChart(netPreview)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-lg font-black text-indigo-300" />
            ) : (
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={AMT_PH}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-lg font-black tabular-nums text-white focus:border-indigo-500 focus:outline-none" />
            )}
            <p className="mt-1 text-[10px] text-slate-500">Chart notation — max 1 decimal. 200 = ₹2,000 · 345.6 = ₹3,456</p>
          </div>

          {form.type === 'udhari' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400">Bill Amount (Chart)</label>
                  <input inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} placeholder="345.6"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white focus:border-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400">Less (Chart)</label>
                  <input inputMode="decimal" value={less} onChange={(e) => setLess(e.target.value)} placeholder="0"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white focus:border-indigo-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">Mode</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(['Cash', 'Receipt'] as CbUdhariMode[]).map((m) => (
                    <button key={m} onClick={() => setMode(m)}
                      className={`rounded-xl border py-2.5 text-xs font-black ${mode === m ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                      {m}{m === 'Cash' ? ' (counter me aayega)' : ' (bank/UPI — counter nahi)'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {(form.type === 'udhari' || isParcel || isHaste) && (
            <div>
              <label className="text-xs font-semibold text-slate-400">{form.type === 'udhari' ? 'Party Name' : isHaste ? 'Haste (Person)' : 'Party'}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={form.type === 'udhari' ? 'Party / firm name' : isHaste ? 'Person name' : 'Shop / party name'}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white focus:border-indigo-500 focus:outline-none" />
            </div>
          )}

          {form.type === 'udhari' && (
            <div>
              <label className="text-xs font-semibold text-slate-400">Bill No</label>
              <input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. 8894"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white focus:border-indigo-500 focus:outline-none" />
            </div>
          )}

          {form.type === 'expense' && (
            <div>
              <label className="text-xs font-semibold text-slate-400">Head</label>
              <select value={head} onChange={(e) => setHead(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm font-semibold text-white focus:border-indigo-500 focus:outline-none">
                {EXPENSE_HEADS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          )}

          {isParcel && (
            <>
              <div>
                <label className="text-xs font-semibold text-slate-400">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm font-semibold text-white">
                  {PARCEL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400">City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400">CO / IM / HG</label>
                  <select value={cat} onChange={(e) => setCat(e.target.value as CbCategory)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm font-semibold text-white">
                    <option value="CO">CO (Cosmetic)</option><option value="IM">IM (Imitation)</option><option value="HG">HG</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">Bill In No</label>
                <input value={billNo} onChange={(e) => setBillNo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
              </div>
            </>
          )}

          {isHaste && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400">City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400">Party</label>
                  <input value={party} onChange={(e) => setParty(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">Vayda Date (promise date)</label>
                <input type="date" value={vayda} onChange={(e) => setVayda(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">Note</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-semibold text-white" />
              </div>
            </>
          )}
        </div>

        {err && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300">{err}</div>}

        <button onClick={submit} className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-black text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500">
          Save Entry
        </button>
      </div>
    </div>
  );
}

// ================= DAY CLOSE MODAL =================
function CloseModal({ date, t1, t2, carryP1, carryP2, minP, onClose, onLock }: {
  date: string; t1: Totals; t2: Totals; carryP1: number; carryP2: number; minP: number;
  onClose: () => void; onLock: (g1: number | null, g2: number | null) => void;
}) {
  const [g1, setG1] = useState('');
  const [g2, setG2] = useState('');
  const [warn, setWarn] = useState('');

  const p1 = parseChartInput(g1), p2 = parseChartInput(g2);
  const d1 = p1 === null ? null : p1 - t1.counterP;
  const d2 = p2 === null ? null : p2 - t2.counterP;

  const go = () => {
    if ((g1.trim() && p1 === null) || (g2.trim() && p2 === null)) { setWarn('Counted value galat — max 1 decimal'); return; }
    if (g1.trim() && p1 !== null && p1 < minP) { setWarn(`D1 counted ${fmtChart(p1)} — min ${fmtChart(minP)} se kam? Sahi check karo`); return; }
    if (g2.trim() && p2 !== null && p2 < minP) { setWarn(`D2 counted ${fmtChart(p2)} — min ${fmtChart(minP)} se kam? Sahi check karo`); return; }
    setWarn('');
    onLock(g1.trim() ? p1 : null, g2.trim() ? p2 : null);
  };

  const Row = ({ label, v, neg }: { label: string; v: number; neg?: boolean }) => (
    <div className="flex justify-between py-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`font-bold tabular-nums ${neg && v > 0 ? 'text-rose-400' : 'text-slate-200'}`}>{neg ? '−' : ''}{fmtChart(v)}</span>
    </div>
  );

  const Block = ({ D, t, carry, gv, setGv, diff }: { D: typeof DEPTS[0]; t: Totals; carry: number; gv: string; setGv: (s: string) => void; diff: number | null }) => (
    <div className={`rounded-xl border p-3 ${D.id === 1 ? 'border-emerald-500/20' : 'border-sky-500/20'} bg-slate-950`}>
      <p className={`mb-2 text-xs font-black ${D.text}`}>{D.name}</p>
      <Row label="Carry-in" v={carry} />
      <Row label="+ Cash Sale" v={t.saleP} />
      <Row label="+ Udhari (Cash)" v={t.recvP} />
      <Row label="− Office Deposit" v={t.depP} neg />
      <Row label="− Expense" v={t.expnP} neg />
      <div className="my-1.5 border-t border-slate-700"></div>
      <div className="flex justify-between py-1">
        <span className="text-xs font-black text-white">= Expected Counter</span>
        <span className="text-base font-black tabular-nums text-white">{fmtChart(t.counterP)}</span>
      </div>
      <div className="mt-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Physical Count (Gini) — chart</label>
        <input inputMode="decimal" value={gv} onChange={(e) => setGv(e.target.value)} placeholder="gini karke likho (optional)"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-sm font-black tabular-nums text-white focus:border-indigo-500 focus:outline-none" />
        {gv.trim() && diff !== null && (
          <p className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black ${diff === 0 ? 'bg-emerald-500/10 text-emerald-400' : diff < 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {diff === 0 ? '✓ MATCH' : diff < 0 ? `SHORT ${fmtChart(-diff)}` : `EXTRA ${fmtChart(diff)}`}
          </p>
        )}
        {gv.trim() && diff === null && <p className="mt-1 text-[10px] text-rose-400">Invalid number</p>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black text-white"><Lock className="h-4 w-4 text-rose-400" /> Day Close — {shortDate(date)}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Block D={DEPTS[0]} t={t1} carry={carryP1} gv={g1} setGv={setG1} diff={d1} />
          <Block D={DEPTS[1]} t={t2} carry={carryP2} gv={g2} setGv={setG2} diff={d2} />
        </div>
        <p className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-400">
          Lock ke baad din read-only ho jayega. Agla din carry-forward = gini counted (ya expected agar count blank). Lock audit log me record hoga.
        </p>
        {warn && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-300">{warn}</div>}
        <button onClick={go} className="mt-4 w-full rounded-xl bg-rose-600 py-3 text-sm font-black text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500">
          Confirm & Lock Day
        </button>
      </div>
    </div>
  );
}

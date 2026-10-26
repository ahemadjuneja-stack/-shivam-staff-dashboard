import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, Trash2,
  ChevronDown, ChevronRight, Truck, Calculator, X, RefreshCw
} from 'lucide-react';
import { db, auth } from '../firebase';
import { obSet, obDel, OutboxBanner } from '../lib/outbox';
import { ThRoute, ThParty, ThBill, ThUpload } from '../types';
import { fmtRs, parseRsInput, cellToPaise, todayStr } from '../lib/cbMoney';
import * as XLSX from 'xlsx';

// ============================================================
// TOUR HISAB (Task 67) — Miracle XL upload -> salesman settlement
// NOTATION: REAL RUPEES. 3456 = Rs.3456. Counter Book (/10) se
// koi lena-dena nahi — systems alag hain (Boss rule).
// Zero-error: sara calculation code-only integer paise me.
// 3-layer checks: bill balance continuity + party totals +
// route summary. Mismatch = red flag with sheet+row reference.
// ============================================================

const who = () => auth.currentUser?.email?.split('@')[0] || 'manager';
const curMonth = () => todayStr().slice(0, 7);
const rs = (p: number) => Math.round((p / 100) * 100) / 100; // excel real-rupee cell
const rsIn = (v: string): number | null => parseRsInput(v);

// ---------- parse helpers ----------
function dateCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()}`;
  if (typeof v === 'number' && v > 25569 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  }
  return String(v).trim();
}

const RE = {
  route: /^(route|station)\s*[:\-]/i,
  opening: /opening|op\.?\s*bal/i,
  total: /total|total amt/i,
  kharcha: /kharcha|kharca|expense/i,
  aangadiya: /aangadiya|angadiya|aangadiya|mandi|market fee/i,
  skip: /order pad|page \d|generated|report|summary of/i
};

interface ColMap { date: number; no: number; amt: number; rg: number; less: number; recv: number; cash: number; upi: number; cheq: number; bal: number; mode: number }

function scoreHeader(row: unknown[]): ColMap | null {
  const m: ColMap = { date: -1, no: -1, amt: -1, rg: -1, less: -1, recv: -1, cash: -1, upi: -1, cheq: -1, bal: -1, mode: -1 };
  let hits = 0;
  row.forEach((cell, i) => {
    const s = String(cell ?? '').toLowerCase().trim();
    if (!s) return;
    if (m.date < 0 && /date|tarikh/.test(s)) { m.date = i; hits++; }
    else if (m.amt < 0 && /amt|amount/.test(s) && !/total/.test(s)) { m.amt = i; hits++; }
    else if (m.rg < 0 && /r\.?\s?g|return|goods/.test(s)) { m.rg = i; hits++; }
    else if (m.less < 0 && /less|disc/.test(s)) { m.less = i; hits++; }
    else if (m.cash < 0 && /cash/.test(s) && !/total/.test(s)) { m.cash = i; hits++; }
    else if (m.upi < 0 && /upi|online|paytm|phonepe|gpay/.test(s)) { m.upi = i; hits++; }
    else if (m.cheq < 0 && /chq|cheq|check/.test(s)) { m.cheq = i; hits++; }
    else if (m.recv < 0 && /recd|recvd|recv|receiv/.test(s)) { m.recv = i; hits++; }
    else if (m.bal < 0 && /bal/.test(s)) { m.bal = i; hits++; }
    else if (m.mode < 0 && /^mode|mode$|by$/.test(s)) { m.mode = i; hits++; }
    else if (m.no < 0 && /bill|inv|no/.test(s) && !/amt|amount/.test(s)) { m.no = i; hits++; }
  });
  const moneyCols = [m.amt, m.recv, m.cash, m.upi, m.cheq, m.bal].filter((x) => x >= 0).length;
  if (hits >= 3 && moneyCols >= 2) return m;
  return null;
}

function blankBill(src: string): ThBill {
  return { date: '', no: '', amtP: 0, rgP: 0, lessP: 0, cashP: 0, upiP: 0, cheqP: 0, balP: 0, src };
}

/** Parse Miracle workbook -> routes + parse issues (line refs) */
export function parseWorkbook(data: ArrayBuffer, fileName: string): { routes: ThRoute[]; issues: string[] } {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  const routes: ThRoute[] = [];
  const issues: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    if (!grid.length) continue;
    let col: ColMap | null = null;
    let party: ThParty | null = null;
    let partyBills = 0;
    let route: ThRoute | null = null;
    const ensureRoute = (name: string) => {
      route = { name: name.replace(/[:\-]+$/, '').trim() || sheetName, kharchaP: 0, aangadiyaP: 0, parties: [], src: sheetName };
      routes.push(route);
    };
    ensureRoute(sheetName);
    let billsInSheet = 0;

    grid.forEach((rowRaw, rIdx) => {
      const row = rowRaw as unknown[];
      const first = String(row[0] ?? '').trim();
      const firstLow = first.toLowerCase();
      const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '');

      // route header inside sheet
      if (RE.route.test(first)) {
        const nm = first.replace(/^(route|station)\s*[:\-]\s*/i, '').trim();
        if (billsInSheet > 0 || route!.parties.length > 0) ensureRoute(nm || `${sheetName} ${routes.length + 1}`);
        else route!.name = nm || route!.name;
        return;
      }
      // summary keywords
      if (RE.kharcha.test(firstLow) && !RE.skip.test(firstLow)) {
        const nums = row.filter((c) => typeof c === 'number' || (typeof c === 'string' && /^[\d,]+(\.\d+)?$/.test(String(c).trim())));
        if (nums.length) { route!.kharchaP = cellToPaise(nums[nums.length - 1]); return; }
      }
      if (RE.aangadiya.test(firstLow) && !RE.skip.test(firstLow)) {
        const nums = row.filter((c) => typeof c === 'number' || (typeof c === 'string' && /^[\d,]+(\.\d+)?$/.test(String(c).trim())));
        if (nums.length) { route!.aangadiyaP = cellToPaise(nums[nums.length - 1]); return; }
      }
      if (RE.skip.test(firstLow)) return;

      // header row?
      const h = scoreHeader(row);
      if (h) { col = h; return; }

      // party total row — prefer the AMOUNT column value (balance col bhi
      // total row me hota hai, usse total nahi banta)
      if (RE.total.test(firstLow) && party && col) {
        const c0 = col as ColMap;
        if (c0.amt >= 0 && String(row[c0.amt] ?? '').trim() !== '') {
          party.totalStatedP = cellToPaise(row[c0.amt]);
        } else {
          const nums = row.filter((c, i) => i > 0 && (typeof c === 'number' || (typeof c === 'string' && /^[\d,]+(\.\d+)?$/.test(String(c).trim()))));
          if (nums.length) party.totalStatedP = cellToPaise(nums[nums.length - 1]);
        }
        return;
      }
      // opening balance — same: amt column preferred
      if (RE.opening.test(firstLow)) {
        const c0 = col as ColMap | null;
        if (c0 && c0.amt >= 0 && String(row[c0.amt] ?? '').trim() !== '') {
          if (party) party.openingP = cellToPaise(row[c0.amt]);
        } else {
          const nums = row.filter((c) => typeof c === 'number' || (typeof c === 'string' && /^[\d,]+(\.\d+)?$/.test(String(c).trim())));
          if (party && nums.length) party.openingP = cellToPaise(nums[nums.length - 1]);
        }
        return;
      }
      // party name row: single text cell (no numbers, no date)
      if (nonEmpty.length === 1 && first.length >= 3 && typeof row[0] !== 'number' && !(row[0] instanceof Date) && !/^[\d,.\-/]+$/.test(first)) {
        if (party && partyBills === 0 && party.bills.length === 0 && party.openingP === 0 && party.name === 'Unnamed Party') {
          party.name = first; // rename placeholder
          return;
        }
        party = { name: first, openingP: 0, bills: [] };
        partyBills = 0;
        route!.parties.push(party);
        return;
      }
      // bill row needs a column map
      if (!col) {
        // positional fallback: date|no|amt|rg|less|recv|bal
        if (nonEmpty.length >= 3) col = { date: 0, no: 1, amt: 2, rg: 3, less: 4, recv: 5, cash: -1, upi: -1, cheq: -1, bal: 6, mode: -1 };
        else return;
      }
      const c = col as ColMap;
      const amt = c.amt >= 0 ? cellToPaise(row[c.amt]) : 0;
      const rg = c.rg >= 0 ? cellToPaise(row[c.rg]) : 0;
      const less = c.less >= 0 ? cellToPaise(row[c.less]) : 0;
      let cash = c.cash >= 0 ? cellToPaise(row[c.cash]) : 0;
      let upi = c.upi >= 0 ? cellToPaise(row[c.upi]) : 0;
      let cheq = c.cheq >= 0 ? cellToPaise(row[c.cheq]) : 0;
      let recv = c.recv >= 0 ? cellToPaise(row[c.recv]) : 0;
      const balStated = c.bal >= 0 && String(row[c.bal] ?? '').trim() !== '' ? cellToPaise(row[c.bal]) : undefined;
      const dateS = dateCell(c.date >= 0 ? row[c.date] : '');
      const noS = c.no >= 0 ? String(row[c.no] ?? '').trim() : '';

      // mode column -> split single recv into cash/upi/cheq (1=Cash 2=UPI 3=Cheque)
      if (recv > 0 && cash === 0 && upi === 0 && cheq === 0) {
        const mv = c.mode >= 0 ? String(row[c.mode] ?? '').trim() : '';
        if (mv === '2') { upi = recv; } // no let
        else if (mv === '3') { cheq = recv; }
        else { cash = recv; }
      }

      const isBill = amt > 0 || recv > 0 || rg > 0 || less > 0 || (dateS && noS);
      if (!isBill) return;
      if (!party) { party = { name: 'Unnamed Party', openingP: 0, bills: [] }; route!.parties.push(party); }
      const b: ThBill = { date: dateS, no: noS, amtP: amt, rgP: rg, lessP: less, cashP: cash, upiP: upi, cheqP: cheq, balP: 0, balStatedP: balStated, src: `${sheetName} row ${rIdx + 1}` };
      party.bills.push(b);
      partyBills++;
      billsInSheet++;
    });

    // compute balances + live checks (code-only)
    for (const rt of routes.filter((x) => x.src === sheetName)) {
      for (const p of rt.parties) {
        let bal = p.openingP;
        for (const b of p.bills) {
          bal = bal + b.amtP - b.rgP - b.lessP - (b.cashP + b.upiP + b.cheqP);
          b.balP = bal;
          if (b.balStatedP !== undefined && Math.abs(b.balStatedP - bal) > 100) {
            b.flag = `Balance mismatch: sheet ${fmtRs(b.balStatedP)} vs computed ${fmtRs(bal)}`;
            issues.push(`${rt.name} · ${p.name} · ${b.no || b.date || b.src}: ${b.flag}`);
          }
        }
        if (p.totalStatedP !== undefined) {
          const sum = p.bills.reduce((s, b) => s + b.amtP, 0);
          if (Math.abs(p.totalStatedP - sum) > 100) {
            issues.push(`${rt.name} · ${p.name}: Party total sheet ${fmtRs(p.totalStatedP)} vs bills sum ${fmtRs(sum)}`);
          }
        }
      }
    }
    void partyBills;
  }

  // drop empty routes
  const alive = routes.filter((r) => r.parties.length > 0 || r.kharchaP > 0 || r.aangadiyaP > 0);
  if (!alive.some((r) => r.parties.some((p) => p.bills.length > 0))) {
    issues.unshift('NO PARTY BILLS DETECTED — kya ye Miracle export file hai? Columns: Date | Bill No | Amt | R.G. | Less | Received | Balance');
  }
  return { routes: alive, issues };
}

/** live re-check after boss edits (recompute balances code-only) */
function recheck(routes: ThRoute[]): string[] {
  const issues: string[] = [];
  for (const r of routes) {
    for (const p of r.parties) {
      let bal = p.openingP;
      for (const b of p.bills) {
        bal = bal + b.amtP - b.rgP - b.lessP - (b.cashP + b.upiP + b.cheqP);
        b.balP = bal;
        if (b.balStatedP !== undefined && Math.abs(b.balStatedP - bal) > 100) {
          issues.push(`${r.name} · ${p.name} · ${b.no || b.src}: Balance sheet ${fmtRs(b.balStatedP)} vs computed ${fmtRs(bal)}`);
        }
      }
      if (p.totalStatedP !== undefined) {
        const sum = p.bills.reduce((s, b) => s + b.amtP, 0);
        if (Math.abs(p.totalStatedP - sum) > 100) issues.push(`${r.name} · ${p.name}: Party total sheet ${fmtRs(p.totalStatedP)} vs sum ${fmtRs(sum)}`);
      }
    }
  }
  return issues;
}

export function routeStats(r: ThRoute) {
  let billsP = 0, cashP = 0, upiP = 0, cheqP = 0, rgP = 0, lessP = 0, recvP = 0, balP = 0;
  for (const p of r.parties) {
    balP += p.openingP;
    for (const b of p.bills) {
      billsP += b.amtP; rgP += b.rgP; lessP += b.lessP;
      cashP += b.cashP; upiP += b.upiP; cheqP += b.cheqP;
      balP += b.amtP - b.rgP - b.lessP - (b.cashP + b.upiP + b.cheqP);
    }
  }
  recvP = cashP + upiP + cheqP;
  const haathP = cashP - r.kharchaP - r.aangadiyaP;
  const partyCount = r.parties.length;
  const billCount = r.parties.reduce((s, p) => s + p.bills.length, 0);
  return { billsP, cashP, upiP, cheqP, rgP, lessP, recvP, balP, haathP, partyCount, billCount };
}

// ================= SCREEN =================
export default function TourHisabScreen() {
  const [uploads, setUploads] = useState<ThUpload[]>([]);
  const [month, setMonth] = useState(curMonth());
  const [selected, setSelected] = useState<string>('');
  const [preview, setPreview] = useState<{ fileName: string; routes: ThRoute[] } | null>(null);
  const [previewRoute, setPreviewRoute] = useState(0);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [openParty, setOpenParty] = useState<string>('');

  const say = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg((p) => (p?.m === m ? null : p)), 5000); };

  const loadUploads = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'hisab'), where('kind', '==', 'th-upload')));
      const list: ThUpload[] = [];
      snap.forEach((d) => list.push(d.data() as ThUpload));
      list.sort((a, b) => b.uploadedAt - a.uploadedAt);
      setUploads(list);
      if (!selected && list.length) setSelected(list[0].uploadedAt.toString());
    } catch (e) { say('err', 'Load failed: ' + (e as Error).message); }
  };
  useEffect(() => { loadUploads(); /* eslint-disable-next-line */ }, []);

  const liveIssues = useMemo(() => (preview ? recheck(preview.routes) : []), [preview]);

  const handleFile = async (f: File) => {
    setBusy('Parsing ' + f.name + '...');
    try {
      const buf = await f.arrayBuffer();
      const { routes, issues } = parseWorkbook(buf, f.name);
      setPreview({ fileName: f.name, routes });
      setPreviewRoute(0);
      setOverride(false);
      setBusy('');
      if (issues.length) say('err', `${issues.length} check issue(s) — preview me dekho aur fix karo`);
      else say('ok', 'Parsed clean — sab checks pass');
    } catch (e) { setBusy(''); say('err', 'Parse failed: ' + (e as Error).message); }
  };

  const saveUpload = async () => {
    if (!preview) return;
    if (liveIssues.length && !override) return say('err', 'Issues fix karo ya "Save anyway" tick karo');
    setBusy('Saving...');
    try {
      const clean: ThRoute[] = preview.routes.map((r) => ({
        ...r,
        parties: r.parties.map((p) => ({
          name: p.name, openingP: p.openingP, totalStatedP: p.totalStatedP,
          bills: p.bills.map((b) => ({ date: b.date, no: b.no, amtP: b.amtP, rgP: b.rgP, lessP: b.lessP, cashP: b.cashP, upiP: b.upiP, cheqP: b.cheqP, balP: b.balP, src: b.src, flag: b.flag }))
        }))
      }));
      const id = `th-${Date.now()}`;
      const docu: ThUpload = {
        kind: 'th-upload', month, fileName: preview.fileName, uploadedBy: who(), uploadedAt: Date.now(),
        routes: clean, checks: { ok: liveIssues.length === 0, issues: liveIssues }
      };
      // OUTBOX journal-first (offline-safe — Boss order 2026-10-27)
      await obSet('hisab', id, JSON.parse(JSON.stringify(docu)) as Record<string, unknown>, { merge: false, opId: `th-save-${id}` });
      setPreview(null);
      setBusy('');
      setSelected(Date.now().toString());
      await loadUploads();
      say('ok', 'Upload saved — settlement view ready' + (navigator.onLine ? '' : ' (offline — net aane par sync)'));
    } catch (e) { setBusy(''); say('err', 'Save failed: ' + (e as Error).message); }
  };

  const delUpload = async (id: string) => {
    if (!window.confirm('Delete this tour upload permanently?')) return;
    try { await obDel('hisab', `th-${id}`); setSelected(''); await loadUploads(); say('ok', 'Upload deleted'); }
    catch (e) { say('err', 'Delete failed: ' + (e as Error).message); }
  };

  // ---- backup XL (REAL rupees) ----
  const backupUpload = async (u: ThUpload) => {
    try {
      const wb = XLSX.utils.book_new();
      const sumRows: (string | number)[][] = [['ROUTE', 'PARTIES', 'BILLS', 'BILL AMT', 'R.G.', 'LESS', 'CASH', 'UPI', 'CHEQUE', 'TOTAL RECV', 'KHARCHA', 'AANGADIYA', 'HAATH ME BACHA', 'STATUS']];
      for (const r of u.routes) {
        const s = routeStats(r);
        sumRows.push([r.name, s.partyCount, s.billCount, rs(s.billsP), rs(s.rgP), rs(s.lessP), rs(s.cashP), rs(s.upiP), rs(s.cheqP), rs(s.recvP), rs(r.kharchaP), rs(r.aangadiyaP), rs(s.haathP), s.haathP >= 0 ? 'OK' : 'CHECK']);
      }
      const gt = u.routes.reduce((a, r) => { const s = routeStats(r); return { cashP: a.cashP + s.cashP, upiP: a.upiP + s.upiP, cheqP: a.cheqP + s.cheqP, haathP: a.haathP + s.haathP, billsP: a.billsP + s.billsP }; }, { cashP: 0, upiP: 0, cheqP: 0, haathP: 0, billsP: 0 });
      sumRows.push(['GRAND TOTAL', '', '', rs(gt.billsP), '', '', rs(gt.cashP), rs(gt.upiP), rs(gt.cheqP), rs(gt.cashP + gt.upiP + gt.cheqP), '', '', rs(gt.haathP), '']);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Summary');
      for (const r of u.routes) {
        const rows: (string | number)[][] = [[`ROUTE: ${r.name}`, '', '', '', '', '', '', '', '', '']];
        rows.push(['PARTY', 'DATE', 'BILL NO', 'AMOUNT', 'R.G.', 'LESS', 'CASH', 'UPI', 'CHEQUE', 'BALANCE']);
        for (const p of r.parties) {
          rows.push([p.name + (p.openingP ? ` (opening ${rs(p.openingP)})` : ''), '', '', '', '', '', '', '', '', '']);
          for (const b of p.bills) rows.push(['', b.date, b.no, rs(b.amtP), rs(b.rgP), rs(b.lessP), rs(b.cashP), rs(b.upiP), rs(b.cheqP), rs(b.balP)]);
          const pSum = p.bills.reduce((a, b) => ({ amt: a.amt + b.amtP, recv: a.recv + b.cashP + b.upiP + b.cheqP }), { amt: 0, recv: 0 });
          rows.push([`TOTAL`, '', '', rs(pSum.amt), '', '', rs(pSum.recv), '', '', rs(p.bills.length ? p.bills[p.bills.length - 1].balP : p.openingP)]);
        }
        const s = routeStats(r);
        rows.push([]);
        rows.push(['KHARCHA', rs(r.kharchaP), 'AANGADIYA', rs(r.aangadiyaP), 'HAATH ME BACHA', rs(s.haathP)]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), r.name.slice(0, 28).replace(/[\\/?*[\]:]/g, ' ') || 'Route');
      }
      XLSX.writeFile(wb, `TourHisab-${u.month}-${u.fileName.replace(/\.[^.]+$/, '')}.xlsx`);
      say('ok', 'Backup downloaded (real rupees)');
    } catch (e) { say('err', 'Backup failed: ' + (e as Error).message); }
  };

  const monthUploads = uploads.filter((u) => !month || u.month === month);
  const selUpload = uploads.find((u) => u.uploadedAt.toString() === selected) || null;

  return (
    <div className="space-y-5">
      <OutboxBanner />
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-white">
            <Truck className="h-5 w-5 text-cyan-400" /> TOUR HISAB — MIRACLE XL
            <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-black text-cyan-400">REAL RUPEES</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">Miracle export upload karo — parse, 3-layer checks, salesman settlement (Cash / UPI / Cheque / Kharcha / Aangadiya / Haath-me-bacha). Salesman system = real ₹ (3456 = ₹3,456).</p>
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-semibold ${msg.t === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>{msg.m}</div>
      )}

      {/* upload card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-400">Month (YYYY-MM)</label>
            <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-10"
              className="mt-1 w-36 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-500 focus:outline-none" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-cyan-600/30 hover:bg-cyan-500">
            <Upload className="h-4 w-4" /> Upload Miracle XL
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
          {busy && <span className="flex items-center gap-2 text-xs font-bold text-cyan-300"><RefreshCw className="h-4 w-4 animate-spin" /> {busy}</span>}
        </div>
      </div>

      {/* ============ PREVIEW / EDITOR ============ */}
      {preview && (
        <div className="rounded-2xl border border-cyan-500/30 bg-slate-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-black text-white"><FileSpreadsheet className="h-4 w-4 text-cyan-400" /> PREVIEW — {preview.fileName}</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setPreview(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800"><X className="mr-1 inline h-3.5 w-3.5" />Cancel</button>
            </div>
          </div>

          {/* live issues */}
          {liveIssues.length > 0 && (
            <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black text-rose-300"><AlertTriangle className="h-4 w-4" /> {liveIssues.length} CHECK ISSUE(S) — fix karo ya row edit karo:</p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {liveIssues.map((i, k) => <p key={k} className="text-[11px] font-semibold text-rose-300">• {i}</p>)}
              </div>
            </div>
          )}
          {liveIssues.length === 0 && (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-black text-emerald-300"><span className="mr-1.5">✓</span>ALL CHECKS PASS — balances code-only verify ho gaye</div>
          )}

          {/* route chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            {preview.routes.map((r, i) => (
              <button key={i} onClick={() => setPreviewRoute(i)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${previewRoute === i ? 'border-cyan-500 bg-cyan-600/20 text-cyan-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                {r.name} ({r.parties.length})
              </button>
            ))}
          </div>

          {/* party bills editable */}
          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {(preview.routes[previewRoute]?.parties || []).map((p, pi) => (
              <div key={pi} className="rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="flex items-center justify-between px-3 py-2">
                  <button onClick={() => setOpenParty(openParty === `${previewRoute}-${pi}` ? '' : `${previewRoute}-${pi}`)} className="flex items-center gap-2 text-xs font-black text-white">
                    {openParty === `${previewRoute}-${pi}` ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {p.name}
                    <span className="text-[10px] font-bold text-slate-500">{p.bills.length} bills{p.openingP ? ` · opening ${fmtRs(p.openingP)}` : ''}</span>
                  </button>
                  <span className="text-xs font-black tabular-nums text-amber-300">{fmtRs(p.bills.reduce((s, b) => s + b.cashP + b.upiP + b.cheqP, 0))} recv</span>
                </div>
                {openParty === `${previewRoute}-${pi}` && (
                  <div className="border-t border-slate-800 p-2">
                    {p.bills.map((b, bi) => (
                      <BillEdit key={bi} bill={b} party={p} onChange={(nb) => {
                        const routes = preview.routes;
                        const np = { ...p, bills: p.bills.map((x, k) => (k === bi ? nb : x)), totalStatedP: undefined };
                        nb.balStatedP = undefined;
                        routes[previewRoute].parties[pi] = np;
                        setPreview({ ...preview, routes: [...routes] });
                      }} />
                    ))}
                    {p.bills.length === 0 && <p className="p-2 text-center text-[11px] text-slate-600">No bill rows (sirf opening balance mila)</p>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* kharcha / aangadiya per route edit */}
          {preview.routes[previewRoute] && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-400">Route Kharcha (₹)</label>
                <input inputMode="decimal" defaultValue={preview.routes[previewRoute].kharchaP / 100 || ''}
                  onBlur={(e) => { const v = rsIn(e.target.value); preview.routes[previewRoute].kharchaP = v ?? 0; setPreview({ ...preview, routes: [...preview.routes] }); }}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">Aangadiya (₹)</label>
                <input inputMode="decimal" defaultValue={preview.routes[previewRoute].aangadiyaP / 100 || ''}
                  onBlur={(e) => { const v = rsIn(e.target.value); preview.routes[previewRoute].aangadiyaP = v ?? 0; setPreview({ ...preview, routes: [...preview.routes] }); }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-500 focus:outline-none" />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
              Save anyway (issues baad me fix karunga)
            </label>
            <button onClick={saveUpload} className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-black text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500">
              Save Upload ({preview.routes.reduce((s, r) => s + r.parties.length, 0)} parties)
            </button>
          </div>
        </div>
      )}

      {/* ============ SAVED UPLOADS LIST ============ */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white">Saved Tour Uploads</h3>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-xs text-white">
            <option value="">All months</option>
            {Array.from(new Set(uploads.map((u) => u.month))).sort().reverse().map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          {monthUploads.length === 0 && <p className="py-4 text-center text-xs text-slate-600">No uploads{month ? ` for ${month}` : ''}</p>}
          {monthUploads.map((u) => (
            <button key={u.uploadedAt} onClick={() => setSelected(u.uploadedAt.toString())}
              className={`flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selected === u.uploadedAt.toString() ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800/40'}`}>
              <span className="text-xs font-black text-white">{u.month}</span>
              <span className="text-xs text-slate-300">{u.fileName}</span>
              <span className="text-[10px] text-slate-500">{u.routes.length} routes · {u.routes.reduce((s, r) => s + r.parties.length, 0)} parties · by {u.uploadedBy}</span>
              <span className={`ml-auto rounded px-2 py-0.5 text-[10px] font-black ${u.checks.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>{u.checks.ok ? 'CHECKS OK' : `${u.checks.issues.length} ISSUES`}</span>
              <span onClick={(e) => { e.stopPropagation(); delUpload(u.uploadedAt.toString()); }} className="text-slate-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></span>
            </button>
          ))}
        </div>
      </div>

      {/* ============ SETTLEMENT DETAIL ============ */}
      {selUpload && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-black text-white">
              <Calculator className="h-4 w-4 text-cyan-400" /> SETTLEMENT — {selUpload.month} ({selUpload.fileName})
            </h3>
            <button onClick={() => backupUpload(selUpload)} className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20">
              <Download className="h-4 w-4" /> XL Backup (₹ real)
            </button>
          </div>

          {/* grand totals strip */}
          {(() => {
            const g = selUpload.routes.reduce((a, r) => { const s = routeStats(r); return { cash: a.cash + s.cashP, upi: a.upi + s.upiP, cheq: a.cheq + s.cheqP, haath: a.haath + s.haathP, bills: a.bills + s.billsP }; }, { cash: 0, upi: 0, cheq: 0, haath: 0, bills: 0 });
            return (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatCard label="Total Bills" value={fmtRs(g.bills)} cls="text-white" />
                <StatCard label="Cash" value={fmtRs(g.cash)} cls="text-emerald-400" />
                <StatCard label="UPI" value={fmtRs(g.upi)} cls="text-sky-400" />
                <StatCard label="Cheque" value={fmtRs(g.cheq)} cls="text-purple-400" />
                <StatCard label="HAATH ME BACHA" value={fmtRs(g.haath)} cls={g.haath >= 0 ? 'text-amber-300' : 'text-rose-400'} big />
              </div>
            );
          })()}

          {/* route cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {selUpload.routes.map((r, ri) => {
              const s = routeStats(r);
              const bad = r.parties.some((p) => p.bills.some((b) => b.flag)) || selUpload.checks.issues.some((i) => i.startsWith(r.name));
              return (
                <div key={ri} className={`rounded-2xl border bg-slate-900 p-4 ${bad ? 'border-rose-500/30' : 'border-emerald-500/20'}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-black text-white">{r.name}</h4>
                    <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black ${bad ? 'bg-rose-500/15 text-rose-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                      {bad ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />} {bad ? 'CHECK ISSUES' : 'GREEN'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="Bills" v={fmtRs(s.billsP)} />
                    <MiniStat label="Cash" v={fmtRs(s.cashP)} c="text-emerald-400" />
                    <MiniStat label="UPI" v={fmtRs(s.upiP)} c="text-sky-400" />
                    <MiniStat label="Cheque" v={fmtRs(s.cheqP)} c="text-purple-400" />
                    <MiniStat label="Kharcha" v={fmtRs(r.kharchaP)} c="text-rose-400" />
                    <MiniStat label="Aangadiya" v={fmtRs(r.aangadiyaP)} c="text-rose-400" />
                  </div>
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Haath Me Bacha (dena hai)</p>
                    <p className={`text-2xl font-black tabular-nums ${s.haathP >= 0 ? 'text-amber-300' : 'text-rose-400'}`}>{fmtRs(s.haathP)}</p>
                    <p className="text-[10px] text-slate-400">Cash {fmtRs(s.cashP)} − Kharcha {fmtRs(r.kharchaP)} − Aangadiya {fmtRs(r.aangadiyaP)}</p>
                  </div>
                  {/* party accordion */}
                  <div className="mt-3 space-y-1.5">
                    {r.parties.map((p, pi) => {
                      const key = `${ri}-${pi}`;
                      const pRecv = p.bills.reduce((a, b) => a + b.cashP + b.upiP + b.cheqP, 0);
                      const lastBal = p.bills.length ? p.bills[p.bills.length - 1].balP : p.openingP;
                      return (
                        <div key={pi} className="rounded-lg border border-slate-800 bg-slate-950/60">
                          <button onClick={() => setOpenParty(openParty === key ? '' : key)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                            {openParty === key ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <span className="flex-1 truncate text-xs font-bold text-white">{p.name}</span>
                            <span className="text-[10px] font-bold text-emerald-400">{fmtRs(pRecv)}</span>
                            <span className="text-[10px] text-slate-500">bal {fmtRs(lastBal)}</span>
                          </button>
                          {openParty === key && (
                            <div className="border-t border-slate-800 px-3 py-2">
                              {p.bills.length === 0 && <p className="text-[11px] text-slate-600">No bills</p>}
                              {p.bills.map((b, k) => (
                                <div key={k} className={`flex items-center gap-2 py-1 text-[11px] ${b.flag ? 'text-rose-300' : 'text-slate-300'}`}>
                                  <span className="w-16 shrink-0 text-slate-500">{b.date}</span>
                                  <span className="w-16 shrink-0 font-bold text-slate-300">{b.no || '—'}</span>
                                  <span className="w-20 shrink-0 text-right tabular-nums">{fmtRs(b.amtP)}</span>
                                  {b.rgP > 0 && <span className="rounded bg-amber-500/10 px-1 text-[9px] font-bold text-amber-400">RG {fmtRs(b.rgP)}</span>}
                                  {b.lessP > 0 && <span className="rounded bg-slate-700 px-1 text-[9px] font-bold text-slate-300">Less {fmtRs(b.lessP)}</span>}
                                  <span className="ml-auto flex gap-1.5">
                                    {b.cashP > 0 && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold text-emerald-400">C {fmtRs(b.cashP)}</span>}
                                    {b.upiP > 0 && <span className="rounded bg-sky-500/10 px-1 text-[9px] font-bold text-sky-400">U {fmtRs(b.upiP)}</span>}
                                    {b.cheqP > 0 && <span className="rounded bg-purple-500/10 px-1 text-[9px] font-bold text-purple-400">Q {fmtRs(b.cheqP)}</span>}
                                  </span>
                                  <span className="w-20 shrink-0 text-right font-bold tabular-nums text-white">{fmtRs(b.balP)}</span>
                                </div>
                              ))}
                              {billsFlagNote(p)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function billsFlagNote(p: ThParty) {
  const flags = p.bills.filter((b) => b.flag);
  if (!flags.length) return null;
  return (
    <div className="mt-1 rounded-lg bg-rose-500/10 p-2">
      {flags.map((b, k) => <p key={k} className="text-[10px] font-bold text-rose-300">⚠ {b.no || b.src}: {b.flag}</p>)}
    </div>
  );
}

function StatCard({ label, value, cls, big }: { label: string; value: string; cls?: string; big?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center ${big ? 'lg:col-span-1' : ''}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 font-black tabular-nums ${big ? 'text-2xl' : 'text-xl'} ${cls || 'text-white'}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, v, c }: { label: string; v: string; c?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-xs font-black tabular-nums ${c || 'text-white'}`}>{v}</p>
    </div>
  );
}

// editable bill row (preview)
function BillEdit({ bill, party, onChange }: { bill: ThBill; party: ThParty; onChange: (b: ThBill) => void }) {
  const f = (p: number) => (p ? String(p / 100) : '');
  const set = (k: keyof ThBill, s: string) => {
    const v = rsIn(s);
    const nb: ThBill = { ...bill };
    if (k === 'amtP') nb.amtP = v ?? 0;
    if (k === 'rgP') nb.rgP = v ?? 0;
    if (k === 'lessP') nb.lessP = v ?? 0;
    if (k === 'cashP') nb.cashP = v ?? 0;
    if (k === 'upiP') nb.upiP = v ?? 0;
    if (k === 'cheqP') nb.cheqP = v ?? 0;
    onChange(nb);
  };
  const inp = 'w-20 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-right text-[11px] font-bold text-white tabular-nums focus:border-cyan-500 focus:outline-none';
  return (
    <div className={`flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 ${bill.flag ? 'bg-rose-500/5' : ''}`}>
      <span className="w-24 truncate text-[11px] text-slate-500">{bill.date} {bill.no}</span>
      <input className={inp} defaultValue={f(bill.amtP)} onBlur={(e) => set('amtP', e.target.value)} placeholder="Amt" />
      <input className={inp} defaultValue={f(bill.rgP)} onBlur={(e) => set('rgP', e.target.value)} placeholder="RG" />
      <input className={inp} defaultValue={f(bill.lessP)} onBlur={(e) => set('lessP', e.target.value)} placeholder="Less" />
      <input className={inp} defaultValue={f(bill.cashP)} onBlur={(e) => set('cashP', e.target.value)} placeholder="Cash" />
      <input className={inp} defaultValue={f(bill.upiP)} onBlur={(e) => set('upiP', e.target.value)} placeholder="UPI" />
      <input className={inp} defaultValue={f(bill.cheqP)} onBlur={(e) => set('cheqP', e.target.value)} placeholder="Chq" />
      <span className="ml-auto text-[11px] font-black tabular-nums text-white">bal {fmtRs(bill.balP)}</span>
      {bill.flag && <span className="text-[10px] font-bold text-rose-400">⚠ fixed on save</span>}
      {party.totalStatedP !== undefined && <span className="text-[9px] text-slate-600">party-total check on</span>}
    </div>
  );
}

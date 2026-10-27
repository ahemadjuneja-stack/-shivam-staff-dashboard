import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  ClipboardPaste, MapPin, Truck, Trash2, Save, X, RefreshCw,
  CheckCircle2, AlertTriangle, Radio, User, Wallet, Landmark,
  UploadCloud, FileText, FileSpreadsheet, Loader2
} from 'lucide-react';
import { db, auth } from '../firebase';
import { obSet, OutboxBanner } from '../lib/outbox';
import { Tour, TourCity, TourHisabDoc, TourHisabEntry } from '../types';
import { fmtRs, todayStr } from '../lib/cbMoney';
import { parseTourPaste, suggestTourName } from '../lib/tourPaste';
import { fileKindOf, parseTourWorkbook, pdfToText } from '../lib/tourFile';

// ============================================================
// TOUR PASTE + SALESMAN LIVE (Task 93, Boss order 2026-10-28)
// 1. Miracle/PDF data PASTE karo -> system poochhega "Ye kis TOUR ka hai?"
// 2. Tour naam (e.g. PORBANDAR) -> SALES ko staff app me yahi dikhta hai
//    (Line Schedule ke niche box -> cities -> shops -> GR/Less/Paisa-diya)
// 3. Salesman jama (deposit) bhi staff app se — kaha jama kiya note ke saath
// 4. Yahan SALESMAN HISAB LIVE dikhta hai — dono salesman alag-alag
// Money: integer paise (real ₹) — fmtRs se display.
// ============================================================

const who = () => auth.currentUser?.email?.split('@')[0] || 'manager';
const MODE_LBL = ['', 'Cash', 'UPI', 'Cheque'];
const MODE_CLS = ['', 'text-emerald-400 bg-emerald-500/10', 'text-sky-400 bg-sky-500/10', 'text-purple-400 bg-purple-500/10'];

function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

/** salesman hisab doc ke totals (pure) */
export function salesTotals(doc?: TourHisabDoc) {
  let paidP = 0, cashP = 0, upiP = 0, cheqP = 0, grP = 0, lessP = 0, jamaP = 0, filled = 0;
  const es = doc?.entries || {};
  for (const k of Object.keys(es)) {
    const e: TourHisabEntry | undefined = es[k];
    if (!e) continue;
    filled++;
    paidP += e.paidP || 0;
    grP += e.grP || 0;
    lessP += e.lessP || 0;
    if (e.mode === 2) upiP += e.paidP || 0;
    else if (e.mode === 3) cheqP += e.paidP || 0;
    else cashP += e.paidP || 0;
  }
  for (const d of doc?.deposits || []) jamaP += d.amtP || 0;
  return { paidP, cashP, upiP, cheqP, grP, lessP, jamaP, haathP: cashP - jamaP, filled };
}

export default function TourPasteSection() {
  const [paste, setPaste] = useState('');
  const [tourName, setTourName] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseTourPaste> | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [tours, setTours] = useState<Tour[]>([]);
  const [selTourId, setSelTourId] = useState('');
  const [hisabMap, setHisabMap] = useState<Record<string, TourHisabDoc>>({});
  const [salesUsers, setSalesUsers] = useState<{ uid: string; name: string }[]>([]);
  const [openUid, setOpenUid] = useState('');
  // FILE UPLOAD (Task 95 — Boss: "pdf ya xl hi upload karege, app khud manage kare")
  const [fileInfo, setFileInfo] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const say = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg((p) => (p?.m === m ? null : p)), 6000); };

  // tours LIVE — naya paste turant list me
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tours'),
      (snap) => {
        const list: Tour[] = [];
        snap.forEach((d) => { const v = d.data() as Tour; if (v && v.kind === 'tour') list.push(v); });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setTours(list);
      },
      () => {});
    return () => unsub();
  }, []);

  // active salesmen — khali salesman ka card bhi dikhana hai (dono alag-alag)
  useEffect(() => {
    const q = query(collection(db, 'users'), where('status', '==', 'active'));
    const unsub = onSnapshot(q,
      (snap) => {
        const list: { uid: string; name: string }[] = [];
        snap.forEach((d) => {
          const u = d.data() as { name?: string; role?: string };
          if (u.role === 'sales' || u.role === 'salesman' || u.role === 'sales_manager') {
            list.push({ uid: d.id, name: u.name || d.id });
          }
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setSalesUsers(list);
      },
      () => {});
    return () => unsub();
  }, []);

  // selected tour ka salesman hisab — LIVE (Boss: "uska hisab dikhna chahiye live")
  useEffect(() => {
    if (!selTourId) { setHisabMap({}); return; }
    const unsub = onSnapshot(collection(db, 'tours', selTourId, 'hisab'),
      (snap) => {
        const m: Record<string, TourHisabDoc> = {};
        snap.forEach((d) => { m[d.id] = d.data() as TourHisabDoc; });
        setHisabMap(m);
      },
      () => {});
    return () => unsub();
  }, [selTourId]);

  const doParse = () => {
    if (!paste.trim()) return say('err', 'Pehle Miracle/PDF ka data paste karo');
    const res = parseTourPaste(paste);
    setParsed(res);
    if (res.ok) {
      setTourName((prev) => (prev.trim() ? prev : suggestTourName(res)));
      const shops = res.cities.reduce((a, c) => a + c.shops.length, 0);
      const bills = res.cities.reduce((a, c) => a + c.shops.reduce((x, s) => x + s.bills.length, 0), 0);
      say('ok', `Parsed: ${res.cities.length} cities · ${shops} shops · ${bills} bills${res.tourDate ? ` · date ${res.tourDate}` : ''}`);
    } else {
      say('err', res.reason || 'Parse fail');
    }
  };

  // ===== FILE UPLOAD (Task 95): file chuno, app KHUD parse kare =====
  const applyParsed = (res: ReturnType<typeof parseTourPaste>, srcText: string, label: string) => {
    setParsed(res);
    setPaste(srcText.slice(0, 20000)); // sourceText backup flow reuse
    if (res.ok) {
      setTourName((prev) => (prev.trim() ? prev : suggestTourName(res)));
      const shops = res.cities.reduce((a, c) => a + c.shops.length, 0);
      const bills = res.cities.reduce((a, c) => a + c.shops.reduce((x, s) => x + s.bills.length, 0), 0);
      say('ok', `${label} parsed: ${res.cities.length} cities · ${shops} shops · ${bills} bills${res.tourDate ? ` · date ${res.tourDate}` : ''} — niche preview check karke SAVE karo`);
    } else {
      say('err', res.reason || 'File parse nahi hui');
    }
  };

  const handleFile = async (f: File) => {
    const kind = fileKindOf(f.name);
    if (kind === 'unknown') {
      return say('err', 'Sirf PDF ya Excel/CSV file chalo (.pdf / .xlsx / .xls / .csv)');
    }
    setFileBusy(true);
    setFileInfo(f.name);
    try {
      const buf = await f.arrayBuffer();
      if (kind === 'pdf') {
        const text = await pdfToText(buf);
        if (!text.trim()) {
          say('err', 'Is PDF me text nahi mila (scanned photo hai?) — Miracle se text-based PDF export karo');
          setParsed(null);
        } else {
          applyParsed(parseTourPaste(text), text, 'PDF');
        }
      } else {
        const res = parseTourWorkbook(buf, XLSX as unknown as Parameters<typeof parseTourWorkbook>[1]);
        applyParsed(res, res.text || '', `XL${res.sheetName ? ` (sheet: ${res.sheetName})` : ''}`);
      }
    } catch (e) {
      say('err', 'File read/parse fail: ' + (e as Error).message.slice(0, 120));
      setParsed(null);
    } finally {
      setFileBusy(false);
    }
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // same file dobara choose kar sake
    if (f) void handleFile(f);
  };

  const saveTour = async () => {
    if (!parsed?.ok) return;
    const name = tourName.trim();
    if (!name) return say('err', 'Ye kis TOUR ka hai? — Tour ka naam likho (salesman ko yahi dikhega)');
    setBusy('Saving tour...');
    try {
      const now = Date.now();
      const cities: TourCity[] = JSON.parse(JSON.stringify(parsed.cities));
      const tour: Tour = {
        kind: 'tour',
        name,
        date: parsed.tourDate,
        month: todayStr().slice(0, 7),
        cities,
        summary: {
          shops: cities.reduce((a, c) => a + c.shops.length, 0),
          billsP: cities.reduce((a, c) => a + c.shops.reduce((x, s) => x + s.billsP, 0), 0),
          recvP: cities.reduce((a, c) => a + c.shops.reduce((x, s) => x + s.recvP, 0), 0)
        },
        sourceText: paste.slice(0, 6000),
        active: true,
        createdBy: who(),
        createdAt: now,
        updatedAt: now
      };
      const id = `tour-${now}`;
      await obSet('tours', id, JSON.parse(JSON.stringify(tour)) as Record<string, unknown>, { merge: false, opId: `tour-save-${id}` });
      setPaste(''); setParsed(null); setTourName('');
      setSelTourId(id);
      setBusy('');
      say('ok', `Tour "${name}" save ho gaya — staff app me salesman ko Line Schedule ke niche dikhega`);
    } catch (e) { setBusy(''); say('err', 'Save failed: ' + (e as Error).message); }
  };

  const delTour = async (id: string, name: string) => {
    if (!window.confirm(`Tour "${name}" delete karein? Salesman ka bhara hisab bhi chhupa rahega (data delete nahi hota).`)) return;
    try { await deleteDoc(doc(db, 'tours', id)); if (selTourId === id) setSelTourId(''); say('ok', 'Tour deleted'); }
    catch (e) { say('err', 'Delete failed: ' + (e as Error).message); }
  };

  const selTour = useMemo(() => tours.find((t) => t.createdAt.toString() === selTourId) || null, [tours, selTourId]);

  // salesman cards: users + jo hisab doc bhej chuke (dono union)
  const salesCards = useMemo(() => {
    const rows: { uid: string; name: string; doc?: TourHisabDoc }[] = [];
    const seen = new Set<string>();
    for (const u of salesUsers) { seen.add(u.uid); rows.push({ uid: u.uid, name: u.name, doc: hisabMap[u.uid] }); }
    for (const uid of Object.keys(hisabMap)) {
      if (!seen.has(uid)) rows.push({ uid, name: hisabMap[uid].name || uid, doc: hisabMap[uid] });
    }
    return rows;
  }, [salesUsers, hisabMap]);

  return (
    <div className="space-y-4">
      <OutboxBanner />

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-white">
            <Truck className="h-5 w-5 text-cyan-400" /> TOUR HISAB — PASTE + SALESMAN LIVE
            <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-black text-cyan-400">REAL RUPEES</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">Miracle/PDF data paste karo → tour ka naam likho → tour staff app me salesman ko dikhega → salesman GR/Less/Paisa-diya + JAMA bharega → sab yahan LIVE.</p>
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-semibold ${msg.t === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>{msg.m}</div>
      )}

      {/* ============ FILE UPLOAD CARD (Task 95 — app khud manage kare) ============ */}
      <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-slate-900 to-slate-900/60 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-black text-white">
          <UploadCloud className="h-4 w-4 text-cyan-400" /> PDF / EXCEL UPLOAD — APP KHUD PARSE KAREGA
          <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black text-emerald-400">NO PASTE NEEDED</span>
        </h3>
        <p className="mb-3 text-xs text-slate-400">Miracle se TOUR REPORT ka <b className="text-slate-200">PDF ya XL</b> download karke yahan upload karo — cities, shops, bills, payment-details sab khud nikal jayega.</p>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-cyan-500/40 bg-cyan-500/5 p-4"
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={onFilePick} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={fileBusy}
            className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-600/30 hover:bg-cyan-500 disabled:opacity-60"
          >
            {fileBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {fileBusy ? 'PARSING…' : 'FILE CHUNO (PDF / XL / CSV)'}
          </button>
          {fileInfo && !fileBusy && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
              {fileInfo.toLowerCase().endsWith('.pdf') ? <FileText className="h-3.5 w-3.5 text-rose-400" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />}
              {fileInfo}
            </span>
          )}
          <span className="text-[10px] text-slate-500">file kahin upload nahi hoti — phone/laptop par hi parse hoti hai (private)</span>
        </div>
      </div>

      {/* ============ PASTE CARD (fallback) ============ */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-white"><ClipboardPaste className="h-4 w-4 text-cyan-400" /> YA TEXT PASTE KARO (PURANA TARIKA)</h3>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Miracle software ke report ka text (ya PDF se copy) yahan paste karo — city header, shop rows, bill rows, Payment Details sab aa jaye…"
          rows={7}
          className="w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="text-xs font-semibold text-slate-400">Ye kis TOUR ka hai? <span className="text-cyan-400">(naam salesman ko bhi dikhega)</span></label>
            <input
              value={tourName}
              onChange={(e) => setTourName(e.target.value)}
              placeholder="e.g. PORBANDAR"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm font-bold text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <button onClick={doParse} className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-cyan-600/30 hover:bg-cyan-500">
            <RefreshCw className="h-4 w-4" /> PARSE DATA
          </button>
          {busy && <span className="flex items-center gap-2 text-xs font-bold text-cyan-300"><RefreshCw className="h-4 w-4 animate-spin" /> {busy}</span>}
        </div>

        {/* preview */}
        {parsed && parsed.ok && (
          <div className="mt-4 rounded-xl border border-cyan-500/30 bg-slate-950/60 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-xs font-black text-white">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> PREVIEW — "TOUR: {tourName || '(naam likho)'}"{parsed.tourDate ? ` · ${parsed.tourDate}` : ''}
              </h4>
              <div className="flex gap-2">
                <button onClick={() => setParsed(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"><X className="mr-1 inline h-3 w-3" />Cancel</button>
                <button onClick={saveTour} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-[11px] font-black text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500">
                  <Save className="h-3.5 w-3.5" /> SAVE TOUR ({parsed.cities.reduce((a, c) => a + c.shops.length, 0)} shops)
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500">
                    <th className="py-1.5 pr-2">City</th>
                    <th className="pr-2">Shops</th>
                    <th className="pr-2">Bills</th>
                    <th className="pr-2 text-right">Bill Total</th>
                    <th className="pr-2 text-right">Miracle Recv</th>
                    <th className="pr-2 text-right">Cash / UPI / Cheque</th>
                    <th className="pr-2">Jama Note</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.cities.map((c, i) => (
                    <tr key={i} className="border-b border-slate-900 text-slate-300">
                      <td className="py-1.5 pr-2 font-bold text-white">{c.name}{c.date ? ` · ${c.date}` : ''}</td>
                      <td className="pr-2">{c.shops.length}</td>
                      <td className="pr-2">{c.shops.reduce((a, s) => a + s.bills.length, 0)}</td>
                      <td className="pr-2 text-right tabular-nums">{fmtRs(c.shops.reduce((a, s) => a + s.billsP, 0))}</td>
                      <td className="pr-2 text-right tabular-nums text-emerald-400">{fmtRs(c.shops.reduce((a, s) => a + s.recvP, 0))}</td>
                      <td className="pr-2 text-right tabular-nums">{fmtRs(c.cashP || 0)} / {fmtRs(c.upiP || 0)} / {fmtRs(c.cheqP || 0)}</td>
                      <td className="pr-2 text-slate-500">{c.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.junkLines > 0 && (
              <p className="mt-2 text-[10px] text-slate-600">{parsed.junkLines} junk lines skip hui (page headers / khali rows — normal hai)</p>
            )}
          </div>
        )}
        {parsed && !parsed.ok && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-300"><AlertTriangle className="mr-1.5 inline h-4 w-4" />{parsed.reason}</div>
        )}
      </div>

      {/* ============ SAVED TOURS ============ */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-bold text-white">Saved Tours <span className="text-[10px] font-bold text-slate-500">— salesman ke Line Schedule ke niche boxes isi se bante hain</span></h3>
        <div className="space-y-2">
          {tours.length === 0 && <p className="py-3 text-center text-xs text-slate-600">Koi tour nahi — upar data paste karke pehla tour banao</p>}
          {tours.map((t) => (
            <button
              key={t.createdAt}
              onClick={() => setSelTourId(t.createdAt.toString())}
              className={`flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selTourId === t.createdAt.toString() ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800/40'}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10"><MapPin className="h-4 w-4 text-cyan-400" /></span>
              <span className="text-xs font-black text-white">{t.name}</span>
              {t.date && <span className="text-[10px] text-slate-500">{t.date}</span>}
              <span className="text-[10px] text-slate-500">{t.cities.length} cities · {t.summary?.shops || 0} shops · bills {fmtRs(t.summary?.billsP || 0)}</span>
              <span className="text-[10px] text-slate-600">by {t.createdBy} · {fmtTime(t.createdAt)}</span>
              <span
                onClick={(e) => { e.stopPropagation(); delTour(t.createdAt.toString(), t.name); }}
                className="ml-auto text-slate-600 hover:text-rose-400"
              ><Trash2 className="h-3.5 w-3.5" /></span>
            </button>
          ))}
        </div>
      </div>

      {/* ============ SELECTED TOUR: SALESMAN HISAB LIVE ============ */}
      {selTour && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-black text-white">
              <Radio className="h-4 w-4 text-emerald-400" /> SALESMAN HISAB — LIVE
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-400">{selTour.name}</span>
            </h3>
            <span className="text-[10px] text-slate-500">staff app me salesman jo bharta hai wo turant yahan aata hai</span>
          </div>

          {/* grand strip */}
          {(() => {
            const g = salesCards.reduce((a, r) => { const t = salesTotals(r.doc); return { paid: a.paid + t.paidP, jama: a.jama + t.jamaP, gr: a.gr + t.grP, less: a.less + t.lessP }; }, { paid: 0, jama: 0, gr: 0, less: 0 });
            return (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <PasteStat label="Salesman ne Diya" value={fmtRs(g.paid)} cls="text-emerald-300" />
                <PasteStat label="Total JAMA (jama kiya)" value={fmtRs(g.jama)} cls="text-sky-300" />
                <PasteStat label="GR (R.Goods)" value={fmtRs(g.gr)} cls="text-amber-300" />
                <PasteStat label="Less diya" value={fmtRs(g.less)} cls="text-slate-200" />
              </div>
            );
          })()}

          {/* per-salesman cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {salesCards.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-600">Koi active salesman nahi mila</p>
            )}
            {salesCards.map((r) => {
              const t = salesTotals(r.doc);
              const open = openUid === r.uid;
              const entries = Object.values(r.doc?.entries || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
              const deposits = [...(r.doc?.deposits || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
              return (
                <div key={r.uid} className={`rounded-2xl border bg-slate-900 p-4 ${t.filled ? 'border-emerald-500/25' : 'border-slate-800'}`}>
                  <button onClick={() => setOpenUid(open ? '' : r.uid)} className="flex w-full items-center gap-2 text-left">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950"><User className="h-4 w-4 text-slate-400" /></span>
                    <span className="text-sm font-black text-white">{r.name}</span>
                    {t.filled > 0 && <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-400">{t.filled} shops hisab</span>}
                    {!t.filled && <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-500">abhi tak kuch nahi bhara</span>}
                    <span className="ml-auto text-xs font-black tabular-nums text-emerald-400">{fmtRs(t.paidP)}</span>
                  </button>

                  {/* totals strip */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <MiniStat label="Diya" v={fmtRs(t.paidP)} c="text-emerald-400" />
                    <MiniStat label="Cash" v={fmtRs(t.cashP)} c="text-slate-200" />
                    <MiniStat label="JAMA" v={fmtRs(t.jamaP)} c="text-sky-400" />
                    <MiniStat label="Haath me" v={fmtRs(t.haathP)} c={t.haathP >= 0 ? 'text-amber-300' : 'text-rose-400'} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black text-emerald-400">CASH {fmtRs(t.cashP)}</span>
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-black text-sky-400">UPI {fmtRs(t.upiP)}</span>
                    <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-black text-purple-400">CHEQUE {fmtRs(t.cheqP)}</span>
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black text-amber-400">GR {fmtRs(t.grP)}</span>
                    <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[9px] font-black text-slate-300">LESS {fmtRs(t.lessP)}</span>
                  </div>

                  {open && (
                    <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                      {/* entries */}
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Shop-wise hisab</p>
                      {entries.length === 0 && <p className="text-[11px] text-slate-600">Koi shop hisab nahi — salesman app me bharega</p>}
                      {entries.map((e, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px]">
                          <span className="text-slate-500">{e.cityName}</span>
                          <span className="font-bold text-white">{e.shopName}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${MODE_CLS[e.mode] || ''}`}>{MODE_LBL[e.mode] || '—'} {fmtRs(e.paidP)}</span>
                          {e.grP > 0 && <span className="text-[9px] font-bold text-amber-400">GR {fmtRs(e.grP)}</span>}
                          {e.lessP > 0 && <span className="text-[9px] font-bold text-slate-400">Less {fmtRs(e.lessP)}</span>}
                          {e.note && <span className="text-[9px] text-slate-500">"{e.note}"</span>}
                          <span className="ml-auto text-[9px] text-slate-600">{fmtTime(e.at)}</span>
                        </div>
                      ))}

                      {/* deposits (JAMA) */}
                      <p className="flex items-center gap-1.5 pt-1 text-[10px] font-black uppercase tracking-widest text-slate-500"><Landmark className="h-3 w-3" /> Jama (kaha kiya)</p>
                      {deposits.length === 0 && <p className="text-[11px] text-slate-600">Koi jama nahi</p>}
                      {deposits.map((d, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px]">
                          <Wallet className="h-3.5 w-3.5 text-sky-400" />
                          <span className="font-black text-sky-300">{fmtRs(d.amtP)}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${MODE_CLS[d.mode] || ''}`}>{MODE_LBL[d.mode] || '—'}</span>
                          <span className="text-slate-300">jama kiya: <b className="text-white">{d.place || '—'}</b></span>
                          {d.note && <span className="text-[9px] text-slate-500">"{d.note}"</span>}
                          <span className="ml-auto text-[9px] text-slate-600">{fmtTime(d.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* tour cities mini summary */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h4 className="mb-2 text-xs font-black text-white">Tour ka Miracle data ({selTour.cities.length} cities)</h4>
            <div className="grid gap-2 md:grid-cols-3">
              {selTour.cities.map((c, i) => (
                <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-black text-white"><MapPin className="h-3.5 w-3.5 text-cyan-400" /> {c.name} {c.date && <span className="text-[9px] font-bold text-slate-500">{c.date}</span>}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{c.shops.length} shops · bills {fmtRs(c.shops.reduce((a, s) => a + s.billsP, 0))}</p>
                  {(c.cashP || c.upiP || c.cheqP) && (
                    <p className="mt-0.5 text-[10px] text-slate-500">Payment-details: C {fmtRs(c.cashP || 0)} · U {fmtRs(c.upiP || 0)} · Q {fmtRs(c.cheqP || 0)}{c.note ? ` · ${c.note}` : ''}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PasteStat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black tabular-nums ${cls || 'text-white'}`}>{value}</p>
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

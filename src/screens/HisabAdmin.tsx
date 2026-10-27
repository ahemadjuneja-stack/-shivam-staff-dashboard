import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { parseMiracleSheet, ParsedSheetData } from '../parser';
import { UserProfile, Sheet, LedgerEntry } from '../types';

export default function HisabAdminScreen() {
  const [salesReps, setSalesReps] = useState<UserProfile[]>([]);
  const [selectedRepUid, setSelectedRepUid] = useState<string>('');
  const [rawText, setRawText] = useState('');
  const [targetMonth, setTargetMonth] = useState('2026-10');
  const [defaultCity, setDefaultCity] = useState('DEESA');
  const [parsedPreview, setParsedPreview] = useState<ParsedSheetData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [sheetEntries, setSheetEntries] = useState<LedgerEntry[]>([]);
  const [msg, setMsg] = useState('');

  // 1. Fetch Sales Staff
  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      where('status', '==', 'active'),
      where('role', 'in', ['sales', 'salesman', 'sales_manager'])
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((d) => list.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
      setSalesReps(list);
      if (list.length > 0 && !selectedRepUid) setSelectedRepUid(list[0].uid);
    });
    return () => unsub();
  }, []);

  // 2. Fetch All Sheets
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'sheets'), (snapshot) => {
      const list: Sheet[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Sheet, 'id'>) }));
      setSheets(list);
      if (list.length > 0 && !selectedSheetId) setSelectedSheetId(list[0].id);
    });
    return () => unsub();
  }, []);

  // 3. Fetch entries for selected sheet to mark Miracle Copied
  useEffect(() => {
    if (!selectedSheetId) {
      setSheetEntries([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'sheets', selectedSheetId, 'entries'), (snapshot) => {
      const list: LedgerEntry[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<LedgerEntry, 'id'>) }));
      setSheetEntries(list);
    });
    return () => unsub();
  }, [selectedSheetId]);

  const handleParse = () => {
    if (!rawText.trim()) return;
    const result = parseMiracleSheet(rawText, defaultCity);
    setParsedPreview(result);
  };

  const handleUploadSheet = async () => {
    if (!parsedPreview || !selectedRepUid) {
      setMsg('Kripya sheet parse karein aur sales rep select karein.');
      return;
    }
    setIsUploading(true);
    setMsg('');

    try {
      const rep = salesReps.find((r) => r.uid === selectedRepUid);
      const sheetId = `${parsedPreview.city.toLowerCase()}_${targetMonth}`;
      const batch = writeBatch(db);

      // Sheet Parent Document
      const sheetRef = doc(db, 'sheets', sheetId);
      batch.set(sheetRef, {
        month: targetMonth,
        city: parsedPreview.city,
        assignedTo: selectedRepUid,
        assignedName: rep?.name || 'Sales Staff',
        status: 'active',
        createdAt: Date.now()
      });

      // Customers & Bills Subcollections
      for (const item of parsedPreview.customers) {
        const custRef = doc(db, 'sheets', sheetId, 'customers', item.customer.code);
        batch.set(custRef, item.customer);

        item.bills.forEach((bill, idx) => {
          const billRef = doc(db, 'sheets', sheetId, 'customers', item.customer.code, 'bills', `bill_${idx}`);
          batch.set(billRef, bill);
        });
      }

      await batch.commit();
      setMsg(`Sheet "${parsedPreview.city}" uploaded and assigned to ${rep?.name}!`);
      setParsedPreview(null);
      setRawText('');
    } catch (err: any) {
      setMsg(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleMiracle = async (entryId: string, currentStatus: boolean) => {
    if (!selectedSheetId) return;
    try {
      await updateDoc(doc(db, 'sheets', selectedSheetId, 'entries', entryId), {
        miracle: !currentStatus
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-base font-bold text-white tracking-wide">HISAB UPLOAD &amp; MIRACLE SYNC</h2>
        <p className="text-xs text-slate-400">Miracle software export paste karke parse karein aur phone app ko assign karein.</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* Sheet Paste & Parse Box */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white">Upload New Miracle Sheet</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400">Assign To Sales Rep</label>
            <select
              value={selectedRepUid}
              onChange={(e) => setSelectedRepUid(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white"
            >
              {salesReps.map((r) => (
                <option key={r.uid} value={r.uid}>{r.name} ({r.city})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Target Month (YYYY-MM)</label>
            <input
              type="text"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              placeholder="2026-10"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Default City / Station</label>
            <input
              type="text"
              value={defaultCity}
              onChange={(e) => setDefaultCity(e.target.value)}
              placeholder="DEESA"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">Paste Miracle Export Sheet Raw Text Here</label>
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste raw export text (Order Pad lines will be auto-ignored)..."
            className="mt-1 w-full font-mono text-xs rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <button
          onClick={handleParse}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 shadow"
        >
          Parse Sheet Preview
        </button>

        {/* Parsed Preview Table */}
        {parsedPreview && (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-indigo-400">
                Detected Route: {parsedPreview.city} ({parsedPreview.customers.length} Customers)
              </span>
              <span className="text-slate-400">
                Total Opening: ₹{parsedPreview.totalOpening.toLocaleString('en-IN')}
              </span>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {parsedPreview.customers.map((c, i) => (
                <div key={i} className="flex justify-between text-[11px] p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="font-semibold text-white">{c.customer.code} - {c.customer.name}</span>
                  <span className="font-mono text-emerald-400">₹{c.customer.balance.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleUploadSheet}
              disabled={isUploading}
              className="w-full rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-lg"
            >
              {isUploading ? 'Uploading to Firestore...' : 'Confirm & Send Sheet to Sales Phone'}
            </button>
          </div>
        )}
      </div>

      {/* Month-End Miracle Reconciliation Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-white">Month-End Miracle Software Reconciliation</h3>
          <select
            value={selectedSheetId || ''}
            onChange={(e) => setSelectedSheetId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-xs text-white"
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>{s.city} ({s.month}) - {s.assignedName}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 uppercase text-[10px] text-slate-400">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Mode</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Miracle Software Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sheetEntries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/30">
                  <td className="p-3 text-slate-400">{new Date(e.at).toLocaleDateString()}</td>
                  <td className="p-3 font-bold text-white">{e.cname}</td>
                  <td className="p-3">{e.mode === 1 ? 'Cash' : e.mode === 2 ? 'UPI' : 'Cheque'}</td>
                  <td className="p-3 font-mono font-bold text-emerald-400">₹{e.amount}</td>
                  <td className="p-3">
                    <button
                      onClick={() => e.id && handleToggleMiracle(e.id, e.miracle)}
                      className={`px-3 py-1 rounded text-xs font-bold transition ${
                        e.miracle
                          ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/40'
                      }`}
                    >
                      {e.miracle ? '✓ Copied to Miracle' : 'Mark as Copied'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

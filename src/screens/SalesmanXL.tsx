import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, Sheet } from '../types';
import { LogOut, FileSpreadsheet, AlertCircle, MapPin, CheckCircle2 } from 'lucide-react';

interface SalesmanXLProps {
  currentUser: { uid: string; email?: string | null };
  userProfile: UserProfile | null;
  onLogout: () => void;
}

export default function SalesmanXL({ currentUser, userProfile, onLogout }: SalesmanXLProps) {
  const [activeSheets, setActiveSheets] = useState<Sheet[]>([]);
  const [selectedSheetNotice, setSelectedSheetNotice] = useState<string | null>(null);

  const xlCities = userProfile?.xlCities || [];

  // Query active sheets
  useEffect(() => {
    const q = query(collection(db, 'sheets'), where('status', '==', 'active'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Sheet[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<Sheet, 'id'>) });
      });
      setActiveSheets(list);
    }, (err) => console.warn('Sheets listener error:', err));
    return () => unsub();
  }, []);

  // Filter sheets whose city is in xlCities (case-insensitive comparison just in case)
  const normalizedXlCities = xlCities.map(c => c.trim().toLowerCase());
  const filteredSheets = activeSheets.filter(sheet => {
    const sheetCity = (sheet.city || '').trim().toLowerCase();
    return normalizedXlCities.includes(sheetCity);
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black shadow-lg shadow-blue-600/30">
            XL
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider text-white">SHIVAM STAFF</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Salesman XL Sheets</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-white">{userProfile?.name || currentUser.email}</p>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Salesman
            </span>
          </div>
          <button
            onClick={onLogout}
            title="Logout"
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Notice popup if sheet clicked */}
      {selectedSheetNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-white">Sheet Details</h3>
            <p className="text-xs text-slate-300 bg-slate-800/80 p-3 rounded-xl border border-slate-700 font-medium">
              {selectedSheetNotice}
            </p>
            <p className="text-[11px] text-amber-400 font-semibold">
              Detail view coming soon — full XL sheet editing page will be available shortly.
            </p>
            <button
              onClick={() => setSelectedSheetNotice(null)}
              className="w-full rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white shadow hover:bg-blue-500 transition"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full space-y-6">
        {/* Header & Permitted Cities */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-400" />
              Active Miracle XL Sheets
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Access active sheets for your permitted operating cities.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Permitted Cities:</span>
            {xlCities.length === 0 ? (
              <span className="rounded-lg bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-400 border border-rose-500/20">
                No City Assigned
              </span>
            ) : (
              xlCities.map((city, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs font-bold text-blue-300 border border-blue-500/20">
                  <MapPin className="h-3 w-3 text-blue-400" />
                  {city}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Sheets Listing / Empty State */}
        {xlCities.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xl font-bold">
              ⚠️
            </div>
            <p className="text-sm font-bold text-white">No XL permission yet. Contact admin.</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              XL permission is granted by admin from Staff Management (assigning operating cities).
            </p>
          </div>
        ) : filteredSheets.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-slate-400 text-xl font-bold">
              📂
            </div>
            <p className="text-sm font-bold text-slate-300">No active sheets found for your cities ({xlCities.join(', ')})</p>
            <p className="text-xs text-slate-500">Active sheets uploaded by admin for your cities will appear here instantly.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSheets.map((sheet) => (
              <div
                key={sheet.id}
                onClick={() => setSelectedSheetNotice(`Sheet: ${sheet.id} (${sheet.month}) — City: ${sheet.city}`)}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg hover:border-blue-500/50 hover:bg-slate-850 transition cursor-pointer flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 font-mono">
                        Month: {sheet.month}
                      </span>
                      <h4 className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        {sheet.city}
                      </h4>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Active
                    </span>
                  </div>

                  <div className="mt-4 text-xs text-slate-400 space-y-1 border-t border-slate-800 pt-3">
                    <p>Assigned To: <strong className="text-slate-200">{sheet.assignedName || 'Salesman'}</strong></p>
                    <p>Created: <span className="text-slate-400">{sheet.createdAt ? new Date(sheet.createdAt).toLocaleDateString() : 'N/A'}</span></p>
                  </div>
                </div>

                <div className="pt-2 text-right">
                  <span className="text-xs font-bold text-blue-400 hover:text-blue-300 transition">
                    Open Sheet →
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

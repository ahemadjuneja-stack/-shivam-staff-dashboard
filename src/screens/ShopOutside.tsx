import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { MapPin, Check, X, AlertTriangle, Navigation, Clock, ShieldCheck, History } from 'lucide-react';

interface ShopConfig {
  lat?: number;
  lng?: number;
  radius?: number;
  name?: string;
}

interface OutsideLog {
  id: string;
  uid: string;
  name: string;
  fromAt: number;
  toAt: number;
  outsideMin: number;
  lat: number;
  lng: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  cutApplied?: boolean;
}

export default function ShopOutsideScreen() {
  // Shop Config State
  const [shopConfig, setShopConfig] = useState<ShopConfig | null>(null);
  const [shopNameInput, setShopNameInput] = useState('');
  const [radiusInput, setRadiusInput] = useState<number>(100);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);

  // Outside Logs State
  const [pendingLogs, setPendingLogs] = useState<OutsideLog[]>([]);
  const [historyLogs, setHistoryLogs] = useState<OutsideLog[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // 1. Fetch Shop Config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'shop_config', 'default'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as ShopConfig;
        setShopConfig(data);
        if (data.name) setShopNameInput(data.name);
        if (data.radius) setRadiusInput(data.radius);
      } else {
        setShopConfig(null);
      }
    }, (err) => console.warn('Shop config listener error:', err));
    return () => unsub();
  }, []);

  // 2. Fetch Pending Outside Logs
  useEffect(() => {
    const q = query(
      collection(db, 'outside_logs'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: OutsideLog[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<OutsideLog, 'id'>) });
      });
      // Sort client-side by createdAt desc
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setPendingLogs(list.slice(0, 20));
    }, (err) => console.warn('Pending outside logs error:', err));
    return () => unsub();
  }, []);

  // 3. Fetch History Outside Logs (approved / rejected)
  useEffect(() => {
    const q = query(
      collection(db, 'outside_logs'),
      where('status', 'in', ['approved', 'rejected'])
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: OutsideLog[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<OutsideLog, 'id'>) });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setHistoryLogs(list.slice(0, 10));
    }, (err) => console.warn('History outside logs error:', err));
    return () => unsub();
  }, []);

  // Geolocation Handler for Shop Location Setup
  const handleUseCurrentLocation = () => {
    setGeoLoading(true);
    setGeoError(null);
    setShopMsg(null);

    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser');
      setGeoLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
          await setDoc(
            doc(db, 'shop_config', 'default'),
            {
              lat,
              lng,
              radius: Number(radiusInput) || 100,
              name: shopNameInput.trim() || 'Main Shop'
            },
            { merge: true }
          );
          setShopMsg('✅ Shop location saved successfully using your current GPS coordinates!');
        } catch (err: any) {
          setGeoError(`Failed to save location: ${err.message}`);
        } finally {
          setGeoLoading(false);
        }
      },
      (error) => {
        setGeoError(`Geolocation error: ${error.message}`);
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Handle Outside Log Decision (Approve / Reject)
  const handleLogDecision = async (logId: string, approve: boolean) => {
    setActionMsg(null);
    try {
      await updateDoc(doc(db, 'outside_logs', logId), {
        status: approve ? 'approved' : 'rejected'
      });
      setActionMsg(approve ? '✅ Outside log approved (Shop Work).' : '❌ Outside log rejected.');
      setTimeout(() => setActionMsg(null), 4000);
    } catch (err: any) {
      setActionMsg(`Error updating log: ${err.message}`);
    }
  };

  const formatDateRange = (fromAt: number, toAt: number) => {
    try {
      const f = new Date(fromAt);
      const t = new Date(toAt);
      const dateStr = f.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-');
      const timeF = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const timeT = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${dateStr} • ${timeF} to ${timeT}`;
    } catch {
      return 'Time unavailable';
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-2">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-400" />
            SHOP LOCATION &amp; OUTSIDE ALERTS
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure geofence shop coordinates and review staff outside-duty duration alerts.
          </p>
        </div>
      </div>

      {shopMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-300">
          {shopMsg}
        </div>
      )}

      {geoError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-semibold text-rose-300">
          {geoError}
        </div>
      )}

      {/* 1) SHOP LOCATION SETUP CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Navigation className="h-4 w-4 text-emerald-400" />
            Shop Geofence Location Setup
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded border border-indigo-500/20">
            Manager Control
          </span>
        </div>

        {!shopConfig || shopConfig.lat === undefined || shopConfig.lng === undefined ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xl font-bold">
              ⚠️
            </div>
            <div>
              <p className="text-sm font-bold text-amber-300">Shop location not set</p>
              <p className="text-xs text-slate-400 mt-1">Set your shop coordinates so geofence punch tracking can calculate distance accurately.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto pt-2">
              <input
                type="text"
                value={shopNameInput}
                onChange={(e) => setShopNameInput(e.target.value)}
                placeholder="Shop Name (e.g. Main Showroom)"
                className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="number"
                value={radiusInput}
                onChange={(e) => setRadiusInput(Number(e.target.value))}
                placeholder="Radius in meters (e.g. 100)"
                className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={geoLoading}
              className="rounded-xl bg-emerald-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
            >
              {geoLoading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              <span>📍 Use My Current Location</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Shop Name</p>
                <p className="text-sm font-bold text-white mt-1">{shopConfig.name || 'Main Showroom'}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Coordinates</p>
                <p className="text-xs font-mono font-bold text-emerald-400 mt-1">
                  {shopConfig.lat.toFixed(6)}, {shopConfig.lng.toFixed(6)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Geofence Radius</p>
                <p className="text-sm font-bold text-indigo-400 mt-1">{shopConfig.radius || 100} meters</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <a
                href={`https://maps.google.com/?q=${shopConfig.lat},${shopConfig.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-emerald-400 hover:underline flex items-center gap-1.5"
              >
                <span>🗺️</span> Open Shop in Google Maps →
              </a>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={shopNameInput}
                  onChange={(e) => setShopNameInput(e.target.value)}
                  placeholder="Shop Name"
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"
                />
                <input
                  type="number"
                  value={radiusInput}
                  onChange={(e) => setRadiusInput(Number(e.target.value))}
                  placeholder="Radius (m)"
                  className="w-24 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={geoLoading}
                  className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition shrink-0"
                >
                  {geoLoading ? 'Updating...' : 'Update GPS'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2) OUTSIDE ALERTS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span>🚨</span> Pending Outside Duty Alerts ({pendingLogs.length})
          </h3>
          <span className="text-xs text-slate-400">Review staff outside duration requests</span>
        </div>

        {actionMsg && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-xs font-semibold text-indigo-300">
            {actionMsg}
          </div>
        )}

        {pendingLogs.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400 text-xl font-bold">
              ✓
            </div>
            <p className="text-sm font-semibold text-slate-300">No pending outside alerts</p>
            <p className="text-xs text-slate-500">Staff outside duty requests will appear here instantly in real-time.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">{log.name}</h4>
                      <p className="text-xs font-mono text-amber-400 font-bold mt-0.5">
                        ⏳ {log.outsideMin || 0} min outside
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                      PENDING
                    </span>
                  </div>

                  <div className="mt-3 text-xs text-slate-300 space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <p className="flex items-center gap-1.5 text-slate-400">
                      <Clock className="h-3.5 w-3.5 text-indigo-400" />
                      <span>{formatDateRange(log.fromAt, log.toAt)}</span>
                    </p>
                    {log.lat && log.lng && (
                      <p className="flex items-center gap-1.5 pt-1 border-t border-slate-900">
                        <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                        <a
                          href={`https://maps.google.com/?q=${log.lat},${log.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:underline font-mono text-[11px]"
                        >
                          View Location on Google Maps →
                        </a>
                      </p>
                    )}
                  </div>
                </div>

                {/* YES / NO Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleLogDecision(log.id, true)}
                    className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition flex items-center justify-center gap-1.5"
                  >
                    <Check className="h-4 w-4" /> YES (Shop Work)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogDecision(log.id, false)}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition flex items-center justify-center gap-1.5"
                  >
                    <X className="h-4 w-4" /> NO (Not Allowed)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3) PROCESSED HISTORY SECTION */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white transition"
          >
            <span><History className="h-4 w-4 text-indigo-400" /></span>
            <span>Processed History (Last {historyLogs.length})</span>
            <span className="text-[10px] text-slate-500">({showHistory ? 'Hide' : 'Show'})</span>
          </button>
        </div>

        {showHistory && (
          <div className="space-y-2.5">
            {historyLogs.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                No processed history logs yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {historyLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white">{log.name}</h4>
                        <span className="text-[11px] text-slate-400 font-mono">({log.outsideMin || 0} min)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{formatDateRange(log.fromAt, log.toAt)}</p>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase border ${
                      log.status === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                    }`}>
                      {log.status === 'approved' ? '✓ Approved' : '✕ Rejected'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

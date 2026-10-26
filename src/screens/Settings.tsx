import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { SHOP_CENTER_LOCKED, SHOP_ADDRESS_LOCKED } from '../shopLocation';
import { ShopConfig } from '../types';

interface SettingsProps {
  currentUser: User | null;
}

export default function SettingsScreen({ currentUser }: SettingsProps) {
  const [shopName, setShopName] = useState('SHIVAM');
  const [radius, setRadius] = useState<number>(100);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const fetchConfig = async () => {
      const snap = await getDoc(doc(db, 'config', 'shop'));
      if (snap.exists()) {
        const data = snap.data() as ShopConfig;
        setShopName(data.name || 'SHIVAM');
        setRadius(data.radius || 100);
        setShiftStart(data.shiftStart || '09:00');
      }
    };
    fetchConfig();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      // BOSS-LOCKED CENTER: lat/lng hamesha Boss ke exact shop coords —
      // inputs se koi aur location aa hi nahi sakti ("Aur koi nahi dena")
      await setDoc(doc(db, 'config', 'shop'), {
        name: shopName,
        lat: SHOP_CENTER_LOCKED.lat,
        lng: SHOP_CENTER_LOCKED.lng,
        radius: Number(radius),
        shiftStart
      });
      setMsg('Shop settings update ho gayi! (Location Boss-locked — sirf radius/shift change hota hai)');
    } catch (err: unknown) {
      const error = err as Error;
      setMsg(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-base font-bold text-white tracking-wide">SYSTEM SETTINGS</h2>
        <p className="text-xs text-slate-400">Shop geofence GPS and late punch cutoff settings.</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* Geofence Form */}
      <form onSubmit={handleSaveConfig} className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white">Shop Radius &amp; Duty Timings</h3>

        <div>
          <label className="text-xs text-slate-400">Shop Name (Locked Brand)</label>
          <input
            type="text"
            disabled
            value={shopName}
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-800/40 p-2.5 text-xs text-slate-400"
          />
        </div>

        {/* BOSS-LOCKED LOCATION (2026-10-26) — "Hamare shop ka exect location
            ye hai... Aur koi nahi dena" — center permanent, inputs removed */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1">
          <p className="text-xs font-bold text-emerald-300">Shop Location BOSS-LOCKED</p>
          <p className="text-xs text-slate-300">{SHOP_ADDRESS_LOCKED}</p>
          <p className="text-xs font-mono text-emerald-400">Lat {SHOP_CENTER_LOCKED.lat}, Lng {SHOP_CENTER_LOCKED.lng}</p>
          <p className="text-[11px] text-slate-400">Ye exact Google Maps location Boss ne di hai — koi aur location configurable nahi hai. Staff app geofence isi center se chalega.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="text-xs text-slate-400">Geofence Radius (Meters)</label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              placeholder="100"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Shift Start Time (HH:MM)</label>
            <input
              type="time"
              value={shiftStart}
              onChange={(e) => setShiftStart(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-lg"
        >
          {loading ? 'Saving...' : 'Save Geofence Settings'}
        </button>
      </form>

      {/* Read-Only Admin Info */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg space-y-2">
        <h3 className="text-sm font-bold text-white">Admin Management</h3>
        <p className="text-xs text-slate-400 font-medium">
          Admins sirf Firebase Console se manage hote hain.
        </p>
        {currentUser && (
          <p className="text-[11px] font-mono text-slate-500">
            Current UID: {currentUser.uid}
          </p>
        )}
      </div>
    </div>
  );
}

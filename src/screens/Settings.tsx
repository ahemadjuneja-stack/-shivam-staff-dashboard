import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { ShopConfig } from '../types';

interface SettingsProps {
  currentUser: User | null;
  onAdminUpdated: () => void;
}

export default function SettingsScreen({ currentUser, onAdminUpdated }: SettingsProps) {
  const [shopName, setShopName] = useState('SHIVAM');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
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
        setLat(data.lat || 0);
        setLng(data.lng || 0);
        setRadius(data.radius || 100);
        setShiftStart(data.shiftStart || '09:00');
      }
    };
    fetchConfig();
  }, []);

  const handleCaptureCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMsg('Browser geolocation not supported.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setMsg('Dukaan ki live GPS location capture ho gayi!');
      },
      (err) => setMsg(`GPS Error: ${err.message}`),
      { enableHighAccuracy: true }
    );
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      await setDoc(doc(db, 'config', 'shop'), {
        name: shopName,
        lat,
        lng,
        radius: Number(radius),
        shiftStart
      });
      setMsg('Shop Geofence & Duty settings update ho gayi!');
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterAsAdmin = async () => {
    if (!currentUser) return;
    try {
      await setDoc(doc(db, 'admins', currentUser.uid), {
        name: 'Owner Admin',
        email: currentUser.email,
        createdAt: Date.now()
      });
      onAdminUpdated();
      setMsg('Aapka UID admins collection me add ho gaya hai!');
    } catch (err: any) {
      setMsg(`Admin update failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-base font-bold text-white tracking-wide">SYSTEM SETTINGS</h2>
        <p className="text-xs text-slate-400">Shop geofence GPS, late punch cutoff, aur admin authorization.</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* Geofence Form */}
      <form onSubmit={handleSaveConfig} className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white">Shop Geofence &amp; Duty Timings</h3>

        <div>
          <label className="text-xs text-slate-400">Shop Name (Locked Brand)</label>
          <input
            type="text"
            disabled
            value={shopName}
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-800/40 p-2.5 text-xs text-slate-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Latitude</label>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(parseFloat(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Longitude</label>
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(parseFloat(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleCaptureCurrentLocation}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
        >
          📍 Dukaan me baith kar Live Location Capture Karein
        </button>

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

      {/* Admin Authorization Helper Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg space-y-3">
        <h3 className="text-sm font-bold text-white">Admin UID Authorization</h3>
        <p className="text-xs text-slate-400">
          Agar dashboard me "ADMIN DOC MISSING" warning dikh rahi hai, to neeche button dabakar apne account ko admins collection me register karein.
        </p>
        <button
          onClick={handleRegisterAsAdmin}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 shadow"
        >
          Mujhe Admin Banao (Authorize My UID)
        </button>
      </div>
    </div>
  );
}

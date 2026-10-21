import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { ShopConfig } from '../types';

interface SettingsProps {
  currentUser: User | null;
}

export default function SettingsScreen({ currentUser }: SettingsProps) {
  const [shopName, setShopName] = useState('SHIVAM');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [radius, setRadius] = useState<number>(100);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Migration state
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);

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
    } catch (err: unknown) {
      const error = err as Error;
      setMsg(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunMigration = async () => {
    if (!window.confirm('Kya aap staff_users se users collection me data copy karna chahte hain?')) return;
    setMigrating(true);
    setMigrationResult(null);
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errorsList: string[] = [];

    try {
      const querySnapshot = await getDocs(collection(db, 'staff_users'));
      for (const d of querySnapshot.docs) {
        try {
          const sameId = d.id;
          const data = d.data();
          const targetRef = doc(db, 'users', sameId);
          const targetSnap = await getDoc(targetRef);
          if (!targetSnap.exists()) {
            await setDoc(targetRef, data);
            migratedCount++;
          } else {
            skippedCount++;
          }
        } catch (err: any) {
          errorCount++;
          errorsList.push(`ID ${d.id}: ${err.message}`);
        }
      }
      setMigrationResult(`Migration complete: ${migratedCount} migrate hue, ${skippedCount} already the (skipped), ${errorCount} errors.`);
      if (errorsList.length > 0) {
        console.warn('Migration errors:', errorsList);
      }
    } catch (err: any) {
      setMigrationResult(`Migration failed: ${err.message}`);
    } finally {
      setMigrating(false);
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

      {/* MIGRATION (one-time) Card */}
      <div className="rounded-2xl border border-indigo-900/40 bg-slate-900 p-6 shadow-lg space-y-3">
        <h3 className="text-sm font-bold text-white">MIGRATION (one-time)</h3>
        <p className="text-xs text-slate-400">
          Copy existing staff registrations from legacy <code className="text-indigo-300">staff_users</code> collection into the standardized <code className="text-indigo-300">users</code> collection.
        </p>
        <button
          type="button"
          disabled={migrating}
          onClick={handleRunMigration}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 shadow"
        >
          {migrating ? 'Migrating...' : 'staff_users → users copy karein'}
        </button>
        {migrationResult && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
            {migrationResult}
          </div>
        )}
      </div>

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

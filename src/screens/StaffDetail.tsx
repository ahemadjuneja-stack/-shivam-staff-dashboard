import React, { useEffect, useState } from 'react';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkLog, StarEvent } from '../types';
import { getRoleDefinition } from '../roles';
import {
  ArrowLeft,
  Smartphone,
  MapPin,
  Star,
  CheckSquare,
  Clock,
  ExternalLink,
  Shield,
  Activity
} from 'lucide-react';

interface StaffDetailProps {
  uid: string;
  onBack: () => void;
}

interface TaskItem {
  id: string;
  title: string;
  startAt?: number;
  deadlineAt?: string;
  status?: 'pending' | 'completed' | 'rejected';
}

interface PunchItem {
  id: string;
  type: 'in' | 'out';
  at: number;
  distM?: number;
  dist?: number;
}

export default function StaffDetail({ uid, onBack }: StaffDetailProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditPoints, setCreditPoints] = useState<{ taskScore?: number; hoursScore?: number }>({ taskScore: 0, hoursScore: 0 });
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [punches, setPunches] = useState<PunchItem[]>([]);

  // 1. Fetch user profile live
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', uid), (docSnap) => {
      if (docSnap.exists()) {
        setProfile({ uid: docSnap.id, ...(docSnap.data() as Omit<UserProfile, 'uid'>) });
      }
      setLoading(false);
    }, (err) => {
      console.warn('Staff profile listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  // 2. Fetch credit score live
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'credit_points', uid), (docSnap) => {
      if (docSnap.exists()) {
        setCreditPoints(docSnap.data() as any);
      }
    }, () => {});
    return () => unsub();
  }, [uid]);

  // 3. Fetch tasks live (where toUid == uid)
  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('toUid', '==', uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: TaskItem[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<TaskItem, 'id'>) });
      });
      list.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
      setTasks(list);
    }, () => {});
    return () => unsub();
  }, [uid]);

  // 4. Fetch punches live (where uid == uid)
  useEffect(() => {
    const q = query(collection(db, 'punches'), where('uid', '==', uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: PunchItem[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<PunchItem, 'id'>) });
      });
      list.sort((a, b) => b.at - a.at);
      setPunches(list);
    }, () => {});
    return () => unsub();
  }, [uid]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4 p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="rounded-2xl border border-rose-900/50 bg-slate-900 p-8 text-center text-rose-400">
          Staff profile not found.
        </div>
      </div>
    );
  }

  const roleDef = getRoleDefinition(profile.role);

  // Relative time helpers
  const formatRelativeTime = (timestamp?: number) => {
    if (!timestamp) return '—';
    const diffMin = Math.floor((Date.now() - timestamp) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs} hrs ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays} days ago`;
  };

  const lastSeenMin = profile.lastSeenAt ? Math.floor((Date.now() - profile.lastSeenAt) / 60000) : null;
  const isLastSeenStale = lastSeenMin !== null && lastSeenMin > 1440; // > 24 hours

  const loc = profile.lastLocation;
  const locAgeMin = loc?.at ? Math.floor((Date.now() - loc.at) / 60000) : null;
  const isLocStale = locAgeMin !== null && locAgeMin > 30; // > 30 min

  // Credit score calculation
  const taskScore = Number(creditPoints.taskScore || 0);
  const hoursScore = Number(creditPoints.hoursScore || 0);
  const rawTotal = taskScore + hoursScore;
  const creditTotal = Math.max(0, Math.min(100, rawTotal));

  // Tasks summary counts
  const pendingTasksCount = tasks.filter(t => t.status === 'pending' || !t.status).length;
  const completedTasksCount = tasks.filter(t => t.status === 'completed').length;
  const rejectedTasksCount = tasks.filter(t => t.status === 'rejected').length;
  const recentTasks = tasks.slice(0, 5);

  // Today's punches calculation
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayPunches = punches.filter(p => p.at >= midnight).sort((a, b) => a.at - b.at);
  const firstInToday = todayPunches.find(p => p.type === 'in');
  const lastOutToday = [...todayPunches].reverse().find(p => p.type === 'out');
  const recentPunches = punches.slice(0, 10);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Top Navigation Back */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
        <span className="text-xs text-slate-400 font-mono">UID: {profile.uid}</span>
      </div>

      {/* 1. HEADER CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-white">{profile.name}</h2>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${roleDef.badgeClass}`}>
                <span className={`h-2 w-2 rounded-full ${roleDef.dotColor}`} />
                {roleDef.label}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                profile.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                profile.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
                {profile.status}
              </span>
            </div>
            <p className="text-xs font-mono text-indigo-400">{profile.mobile}</p>
          </div>

          <div className="text-xs text-slate-400 space-y-1 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <p>City / Location: <strong className="text-slate-200">{profile.city || 'Head Office'}</strong></p>
            <p>Joined Date: <span className="text-slate-300">{profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : 'N/A'}</span></p>
          </div>
        </div>

        {/* Salesman XL Cities if applicable */}
        {profile.xlCities && profile.xlCities.length > 0 && (
          <div className="pt-3 border-t border-slate-800 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-400">Assigned XL Cities:</span>
            {profile.xlCities.map((city, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs font-bold">
                <MapPin className="h-3 w-3 text-blue-400" />
                {city}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Grid of Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 2. DEVICE & APP CARD */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Smartphone className="h-4 w-4 text-sky-400" />
            Device &amp; App Information
          </h3>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400">Phone Model</span>
              <strong className="text-white font-mono">{profile.deviceModel || '—'}</strong>
            </div>
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400">Android OS Version</span>
              <strong className="text-white font-mono">{profile.osVersion || '—'}</strong>
            </div>
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400">App Version</span>
              <strong className="text-indigo-300 font-mono">
                {profile.appVersion ? `${profile.appVersion} (${profile.appVersionCode || '—'})` : '—'}
              </strong>
            </div>
            <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400">Last Seen App Active</span>
              <strong className={`font-mono ${isLastSeenStale ? 'text-rose-400' : 'text-emerald-400'}`}>
                {formatRelativeTime(profile.lastSeenAt)}
              </strong>
            </div>
          </div>
        </div>

        {/* 3. LIVE LOCATION CARD */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <MapPin className="h-4 w-4 text-emerald-400" />
              Live GPS Location
            </h3>

            {!profile.lastLocation ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No location reported yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Latitude, Longitude</span>
                  <strong className="text-white font-mono">
                    {profile.lastLocation.lat.toFixed(6)}, {profile.lastLocation.lng.toFixed(6)}
                  </strong>
                </div>
                <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Location Updated</span>
                  <span className={`font-mono font-bold ${isLocStale ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {formatRelativeTime(profile.lastLocation.at)} {isLocStale && '(Stale)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {profile.lastLocation && (
            <div className="pt-4">
              <a
                href={`https://maps.google.com/?q=${profile.lastLocation.lat},${profile.lastLocation.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
              >
                <ExternalLink className="h-4 w-4" /> Open in Google Maps
              </a>
            </div>
          )}
        </div>

        {/* 4. CREDIT SCORE CARD */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Star className="h-4 w-4 text-amber-400" />
            Performance Credit Score
          </h3>

          <div className="flex flex-col items-center justify-center text-center space-y-3 py-2">
            <div className="text-3xl font-black font-mono text-amber-400 flex items-center gap-1">
              <span>⭐</span> {creditTotal} <span className="text-sm text-slate-500 font-normal">/ 100</span>
            </div>

            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-slate-700">
              <div 
                className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${creditTotal}%` }}
              />
            </div>

            <div className="pt-2 text-xs text-slate-400 flex items-center justify-center gap-4 bg-slate-950 p-3 rounded-xl border border-slate-800 w-full">
              <span>Tasks Score: <strong className="text-white font-mono">{taskScore}</strong></span>
              <span className="text-slate-600">•</span>
              <span>Hours Score: <strong className="text-white font-mono">{hoursScore}</strong></span>
            </div>
          </div>
        </div>

        {/* 5. TASKS SUMMARY CARD */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-indigo-400" />
              Tasks Summary ({tasks.length})
            </h3>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Pending: {pendingTasksCount}</span>
              <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Done: {completedTasksCount}</span>
            </div>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto">
            {recentTasks.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No tasks assigned.</p>
            ) : (
              recentTasks.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-white">{t.title}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Deadline: <strong className="text-slate-300">{t.deadlineAt || 'N/A'}</strong>
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    t.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    t.status === 'rejected' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                    'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {t.status || 'pending'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 6. RECENT PUNCHES CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-400" />
            Recent Duty Punches ({punches.length})
          </h3>
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
            <span>First In: <strong className="text-emerald-400">{firstInToday ? new Date(firstInToday.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></span>
            <span>Last Out: <strong className="text-rose-400">{lastOutToday ? new Date(lastOutToday.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></span>
          </div>
        </div>

        {recentPunches.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">No punches recorded yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recentPunches.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 flex items-center justify-between text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${p.type === 'in' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    <span className="font-bold text-white uppercase tracking-wider">Punch {p.type}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 font-mono">
                    {new Date(p.at).toLocaleString()} • {Math.round(p.distM ?? p.dist ?? 0)}m from shop
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                  p.type === 'in' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {p.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

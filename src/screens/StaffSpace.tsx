import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { LogOut, CheckSquare, Star, Clock, AlertCircle } from 'lucide-react';

interface StaffSpaceProps {
  currentUser: { uid: string; email?: string | null };
  userProfile: UserProfile | null;
  onLogout: () => void;
}

interface TaskItem {
  id: string;
  title: string;
  startAt?: number;
  deadlineAt?: string;
  byName?: string;
  status?: 'pending' | 'completed' | 'rejected';
}

interface CreditPoints {
  taskScore?: number;
  hoursScore?: number;
  dailyScore?: number;
}

interface AttendanceDoc {
  isOnDuty?: boolean;
}

interface PunchRecordItem {
  id: string;
  type: 'in' | 'out';
  at: number;
}

export default function StaffSpace({ currentUser, userProfile, onLogout }: StaffSpaceProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [creditPoints, setCreditPoints] = useState<CreditPoints>({ taskScore: 0, hoursScore: 0, dailyScore: 0 });
  const [isOnDuty, setIsOnDuty] = useState<boolean>(false);
  const [todayPunches, setTodayPunches] = useState<PunchRecordItem[]>([]);

  const uid = currentUser.uid;

  // 1. Tasks listener (toUid == uid)
  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('toUid', '==', uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: TaskItem[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<TaskItem, 'id'>) });
      });
      // Sort by startAt or created desc if available
      list.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
      setTasks(list);
    }, (err) => console.warn('Tasks listener error:', err));
    return () => unsub();
  }, [uid]);

  // 2. Credit Score listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'credit_points', uid), (docSnap) => {
      if (docSnap.exists()) {
        setCreditPoints(docSnap.data() as CreditPoints);
      } else {
        setCreditPoints({ taskScore: 30, hoursScore: 20, dailyScore: 0 }); // default base if not present
      }
    }, (err) => console.warn('Credit points listener error:', err));
    return () => unsub();
  }, [uid]);

  // 3. Attendance & Punches listener
  useEffect(() => {
    const unsubAtt = onSnapshot(doc(db, 'staff_attendance', uid), (docSnap) => {
      if (docSnap.exists()) {
        setIsOnDuty(!!docSnap.data().isOnDuty);
      }
    }, () => {});

    // Today's midnight timestamp
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const qPunches = query(collection(db, 'punches'), where('uid', '==', uid));
    const unsubPunches = onSnapshot(qPunches, (snapshot) => {
      const list: PunchRecordItem[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as any;
        if (data.at && data.at >= midnight) {
          list.push({ id: d.id, type: data.type, at: data.at });
        }
      });
      list.sort((a, b) => a.at - b.at);
      setTodayPunches(list);
    }, () => {});

    return () => {
      unsubAtt();
      unsubPunches();
    };
  }, [uid]);

  const taskScore = Number(creditPoints.taskScore || 0);
  const hoursScore = Number(creditPoints.hoursScore || 0);
  const dailyScore = Number(creditPoints.dailyScore || 0);
  const rawTotal = taskScore + hoursScore + dailyScore;
  // BOSS Task 52: credit scale 1-300 (staff app jaisa) — floor 1, max 300
  const totalScore = Math.max(1, Math.min(300, Math.round(rawTotal)));

  const firstIn = todayPunches.find(p => p.type === 'in');
  const lastOut = [...todayPunches].reverse().find(p => p.type === 'out');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black shadow-lg shadow-indigo-600/30">
            S
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider text-white">SHIVAM STAFF</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">My Space</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-white">{userProfile?.name || currentUser.email}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Staff
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

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-6">
        {/* Welcome Banner */}
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-900/80 p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">Welcome, {userProfile?.name || 'Staff Member'}!</h2>
            <p className="text-xs text-slate-400 mt-1">
              Your daily tasks, performance credit score, and duty time records in real-time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold border ${
              isOnDuty 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}>
              <span className={`h-2.5 w-2.5 rounded-full ${isOnDuty ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {isOnDuty ? 'On Duty (Active)' : 'Off Duty'}
            </span>
          </div>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Tasks (REAL) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-indigo-400" />
                  Assigned Tasks ({tasks.length})
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Real-time sync</span>
              </div>

              <div className="mt-4 space-y-3 max-h-72 overflow-y-auto pr-1">
                {tasks.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500">
                    No tasks yet.
                  </div>
                ) : (
                  tasks.map((t) => {
                    const statusClass = t.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : t.status === 'rejected'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

                    const dateStr = t.startAt 
                      ? new Date(t.startAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-')
                      : 'Today';

                    return (
                      <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-white">{t.title}</h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${statusClass}`}>
                            {t.status || 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                          <span>Date: <strong className="text-slate-300">{dateStr}</strong></span>
                          <span>By: <strong className="text-slate-300">{t.byName || 'Admin'}</strong></span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Polls (Coming Soon) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📊</span> Company Polls &amp; Feedback
                </h3>
                <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-bold text-indigo-400 border border-indigo-500/20">
                  Coming Soon
                </span>
              </div>

              <div className="py-16 text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400 text-xl font-bold">
                  📈
                </div>
                <p className="text-sm font-semibold text-slate-300">Polls feature is launching soon</p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Interactive company surveys and feedback modules will appear here for staff voting.
                </p>
              </div>
            </div>
          </div>

          {/* Card 3: Credit Score (REAL) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-400" />
                  Performance Credit Score
                </h3>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Live Score
                </span>
              </div>

              <div className="mt-6 flex flex-col items-center justify-center text-center space-y-3">
                <div className="text-4xl font-black font-mono text-amber-400 flex items-center gap-1">
                  <span>⭐</span> {totalScore} <span className="text-sm text-slate-500 font-normal">/ 300</span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-slate-700">
                  <div 
                    className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (totalScore / 300) * 100)}%` }}
                  />
                </div>

                <div className="pt-2 text-xs text-slate-400 flex items-center justify-center gap-4 bg-slate-950/60 p-3 rounded-xl border border-slate-800 w-full">
                  <span>Tasks Score: <strong className="text-white font-mono">{taskScore}</strong></span>
                  <span className="text-slate-600">•</span>
                  <span>Hours Score: <strong className="text-white font-mono">{hoursScore}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Time (REAL) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="h-4 w-4 text-sky-400" />
                  Today's Duty &amp; Time
                </h3>
                <span className="text-[10px] font-bold text-slate-400">
                  {new Date().toLocaleDateString()}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">First In</p>
                    <p className="text-xs font-mono font-bold text-emerald-400 mt-1">
                      {firstIn ? new Date(firstIn.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </p>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last Out</p>
                    <p className="text-xs font-mono font-bold text-rose-400 mt-1">
                      {lastOut ? new Date(lastOut.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </p>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Punches</p>
                    <p className="text-xs font-mono font-bold text-indigo-400 mt-1">
                      {todayPunches.length} today
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-medium">Current Duty Status</span>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                    isOnDuty 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}>
                    {isOnDuty ? '🟢 On Duty' : '🔴 Off Duty'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

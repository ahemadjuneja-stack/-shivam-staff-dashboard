import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  addDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkLog, StarEvent } from '../types';

export default function WorkersScreen() {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [starScores, setStarScores] = useState<{ [uid: string]: number }>({});
  const [selectedWorker, setSelectedWorker] = useState<UserProfile | null>(null);

  // Manual Adjust Modal
  const [manualDelta, setManualDelta] = useState<number>(1);
  const [manualReason, setManualReason] = useState<string>('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // 1. Fetch Active Workers
  useEffect(() => {
    const q = query(collection(db, 'users'), where('status', '==', 'active'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((d) => list.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
      setWorkers(list);
    });
    return () => unsub();
  }, []);

  // 2. Fetch Pending Work Logs
  useEffect(() => {
    const q = query(collection(db, 'worklogs'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: WorkLog[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<WorkLog, 'id'>) }));
      setWorkLogs(list);
    });
    return () => unsub();
  }, []);

  // 3. Compute Star Scores from Events
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events'), (snapshot) => {
      const scores: { [uid: string]: number } = {};
      snapshot.forEach((d) => {
        const ev = d.data() as StarEvent;
        if (!scores[ev.uid]) scores[ev.uid] = 3.0; // Base start score
        scores[ev.uid] += Number(ev.delta || 0);
      });
      setStarScores(scores);
    });
    return () => unsub();
  }, []);

  const handleVerifyLog = async (log: WorkLog, approve: boolean) => {
    if (!log.id) return;
    try {
      await updateDoc(doc(db, 'worklogs', log.id), {
        status: approve ? 'approved' : 'rejected',
        verifiedAt: Date.now()
      });

      await addDoc(collection(db, 'events'), {
        uid: log.uid,
        type: approve ? 'verify' : 'reject',
        delta: approve ? 1 : -2,
        note: approve ? 'Daily work log verified' : 'Daily work log rejected',
        at: Date.now()
      });

      setMsg(`Log ${approve ? 'Approved (+1 Star)' : 'Rejected (-2 Stars)'}!`);
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    }
  };

  const handleManualStarAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorker || !manualReason.trim()) return;
    setAdjustLoading(true);
    try {
      await addDoc(collection(db, 'events'), {
        uid: selectedWorker.uid,
        type: 'manual',
        delta: Number(manualDelta),
        note: manualReason.trim(),
        at: Date.now()
      });
      setMsg(`Star adjusted successfully for ${selectedWorker.name}!`);
      setManualReason('');
      setSelectedWorker(null);
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setAdjustLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-base font-bold text-white tracking-wide">WORKERS &amp; STAR PERFORMANCE</h2>
        <p className="text-xs text-slate-400">Work log verifications, star adjustments, aur staff rating monitoring.</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* Pending Work Logs Section */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-3">Pending Work Logs to Verify ({workLogs.length})</h3>
        {workLogs.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">Koi pending work logs nahi hain.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-slate-800 bg-slate-850 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-white">{log.name}</span>
                    <span className="text-slate-400">{log.date}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                    "{log.text}"
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleVerifyLog(log, true)}
                    className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    Approve (+1 ⭐)
                  </button>
                  <button
                    onClick={() => handleVerifyLog(log, false)}
                    className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20"
                  >
                    Reject (-2 ⭐)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Staff Roster & Leaderboard */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-3">Active Staff Directory</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 uppercase text-[10px] text-slate-400">
              <tr>
                <th className="p-3">Staff Name</th>
                <th className="p-3">Mobile</th>
                <th className="p-3">City</th>
                <th className="p-3">Role</th>
                <th className="p-3">Star Rating</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {workers.map((w) => {
                const score = starScores[w.uid] !== undefined ? starScores[w.uid] : 3.0;
                const isUnderperforming = score < 2.0;

                return (
                  <tr key={w.uid} className="hover:bg-slate-800/30">
                    <td className="p-3 font-bold text-white">{w.name}</td>
                    <td className="p-3 font-mono text-slate-400">{w.mobile}</td>
                    <td className="p-3">{w.city}</td>
                    <td className="p-3">
                      <span className="capitalize px-2 py-0.5 rounded bg-slate-800 text-indigo-400 font-semibold text-[10px]">
                        {w.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`font-bold font-mono text-sm ${isUnderperforming ? 'text-rose-400' : 'text-amber-400'}`}>
                        ★ {score.toFixed(1)}
                      </span>
                      {isUnderperforming && (
                        <span className="ml-2 text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded">
                          Warning
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setSelectedWorker(w)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold hover:bg-slate-700"
                      >
                        Adjust Stars
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Star Adjustment Modal */}
      {selectedWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form onSubmit={handleManualStarAdjust} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">Manual Star Adjustment</h3>
            <p className="text-xs text-slate-400">Worker: <strong>{selectedWorker.name}</strong></p>

            <div>
              <label className="text-xs text-slate-400">Point Change (Delta)</label>
              <select
                value={manualDelta}
                onChange={(e) => setManualDelta(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white"
              >
                <option value={2}>+2 Stars (Extra Effort)</option>
                <option value={1}>+1 Star (Good Performance)</option>
                <option value={-1}>-1 Star (Minor Mistake)</option>
                <option value={-2}>-2 Stars (Late / Undisciplined)</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400">Mandatory Written Reason</label>
              <input
                type="text"
                required
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="Reason (e.g. Sunday overtime, inventory accurate)"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={adjustLoading}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {adjustLoading ? 'Saving...' : 'Apply Adjustment'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedWorker(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

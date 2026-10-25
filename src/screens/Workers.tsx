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
import { UserProfile, WorkLog, StarEvent, UserRole } from '../types';
import { ROLES, getRoleDefinition } from '../roles';
import { Check, AlertCircle, X, Shield, Sparkles, Smartphone } from 'lucide-react';
import StaffApp from './StaffApp';

export default function WorkersScreen() {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [starScores, setStarScores] = useState<{ [uid: string]: number }>({});
  const [selectedWorker, setSelectedWorker] = useState<UserProfile | null>(null);
  const [previewWorker, setPreviewWorker] = useState<UserProfile | null>(null);

  // Manual Adjust Modal
  const [manualDelta, setManualDelta] = useState<number>(1);
  const [manualReason, setManualReason] = useState<string>('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Role Management Modal State
  const [roleModalStaff, setRoleModalStaff] = useState<UserProfile | null>(null);
  const [targetRole, setTargetRole] = useState<UserRole>('sales');
  const [targetXlCities, setTargetXlCities] = useState<string[]>([]);
  const [newCityInput, setNewCityInput] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  // Toast State
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

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

  // Open Role Change Confirmation Modal
  const openRoleChangeModal = (worker: UserProfile) => {
    setRoleModalStaff(worker);
    const initialRole = (worker.role || 'none') as UserRole;
    let mappedRole: UserRole = initialRole;
    if (initialRole === 'salesman') mappedRole = 'sales';
    if (initialRole === 'sales_manager') mappedRole = 'manager';
    setTargetRole(mappedRole);
    setTargetXlCities(worker.xlCities || []);
    setNewCityInput('');
  };

  // Confirm and Apply Role Update to Firestore
  const handleConfirmRoleChange = async () => {
    if (!roleModalStaff) return;
    setSavingRole(true);
    const staffUid = roleModalStaff.uid;
    const staffName = roleModalStaff.name;
    const targetRoleDef = getRoleDefinition(targetRole);

    try {
      // 1. Update in Firestore
      await updateDoc(doc(db, 'users', staffUid), {
        role: targetRole,
        xlCities: targetRole === 'sales' ? targetXlCities : [],
        roleUpdatedAt: Date.now()
      });

      // 2. Optimistic Row Update in local state
      setWorkers((prev) =>
        prev.map((w) => (w.uid === staffUid ? { ...w, role: targetRole, xlCities: targetRole === 'sales' ? targetXlCities : [] } : w))
      );

      // 3. Success Toast (Exact required format)
      showToast(`Role changed to ${targetRoleDef.label} for ${staffName} — active on their phone now!`, 'success');
      setRoleModalStaff(null);
    } catch (err: unknown) {
      console.error('Role update error:', err);
      const errorMsg = String((err as Error)?.message || '');
      if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
        showToast('Permission denied — Rules publish karo', 'error');
      } else {
        showToast(`Role change fail hua: ${errorMsg}`, 'error');
      }
    } finally {
      setSavingRole(false);
    }
  };

  // Instant Quick Role Change from Preview Panel
  const handleQuickRoleChange = async (targetUid: string, targetName: string, newRole: UserRole) => {
    const targetRoleDef = getRoleDefinition(newRole);
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        role: newRole,
        roleUpdatedAt: Date.now()
      });
      setWorkers((prev) =>
        prev.map((w) => (w.uid === targetUid ? { ...w, role: newRole } : w))
      );
      if (previewWorker && previewWorker.uid === targetUid) {
        setPreviewWorker({ ...previewWorker, role: newRole });
      }
      showToast(`Role changed to ${targetRoleDef.label} for ${targetName} — active on their phone now!`, 'success');
    } catch (err: unknown) {
      showToast(`Role change fail hua: ${(err as Error)?.message || ''}`, 'error');
    }
  };

  const activeRoleDef = getRoleDefinition(targetRole);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl backdrop-blur-md text-xs font-bold transition-all border ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-400" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-base font-bold text-white tracking-wide">STAFF MANAGEMENT &amp; ROLE CONTROL</h2>
        <p className="text-xs text-slate-400">
          Staff role management, work log verifications, star adjustments, aur live directory.
        </p>
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
                    className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
                  >
                    Approve (+1 ⭐)
                  </button>
                  <button
                    onClick={() => handleVerifyLog(log, false)}
                    className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition"
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Active Staff Directory ({workers.length})</h3>
            <p className="text-[11px] text-slate-400">
              Kissi bhi staff ka role yahan se badle — staff app me access turant apply hoga.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" /> Salesman
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-purple-500" /> Sales Manager
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-slate-500" /> Worker / None
            </span>
          </div>
        </div>

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
                const roleDef = getRoleDefinition(w.role);

                return (
                  <tr key={w.uid} className="hover:bg-slate-800/30 transition">
                    <td className="p-3 font-bold text-white">{w.name}</td>
                    <td className="p-3 font-mono text-slate-400">{w.mobile}</td>
                    <td className="p-3">{w.city || 'Head Office'}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold text-[10px] border ${roleDef.badgeClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${roleDef.dotColor}`} />
                        {roleDef.label}
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
                      <div className="flex items-center justify-end gap-2">
                        {/* Preview Staff App Button */}
                        <button
                          onClick={() => setPreviewWorker(w)}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 hover:text-white transition flex items-center gap-1"
                          title="Preview Staff Mobile App as this user"
                        >
                          <Smartphone className="h-3 w-3 text-emerald-400" />
                          <span>Preview App</span>
                        </button>

                        {/* Change Role Button */}
                        <button
                          onClick={() => openRoleChangeModal(w)}
                          className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 hover:text-white transition flex items-center gap-1"
                          title="Change Staff Role"
                        >
                          <Shield className="h-3 w-3 text-indigo-400" />
                          <span>Change Role</span>
                        </button>

                        {/* Adjust Stars Button (untouched) */}
                        <button
                          onClick={() => setSelectedWorker(w)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold hover:bg-slate-700 text-slate-300 hover:text-white transition"
                        >
                          Adjust Stars
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Management Confirmation Modal with Access Preview */}
      {roleModalStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Change Staff Role</h3>
              </div>
              <button
                onClick={() => !savingRole && setRoleModalStaff(null)}
                disabled={savingRole}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-400">
                Staff Member: <strong className="text-white text-sm">{roleModalStaff.name}</strong> ({roleModalStaff.mobile})
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Current Role:{' '}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleDefinition(roleModalStaff.role).badgeClass}`}>
                  {getRoleDefinition(roleModalStaff.role).label}
                </span>
              </p>
            </div>

            {/* Role Selection Dropdown / Buttons */}
            <div>
              <label className="text-xs font-bold text-slate-300">Naya Role Chunein:</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const isSelected = targetRole === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setTargetRole(r.value)}
                      className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1 ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-500/10 text-white ring-1 ring-indigo-500'
                          : 'border-slate-800 bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{r.label}</span>
                        {isSelected && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                      </div>
                      <span className="text-[10px] text-slate-400 leading-snug line-clamp-1">{r.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* XL Cities Editor for Salesman */}
            {targetRole === 'sales' && (
              <div className="space-y-2 border-t border-slate-800 pt-3">
                <label className="text-xs font-bold text-slate-300">Salesman XL Cities Permission:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCityInput}
                    onChange={(e) => setNewCityInput(e.target.value)}
                    placeholder="Enter city (e.g. Patan)"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newCityInput.trim() && !targetXlCities.includes(newCityInput.trim())) {
                          setTargetXlCities([...targetXlCities, newCityInput.trim()]);
                          setNewCityInput('');
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newCityInput.trim() && !targetXlCities.includes(newCityInput.trim())) {
                        setTargetXlCities([...targetXlCities, newCityInput.trim()]);
                        setNewCityInput('');
                      }
                    }}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 transition"
                  >
                    Add City
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {targetXlCities.length === 0 ? (
                    <span className="text-[11px] text-slate-500 italic">No cities added yet. Salesman won't see any XL sheets.</span>
                  ) : (
                    targetXlCities.map((city, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs font-bold">
                        {city}
                        <button
                          type="button"
                          onClick={() => setTargetXlCities(targetXlCities.filter((_, i) => i !== idx))}
                          className="text-blue-400 hover:text-rose-400 ml-1 font-bold"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Access Preview List (Detailed Breakdown) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  Is role me ye sab access milenge:
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${activeRoleDef.badgeClass}`}>
                  {activeRoleDef.label}
                </span>
              </div>
              <ul className="space-y-1.5 text-xs">
                {activeRoleDef.permissions.map((perm, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-slate-300">
                    <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                    <span className="text-[11px]">{perm}</span>
                  </li>
                ))}
              </ul>
              {targetRole === 'none' && (
                <p className="text-[11px] text-amber-400/90 font-medium pt-1 border-t border-slate-800/80">
                  ⚠️ Note: 'None' role par sales module (sheets/customers/entries/bills) poori tarah block ho jayega.
                </p>
              )}
            </div>

            <p className="text-[11px] text-emerald-400/90 font-medium flex items-center gap-1.5 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/20">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span>Full access staff app me bina logout ya reinstall ke turant ("on the spot") apply hoga.</span>
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRoleModalStaff(null)}
                disabled={savingRole}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRoleChange}
                disabled={savingRole}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition disabled:opacity-50 flex items-center gap-2"
              >
                {savingRole && (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                <span>{savingRole ? 'Saving Role...' : `Confirm & Set ${activeRoleDef.label}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Star Adjustment Modal (Untouched functionality) */}
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

      {/* Staff App Interactive Phone Simulator Modal (Boss Demo & Real-time Verification) */}
      {previewWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 backdrop-blur-md">
          <div className="w-full max-w-4xl max-h-[94vh] flex flex-col md:flex-row gap-4 items-center justify-center">
            {/* Phone Simulator Frame */}
            <div className="w-full max-w-sm h-[84vh] bg-slate-950 rounded-[38px] border-4 border-slate-700 shadow-2xl flex flex-col overflow-hidden relative ring-1 ring-slate-600">
              {/* Phone Top Notch / Speaker */}
              <div className="h-6 bg-slate-900 flex items-center justify-center shrink-0 border-b border-slate-800">
                <div className="h-3 w-28 bg-slate-800 rounded-full flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-slate-700 mr-2" />
                  <div className="h-1 w-10 bg-slate-700 rounded-full" />
                </div>
              </div>
              {/* Staff App Inside */}
              <div className="flex-1 overflow-y-auto">
                <StaffApp
                  previewUid={previewWorker.uid}
                  isBossPreview={true}
                  onBackToDashboard={() => setPreviewWorker(null)}
                />
              </div>
            </div>

            {/* Boss Live Controller Panel */}
            <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">Live Role Test &amp; Simulator</h3>
                </div>
                <button
                  onClick={() => setPreviewWorker(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <p className="text-xs text-slate-400">
                  Testing Staff Phone as: <strong className="text-white text-sm">{previewWorker.name}</strong>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Current Active Role:{' '}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleDefinition(workers.find(w => w.uid === previewWorker.uid)?.role || previewWorker.role).badgeClass}`}>
                    {getRoleDefinition(workers.find(w => w.uid === previewWorker.uid)?.role || previewWorker.role).label}
                  </span>
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-2">
                <p className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live "On The Spot" Role Switch
                </p>
                <p className="text-[11px] text-slate-400">
                  Kisi bhi role button par tap karein — phone preview me bina refresh ke turant apply hoga:
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {ROLES.map((r) => {
                    const currentR = workers.find(w => w.uid === previewWorker.uid)?.role || previewWorker.role;
                    const isCurrent = (r.value === currentR) || (r.value === 'salesman' && currentR === 'sales');
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => handleQuickRoleChange(previewWorker.uid, previewWorker.name, r.value)}
                        className={`p-2.5 rounded-xl border text-xs font-bold text-left transition flex flex-col justify-between ${
                          isCurrent
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500'
                            : 'border-slate-800 bg-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span className="flex items-center justify-between">
                          <span>{r.label}</span>
                          {isCurrent && <span className="text-[10px] text-emerald-400 font-bold">Active</span>}
                        </span>
                        <span className="text-[9px] text-slate-400 font-normal mt-0.5">{r.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-[11px] text-indigo-300 space-y-1">
                <p className="font-bold">Observations to verify:</p>
                <p>• <strong>Worker / None</strong>: Sales tab locks &amp; redirects to Duty screen instantly.</p>
                <p>• <strong>Salesman / Manager</strong>: Sales tab unlocks immediately with Sheets, Customers, Entries &amp; Bills.</p>
                <p>• Explanatory banner <em>"Aapka role update ho gaya hai"</em> displays automatically.</p>
              </div>

              <button
                onClick={() => setPreviewWorker(null)}
                className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 hover:text-white transition"
              >
                Close Phone Simulator
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

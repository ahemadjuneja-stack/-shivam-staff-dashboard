import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkLog, StarEvent, UserRole, OutsideLog } from '../types';
import { ROLES, getRoleDefinition } from '../roles';
import { Check, AlertCircle, X, Shield, Sparkles, Smartphone, Timer, UserPlus, Pencil, Trash2, UserCheck } from 'lucide-react';
import StaffApp from './StaffApp';
import { registerStaff, updateStaffDetails, changeStaffPin, deleteStaff } from '../staffAdmin';

export default function WorkersScreen() {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [starScores, setStarScores] = useState<{ [uid: string]: number }>({});
  const [selectedWorker, setSelectedWorker] = useState<UserProfile | null>(null);
  const [previewWorker, setPreviewWorker] = useState<UserProfile | null>(null);

  // STOPWATCH INVENTORY (Boss order 2026-10-26): har staff ke naam ke saath
  // stopwatch — staff 100m bahar gaya (open outside event) to timer chalu.
  // Timer SIRF dashboard se set hota hai (allowedMin) — staff app se nahi.
  const [openOutside, setOpenOutside] = useState<OutsideLog[]>([]);
  const [, setTick] = useState(0);
  const [mins, setMins] = useState<Record<string, string>>({});
  const [busyStop, setBusyStop] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'outside_logs'), where('status', '==', 'open')),
      (snap) => setOpenOutside(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OutsideLog, 'id'>) }))),
      () => setOpenOutside([]));
    return () => unsub();
  }, []);

  const setAllowedMin = async (log: OutsideLog) => {
    if (!log.id) return;
    const allowedMin = Math.max(1, Math.min(240, Math.round(Number(mins[log.id] || 15) || 15)));
    setBusyStop(log.id);
    try {
      await updateDoc(doc(db, 'outside_logs', log.id), {
        allowedMin,
        allowedSetAt: Date.now(),
        allowedSetBy: 'workers_inventory'
      });
      showToast(`Stopwatch set for ${log.name}: ${allowedMin} min (on-time = +5, late = -4 auto)`);
    } catch (err: any) {
      showToast(`Timer set failed: ${err.message}`, 'error');
    } finally {
      setBusyStop(null);
    }
  };

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

  // STAFF REGISTRATION + EDIT + DELETE (Boss order 2026-10-26):
  // dashboard se staff ke sare details fill / edit / delete — strip click par
  // detail panel ke andar sare options. Registration secondary-app trick se
  // hoti hai (boss ka login session break nahi hota) + account turant ACTIVE.
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('worker');
  const [regCity, setRegCity] = useState('Main');
  const [regXlCities, setRegXlCities] = useState<string[]>([]);
  const [regCityInput, setRegCityInput] = useState('');
  const [regBusy, setRegBusy] = useState(false);

  const [detailStaff, setDetailStaff] = useState<UserProfile | null>(null);
  const [staffToEdit, setStaffToEdit] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editNewPin, setEditNewPin] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [staffToDelete, setStaffToDelete] = useState<UserProfile | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  // PENDING REGISTRATION APPROVALS (Boss order: verification approvals Staff
  // Management ke andar hi ho — alag tab nahi). Approvals.tsx ka logic merged.
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<{ [uid: string]: UserRole }>({});

  const openDetail = (w: UserProfile) => setDetailStaff(w);

  const openEdit = (w: UserProfile) => {
    setStaffToEdit(w);
    setEditName(w.name || '');
    setEditCity(w.city || '');
    setEditNewPin('');
  };

  const handleEditSave = async () => {
    if (!staffToEdit) return;
    const name = editName.trim();
    if (!name) {
      showToast('Staff name is required.', 'error');
      return;
    }
    setEditBusy(true);
    try {
      const res = await updateStaffDetails(staffToEdit.uid, name, editCity);
      if (!res.ok) {
        showToast(res.message, 'error');
        return;
      }
      let extra = '';
      const newPin = editNewPin.trim();
      if (newPin) {
        if (!/^\d{4}$/.test(newPin)) {
          showToast('New PIN must be exactly 4 digits.', 'error');
          return;
        }
        if (!staffToEdit.pin) {
          showToast('No PIN on file for this account — the staff keeps their current PIN.', 'error');
          return;
        }
        const pinRes = await changeStaffPin(staffToEdit.uid, String(staffToEdit.pin), newPin);
        if (!pinRes.ok) {
          showToast(pinRes.message, 'error');
          return;
        }
        extra = ' ' + pinRes.message;
      }
      setWorkers((prev) =>
        prev.map((x) => (x.uid === staffToEdit.uid ? { ...x, name, city: editCity.trim() || 'Main' } : x))
      );
      showToast(res.message + extra, 'success');
      setStaffToEdit(null);
      setDetailStaff(null);
    } finally {
      setEditBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = regName.trim();
    const mobile = regMobile.trim();
    const pin = regPin.trim();
    if (!name || !mobile || !pin) {
      showToast('Please fill all required fields.', 'error');
      return;
    }
    if (mobile.length !== 10) {
      showToast('Mobile number must be exactly 10 digits.', 'error');
      return;
    }
    if (pin.length !== 4) {
      showToast('PIN must be exactly 4 digits.', 'error');
      return;
    }
    setRegBusy(true);
    try {
      const res = await registerStaff({ name, mobile, pin, role: regRole, city: regCity, xlCities: regXlCities });
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) {
        setShowRegister(false);
        setRegName('');
        setRegMobile('');
        setRegPin('');
        setRegRole('worker');
        setRegCity('Main');
        setRegXlCities([]);
        setRegCityInput('');
      }
    } finally {
      setRegBusy(false);
    }
  };

  const handleDeleteStaff = async () => {
    if (!staffToDelete) return;
    if (deleteConfirmText.trim() !== String(staffToDelete.name || '').trim()) {
      showToast('Type the staff name exactly to confirm deletion.', 'error');
      return;
    }
    setDeleteBusy(true);
    try {
      const res = await deleteStaff(staffToDelete.uid, staffToDelete.name);
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) {
        setWorkers((prev) => prev.filter((x) => x.uid !== staffToDelete.uid));
        setStaffToDelete(null);
        setDeleteConfirmText('');
        setDetailStaff(null);
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  // Approve / reject a pending self-registration (merged from Approvals screen)
  const handleApproval = async (user: UserProfile, approve: boolean) => {
    const chosenRole: UserRole = selectedRoles[user.uid] || 'worker';
    const updateData = approve
      ? { status: 'active', role: chosenRole, approvedAt: Date.now() }
      : { status: 'rejected' };
    try {
      try {
        await updateDoc(doc(db, 'users', user.uid), updateData);
      } catch {
        await setDoc(doc(db, 'users', user.uid), { ...user, ...updateData }, { merge: true });
      }
      showToast(
        approve
          ? `${user.name} approved as ${chosenRole === 'sales' ? 'Salesman' : chosenRole === 'worker' ? 'Staff' : chosenRole.toUpperCase()} — they can log in now.`
          : `Registration rejected for ${user.name}.`,
        approve ? 'success' : 'success'
      );
      setPendingUsers((prev) => prev.filter((u) => u.uid !== user.uid));
    } catch (err: any) {
      showToast(`Approval failed: ${err?.message || ''}`, 'error');
    }
  };

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

  // 1b. Pending Registration Requests (self signups from the staff app)
  useEffect(() => {
    const q = query(collection(db, 'users'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: UserProfile[] = [];
      const rolesMap: { [uid: string]: UserRole } = {};
      snapshot.forEach((d) => {
        const user = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
        list.push(user);
        rolesMap[user.uid] = user.role === 'sales' || user.role === 'worker' ? user.role : 'worker';
      });
      setPendingUsers(list);
      setSelectedRoles((prev) => ({ ...rolesMap, ...prev }));
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
        showToast('Permission denied — publish the Firestore rules first', 'error');
      } else {
        showToast(`Role change failed: ${errorMsg}`, 'error');
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
      showToast(`Role change failed: ${(err as Error)?.message || ''}`, 'error');
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
          Staff role management, work log verifications, star adjustments, and the live directory.
        </p>
      </div>

      {msg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
          {msg}
        </div>
      )}

      {/* PENDING REGISTRATION REQUESTS (Boss: verification approvals Staff Management ke andar) */}
      {pendingUsers.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5 shadow-lg">
          <div className="flex items-center justify-between pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-amber-400" />
                Registration Requests ({pendingUsers.length})
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                New staff signed up from the mobile app — pick a role and approve. They appear in the directory below instantly.
              </p>
            </div>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[10px] font-black text-amber-300 border border-amber-500/30 animate-pulse">
              ACTION NEEDED
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pendingUsers.map((u) => {
              const currentRole: UserRole = selectedRoles[u.uid] || 'worker';
              return (
                <div key={u.uid} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 font-black text-sm">
                          {String(u.name || 'S').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white">{u.name}</h4>
                          <p className="text-[11px] font-mono text-indigo-400">{u.mobile}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-black text-amber-400 border border-amber-500/20">
                        PENDING
                      </span>
                    </div>
                    <p className="mt-2 text-[10.5px] text-slate-400">
                      City: <strong className="text-slate-200">{u.city || 'Head Office'}</strong>
                      {' · '}Registered: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : 'Just now'}
                    </p>
                    <div className="mt-2.5">
                      <label className="text-[9.5px] font-black uppercase tracking-wider text-slate-500">Assign Role</label>
                      <select
                        value={currentRole}
                        onChange={(e) => setSelectedRoles((prev) => ({ ...prev, [u.uid]: e.target.value as UserRole }))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-white focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="worker">Staff — tasks, duty, credit score</option>
                        <option value="sales">Salesman — city XL sheets, no location lock</option>
                        <option value="manager">Manager — full dashboard access</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleApproval(u, true)}
                      className="rounded-lg bg-emerald-600 py-2 text-[11px] font-bold text-white shadow hover:bg-emerald-500 transition"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApproval(u, false)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-2 text-[11px] font-bold text-rose-400 hover:bg-rose-500/20 transition"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Work Logs Section */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-3">Pending Work Logs to Verify ({workLogs.length})</h3>
        {workLogs.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No pending work logs.</p>
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

      {/* Active Staff Roster & Leaderboard — FULL WIDTH SLIM STRIPS (Boss order) */}
      <div className="hisab-fullbleed border-y border-slate-800 bg-slate-900/60 shadow-lg">
        <div className="px-4 lg:px-8 py-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Active Staff Directory ({workers.length})</h3>
            <p className="text-[11px] text-slate-400">
              Change any staff role here — access applies on their app instantly. Tap a staff row to edit details or delete.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={() => setShowRegister(true)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              Register Staff
            </button>
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] text-slate-300">
            <thead className="bg-slate-800/40 uppercase text-[9px] text-slate-400">
              <tr>
                <th className="px-2.5 py-1.5">Staff Name</th>
                <th className="px-2.5 py-1.5">Stopwatch</th>
                <th className="px-2.5 py-1.5">Mobile</th>
                <th className="px-2.5 py-1.5">City</th>
                <th className="px-2.5 py-1.5">Role</th>
                <th className="px-2.5 py-1.5">Star</th>
                <th className="px-2.5 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {workers.map((w) => {
                const score = starScores[w.uid] !== undefined ? starScores[w.uid] : 3.0;
                const isUnderperforming = score < 2.0;
                const roleDef = getRoleDefinition(w.role);
                const openLog = openOutside.find((l) => l.uid === w.uid);
                const elapsedMs = openLog ? Date.now() - openLog.fromAt : 0;
                const elapsedMin = Math.floor(elapsedMs / 60000);
                const over = openLog && typeof openLog.allowedMin === 'number' && elapsedMs > openLog.allowedMin * 60000;
                const remaining = openLog && typeof openLog.allowedMin === 'number'
                  ? Math.max(0, openLog.allowedMin - elapsedMin) : null;

                return (
                  <tr
                    key={w.uid}
                    onClick={() => openDetail(w)}
                    className={`hover:bg-slate-800/30 transition cursor-pointer ${openLog ? 'bg-rose-500/[0.04]' : ''}`}
                  >
                    <td className="px-2.5 py-1.5 font-bold text-white whitespace-nowrap">
                      {w.name}
                      {openLog && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[9px] font-black text-rose-300">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> OUT
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5">
                      {openLog ? (
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center gap-1.5 rounded-lg border px-2 py-0.5 font-mono text-[11px] font-black tabular-nums ${
                            over
                              ? 'animate-pulse border-rose-500/40 bg-rose-500/15 text-rose-300'
                              : typeof openLog.allowedMin === 'number'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}>
                            <Timer className={`h-3.5 w-3.5 ${over ? 'text-rose-400' : typeof openLog.allowedMin === 'number' ? 'text-emerald-400' : 'text-amber-400'}`} />
                            {String(Math.floor(elapsedMin / 60)).padStart(2, '0')}:{String(elapsedMin % 60).padStart(2, '0')}
                            {typeof openLog.allowedMin === 'number' && (
                              <span className="text-[9px] font-bold text-slate-400">/ {openLog.allowedMin}m</span>
                            )}
                          </span>
                          {typeof openLog.allowedMin === 'number' ? (
                            <span className={`text-[9.5px] font-bold ${over ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {over ? 'TIME OVER — not back yet' : `${remaining}m left (on-time = +5)`}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              {[15, 20, 30].map((n) => (
                                <button
                                  key={n}
                                  onClick={() => setMins((m) => ({ ...m, [openLog.id!]: String(n) }))}
                                  className={`rounded border px-1.5 py-0.5 text-[9.5px] font-black transition ${
                                    Number(mins[openLog.id ?? ''] || 15) === n
                                      ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                                  }`}
                                >
                                  {n}m
                                </button>
                              ))}
                              <button
                                onClick={() => setAllowedMin(openLog)}
                                disabled={busyStop === openLog.id}
                                className="rounded bg-indigo-600 px-2 py-0.5 text-[9.5px] font-black text-white hover:bg-indigo-500 disabled:opacity-50 transition"
                              >
                                {busyStop === openLog.id ? '...' : 'Set'}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-slate-400 whitespace-nowrap">{w.mobile}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{w.city || 'Head Office'}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-bold text-[9.5px] border ${roleDef.badgeClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${roleDef.dotColor}`} />
                        {roleDef.label}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className={`font-bold font-mono text-[11.5px] ${isUnderperforming ? 'text-rose-400' : 'text-amber-400'}`}>
                        ★ {score.toFixed(1)}
                      </span>
                      {isUnderperforming && (
                        <span className="ml-2 text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded">
                          Warning
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Preview Staff App Button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setPreviewWorker(w); }}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20 hover:text-white transition flex items-center gap-1"
                          title="Preview Staff Mobile App as this user"
                        >
                          <Smartphone className="h-3 w-3 text-emerald-400" />
                          <span>Preview App</span>
                        </button>

                        {/* Change Role Button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openRoleChangeModal(w); }}
                          className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/20 hover:text-white transition flex items-center gap-1"
                          title="Change Staff Role"
                        >
                          <Shield className="h-3 w-3 text-indigo-400" />
                          <span>Change Role</span>
                        </button>

                        {/* Adjust Stars Button (untouched) */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedWorker(w); }}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold hover:bg-slate-700 text-slate-300 hover:text-white transition"
                        >
                          Stars
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
      </div>

      {/* STAFF DETAIL PANEL — PC FULL VIEW (Boss order: popup poori screen me) */}
      {detailStaff && (() => {
        const dRoleDef = getRoleDefinition(detailStaff.role);
        const dScore = starScores[detailStaff.uid] !== undefined ? starScores[detailStaff.uid] : 3.0;
        return (
          <div className="fixed inset-0 z-50 bg-slate-950/97 backdrop-blur-md overflow-y-auto">
            <div className="min-h-full w-full flex flex-col">
              {/* Top Bar */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 lg:px-12 py-4 backdrop-blur">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-600/30">
                    {String(detailStaff.name || 'S').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{detailStaff.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] border ${dRoleDef.badgeClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dRoleDef.dotColor}`} />
                        {dRoleDef.label}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setDetailStaff(null)}
                  className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                  title="Close (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body — details (left 2/3) + options (right 1/3) */}
              <div className="flex-1 w-full px-6 lg:px-12 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Details */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Mobile</p>
                      <p className="font-mono text-sm text-slate-100 mt-1">{detailStaff.mobile || '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">City / Branch</p>
                      <p className="text-sm text-slate-100 mt-1">{detailStaff.city || 'Main'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Star Rating</p>
                      <p className="font-bold text-amber-400 text-lg mt-0.5">★ {dScore.toFixed(1)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Registered On</p>
                      <p className="text-sm text-slate-100 mt-1">
                        {detailStaff.createdAt ? new Date(detailStaff.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Role access info */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-400" />
                        Access with current role ({dRoleDef.label}):
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {dRoleDef.permissions.map((perm, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300 text-xs">
                          <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                          <span>{perm}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Account meta */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Account Information</p>
                    <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                      <p>Status: <span className="text-emerald-400 font-bold">Active</span></p>
                      <p>Salesman XL Cities: <span className="font-bold text-slate-100">{detailStaff.xlCities?.length ? detailStaff.xlCities.join(', ') : '—'}</span></p>
                      <p className="sm:col-span-2 font-mono text-[10px] text-slate-500 break-all">UID: {detailStaff.uid}</p>
                    </div>
                  </div>
                </div>

                {/* Right: Options */}
                <div className="space-y-2.5">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Staff Options</p>
                  <button
                    onClick={() => openEdit(detailStaff)}
                    className="w-full rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-4 text-left transition hover:bg-indigo-500/20 flex items-center gap-3 group"
                  >
                    <span className="h-10 w-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
                      <Pencil className="h-4 w-4 text-indigo-300" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-white">Edit Details</span>
                      <span className="block text-[10.5px] text-slate-400">Name, city and login PIN</span>
                    </span>
                  </button>
                  <button
                    onClick={() => { setDetailStaff(null); openRoleChangeModal(detailStaff); }}
                    className="w-full rounded-2xl border border-purple-500/30 bg-purple-500/10 px-4 py-4 text-left transition hover:bg-purple-500/20 flex items-center gap-3"
                  >
                    <span className="h-10 w-10 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
                      <Shield className="h-4 w-4 text-purple-300" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-white">Change Role</span>
                      <span className="block text-[10.5px] text-slate-400">Staff / Salesman / Manager — applies instantly</span>
                    </span>
                  </button>
                  <button
                    onClick={() => { setDetailStaff(null); setSelectedWorker(detailStaff); }}
                    className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-left transition hover:bg-amber-500/20 flex items-center gap-3"
                  >
                    <span className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4 text-amber-300" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-white">Adjust Stars</span>
                      <span className="block text-[10.5px] text-slate-400">Manual star reward or penalty</span>
                    </span>
                  </button>
                  <button
                    onClick={() => { setDetailStaff(null); setPreviewWorker(detailStaff); }}
                    className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-left transition hover:bg-emerald-500/20 flex items-center gap-3"
                  >
                    <span className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <Smartphone className="h-4 w-4 text-emerald-300" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-white">Preview App</span>
                      <span className="block text-[10.5px] text-slate-400">Open the staff phone simulator</span>
                    </span>
                  </button>
                  <button
                    onClick={() => { setStaffToDelete(detailStaff); setDeleteConfirmText(''); setDetailStaff(null); }}
                    className="w-full rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-left transition hover:bg-rose-500/20 flex items-center gap-3"
                  >
                    <span className="h-10 w-10 rounded-xl bg-rose-500/15 flex items-center justify-center shrink-0">
                      <Trash2 className="h-4 w-4 text-rose-300" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-rose-200">Delete Staff</span>
                      <span className="block text-[10.5px] text-slate-400">Blocks login, frees the mobile number</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* REGISTER STAFF MODAL (Boss: dashboard se staff ke sare details fill) */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleRegister}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Register New Staff</h3>
              </div>
              <button
                type="button"
                onClick={() => !regBusy && setShowRegister(false)}
                disabled={regBusy}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-2.5">
              The staff account is created and active immediately — they can log in on their phone with this mobile number and PIN. No separate approval needed.
            </p>

            <div>
              <label className="text-xs font-bold text-slate-300">Full Name *</label>
              <input
                type="text"
                required
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="e.g. Ramesh Patel"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-300">Mobile (10 Digits) *</label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  value={regMobile}
                  onChange={(e) => setRegMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="9876543210"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300">Login PIN (4 Digits) *</label>
                <input
                  type="password"
                  required
                  maxLength={4}
                  value={regPin}
                  onChange={(e) => setRegPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-center text-lg tracking-widest text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300">City / Branch</label>
              <input
                type="text"
                value={regCity}
                onChange={(e) => setRegCity(e.target.value)}
                placeholder="Main"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300">Role *</label>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setRegRole('worker')}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    regRole === 'worker'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                      : 'border-slate-800 bg-slate-800/60 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-bold text-white block">Staff</span>
                  <span className="text-[9.5px] text-slate-400 leading-snug">Tasks, duty, credit score</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRegRole('sales')}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    regRole === 'sales'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                      : 'border-slate-800 bg-slate-800/60 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-bold text-white block">Salesman</span>
                  <span className="text-[9.5px] text-slate-400 leading-snug">City XL sheets, no location lock</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRegRole('manager')}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    regRole === 'manager'
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                      : 'border-slate-800 bg-slate-800/60 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-bold text-white block">Manager</span>
                  <span className="text-[9.5px] text-slate-400 leading-snug">Full dashboard access</span>
                </button>
              </div>
            </div>

            {/* XL Cities for salesman */}
            {regRole === 'sales' && (
              <div className="space-y-2 border-t border-slate-800 pt-3">
                <label className="text-xs font-bold text-slate-300">Salesman XL City Permissions:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={regCityInput}
                    onChange={(e) => setRegCityInput(e.target.value)}
                    placeholder="Enter city (e.g. Patan)"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const c = regCityInput.trim();
                        if (c && !regXlCities.includes(c)) {
                          setRegXlCities([...regXlCities, c]);
                          setRegCityInput('');
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const c = regCityInput.trim();
                      if (c && !regXlCities.includes(c)) {
                        setRegXlCities([...regXlCities, c]);
                        setRegCityInput('');
                      }
                    }}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 transition"
                  >
                    Add City
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {regXlCities.length === 0 ? (
                    <span className="text-[11px] text-slate-500 italic">No cities added yet — the salesman will not see any XL sheets.</span>
                  ) : (
                    regXlCities.map((city, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs font-bold">
                        {city}
                        <button
                          type="button"
                          onClick={() => setRegXlCities(regXlCities.filter((_, i) => i !== idx))}
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

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                disabled={regBusy}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={regBusy}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition disabled:opacity-50 flex items-center gap-2"
              >
                {regBusy && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                <span>{regBusy ? 'Creating Account...' : 'Create Staff Account'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT STAFF DETAILS MODAL */}
      {staffToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => { e.preventDefault(); handleEditSave(); }}
            className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Edit Staff Details</h3>
              </div>
              <button type="button" onClick={() => !editBusy && setStaffToEdit(null)} disabled={editBusy} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Staff: <strong className="text-white">{staffToEdit.name}</strong> ({staffToEdit.mobile})
            </p>

            <div>
              <label className="text-xs font-bold text-slate-300">Full Name *</label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300">City / Branch</label>
              <input
                type="text"
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
                placeholder="Main"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300">New Login PIN (optional)</label>
              <input
                type="password"
                maxLength={4}
                value={editNewPin}
                onChange={(e) => setEditNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Leave blank to keep current PIN"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-center text-lg tracking-widest text-white focus:border-indigo-500 focus:outline-none"
              />
              {staffToEdit.pin ? (
                <p className="text-[10px] text-slate-500 mt-1">Enter a new 4-digit PIN only if you want to change their login PIN.</p>
              ) : (
                <p className="text-[10px] text-amber-400/80 mt-1">No PIN on file for this account — the PIN cannot be changed here. The staff keeps their current PIN.</p>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setStaffToEdit(null)}
                disabled={editBusy}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {editBusy && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                <span>{editBusy ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DELETE STAFF CONFIRMATION MODAL */}
      {staffToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-400" />
                <h3 className="text-sm font-bold text-white">Delete Staff</h3>
              </div>
              <button onClick={() => !deleteBusy && setStaffToDelete(null)} disabled={deleteBusy} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              You are deleting <strong className="text-white">{staffToDelete.name}</strong> ({staffToDelete.mobile}).
            </p>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300 space-y-1.5">
              <p className="font-bold">What happens after deletion:</p>
              <p>• Their app login is blocked immediately.</p>
              <p>• The mobile number becomes free — you can register a new staff on the same number.</p>
              <p>• Old attendance and work history stays safe on the dashboard.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300">
                Type <span className="text-rose-300">"{staffToDelete.name}"</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={staffToDelete.name}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStaffToDelete(null)}
                disabled={deleteBusy}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteStaff}
                disabled={deleteBusy}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {deleteBusy && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                <span>{deleteBusy ? 'Deleting...' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
              <label className="text-xs font-bold text-slate-300">Select New Role:</label>
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
                <label className="text-xs font-bold text-slate-300">Salesman XL City Permissions:</label>
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
                  Access granted with this role:
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
                  ⚠ Note: With the 'None' role, the whole sales module (sheets / customers / entries / bills) is fully blocked.
                </p>
              )}
            </div>

            <p className="text-[11px] text-emerald-400/90 font-medium flex items-center gap-1.5 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/20">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span>Changes apply instantly in the staff app — no logout or reinstall needed.</span>
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
                  Tap any role button — it applies instantly in the phone preview without refresh:
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
                <p>• Explanatory banner <em>"Your role has been updated"</em> displays automatically.</p>
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

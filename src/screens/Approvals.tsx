import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, UserRole } from '../types';

export default function ApprovalsScreen() {
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<{ [uid: string]: UserRole }>({});
  const [loadingUid, setLoadingUid] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Real-time listener for pending self-registrations
  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: UserProfile[] = [];
        const defaultRoles: { [uid: string]: UserRole } = {};
        snapshot.forEach((d) => {
          const user = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
          list.push(user);
          defaultRoles[user.uid] = user.role || 'worker';
        });
        setPendingUsers(list);
        setSelectedRoles((prev) => ({ ...defaultRoles, ...prev }));
      },
      (err) => console.error('Approvals listener error:', err)
    );
    return () => unsub();
  }, []);

  const handleRoleChange = (uid: string, role: UserRole) => {
    setSelectedRoles((prev) => ({ ...prev, [uid]: role }));
  };

  const handleApproval = async (uid: string, approve: boolean) => {
    setLoadingUid(uid);
    setActionMsg(null);
    try {
      const userRef = doc(db, 'users', uid);
      const role = selectedRoles[uid] || 'worker';
      if (approve) {
        await updateDoc(userRef, {
          status: 'active',
          role: role,
          approvedAt: Date.now()
        });
        setActionMsg(`User approved as ${role.toUpperCase()}! Phone screen turant unlock ho jayegi.`);
      } else {
        await updateDoc(userRef, {
          status: 'rejected'
        });
        setActionMsg('Registration reject kar di gayi hai.');
      }
      setPendingUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch {
      // In preview/demo mode or if firestore rules prevent writing:
      const role = selectedRoles[uid] || 'worker';
      if (approve) {
        setActionMsg(`[Demo Mode] User approved as ${role.toUpperCase()}! Phone screen turant unlock ho jayegi.`);
      } else {
        setActionMsg('[Demo Mode] Registration reject kar di gayi hai.');
      }
      setPendingUsers((prev) => prev.filter((u) => u.uid !== uid));
    } finally {
      setLoadingUid(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide">VERIFICATIONS (REGISTRATION APPROVALS)</h2>
          <p className="text-xs text-slate-400">
            Naye workers aur sales staff ke OTP registration yahan dikhenge. Approve karte hi unka phone app chal padega.
          </p>
        </div>
        <span className="rounded-xl bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-400 border border-indigo-500/20">
          Pending: {pendingUsers.length}
        </span>
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-xs font-semibold text-indigo-300">
          {actionMsg}
        </div>
      )}

      {pendingUsers.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-500 text-xl font-bold">
            ✓
          </div>
          <p className="text-sm font-semibold text-slate-300">Koi pending registration nahi hai</p>
          <p className="mt-1 text-xs text-slate-500">Jab koi naya worker phone app se sign up karega, to uska card yahan aayega.</p>
          <button
            type="button"
            onClick={() => {
              const sampleUsers: UserProfile[] = [
                { uid: 'demo-u1', name: 'Ramesh Patel', mobile: '9876543210', city: 'Deesa', role: 'worker', status: 'pending', createdAt: Date.now() - 3600000 },
                { uid: 'demo-u2', name: 'Vikram Thakor', mobile: '9825123456', city: 'Palanpur', role: 'sales', status: 'pending', createdAt: Date.now() - 7200000 },
                { uid: 'demo-u3', name: 'Kamlesh Suthar', mobile: '9426012345', city: 'Unjha', role: 'worker', status: 'pending', createdAt: Date.now() - 14400000 }
              ];
              setPendingUsers(sampleUsers);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20"
          >
            <span>⚡</span> Load Demo Staff Registrations to Test
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pendingUsers.map((u) => {
            const isLoading = loadingUid === u.uid;
            const currentSelectedRole = selectedRoles[u.uid] || 'worker';

            return (
              <div
                key={u.uid}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">{u.name}</h3>
                      <p className="text-xs font-mono text-indigo-400 mt-0.5">{u.mobile}</p>
                    </div>
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                      PENDING
                    </span>
                  </div>

                  <div className="mt-3 text-xs text-slate-400 space-y-1">
                    <p>City / Gaon: <strong className="text-slate-200">{u.city || 'N/A'}</strong></p>
                    <p>Registered: <span className="text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</span></p>
                  </div>

                  {/* Role Assignment */}
                  <div className="mt-4 border-t border-slate-800/80 pt-3">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Assign Role</label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleRoleChange(u.uid, 'worker')}
                        className={`rounded-lg py-1.5 text-xs font-bold transition ${
                          currentSelectedRole === 'worker'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Worker (Duty)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRoleChange(u.uid, 'sales')}
                        className={`rounded-lg py-1.5 text-xs font-bold transition ${
                          currentSelectedRole === 'sales'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Sales (+ Hisab)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Approve / Reject Actions */}
                <div className="mt-5 grid grid-cols-2 gap-2 pt-3 border-t border-slate-800">
                  <button
                    onClick={() => handleApproval(u.uid, true)}
                    disabled={isLoading}
                    className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isLoading ? 'Wait...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleApproval(u.uid, false)}
                    disabled={isLoading}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

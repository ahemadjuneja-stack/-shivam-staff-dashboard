import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, UserRole } from '../types';

export default function ApprovalsScreen() {
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
  const [activeUsers, setActiveUsers] = useState<UserProfile[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<{ [uid: string]: UserRole }>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Real-time listeners for users collection only
  useEffect(() => {
    const unsubPending = onSnapshot(
      query(collection(db, 'users'), where('status', '==', 'pending')),
      (snapshot) => {
        const list: UserProfile[] = [];
        const rolesMap: { [uid: string]: UserRole } = {};
        snapshot.forEach((d) => {
          const user = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
          list.push(user);
          rolesMap[user.uid] = (user.role === 'sales' || user.role === 'worker') ? user.role : 'sales';
        });
        setPendingUsers(list);
        setSelectedRoles((prev) => ({ ...rolesMap, ...prev }));
      },
      (err) => console.warn('users pending listener error:', err)
    );

    const unsubActive = onSnapshot(
      query(collection(db, 'users'), where('status', '==', 'active')),
      (snapshot) => {
        const list: UserProfile[] = [];
        snapshot.forEach((d) => {
          list.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) });
        });
        setActiveUsers(list);
      },
      (err) => console.warn('users active listener error:', err)
    );

    return () => {
      unsubPending();
      unsubActive();
    };
  }, []);

  const handleRoleChange = (uid: string, role: UserRole) => {
    setSelectedRoles((prev) => ({ ...prev, [uid]: role }));
  };

  const handleApproval = async (user: UserProfile, approve: boolean) => {
    setActionMsg(null);
    const chosenRole: UserRole = selectedRoles[user.uid] || 'sales';
    const updateData = approve
      ? { status: 'active', role: chosenRole, approvedAt: Date.now() }
      : { status: 'rejected' };
    
    try {
      try {
        await updateDoc(doc(db, 'users', user.uid), updateData);
      } catch {
        await setDoc(doc(db, 'users', user.uid), { ...user, ...updateData }, { merge: true });
      }

      if (approve) {
        setActionMsg(`✅ ${user.name} approved successfully as ${chosenRole.toUpperCase()}! Moved to Active Staff.`);
        setActiveUsers((prev) => [
          ...prev.filter(p => p.uid !== user.uid),
          { ...user, status: 'active', role: chosenRole, approvedAt: Date.now() }
        ]);
      } else {
        setActionMsg(`❌ Registration rejected for ${user.name}.`);
      }
      setPendingUsers((prev) => prev.filter((u) => u.uid !== user.uid));
    } catch (err: unknown) {
      const error = err as Error;
      setActionMsg(`Error: ${error.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-3">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide">STAFF MANAGEMENT &amp; VERIFICATIONS</h2>
          <p className="text-xs text-slate-400">
            Real-time listener for mobile app registrations. Assign role (worker or sales) and approve staff.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-400 border border-indigo-500/20">
            Pending Approvals: {pendingUsers.length}
          </span>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-xs font-semibold text-indigo-300">
          {actionMsg}
        </div>
      )}

      {/* Pending Approvals Section */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <span>⏳</span> Pending Registrations ({pendingUsers.length})
        </h3>

        {pendingUsers.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-500 text-xl font-bold">
              ✓
            </div>
            <p className="text-sm font-semibold text-slate-300">No pending staff registrations</p>
            <p className="mt-1 text-xs text-slate-500">New staff registrations from the mobile app will appear here instantly in real-time.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendingUsers.map((u) => {
              const currentRole: UserRole = selectedRoles[u.uid] || 'sales';

              return (
                <div
                  key={u.uid}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-white">{u.name}</h4>
                        <p className="text-xs font-mono text-indigo-400 mt-0.5">{u.mobile}</p>
                      </div>
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                        PENDING
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-slate-400 space-y-1">
                      <p>City / Location: <strong className="text-slate-200">{u.city || 'Head Office'}</strong></p>
                      <p>Registered: <span className="text-slate-300">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'Just now'}</span></p>
                    </div>

                    {/* Role Selector Dropdown - Strict 'worker' | 'sales' */}
                    <div className="mt-4 border-t border-slate-800 pt-3">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Select Role</label>
                      <select
                        value={currentRole}
                        onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole)}
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="worker">Worker (Duty &amp; Operations)</option>
                        <option value="sales">Sales (Field &amp; Collection)</option>
                      </select>
                    </div>
                  </div>

                  {/* Approve / Reject Actions */}
                  <div className="mt-5 grid grid-cols-2 gap-2 pt-3 border-t border-slate-800">
                    <button
                      onClick={() => handleApproval(u, true)}
                      className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApproval(u, false)}
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition"
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

      {/* Active Staff Roster Section */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>👥</span> Active Staff Roster ({activeUsers.length})
          </h3>
          <span className="text-[10px] text-slate-500">Real-time synced</span>
        </div>

        {activeUsers.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
            No active staff approved yet. Approve pending registrations above to populate the active roster.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeUsers.map((u) => (
              <div key={u.uid} className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                    <h4 className="text-xs font-bold text-white">{u.name}</h4>
                  </div>
                  <p className="text-[11px] font-mono text-indigo-400 mt-0.5">{u.mobile}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Role: <strong className="text-slate-200 uppercase">{u.role || 'worker'}</strong>
                  </p>
                </div>
                <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 border border-emerald-500/20">
                  ACTIVE
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

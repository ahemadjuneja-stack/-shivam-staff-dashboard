import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserRole, UserProfile } from './types';
import { getRoleDefinition, hasSalesAccess, isSalesManager, RoleDefinition } from './roles';

export interface UseMyRoleResult {
  role: UserRole;
  roleDef: RoleDefinition;
  roleLabel: string;
  badgeClass: string;
  dotColor: string;
  hasSalesAccess: boolean;
  isSalesManager: boolean;
  isSalesman: boolean;
  isWorker: boolean;
  isNone: boolean;
  loading: boolean;
  profile: UserProfile | null;
  refreshRole: () => Promise<void>;
}

export function useMyRole(explicitUid?: string): UseMyRoleResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const uid = explicitUid || auth.currentUser?.uid;

  const fetchProfile = useCallback(async () => {
    if (!uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        setProfile({ uid: snap.id, ...(snap.data() as Omit<UserProfile, 'uid'>) });
      }
    } catch (e) {
      console.warn('fetchProfile error in useMyRole:', e);
    }
  }, [uid]);

  // 1. Live onSnapshot listener to users/{myUid}
  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const userDocRef = doc(db, 'users', uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setProfile({ uid: snapshot.id, ...(snapshot.data() as Omit<UserProfile, 'uid'>) });
        } else {
          setProfile(null);
        }
        setLoading(false);
      },
      (error) => {
        console.warn('useMyRole onSnapshot error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  // 2. Safety Net: Re-fetch on app resume / tab visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && uid) {
        fetchProfile();
      }
    };

    const handleFocus = () => {
      if (uid) fetchProfile();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [uid, fetchProfile]);

  const rawRole: UserRole = profile?.role || 'none';
  const roleDef = getRoleDefinition(rawRole);
  const salesAllowed = hasSalesAccess(rawRole);
  const managerAllowed = isSalesManager(rawRole);

  return {
    role: rawRole,
    roleDef,
    roleLabel: roleDef.label,
    badgeClass: roleDef.badgeClass,
    dotColor: roleDef.dotColor,
    hasSalesAccess: salesAllowed,
    isSalesManager: managerAllowed,
    isSalesman: roleDef.value === 'salesman' || rawRole === 'sales',
    isWorker: roleDef.value === 'worker',
    isNone: roleDef.value === 'none',
    loading,
    profile,
    refreshRole: fetchProfile
  };
}

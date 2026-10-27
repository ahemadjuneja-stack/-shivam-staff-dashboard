import { UserRole } from './types';

export interface RoleDefinition {
  value: UserRole;
  label: string;
  badgeClass: string;
  dotColor: string;
  description: string;
  permissions: string[];
}

export const ROLES: RoleDefinition[] = [
  {
    value: 'manager',
    label: 'Manager',
    badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    dotColor: 'bg-purple-500',
    description: 'Full dashboard access & staff management',
    permissions: [
      'Full Admin Dashboard access',
      'Staff management & verifications',
      'Cash Counter & sheets control',
      'All live attendance & settings'
    ]
  },
  {
    value: 'sales',
    label: 'Salesman',
    badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    dotColor: 'bg-blue-500',
    description: 'City-wise active XL sheets access',
    permissions: [
      'Assigned city Miracle sheets & XL access',
      'Customer Directory & live balances access',
      'Daily Jama / Kharcha collection entries'
    ]
  },
  {
    value: 'worker',
    label: 'Staff',
    badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700',
    dotColor: 'bg-slate-400',
    description: 'My Space: Tasks, Credit Score, Time & Duty',
    permissions: [
      'My Space Tasks & Credit Score',
      'Time & Duty punch in / out',
      'Daily work log submission'
    ]
  },
  {
    value: 'none',
    label: 'None',
    badgeClass: 'bg-slate-700/40 text-slate-400 border border-slate-600',
    dotColor: 'bg-slate-500',
    description: 'No special module access',
    permissions: [
      'Basic profile view only',
      'No dashboard or operational access'
    ]
  }
];

export function getRoleDefinition(role?: string | null): RoleDefinition {
  const normalized = (role || '').toLowerCase();
  if (normalized === 'manager' || normalized === 'sales_manager') {
    return ROLES[0];
  }
  if (normalized === 'sales' || normalized === 'salesman') {
    return ROLES[1];
  }
  if (normalized === 'worker') {
    return ROLES[2];
  }
  return ROLES[3]; // 'none'
}

export function hasSalesAccess(role?: string | null): boolean {
  const normalized = (role || '').toLowerCase();
  return normalized === 'salesman' || normalized === 'sales_manager' || normalized === 'sales' || normalized === 'manager';
}

export function isSalesManager(role?: string | null): boolean {
  const normalized = (role || '').toLowerCase();
  return normalized === 'sales_manager' || normalized === 'manager';
}

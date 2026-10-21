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
    value: 'salesman',
    label: 'Salesman',
    badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    dotColor: 'bg-blue-500',
    description: 'Field sales, customer balance check, cash/UPI collection & entries',
    permissions: [
      'Customer Directory & live balances access',
      'Daily Jama / Kharcha collection entries (Cash/UPI/Cheque)',
      'Assigned Miracle Sheets & customer accounts access',
      'Customer bill history access',
      'Daily duty geofence attendance & work logs'
    ]
  },
  {
    value: 'sales_manager',
    label: 'Sales Manager',
    badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    dotColor: 'bg-purple-500',
    description: 'Full sales module + customer oversight + sheets management',
    permissions: [
      'All Salesman permissions included',
      'All cities Miracle sheets & accounts oversight',
      'Naye customers add karna & balances manage karna',
      'Miracle bills & collection entries oversight',
      'Team live collection monitoring & reporting',
      'Daily duty geofence attendance & work logs'
    ]
  },
  {
    value: 'worker',
    label: 'Worker',
    badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700',
    dotColor: 'bg-slate-400',
    description: 'Shop duty, geofence attendance, work logs & operations',
    permissions: [
      'Duty Geofence punch in / punch out',
      'Daily work log submission',
      'Star rating performance & incentives',
      'Shop basic duty operations'
    ]
  },
  {
    value: 'none',
    label: 'None',
    badgeClass: 'bg-slate-700/40 text-slate-400 border border-slate-600',
    dotColor: 'bg-slate-500',
    description: 'Koi special module access nahi',
    permissions: [
      'Basic profile view only',
      'Sales module (sheets/customers/entries/bills) completely BLOCKED',
      'No operational access'
    ]
  }
];

export function getRoleDefinition(role?: string | null): RoleDefinition {
  const normalized = (role || '').toLowerCase();
  if (normalized === 'salesman' || normalized === 'sales') {
    return ROLES[0];
  }
  if (normalized === 'sales_manager' || normalized === 'manager') {
    return ROLES[1];
  }
  if (normalized === 'worker') {
    return ROLES[2];
  }
  return ROLES[3]; // 'none'
}

export function hasSalesAccess(role?: string | null): boolean {
  const normalized = (role || '').toLowerCase();
  return normalized === 'salesman' || normalized === 'sales_manager' || normalized === 'sales';
}

export function isSalesManager(role?: string | null): boolean {
  const normalized = (role || '').toLowerCase();
  return normalized === 'sales_manager';
}

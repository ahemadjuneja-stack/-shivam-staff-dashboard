export type UserRole = 'none' | 'worker' | 'sales' | 'salesman' | 'sales_manager' | 'manager';
export type UserStatus = 'pending' | 'active' | 'rejected';

export interface UserProfile {
  uid: string;
  name: string;
  mobile: string;
  city: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  approvedAt?: number;
  xlCities?: string[];
}

export interface ShopConfig {
  name: string;
  lat: number;
  lng: number;
  radius: number;
  shiftStart: string;
}

export interface PunchRecord {
  id?: string;
  uid: string;
  name: string;
  type: 'in' | 'out';
  at: number;
  lat: number;
  lng: number;
  dist?: number;
  distM?: number;
}

export interface WorkLog {
  id?: string;
  uid: string;
  name: string;
  date: string;
  text: string;
  status: 'pending' | 'approved' | 'rejected';
  at: number;
  verifiedAt?: number;
}

export type StarEventType = 'verify' | 'reject' | 'manual' | 'violation' | 'full-week' | 'on-time' | 'late';

export interface StarEvent {
  id?: string;
  uid: string;
  type: StarEventType;
  delta: number;
  note: string;
  at: number;
}

export interface ViolationRecord {
  id?: string;
  uid: string;
  at: number;
  kind: 'location-off';
  reason: string;
}

export interface Sheet {
  id: string;
  month: string;
  city: string;
  assignedTo: string;
  assignedName: string;
  status: 'active' | 'closed';
  createdAt: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  opening: number;
  balance: number;
  updatedAt?: number;
}

export interface CustomerBill {
  id: string;
  date: string;
  no: string;
  amount: number;
}

export type EntryKind = 'jama' | 'kharcha';
export type PaymentMode = 1 | 2 | 3; // 1 = Cash, 2 = UPI, 3 = Cheque

export interface LedgerEntry {
  id?: string;
  kind: EntryKind;
  cid?: string;
  cname?: string;
  amount: number;
  cash?: number;
  less?: number;
  rgoods?: number;
  mode: PaymentMode;
  note?: string;
  byUid: string;
  byName: string;
  at: number;
  lat?: number;
  lng?: number;
  miracle: boolean;
}

// OUTSIDE LOG (staff app geofence): staff shop ke radius ke bahar tha.
// Manager YES = shop ke kaam se gaya tha (koi cut nahi) | NO = rejected
// -> staff app AUTO credit cut karta hai (-10, cutApplied atomic flag).
export interface OutsideLog {
  id?: string;
  opId?: string;
  uid: string;
  name: string;
  fromAt: number;
  toAt: number;
  outsideMin: number;
  lat?: number;
  lng?: number;
  status: 'pending' | 'approved' | 'rejected';
  flags?: string[]; // gps_teleport / gps_low_accuracy (integrity layer)
  createdAt: number;
  cutApplied?: boolean;
  cutPoints?: number;
  cutAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

// DUTY GAP (staff app integrity layer): ON duty me app 20 min+ band raha
// (force-close / background) — reopen par log bana. Manager ko dikhta hai.
export interface DutyGap {
  id?: string;
  opId?: string;
  uid: string;
  name: string;
  fromAt: number;
  toAt: number;
  gapMin: number;
  kind: 'app_closed';
  status: 'pending' | 'noted';
  createdAt: number;
  notedAt?: number;
}

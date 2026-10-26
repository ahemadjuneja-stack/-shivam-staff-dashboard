export type UserRole = 'none' | 'worker' | 'sales' | 'salesman' | 'sales_manager' | 'manager';
// 'deleted' = soft delete (dashboard se): directory se gayab, login blocked,
// mobile number re-registration ke liye free (Auth takeover stored PIN se)
export type UserStatus = 'pending' | 'active' | 'rejected' | 'deleted';

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
  pin?: string; // login PIN on file (dashboard registration/PIN reset ke liye)
  photo?: string; // PROFILE DP (Boss order 2026-10-27) — staff app se compressed JPEG dataURL
}

// LINE SCHEDULE (Boss order 2026-10-27): salesman tour plan — kis date kis
// city. Dashboard Tours page XL upload / monthly builder se banata hai,
// staff app me salesman khud bhi likh/edit kar sakta hai. Verification:
// us date ki loc_sessions GPS points city coords se match -> green/red.
export interface ScheduleEntry {
  id?: string;
  uid: string;
  name: string;
  phone?: string;
  date: string; // 'YYYY-MM-DD'
  city: string;
  cityKey: string;
  month: string; // 'YYYY-MM'
  source: 'self' | 'dashboard';
  createdBy?: string;
  createdAt: number;
  updatedAt?: number;
  cityLat?: number;
  cityLng?: number;
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
// TWO-PHASE (stopwatch order 2026-10-26): 'open' = staff ABHI bahar hai
// (live popup + stopwatch), 'pending' = closed, review/auto-process waiting.
// Manager YES = shop ke kaam se gaya tha (koi cut nahi) | NO = rejected
// -> staff app AUTO credit cut karta hai (cutApplied atomic flag).
// allowedMin = manager ne dashboard se "bola hua time" set kiya — close hone
// par staff app khud compare karta hai: on-time = +5, late = -4, bina-bataye = -5.
export interface OutsideLog {
  id?: string;
  opId?: string;
  uid: string;
  name: string;
  fromAt: number;
  toAt?: number;
  outsideMin?: number;
  lat?: number;
  lng?: number;
  status: 'open' | 'pending' | 'approved' | 'rejected';
  flags?: string[]; // gps_teleport / gps_low_accuracy (integrity layer)
  createdAt: number;
  closedAt?: number;
  allowedMin?: number;
  cutApplied?: boolean;
  cutPoints?: number;
  cutReason?: string; // outside_reject/approved/ontime/late/no_notice
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

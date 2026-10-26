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
  // TOUR PAUSE/RESUME (Boss order 2026-10-27): role salesman = time FREEZE,
  // role staff wapas = WAHI SE resume jaha se chhoda tha.
  //   pauseMs  = total paused duration (completed pauses, excluded from elapsed)
  //   pausedAt = current pause start (absent = running)
  // effective elapsed = now - fromAt - pauseMs - (pausedAt ? now - pausedAt : 0)
  pauseMs?: number;
  pausedAt?: number;
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

// ============================================================
// COUNTER BOOK (Task 67 — Boss notation rule)
// ALL amounts stored as integer PAISE (real). Counter Book UI
// displays CHART NOTATION (/10 system): 1 chart unit = Rs.10 =
// 1000 paise. 2000 -> 200, 3456 -> 345.6. Tour Hisab uses real
// rupees. The two systems are SEPARATE — never mixed.
// ============================================================
export type CbEntryType = 'cashSale' | 'udhari' | 'deposit' | 'expense' | 'parcel' | 'haste';
export type CbUdhariMode = 'Cash' | 'Receipt';
export type CbParcelMode = 'In Hand' | 'Transport' | 'Courier' | 'Other Party' | 'Riksha';
export type CbCategory = 'CO' | 'IM' | 'HG';

export interface CbEntry {
  id: string;
  type: CbEntryType;
  dept: 1 | 2;
  amtP: number;            // main amount, integer paise (chart display = amtP/1000)
  name?: string;           // udhari party / parcel party / haste person
  party?: string;          // haste party (shop)
  billNo?: string;         // udhari bill no / parcel bill-in
  billP?: number;          // udhari original bill amount
  lessP?: number;          // udhari less/discount
  mode?: string;           // udhari: 'Cash' | 'Receipt' ; parcel: CbParcelMode
  head?: string;           // expense head
  city?: string;           // parcel / haste city
  cat?: CbCategory;        // parcel category CO / IM / HG
  courier?: string;        // parcel transport name
  vaydaDate?: string;      // haste promise date 'YYYY-MM-DD'
  note?: string;
  status?: 'pending' | 'done'; // haste / parcel status
  by: string;
  at: number;
}

export interface CbGini {
  d1P: number;             // physically counted Dept-1 counter (paise)
  d2P: number;
  at: number;
  by: string;
}

export interface CbCloseTotals {
  exp1P: number;           // computed expected counter D1 at lock
  exp2P: number;
  sale1P: number;
  sale2P: number;
  recv1P: number;          // udhari Cash receipts
  recv2P: number;
  dep1P: number;
  dep2P: number;
  expn1P: number;          // expenses
  expn2P: number;
  nextCarryP1: number;     // gini counted if given else computed
  nextCarryP2: number;
  d1DiffP: number;         // gini - expected
  d2DiffP: number;
}

export interface CbDay {
  kind: 'cb-day';
  date: string;            // 'YYYY-MM-DD'
  status: 'open' | 'locked';
  carryP1: number;         // carried-in counter (paise)
  carryP2: number;
  carryNote?: string;
  entries: CbEntry[];
  gini?: CbGini;
  lockedAt?: number;
  lockedBy?: string;
  closeTotals?: CbCloseTotals;
  createdAt: number;
}

export interface CbSettings {
  kind: 'cb-settings';
  openingP1: number;       // fresh-start opening, default Rs.2000 = 200000 paise
  openingP2: number;
  minCounterP: number;     // 2000-minimum rule (chart 200)
}

export interface CbAuditRec {
  kind: 'cb-audit';
  at: number;
  by: string;
  action: 'add' | 'delete' | 'gini' | 'lock' | 'unlock' | 'settings';
  detail: string;
}

// ============================================================
// TOUR HISAB (Task 67) — Miracle XL upload, REAL RUPEES
// ============================================================
export interface ThBill {
  date: string;
  no: string;
  amtP: number;     // bill amount
  rgP: number;      // R.G. goods return
  lessP: number;
  cashP: number;    // received split
  upiP: number;
  cheqP: number;
  balP: number;     // closing balance (computed — code-only guarantee)
  balStatedP?: number; // balance as stated in XL (for cross-check; cleared on edit)
  src?: string;     // source ref e.g. 'DEESA row 14'
  flag?: string;    // check failure message
}

export interface ThParty {
  name: string;
  code?: string;
  openingP: number;
  bills: ThBill[];
  totalStatedP?: number; // party total row as stated in XL (cross-check)
}

export interface ThRoute {
  name: string;
  kharchaP: number;     // route expense (from summary page)
  aangadiyaP: number;   // market fee paid
  parties: ThParty[];
  src?: string;
}

export interface ThUpload {
  kind: 'th-upload';
  month: string;        // 'YYYY-MM'
  fileName: string;
  uploadedBy: string;
  uploadedAt: number;
  routes: ThRoute[];
  checks: { ok: boolean; issues: string[] };
}

// ============================================================
// MONEY CORE (Task 67) — integer-paise math, ZERO float errors
//
// BOSS NOTATION RULE (locked):
//  - Counter Book  -> CHART NOTATION (/10): 2000 -> 200, 3456 -> 345.6
//    1 chart unit = Rs.10 = 1000 paise. Max 1 decimal in input.
//  - Tour Hisab    -> REAL RUPEES: 3456 -> 3456
//    1 rupee = 100 paise. Max 2 decimals in input.
//  - Two systems are SEPARATE. Never mix, never auto-convert.
// All storage = integer paise. All display = derived at render.
// ============================================================

// ---------- CHART NOTATION (Counter Book) ----------
export const CHART_UNIT_P = 1000; // 1 chart unit = Rs.10 = 1000 paise

export function chartToPaise(v: number): number {
  return Math.round(v * CHART_UNIT_P);
}

export function paiseToChart(p: number): number {
  return p / CHART_UNIT_P;
}

/** Chart display string: 200000 -> "200", 345600 -> "345.6", -12000 -> "-12" */
export function fmtChart(p: number): string {
  if (!Number.isFinite(p)) return '0';
  const v = p / CHART_UNIT_P;
  const a = Math.abs(v);
  const s = Number.isInteger(a) ? String(a) : a.toFixed(1);
  return v < 0 ? '-' + s : s;
}

/**
 * Parse boss's chart input. Allowed: "200", "345.6", ".5" — max 1 decimal.
 * Returns integer paise, or null if invalid.
 */
export function parseChartInput(s: string): number | null {
  const t = (s || '').trim().replace(/,/g, '');
  if (!/^\d{0,7}(\.\d)?$/.test(t) || t === '' || t === '.') return null;
  return chartToPaise(parseFloat(t));
}

// ---------- REAL RUPEES (Tour Hisab / Salesman) ----------
export function rupeesToPaise(v: number): number {
  return Math.round(v * 100);
}

/** "₹12,450" (whole rupees shown; paise shown only when present) */
export function fmtRs(p: number): string {
  if (!Number.isFinite(p)) return '₹0';
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  const hasPaise = a % 100 !== 0;
  return (
    sign +
    '₹' +
    (a / 100).toLocaleString('en-IN', {
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2
    })
  );
}

/** Parse real-rupee input "3456" / "3,456.50" -> paise, or null if invalid */
export function parseRsInput(s: string): number | null {
  const t = (s || '').trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return rupeesToPaise(parseFloat(t));
}

// ---------- SHARED ----------
/** 'YYYY-MM-DD' for a Date in device local time */
export function dateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function todayStr(): string {
  return dateStr(new Date());
}

/** add days to a 'YYYY-MM-DD' string (local-safe) */
export function shiftDateStr(s: string, days: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateStr(dt);
}

/** '2026-10-27' -> '27 Oct' (short label) */
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${String(d).padStart(2, '0')} ${MONS[m - 1]}`;
}

/** numeric cell from XL -> paise (handles 1234.5, "1,234", "Rs 1,234.00") */
export function cellToPaise(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  const t = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

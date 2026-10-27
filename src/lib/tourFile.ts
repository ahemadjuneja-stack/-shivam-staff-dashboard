// ============================================================
// TOUR FILE UPLOAD PARSER (Task 95, Boss order 2026-10-28)
// "Miracle se hume is tarha data nahi dena hum pdf ya xl hi upload karege
//  app ko khud manage karna hoga use user friendly khud hi banana hoga"
//
// FILE -> TEXT -> EXISTING PROVEN PARSER (tourPaste.ts, 52 tests):
//   .pdf          -> pdfjs text layer (line assembly) -> parseTourPaste
//   .xlsx/.xls    -> SheetJS grid -> row-lines -> parseTourPaste
//   .csv          -> SheetJS (csv bhi read karta hai) -> same
//
// Ek hi parse brain dono formats ke liye — Miracle ka report PDF me ho ya
// XL me, structure same hota hai (city headers, shop rows, bill rows,
// payment details). Grid -> lines reconstruction whitespace-tolerant
// parser ke liye kaafi hai.
// ============================================================

import type { ParseResult } from './tourPaste';
import { parseTourPaste } from './tourPaste';

// ---------- cell -> text (Miracle grid ke liye) ----------

/** Date object -> 'dd/mm/yyyy' (Miracle sheet format) */
export function dateCellToStr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** grid cell -> parser-friendly text */
export function cellToText(c: unknown): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return dateCellToStr(c);
  if (typeof c === 'number') {
    if (!Number.isFinite(c)) return '';
    // mode numbers (1/2/3) plain; amounts bhi plain (toPaise comma optional)
    return String(c);
  }
  return String(c).trim();
}

/**
 * Grid -> text lines (ek row = ek line, cells space-joined, empty cells skip).
 * PHIR city-header merge pass: agar "Date: ..." line se pehle LONE city-name
 * line hai (no digits) to dono jod do — XL me city aur Date alag cells/rows
 * me aa sakte hain ("PORBANDAR" row, phir "Date: 24/10/2026" row).
 */
export function gridToLines(grid: unknown[][]): string[] {
  const lines: string[] = [];
  for (const row of grid || []) {
    const cells = (row as unknown[]).map(cellToText).filter((t) => t !== '');
    if (!cells.length) continue;
    lines.push(cells.join(' '));
  }
  return mergeCityHeaderLines(lines);
}

/** "Date: ..." line ke turant pehle lone-name line ho to merge (XL city header) */
export function mergeCityHeaderLines(lines: string[]): string[] {
  const out: string[] = [];
  const JUNK = /^(le|ss|r\.?g|oo|ds|mo|ad|de|e|moad|goods|less|total|totals?|totails?)$/i;
  for (const ln of lines) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      /^date\s*[:\-]/i.test(ln) &&
      prev.length >= 3 &&
      !/\d/.test(prev) &&
      !/^date\s*[:\-]/i.test(prev) &&
      !JUNK.test(prev)
    ) {
      out[out.length - 1] = `${prev} ${ln}`;
    } else {
      out.push(ln);
    }
  }
  return out;
}

// ---------- PDF text extraction (pdfjs, dynamic import) ----------

interface PdfTextItem { str?: string; transform?: number[] }

/**
 * PDF bytes -> text lines. pdfjs ka text layer position-based hota hai —
 * items ko y-position (line) cluster karke x-sort karte hain, warna vertical
 * columns (Le/ss/R.Goods) lines scramble kar dete hain.
 */
export async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs: Record<string, unknown> = await import('pdfjs-dist');
  // Vite worker (browser). Node/tests me fake worker fallback chalta hai.
  try {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = workerUrl;
  } catch { /* node/test env — ignore */ }
  const getDocument = pdfjs.getDocument as (src: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: PdfTextItem[] }> }>;
    }>
  };
  const doc = await getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true
  }).promise;
  const pageLines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // y-cluster: tolerance 3px
    type Row = { y: number; items: { x: number; s: string }[] };
    const rows: Row[] = [];
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4] ?? 0;
      const y = tr[5] ?? 0;
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s });
    }
    rows.sort((a, b) => b.y - a.y); // upar se neeche
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      pageLines.push(r.items.map((i) => i.s).join(' '));
    }
    pageLines.push(''); // page break -> blank line (parser junk-skip)
  }
  // Miracle PDF me city name aur "Date: ..." ALAG visual rows me hote hain —
  // parser ke tryCityHeader ko ek hi line chahiye. mergeCityHeaderLines
  // lone-name + Date jodta hai (XL path me bhi yahi use hota hai).
  return mergeCityHeaderLines(pageLines).join('\n');
}

// ---------- Workbook (XL/CSV) parse ----------

export interface WorkbookParseResult extends ParseResult {
  sheetName?: string; // kis sheet se mila (diagnostics)
  text?: string;      // reconstructed lines (sourceText backup ke liye)
}

/** ArrayBuffer (xlsx/xls/csv) -> best ParseResult (sab sheets try, best jeete) */
export function parseTourWorkbook(buf: ArrayBuffer, XLSX: {
  read: (data: Uint8Array | ArrayBuffer, opts?: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (ws: unknown, opts?: Record<string, unknown>) => unknown[][] };
}): WorkbookParseResult {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  let best: WorkbookParseResult = { ok: false, reason: 'Workbook me koi readable sheet nahi mili', cities: [], junkLines: 0 };
  let bestScore = -1;
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const lines = gridToLines(grid);
    const text = lines.join('\n');
    if (!text.trim()) continue;
    const res = parseTourPaste(text);
    const score = res.ok
      ? res.cities.reduce((a, c) => a + c.shops.length + c.shops.reduce((x, s) => x + s.bills.length, 0) * 2, 0)
      : -1;
    if (score > bestScore) {
      bestScore = score;
      best = { ...res, sheetName, text };
    }
  }
  if (bestScore < 0 && !best.ok) {
    best = {
      ...best,
      reason: 'Is file ka format Miracle tour-report jaisa nahi lag raha. Miracle se TOUR REPORT ka PDF ya XL export karke try karo.'
    };
  }
  return best;
}

/** file extension se kind */
export function fileKindOf(name: string): 'pdf' | 'xl' | 'unknown' {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xl';
  return 'unknown';
}

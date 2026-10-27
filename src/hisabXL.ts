import * as XLSX from 'xlsx-js-style';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

export type CellValue = string | number | null;

export interface SheetData {
  name: string;
  grid: CellValue[][];
  merges: string[]; // e.g. ["A1:B1"]
  cols: (number | null)[]; // column widths in wch
  styleTable?: Record<string, unknown>[];   // unique style objects for this sheet
  styleIndex?: (number | null)[][];         // 53x37 indexes into styleTable (null = no style)
  updatedAt?: unknown;
}

export interface MonthDoc {
  monthId: string; // "YYYY-MM"
  label: string; // "June-2026"
  createdAt?: unknown;
  createdBy?: string;
  closed?: boolean;
  sheetNames: string[];
  synthetic?: boolean; // Task 70: local auto-created month (Firestore doc abhi sync nahi hua)
}

export interface ComputedChips {
  cash1no: number;   // AH53
  recipt1no: number; // AI53
  csah2no: number;   // AJ53
  recipt2no: number; // AK53
}

export interface MismatchItem {
  sheetName?: string;
  cell: string;
  excelValue: number;
  appValue: number;
}

export interface VerificationResult {
  checked: number;
  mismatches: MismatchItem[];
}

const THEME_RGB = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

export function colorToCss(c: any): string | null {
  if (!c || typeof c !== 'object') return null;

  // 1) Direct RGB / ARGB
  if (c.rgb && typeof c.rgb === 'string') {
    const raw = c.rgb.trim();
    if (raw.length >= 6) {
      const hex = raw.slice(-6).toUpperCase();
      return `#${hex}`;
    }
  }

  // 2) Theme index + tint
  if (typeof c.theme === 'number') {
    const idx = Math.max(0, Math.min(9, Math.floor(c.theme)));
    const baseHex = THEME_RGB[idx] || 'FFFFFF';
    const r = parseInt(baseHex.substring(0, 2), 16);
    const g = parseInt(baseHex.substring(2, 4), 16);
    const b = parseInt(baseHex.substring(4, 6), 16);

    const tint = typeof c.tint === 'number' ? c.tint : 0;
    let finalR = r;
    let finalG = g;
    let finalB = b;

    if (tint > 0) {
      finalR = r + (255 - r) * tint;
      finalG = g + (255 - g) * tint;
      finalB = b + (255 - b) * tint;
    } else if (tint < 0) {
      finalR = r * (1 + tint);
      finalG = g * (1 + tint);
      finalB = b * (1 + tint);
    }

    const clampHex = (val: number) =>
      Math.max(0, Math.min(255, Math.round(val))).toString(16).padStart(2, '0').toUpperCase();
    return `#${clampHex(finalR)}${clampHex(finalG)}${clampHex(finalB)}`;
  }

  return null;
}

export function extractStyles(
  ws: any,
  rows: number,
  cols: number
): { styleTable: Record<string, unknown>[]; styleIndex: (number | null)[][] } {
  const styleTable: Record<string, unknown>[] = [];
  const styleMap = new Map<string, number>();
  const styleIndex: (number | null)[][] = [];

  for (let r = 0; r < rows; r++) {
    const rowIdxs: (number | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const s = cell?.s;
      const z = cell?.z || s?.numFmt;

      if (!s && !z) {
        rowIdxs.push(null);
        continue;
      }

      const compact: Record<string, any> = {};

      if (s) {
        if (s.fill) {
          const fillObj: Record<string, any> = {};
          if (s.fill.patternType) fillObj.patternType = s.fill.patternType;
          if (s.fill.fgColor) fillObj.fgColor = s.fill.fgColor;
          if (s.fill.bgColor) fillObj.bgColor = s.fill.bgColor;
          if (Object.keys(fillObj).length > 0) compact.fill = fillObj;
        }

        if (s.font) {
          const fontObj: Record<string, any> = {};
          if (s.font.bold) fontObj.bold = true;
          if (s.font.italic) fontObj.italic = true;
          if (s.font.underline) fontObj.underline = true;
          if (s.font.sz) fontObj.sz = s.font.sz;
          if (s.font.name) fontObj.name = s.font.name;
          if (s.font.color) fontObj.color = s.font.color;
          if (Object.keys(fontObj).length > 0) compact.font = fontObj;
        }

        if (s.alignment) {
          const alignObj: Record<string, any> = {};
          if (s.alignment.horizontal) alignObj.horizontal = s.alignment.horizontal;
          if (s.alignment.vertical) alignObj.vertical = s.alignment.vertical;
          if (s.alignment.wrapText) alignObj.wrapText = true;
          if (Object.keys(alignObj).length > 0) compact.alignment = alignObj;
        }

        if (s.border) {
          const borderObj: Record<string, any> = {};
          ['top', 'bottom', 'left', 'right'].forEach((side) => {
            if (s.border[side]) {
              borderObj[side] = {
                style: s.border[side].style,
                color: s.border[side].color || null
              };
            }
          });
          if (Object.keys(borderObj).length > 0) compact.border = borderObj;
        }
      }

      if (z && typeof z === 'string') {
        compact.numFmt = z;
      } else if (s?.numFmt && typeof s.numFmt === 'string') {
        compact.numFmt = s.numFmt;
      }

      if (Object.keys(compact).length === 0) {
        rowIdxs.push(null);
        continue;
      }

      const json = JSON.stringify(compact);
      let idx = styleMap.get(json);
      if (idx === undefined) {
        idx = styleTable.length;
        styleTable.push(compact);
        styleMap.set(json, idx);
      }
      rowIdxs.push(idx);
    }
    styleIndex.push(rowIdxs);
  }

  return { styleTable, styleIndex };
}

// Convert column index 0-based to letter (e.g. 0 -> A, 26 -> AA, 36 -> AK)
export function colToLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Convert coordinate (r, c) 0-based to A1 string (e.g. 0, 0 -> A1)
export function cellToA1(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

// Safe numeric parser
export function parseNum(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Check if a value should be right-aligned
export function isNumericValue(val: unknown): boolean {
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'number') return true;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s === '') return false;
    return !isNaN(Number(s.replace(/,/g, '')));
  }
  return false;
}

// Normalize any raw grid into at least 53 rows × 37 columns of CellValue
export function normalizeGrid(rawGrid: unknown[][], minRows = 53, minCols = 37): CellValue[][] {
  const rowCount = Math.max(rawGrid.length, minRows);
  const result: CellValue[][] = [];

  for (let r = 0; r < rowCount; r++) {
    const row: CellValue[] = [];
    const sourceRow = rawGrid[r] || [];
    const colCount = Math.max(sourceRow.length, minCols);
    for (let c = 0; c < colCount; c++) {
      const val = sourceRow[c];
      if (val === undefined || val === null) {
        row.push(null);
      } else if (typeof val === 'number' || typeof val === 'string') {
        row.push(val);
      } else if (typeof val === 'boolean') {
        row.push(val ? 'TRUE' : 'FALSE');
      } else {
        row.push(String(val));
      }
    }
    result.push(row);
  }

  return result;
}

// Check if a cell is one of the computed formula cells
export function isComputedCell(r: number, c: number): boolean {
  // r is 0-based row index (Excel row r+1)
  // c is 0-based column index

  // Row 1 (r=0): AD1 (29), AE1 (30), AF1 (31), AG1 (32)
  if (r === 0 && (c === 29 || c === 30 || c === 31 || c === 32)) return true;

  // Rows 2..50 (r=1..49):
  // J (9), K (10), Y (24), AD (29), AE (30), AF (31), AG (32), AH (33), AI (34), AJ (35), AK (36)
  if (r >= 1 && r <= 49) {
    if (c === 9 || c === 10 || c === 24) return true;
    if (c >= 29 && c <= 36) return true;
  }

  // Row 53 (r=52): AH53 (33), AI53 (34), AJ53 (35), AK53 (36)
  if (r === 52 && (c === 33 || c === 34 || c === 35 || c === 36)) return true;

  // Left box computed cells:
  // B4 (r=3, c=1), C4 (r=3, c=2)
  if (r === 3 && (c === 1 || c === 2)) return true;
  // B6 (r=5, c=1), C6 (r=5, c=2)
  if (r === 5 && (c === 1 || c === 2)) return true;
  // B12 (r=11, c=1), C12 (r=11, c=2)
  if (r === 11 && (c === 1 || c === 2)) return true;
  // B14 (r=13, c=1), C14 (r=13, c=2)
  if (r === 13 && (c === 1 || c === 2)) return true;
  // B16 (r=15, c=1), C16 (r=15, c=2)
  if (r === 15 && (c === 1 || c === 2)) return true;

  return false;
}

// Run the live formula engine replicating Excel exactly
export function runFormulaEngine(grid: CellValue[][]): { grid: CellValue[][]; chips: ComputedChips } {
  // Ensure dimensions
  const normalized = normalizeGrid(grid, 53, 37);

  // P1 = grid[0][15] (default 25)
  const p1Val = parseNum(normalized[0][15]) || 25;

  let sumAD = 0;
  let sumAE = 0;
  let sumAF = 0;
  let sumAG = 0;
  let sumAH = 0;
  let sumAI = 0;
  let sumAJ = 0;
  let sumAK = 0;

  // For rows r=2..50 (indexes 1..49)
  for (let r = 1; r < 50; r++) {
    const H = parseNum(normalized[r][7]);
    const I = parseNum(normalized[r][8]);
    // EXCEL-PERCENT RULE (Boss order 27 Oct: 'less % galat hai 5% par 500% ho
    // raha hai... 2000 ka 2000, real calculations'): original chart =H*I Excel
    // ka percent-autocorrect use karta tha (Excel me "5%" type karne par cell
    // VALUE 0.05 store hota hai). App me Boss "5" type karta hai to bhi 5% hi
    // mile — I >= 1 -> percent (I/100); I < 1 -> already fraction (0.05 = 5%).
    const lessRate = I >= 1 ? I / 100 : I;
    const J = H * lessRate;
    normalized[r][9] = J === 0 ? null : J;

    const K = H - J;
    normalized[r][10] = (H === 0 && J === 0) ? null : K;

    const U = parseNum(normalized[r][20]);
    const V = parseNum(normalized[r][21]);
    const W = parseNum(normalized[r][22]);
    const sumUVW = U + V + W;
    const Y = (sumUVW * 10) * (p1Val / 100);
    normalized[r][24] = sumUVW === 0 ? null : Y;

    const E = String(normalized[r][4] ?? '').trim();
    const effectiveK = parseNum(normalized[r][10]);
    const AD = E === '1' ? effectiveK : 0;
    normalized[r][29] = AD === 0 ? null : AD;
    sumAD += AD;

    const AE = E === '2' ? effectiveK : 0;
    normalized[r][30] = AE === 0 ? null : AE;
    sumAE += AE;

    const M = String(normalized[r][12] ?? '').trim();
    // CASH GIVEN REAL FIX (Boss 27 Oct: 'given money me se agar kisi ko diya
    // jaye to 200 me se kam hone chahiye'): Boss amount 'Cash Given' (N col)
    // header ke niche type karta hai — pehle sirf O (Amount) count hota tha isliye
    // Cash In Hand kam nahi hota tha. Ab DONO columns ke amount judte hai
    // (N me naam/detail string ho to parseNum 0 deta hai — safe).
    const givenAmt = parseNum(normalized[r][13]) + parseNum(normalized[r][14]);
    const AF = M === '1' ? givenAmt : 0;
    normalized[r][31] = AF === 0 ? null : AF;
    sumAF += AF;

    const AG = M === '2' ? givenAmt : 0;
    normalized[r][32] = AG === 0 ? null : AG;
    sumAG += AG;

    const F = String(normalized[r][5] ?? '').trim().toLowerCase();
    const AH = F === 'cash' ? AD : 0;
    normalized[r][33] = AH === 0 ? null : AH;
    sumAH += AH;

    const AI = F === 'receipt' ? AD : 0;
    normalized[r][34] = AI === 0 ? null : AI;
    sumAI += AI;

    const AJ = F === 'cash' ? AE : 0;
    normalized[r][35] = AJ === 0 ? null : AJ;
    sumAJ += AJ;

    const AK = F === 'receipt' ? AE : 0;
    normalized[r][36] = AK === 0 ? null : AK;
    sumAK += AK;
  }

  // Row 1 Totals: AD1, AE1, AF1, AG1 (Row 0, cols 29..32)
  normalized[0][29] = sumAD;
  normalized[0][30] = sumAE;
  normalized[0][31] = sumAF;
  normalized[0][32] = sumAG;

  // Row 53 Totals: AH53, AI53, AJ53, AK53 (Row 52, cols 33..36)
  normalized[52][33] = sumAH;
  normalized[52][34] = sumAI;
  normalized[52][35] = sumAJ;
  normalized[52][36] = sumAK;

  // Left box computed cells:
  // B8 = grid[7][1], B9 = grid[8][1]
  // C8 = grid[7][2], C9 = grid[8][2]
  const b8 = parseNum(normalized[7][1]);
  const b9 = parseNum(normalized[8][1]);
  const c8 = parseNum(normalized[7][2]);
  const c9 = parseNum(normalized[8][2]);

  // B6 = 200 + AD1 - AF1 - B8 - B9
  const b6 = 200 + sumAD - sumAF - b8 - b9;
  normalized[5][1] = b6;

  // C6 = 200 + AE1 - AG1 - C8 - C9
  const c6 = 200 + sumAE - sumAG - c8 - c9;
  normalized[5][2] = c6;

  // B4 = 200 - B6; C4 = 200 - C6
  normalized[3][1] = 200 - b6;
  normalized[3][2] = 200 - c6;

  // B12 = AH53; C12 = AJ53
  normalized[11][1] = sumAH;
  normalized[11][2] = sumAJ;

  // B14 = AI53; C14 = AK53
  normalized[13][1] = sumAI;
  normalized[13][2] = sumAK;

  // B16 = AF1; C16 = AG1
  normalized[15][1] = sumAF;
  normalized[15][2] = sumAG;

  const round2 = (x: number) => Math.round(x * 100) / 100;

  return {
    grid: normalized,
    chips: {
      cash1no: round2(sumAH),
      recipt1no: round2(sumAI),
      csah2no: round2(sumAJ),
      recipt2no: round2(sumAK)
    }
  };
}

// Accounting verification function: compares Excel stored values against recomputed app values
export function verifySheet(
  grid: (string | number | null)[][],
  sheetName: string
): VerificationResult {
  const engineResult = runFormulaEngine(grid);
  const computedGrid = engineResult.grid;

  let checked = 0;
  const mismatches: MismatchItem[] = [];

  for (let r = 0; r < 53; r++) {
    for (let c = 0; c < 37; c++) {
      if (!isComputedCell(r, c)) continue;

      const rawVal = grid[r]?.[c];
      if (rawVal === null || rawVal === undefined) continue;

      let excelNum: number | null = null;
      if (typeof rawVal === 'number') {
        if (!isNaN(rawVal)) excelNum = rawVal;
      } else if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (trimmed !== '') {
          const parsed = parseFloat(trimmed.replace(/,/g, ''));
          if (!isNaN(parsed)) excelNum = parsed;
        }
      }

      if (excelNum === null) continue;

      checked++;

      const appNum = parseNum(computedGrid[r]?.[c]);
      const diff = Math.abs(excelNum - appNum);

      if (diff > 0.01) {
        mismatches.push({
          cell: cellToA1(r, c),
          excelValue: Math.round(excelNum * 100) / 100,
          appValue: Math.round(appNum * 100) / 100
        });
      }
    }
  }

  return {
    checked,
    mismatches
  };
}

// Parse merge strings ("A1:B2") into map of row/col span and covered cells
export interface CellMergeInfo {
  isCovered: boolean;
  rowSpan?: number;
  colSpan?: number;
}

export function buildMergeMap(merges: string[]): Map<string, CellMergeInfo> {
  const map = new Map<string, CellMergeInfo>();

  for (const mergeStr of merges) {
    try {
      const range = XLSX.utils.decode_range(mergeStr);
      const startR = range.s.r;
      const startC = range.s.c;
      const endR = range.e.r;
      const endC = range.e.c;

      // Top-left cell gets rowSpan & colSpan
      const keyStart = `${startR},${startC}`;
      map.set(keyStart, {
        isCovered: false,
        rowSpan: endR - startR + 1,
        colSpan: endC - startC + 1
      });

      // All other cells within the rectangle are covered
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) {
          if (r === startR && c === startC) continue;
          map.set(`${r},${c}`, { isCovered: true });
        }
      }
    } catch {
      // Ignore unparseable merge range
    }
  }

  return map;
}

// Sort sheet names: numeric sheets ("1".."31") first ascending, non-numeric after
export function sortSheetNames(names: string[]): string[] {
  const numeric: number[] = [];
  const nonNumeric: string[] = [];

  for (const name of names) {
    const trimmed = name.trim();
    const num = Number(trimmed);
    if (!isNaN(num) && Number.isInteger(num) && num > 0 && num <= 31) {
      numeric.push(num);
    } else {
      nonNumeric.push(trimmed);
    }
  }

  numeric.sort((a, b) => a - b);
  return [...numeric.map((n) => String(n)), ...nonNumeric];
}

// Save a single sheet document to Firestore with nested-array fallback
export async function saveSheetToFirestore(
  db: Firestore,
  monthId: string,
  sheet: SheetData
): Promise<void> {
  const sheetDocRef = doc(db, 'hisab', monthId, 'sheets', sheet.name);
  const baseDoc: Record<string, any> = {
    name: sheet.name,
    grid: deepClean(sheet.grid),
    merges: deepClean(sheet.merges),
    cols: deepClean(sheet.cols),
    updatedAt: serverTimestamp()
  };
  if (sheet.styleTable) baseDoc.styleTable = deepClean(sheet.styleTable);
  if (sheet.styleIndex) baseDoc.styleIndex = deepClean(sheet.styleIndex);

  try {
    await setDoc(sheetDocRef, baseDoc);
  } catch (err: unknown) {
    // Fall back to rows stored as JSON strings if nested array is rejected
    const errorMsg = String((err as Error)?.message || '');
    if (errorMsg.includes('nested') || errorMsg.includes('array')) {
      const rowsJson = sheet.grid.map((r) => JSON.stringify(r));
      const fallbackDoc: Record<string, any> = {
        name: sheet.name,
        rowsJson,
        merges: deepClean(sheet.merges),
        cols: deepClean(sheet.cols),
        updatedAt: serverTimestamp()
      };
      if (sheet.styleTable) fallbackDoc.styleTable = deepClean(sheet.styleTable);
      if (sheet.styleIndex) {
        fallbackDoc.styleIndexJson = deepClean(sheet.styleIndex.map((r) => JSON.stringify(r)));
      }
      await setDoc(sheetDocRef, fallbackDoc);
    } else {
      throw err;
    }
  }
}

// Load a single sheet document from Firestore
export async function loadSheetFromFirestore(
  db: Firestore,
  monthId: string,
  sheetName: string
): Promise<SheetData | null> {
  const sheetDocRef = doc(db, 'hisab', monthId, 'sheets', sheetName);
  const snap = await getDoc(sheetDocRef);
  if (!snap.exists()) return null;

  const data = snap.data();
  let grid: CellValue[][] = [];

  if (data.grid && Array.isArray(data.grid)) {
    if (Array.isArray(data.grid[0])) {
      grid = data.grid as CellValue[][];
    } else if (typeof data.grid[0] === 'string') {
      grid = data.grid.map((r: string) => JSON.parse(r));
    }
  } else if (data.rowsJson && Array.isArray(data.rowsJson)) {
    grid = data.rowsJson.map((r: string) => JSON.parse(r));
  }

  let styleTable: Record<string, unknown>[] | undefined;
  if (Array.isArray(data.styleTable)) {
    styleTable = data.styleTable;
  }

  let styleIndex: (number | null)[][] | undefined;
  if (Array.isArray(data.styleIndex)) {
    if (Array.isArray(data.styleIndex[0])) {
      styleIndex = data.styleIndex;
    } else if (typeof data.styleIndex[0] === 'string') {
      styleIndex = data.styleIndex.map((r: string) => JSON.parse(r));
    }
  } else if (Array.isArray(data.styleIndexJson)) {
    styleIndex = data.styleIndexJson.map((r: string) => JSON.parse(r));
  }

  return {
    name: data.name || sheetName,
    grid: normalizeGrid(grid, 53, 37),
    merges: Array.isArray(data.merges) ? data.merges : [],
    cols: Array.isArray(data.cols) ? data.cols : [],
    styleTable,
    styleIndex,
    updatedAt: data.updatedAt
  };
}

// Save an entire month workbook to Firestore (batch creation with progress callback)
export async function saveMonthWorkbookToFirestore(
  db: Firestore,
  monthId: string,
  label: string,
  uid: string,
  sheetNames: string[],
  sheets: { [sheetName: string]: SheetData },
  onProgress?: (saved: number, total: number) => void
): Promise<{ saved: string[]; failed: string[] }> {
  // 1. Save month document
  const monthDocRef = doc(db, 'hisab', monthId);
  await setDoc(monthDocRef, {
    monthId,
    label,
    createdAt: serverTimestamp(),
    createdBy: uid,
    closed: false,
    sheetNames
  });

  // 2. Save each sheet — FAILURES CAPTURE (koi sheet fail ho to naam yaad rehta hai)
  const total = sheetNames.length;
  const saved: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < sheetNames.length; i++) {
    const name = sheetNames[i];
    const sheet = sheets[name];
    if (sheet) {
      try {
        await saveSheetToFirestore(db, monthId, sheet);
        saved.push(name);
      } catch (err: unknown) {
        console.error(`[HISAB SAVE FAIL] sheet '${name}':`, err);
        failed.push(name);
      }
    } else {
      failed.push(name);
    }
    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  return { saved, failed };
}

// Export the workbook to an .xlsx file using SheetJS
export function exportMonthWorkbook(
  monthLabel: string,
  sheetNames: string[],
  sheets: { [sheetName: string]: SheetData }
): void {
  const wb = XLSX.utils.book_new();

  for (const sheetName of sheetNames) {
    const sheet = sheets[sheetName];
    if (!sheet) continue;

    const ws = XLSX.utils.aoa_to_sheet(sheet.grid);

    const isDaySheet = /^\d+$/.test(sheetName.trim());

    if (isDaySheet) {
      const setFormulaCell = (r0: number, c0: number, formula: string) => {
        const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
        const raw = sheet.grid[r0]?.[c0];
        const numVal = parseNum(raw);
        ws[addr] = { t: 'n', v: numVal, f: formula };
      };

      // Rows 2..50 (r = 2..50, r0 = 1..49)
      for (let r = 2; r <= 50; r++) {
        const r0 = r - 1;

        // J{r}: EXCEL-PERCENT RULE (Boss 27 Oct real %) — I>=1 -> H*I/100,
        // else H*I (fraction) — app engine se EXACT match, export bhi real %
        if (isNumericValue(sheet.grid[r0]?.[9])) {
          setFormulaCell(r0, 9, `IF(I${r}>=1,H${r}*I${r}/100,H${r}*I${r})`);
        }

        // K{r}: H{r}-J{r}
        setFormulaCell(r0, 10, `H${r}-J${r}`);

        // Y{r}: ((U{r}+V{r}+W{r})*10)*$P$1%
        setFormulaCell(r0, 24, `((U${r}+V${r}+W${r})*10)*$P$1%`);

        // AD{r}: if($E{r}=1,$K${r},0)
        setFormulaCell(r0, 29, `if($E${r}=1,$K${r},0)`);

        // AE{r}: if($E${r}=2,$K${r},0)
        setFormulaCell(r0, 30, `if($E${r}=2,$K${r},0)`);

        // AF{r}: if($M${r}=1,SUM($N${r}:$O${r}),0) — Cash Given (N) + Amount (O)
        // dono count (SUM text/name ignore karta hai — Excel safe, Boss 27 Oct)
        setFormulaCell(r0, 31, `if($M${r}=1,SUM($N${r}:$O${r}),0)`);

        // AG{r}: if($M${r}=2,SUM($N${r}:$O${r}),0)
        setFormulaCell(r0, 32, `if($M${r}=2,SUM($N${r}:$O${r}),0)`);

        // AH{r}: if(F{r}="cash",AD${r},0)
        setFormulaCell(r0, 33, `if(F${r}="cash",AD${r},0)`);

        // AI{r}: if(F${r}="receipt",AD${r},0)
        setFormulaCell(r0, 34, `if(F${r}="receipt",AD${r},0)`);

        // AJ{r}: if(F${r}="cash",AE${r},0)
        setFormulaCell(r0, 35, `if(F${r}="cash",AE${r},0)`);

        // AK{r}: if(F${r}="receipt",AE${r},0)
        setFormulaCell(r0, 36, `if(F${r}="receipt",AE${r},0)`);
      }

      // Totals
      // AD1: Sum(AD2:AD50)
      setFormulaCell(0, 29, 'Sum(AD2:AD50)');
      // AE1: Sum(AE2:AE50)
      setFormulaCell(0, 30, 'Sum(AE2:AE50)');
      // AF1: Sum(AF2:AF50)
      setFormulaCell(0, 31, 'Sum(AF2:AF50)');
      // AG1: Sum(AG2:AG50)
      setFormulaCell(0, 32, 'Sum(AG2:AG50)');

      // AH53: SUM(AH2:AH50)
      setFormulaCell(52, 33, 'SUM(AH2:AH50)');
      // AI53: SUM(AI2:AI50)
      setFormulaCell(52, 34, 'SUM(AI2:AI50)');
      // AJ53: SUM(AJ2:AJ50)
      setFormulaCell(52, 35, 'SUM(AJ2:AJ50)');
      // AK53: SUM(AK2:AK50)
      setFormulaCell(52, 36, 'SUM(AK2:AK50)');

      // Summary box
      // B4: 200-B6
      setFormulaCell(3, 1, '200-B6');
      // B6: 200+AD1-AF1-B8-B9
      setFormulaCell(5, 1, '200+AD1-AF1-B8-B9');
      // B12: AH53
      setFormulaCell(11, 1, 'AH53');
      // B14: AI53
      setFormulaCell(13, 1, 'AI53');
      // B16: AF1
      setFormulaCell(15, 1, 'AF1');

      // C4: 200-C6
      setFormulaCell(3, 2, '200-C6');
      // C6: 200+AE1-AG1-C8-C9
      setFormulaCell(5, 2, '200+AE1-AG1-C8-C9');
      // C12: AJ53
      setFormulaCell(11, 2, 'AJ53');
      // C14: AK53
      setFormulaCell(13, 2, 'AK53');
      // C16: AG1
      setFormulaCell(15, 2, 'AG1');
    }

    if (sheet.styleTable && sheet.styleIndex) {
      const sIndex = sheet.styleIndex;
      const sTable = sheet.styleTable;
      for (let r = 0; r < sIndex.length; r++) {
        const rowData = sIndex[r];
        if (!rowData) continue;
        for (let c = 0; c < rowData.length; c++) {
          const idx = rowData[c];
          if (idx !== null && idx !== undefined && sTable[idx]) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (!ws[addr]) {
              ws[addr] = { t: 'z', v: '' };
            }
            ws[addr].s = sTable[idx];
          }
        }
      }
    }

    if (sheet.merges && sheet.merges.length > 0) {
      const decodedMerges: any[] = [];
      for (const m of sheet.merges) {
        try {
          decodedMerges.push(XLSX.utils.decode_range(m));
        } catch {
          // ignore invalid
        }
      }
      ws['!merges'] = decodedMerges;
    }

    if (sheet.cols && sheet.cols.length > 0) {
      ws['!cols'] = sheet.cols.map((wch) => (wch ? { wch } : {}));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  XLSX.writeFile(wb, `SHIVAM-HISAB-${monthLabel}.xlsx`);
}

// ==== deepClean: Firestore "undefined" field values + stray objects strip karta hai ====
export function deepClean<T>(value: T): T {
  if (value === null || value === undefined) return null as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value as object);
    if (proto !== Object.prototype && proto !== null) return value; // Date/Timestamp/FieldValue sentinel untouched
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = deepClean(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ==== CANONICAL HISAB XL STYLE DNA (generated from boss ka template CHART COPY.xlsx) ====
export const CANON_TABLE: any[] = [
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF274E13' } }, font: { name: 'Comfortaa', sz: 15.0, color: { rgb: 'FFFFFFFF' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Lobster', sz: 20.0, color: { rgb: 'FFFF0000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Lobster', sz: 25.0, bold: true, color: { rgb: 'FF0000FF' } }, alignment: { horizontal: 'left' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF073763' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF073763' } }, font: { name: 'Comfortaa', sz: 10.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF073763' } }, font: { name: 'Comfortaa', color: { rgb: 'FF000000' } } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF783F04' } }, font: { name: 'Comfortaa', sz: 8.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF783F04' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF783F04' } }, font: { name: 'Comfortaa', sz: 10.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF783F04' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF660000' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 8.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'left' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 11.0, bold: true, color: { rgb: 'FFEFEFEF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'center' } },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FFEAD1DC' } }, numFmt: '0' },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FFEAD1DC' } } },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FFEAD1DC' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF38761D' } }, font: { name: 'Comfortaa', sz: 15.0, color: { rgb: 'FFFFFFFF' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF38761D' } }, font: { name: 'Comfortaa', sz: 11.0, bold: true, color: { rgb: 'FFFFFFFF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF38761D' } }, font: { name: 'Comfortaa', sz: 10.0, bold: true, color: { rgb: 'FFFFFFFF' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF274E13' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Comfortaa', sz: 10.0, color: { rgb: 'FFC27BA0' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Comfortaa', sz: 8.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Arial', sz: 11.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0%' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Arial', sz: 11.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0.0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF073763' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF073763' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 10.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF7F6000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF783F04' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 8.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'left' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 10.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, numFmt: '0' },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } } },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Comfortaa', sz: 10.0, color: { rgb: 'FFC27BA0' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Comfortaa', sz: 8.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Arial', sz: 11.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0%' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Arial', sz: 11.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0.0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEBEFF1' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF0C343D' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFE06666' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFE6B8AF' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFB6D7A8' } }, font: { name: 'Comfortaa', sz: 13.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFD9EAD3' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFB6D7A8' } }, font: { name: 'Comfortaa', sz: 9.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFD9EAD3' } }, font: { name: 'Comfortaa', sz: 11.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFEAD1DC' } }, font: { name: 'Comfortaa', sz: 11.0, color: { rgb: 'FF4C1130' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF274E13' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFBF9000' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFBF9000' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFD966' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFF2CC' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFB6D7A8' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFE6B8AF' } }, font: { name: 'Comfortaa', sz: 15.0, bold: true, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' }, numFmt: '0' },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFD9EAD3' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FFD9EAD3' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF000000' } }, alignment: { horizontal: 'center' } },
  { font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FF7F6000' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FFEAD1DC' } }, alignment: { horizontal: 'right' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, bold: true, color: { rgb: 'FFEAD1DC' } }, alignment: { horizontal: 'center' } },
  { fill: { patternType: 'solid', fgColor: { rgb: 'FF4C1130' } }, font: { name: 'Comfortaa', sz: 12.0, color: { rgb: 'FFEAD1DC' } }, alignment: { horizontal: 'center' } },
];

const CANON_INDEX_RLE =
  "0x1,-1x1,1x1,2x1,-1x1,3x3,4x2,3x1,5x1,6x1,7x1,8x1,9x1,10x1,11x1,12x1,13x1,10x5,14x1,10x2,15x1,16" +
  "x1,17x3,18x4;19x1,20x1,21x1,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x" +
  "2,36x1,37x3,38x1,39x1,37x2,36x1,15x1,40x1,41x3,42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1" +
  ",30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;50x1,51x2,22x1,23x1," +
  "24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,4" +
  "1x3,42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38" +
  "x1,39x1,37x3,15x1,40x1,41x3,42x4;52x1,53x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x" +
  "2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1" +
  ",48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;54x1,55x2," +
  "22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x1,56x1,37x1,38x1,3" +
  "9x1,37x3,15x1,40x1,41x3,42x4;54x1,55x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33" +
  "x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;22x1,57x2,22x1,23x1,24x1,25x1,26x1,27x" +
  "1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;58x1,59x2" +
  ",22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3," +
  "15x1,40x1,41x3,42x4;60x1,61x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,3" +
  "5x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30" +
  "x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;62x1,53x2,22x1,23x1,24x" +
  "1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3" +
  ",42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1," +
  "39x1,37x3,15x1,40x1,41x3,42x4;50x1,63x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,3" +
  "3x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;-1x3,22x1,43x1,44x1,45x1,46x1,47x1,48" +
  "x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;64x1,65x2,22x" +
  "1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1" +
  ",40x1,41x3,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2," +
  "36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,3" +
  "0x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,40x1,41x3,42x4;64x1,65x2,22x1,43x1,44" +
  "x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x" +
  "1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1" +
  ",37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1," +
  "30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,2" +
  "3x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41" +
  "x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x" +
  "2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1" +
  ",29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2," +
  "22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,1" +
  "5x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34" +
  "x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x" +
  "1,48x1,49x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1" +
  ",65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,32x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1," +
  "37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,3" +
  "3x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26" +
  "x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x" +
  "4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1" +
  ",39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1," +
  "66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,4" +
  "5x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41" +
  "x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x" +
  "3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1" +
  ",31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1," +
  "24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,4" +
  "0x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36" +
  "x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x" +
  "1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1" +
  ",43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1," +
  "41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,3" +
  "5x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48" +
  "x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x" +
  "2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3" +
  ",15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1," +
  "34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,2" +
  "7x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64" +
  "x1,65x2,22x1,43x1,44x1,45x1,46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x" +
  "1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2" +
  ",33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;64x1,65x2,22x1,43x1,44x1,45x1," +
  "46x1,47x1,48x1,49x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38x1,39x1,37x3,15x1,41x1,40x1,41x2,4" +
  "2x4;64x1,65x2,22x1,23x1,24x1,25x1,26x1,27x1,28x1,29x1,30x1,31x1,66x2,33x1,34x1,35x2,36x1,37x3,38" +
  "x1,39x1,37x3,15x1,41x1,40x1,41x2,42x4;67x28,68x1,69x8;67x28,68x1,69x8;67x28,68x1,69x8";

export const CANON_INDEX: (number | null)[][] = CANON_INDEX_RLE.split(';').map((row) =>
  row.split(',').flatMap((seg) => {
    const [v, n] = seg.split('x').map(Number);
    return Array.from({ length: n }, () => (v === -1 ? null : v));
  })
);

export const CANON_COL_WIDTHS_PX: number[] = [123, 77, 93, 15, 34, 68, 192, 71, 41, 60, 71, 15, 34, 153, 62, 15, 71, 51, 103, 160, 58, 93, 58, 168, 63, 62, 93, 103, 19];

// ============================================================
// NATIVE TEMPLATE BUILDERS (Task 70 — Boss order: home screen BILKUL XL jaisa,
// upload ke bina naya month khud banega, roz naya date 0 se start)
// Structure EXACT boss ke demo CHART COPY.xlsx sheet "1" jaisa (dump-verified):
// headers, department details box, presets E/M (dept 1|2) + Q (parcel modes),
// P1=25%, D1=dayNo — computed cells (J,K,Y,AD..AK,B4,B6,B12,B14,B16,AH53..)
// khali chhode hain: formula engine unhe LIVE banata hai (fresh day = sab 0).
// ============================================================

// Demo file ke EXACT 20 merges
export const DAY_SHEET_MERGES: string[] = [
  'A1:B1', 'D1:E1',
  'A2:A3', 'B2:B3', 'C2:C3',
  'A4:A5', 'B4:B5', 'C4:C5',
  'A6:A7', 'B6:B7', 'C6:C7',
  'A12:A13', 'B12:B13', 'C12:C13',
  'A14:A15', 'B14:B15', 'C14:C15',
  'A16:A17', 'B16:B17', 'C16:C17'
];

// 37 col widths (wch): A..AC = CANON px/7, AD..AK helper cols patli
export const DAY_SHEET_COLS_WCH: (number | null)[] = [
  ...CANON_COL_WIDTHS_PX.map((px) => Math.max(4, Math.round(px / 7))),
  6, 6, 6, 6, 9, 9, 9, 9
];

export const ALL_DAY_SHEET_NAMES: string[] = Array.from({ length: 31 }, (_, i) => String(i + 1));
export const REMINDER_SHEET_NAME = 'Reminder';
export const ALL_SHEET_NAMES: string[] = [...ALL_DAY_SHEET_NAMES, REMINDER_SHEET_NAME];

// Parcel mode presets — demo sheet "1" ke exact row ranges (Q column)
const Q_PRESETS: { from: number; to: number; mode: string }[] = [
  { from: 1, to: 9, mode: 'Transport' },   // R2..R10
  { from: 10, to: 15, mode: 'Courior' },   // R11..R16
  { from: 16, to: 19, mode: 'In Hand' },   // R17..R20
  { from: 20, to: 23, mode: 'Other Party' }, // R21..R24
  { from: 24, to: 25, mode: 'Riksha' }     // R25..R26
];

export interface TemplateSheet {
  grid: CellValue[][];
  merges: string[];
  cols: (number | null)[];
  styleTable?: Record<string, unknown>[];
  styleIndex?: (number | null)[][];
}

// Ek din ki FRESH sheet — bilkul chart ke khali page jaisi (0 se start)
export function buildDaySheetTemplate(dayNo: number): TemplateSheet {
  const grid: CellValue[][] = Array.from({ length: 53 }, () => Array<CellValue>(37).fill(null));

  // Row 1 — headers (demo sheet "1" ke exact labels)
  grid[0][0] = 'department details';
  grid[0][3] = dayNo; // D1 = din ka number
  grid[0][5] = 'Mode';
  grid[0][6] = 'Name Or Bill No.';
  grid[0][7] = 'Bill Amt';
  grid[0][8] = 'Less';
  grid[0][9] = 'Less Amt.';
  grid[0][10] = 'Net Amt';
  grid[0][13] = 'Cash Given';
  grid[0][14] = 'Amount';
  grid[0][15] = 25; // P1 — aangadiya % (Boss edit kar sakta hai)
  grid[0][16] = 'Mode';
  grid[0][17] = 'Dipartment';
  grid[0][18] = 'City';
  grid[0][19] = 'Party';
  grid[0][20] = 'CO';
  grid[0][21] = 'IM';
  grid[0][22] = 'HG';
  grid[0][23] = 'Bill In';
  grid[0][24] = 'Bill Amt.';
  grid[0][25] = 'Status';
  grid[0][26] = 'CR.';
  grid[0][27] = 'Tra.';
  grid[0][33] = 'Cash 1no';
  grid[0][34] = 'Recipt 1no';
  grid[0][35] = 'Csah 2no';
  grid[0][36] = 'Recipt 2no';

  // Row 2 — dept names + L2 marker (demo jaisa)
  grid[1][1] = 'Cosmetic';
  grid[1][2] = 'Immitation';
  grid[1][11] = 1;

  // Rows 2..50 (r=1..49): dept presets E/M + parcel mode presets Q
  for (let r = 1; r <= 49; r++) {
    const dept1 = r <= 19; // R2..R20 = dept 1 (Cosmetic), R21..R50 = dept 2 (Immitation)
    grid[r][4] = dept1 ? 1 : 2;  // E — department
    grid[r][12] = dept1 ? 1 : 2; // M — department (office cash given side)
    for (const p of Q_PRESETS) {
      if (r >= p.from && r <= p.to) grid[r][16] = p.mode; // Q — parcel mode
    }
  }

  return { grid, merges: DAY_SHEET_MERGES, cols: DAY_SHEET_COLS_WCH };
}

// Reminder sheet — demo ke exact 8 columns (Haste/City/Party Name/Date/Amount/Vayda Date/Note/Status)
export const REMINDER_COLS_WCH: (number | null)[] = [16, 12, 24, 11, 11, 12, 28, 11, null, null, null];

export function buildReminderTemplate(): TemplateSheet {
  const rows = 95; // demo file jaisa (1 header + 94 khali rows)
  const cols = 11;
  const grid: CellValue[][] = Array.from({ length: rows }, () => Array<CellValue>(cols).fill(null));
  grid[0][0] = 'Haste';
  grid[0][1] = 'City';
  grid[0][2] = 'Party Name';
  grid[0][3] = 'Date';
  grid[0][4] = 'Amount';
  grid[0][5] = 'Vayda Date';
  grid[0][6] = 'Note';
  grid[0][7] = 'Status';

  // Navy header style (dashboard theme match)
  const styleTable = [
    {
      fill: { patternType: 'solid', fgColor: { rgb: 'FF073763' } },
      font: { name: 'Comfortaa', sz: 11, bold: true, color: { rgb: 'FFFFFFFF' } },
      alignment: { horizontal: 'center' }
    }
  ];
  const styleIndex: (number | null)[][] = Array.from({ length: rows }, (_, r) =>
    r === 0 ? Array<number | null>(cols).fill(0) : Array<number | null>(cols).fill(null)
  );

  return { grid, merges: [], cols: REMINDER_COLS_WCH, styleTable, styleIndex };
}

// Template sheet ko poore SheetData payload me convert (Firestore/outbox doc ke liye)
export function templateToSheetData(name: string, tpl: TemplateSheet, isDay: boolean): SheetData {
  const out: SheetData = {
    name,
    grid: tpl.grid,
    merges: tpl.merges,
    cols: tpl.cols
  };
  if (isDay) {
    out.styleTable = CANON_TABLE as unknown as Record<string, unknown>[];
    out.styleIndex = CANON_INDEX;
  } else {
    if (tpl.styleTable) out.styleTable = tpl.styleTable;
    if (tpl.styleIndex) out.styleIndex = tpl.styleIndex;
  }
  return out;
}

import * as XLSX from 'xlsx';
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
  updatedAt?: unknown;
}

export interface MonthDoc {
  monthId: string; // "YYYY-MM"
  label: string; // "June-2026"
  createdAt?: unknown;
  createdBy?: string;
  closed?: boolean;
  sheetNames: string[];
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
    const J = H * I;
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
    const O = parseNum(normalized[r][14]);
    const AF = M === '1' ? O : 0;
    normalized[r][31] = AF === 0 ? null : AF;
    sumAF += AF;

    const AG = M === '2' ? O : 0;
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
  try {
    await setDoc(sheetDocRef, {
      name: sheet.name,
      grid: sheet.grid,
      merges: sheet.merges,
      cols: sheet.cols,
      updatedAt: serverTimestamp()
    });
  } catch (err: unknown) {
    // Fall back to rows stored as JSON strings if nested array is rejected
    const errorMsg = String((err as Error)?.message || '');
    if (errorMsg.includes('nested') || errorMsg.includes('array')) {
      const rowsJson = sheet.grid.map((r) => JSON.stringify(r));
      await setDoc(sheetDocRef, {
        name: sheet.name,
        rowsJson,
        merges: sheet.merges,
        cols: sheet.cols,
        updatedAt: serverTimestamp()
      });
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

  return {
    name: data.name || sheetName,
    grid: normalizeGrid(grid, 53, 37),
    merges: Array.isArray(data.merges) ? data.merges : [],
    cols: Array.isArray(data.cols) ? data.cols : [],
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
): Promise<void> {
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

  // 2. Save each sheet in batches or individually to report live progress
  const total = sheetNames.length;
  let savedCount = 0;

  for (const name of sheetNames) {
    const sheet = sheets[name];
    if (sheet) {
      await saveSheetToFirestore(db, monthId, sheet);
    }
    savedCount++;
    if (onProgress) {
      onProgress(savedCount, total);
    }
  }
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

        // J{r}: H{r}*I{r} — ONLY where grid has a numeric value at J{r}
        if (isNumericValue(sheet.grid[r0]?.[9])) {
          setFormulaCell(r0, 9, `H${r}*I${r}`);
        }

        // K{r}: H{r}-J{r}
        setFormulaCell(r0, 10, `H${r}-J${r}`);

        // Y{r}: ((U{r}+V{r}+W{r})*10)*$P$1%
        setFormulaCell(r0, 24, `((U${r}+V${r}+W${r})*10)*$P$1%`);

        // AD{r}: if($E{r}=1,$K${r},0)
        setFormulaCell(r0, 29, `if($E${r}=1,$K${r},0)`);

        // AE{r}: if($E${r}=2,$K${r},0)
        setFormulaCell(r0, 30, `if($E${r}=2,$K${r},0)`);

        // AF{r}: if($M${r}=1,$O${r},0)
        setFormulaCell(r0, 31, `if($M${r}=1,$O${r},0)`);

        // AG{r}: if($M${r}=2,$O${r},0)
        setFormulaCell(r0, 32, `if($M${r}=2,$O${r},0)`);

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

    if (sheet.merges && sheet.merges.length > 0) {
      const decodedMerges: XLSX.Range[] = [];
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

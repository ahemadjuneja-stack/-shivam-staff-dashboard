// ============================================================
// TASK 70 TESTS — Native XL template + mirror + engine parity
// Run: bun run scripts/test_xl_template.ts  (ya npx tsx)
// ============================================================
import * as XLSXNS from 'xlsx-js-style';
import * as fs from 'fs';
// CJS interop: tsx me namespace me .default ke andar ho sakta hai
const XLSX: any = ((XLSXNS as any).read ? XLSXNS : (XLSXNS as any).default);
import {
  buildDaySheetTemplate,
  buildReminderTemplate,
  templateToSheetData,
  runFormulaEngine,
  verifySheet,
  normalizeGrid,
  ALL_SHEET_NAMES,
  DAY_SHEET_MERGES,
  DAY_SHEET_COLS_WCH,
  CellValue,
  formatPercentDisplay
} from '../src/hisabXL';
import {
  mirrorGetSheet,
  mirrorSetSheet,
  mirrorGetMonthDoc,
  mirrorSetMonthDoc,
  mirrorListMonths
} from '../src/lib/hisabMirror';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

console.log('\n=== 1. DAY SHEET TEMPLATE (CHART COPY.xlsx parity) ===');
const t27 = buildDaySheetTemplate(27);
check('grid 53x37', t27.grid.length === 53 && t27.grid[0].length === 37);
check('D1 = dayNo 27', t27.grid[0][3] === 27);
check('A1 department details', t27.grid[0][0] === 'department details');
check('F1 Mode / G1 Name Or Bill No. / H1 Bill Amt', t27.grid[0][5] === 'Mode' && t27.grid[0][6] === 'Name Or Bill No.' && t27.grid[0][7] === 'Bill Amt');
check('I1 Less / J1 Less Amt. / K1 Net Amt', t27.grid[0][8] === 'Less' && t27.grid[0][9] === 'Less Amt.' && t27.grid[0][10] === 'Net Amt');
check('N1 Cash Given / O1 Amount', t27.grid[0][13] === 'Cash Given' && t27.grid[0][14] === 'Amount');
check('P1 = 25 (aangadiya %)', t27.grid[0][15] === 25);
check('Q..AB headers', t27.grid[0][16] === 'Mode' && t27.grid[0][17] === 'Dipartment' && t27.grid[0][18] === 'City' && t27.grid[0][19] === 'Party' && t27.grid[0][20] === 'CO' && t27.grid[0][21] === 'IM' && t27.grid[0][22] === 'HG' && t27.grid[0][23] === 'Bill In' && t27.grid[0][24] === 'Bill Amt.' && t27.grid[0][25] === 'Status' && t27.grid[0][26] === 'CR.' && t27.grid[0][27] === 'Tra.');
check('AH1..AK1 chips headers', t27.grid[0][33] === 'Cash 1no' && t27.grid[0][34] === 'Recipt 1no' && t27.grid[0][35] === 'Csah 2no' && t27.grid[0][36] === 'Recipt 2no');
check('B2 Cosmetic / C2 Immitation', t27.grid[1][1] === 'Cosmetic' && t27.grid[1][2] === 'Immitation');
check('E2=1, M2=1, E21=2, M21=2, E50=2', t27.grid[1][4] === 1 && t27.grid[1][12] === 1 && t27.grid[20][4] === 2 && t27.grid[20][12] === 2 && t27.grid[49][4] === 2);
check('Q presets: R2 Transport, R11 Courior, R17 In Hand, R21 Other Party, R25 Riksha', t27.grid[1][16] === 'Transport' && t27.grid[10][16] === 'Courior' && t27.grid[16][16] === 'In Hand' && t27.grid[20][16] === 'Other Party' && t27.grid[24][16] === 'Riksha');
check('merges = 20 (demo exact)', t27.merges.length === 20 && JSON.stringify(t27.merges) === JSON.stringify(DAY_SHEET_MERGES));
check('cols = 37 widths', t27.cols.length === 37 && JSON.stringify(t27.cols) === JSON.stringify(DAY_SHEET_COLS_WCH));
check('computed cells khali (J2,K2 null)', t27.grid[1][9] === null && t27.grid[1][10] === null);

console.log('\n=== 2. FRESH DAY ENGINE (roz naya date 0 se start) ===');
const fresh = runFormulaEngine(t27.grid);
check('B6 Cash In Hand = 200 (dept1)', fresh.grid[5][1] === 200, `got ${fresh.grid[5][1]}`);
check('C6 Cash In Hand = 200 (dept2)', fresh.grid[5][2] === 200, `got ${fresh.grid[5][2]}`);
check('B4 = 0 / C4 = 0', fresh.grid[3][1] === 0 && fresh.grid[3][2] === 0);
check('B12 Cash = 0 / B14 Receipts = 0 / B16 Expense = 0', fresh.grid[11][1] === 0 && fresh.grid[13][1] === 0 && fresh.grid[15][1] === 0);
check('chips sab 0', fresh.chips.cash1no === 0 && fresh.chips.recipt1no === 0 && fresh.chips.csah2no === 0 && fresh.chips.recipt2no === 0);
check('AD1..AG1 totals 0', fresh.grid[0][29] === 0 && fresh.grid[0][30] === 0 && fresh.grid[0][31] === 0 && fresh.grid[0][32] === 0);

console.log('\n=== 3. ENTRY SIMULATION (engine XL logic follow karta hai) ===');
const g2 = t27.grid.map((r) => [...r]);
g2[1][7] = 100;  // H2 Bill Amt (chart units)
g2[1][8] = 0.1;  // I2 Less
g2[1][5] = 'Cash'; // F2 mode
// E2 already 1 (dept1)
const e2 = runFormulaEngine(g2);
// J = H*I = 10, K = H-J = 90, AD2 = 90 (E=1), AH2 = 90 (cash)
check('J2 = H*I = 10', e2.grid[1][9] === 10, `got ${e2.grid[1][9]}`);
check('K2 Net = 90', e2.grid[1][10] === 90, `got ${e2.grid[1][10]}`);
check('chips cash1no = 90', e2.chips.cash1no === 90, `got ${e2.chips.cash1no}`);
check('B6 = 200 + 90 = 290', e2.grid[5][1] === 290, `got ${e2.grid[5][1]}`);
check('B12 Cash dept1 = 90', e2.grid[11][1] === 90);
// office cash given: O3 = 40, M3 = 1 -> AF = 40, B6 = 290 - 40 - B8 - B9
const g3 = e2.grid.map((r) => [...r]);
g3[2][14] = 40; // O3 Amount
const e3 = runFormulaEngine(g3);
check('AF1 office total = 40', e3.grid[0][31] === 40, `got ${e3.grid[0][31]}`);
check('B6 = 290 - 40 = 250', e3.grid[5][1] === 250, `got ${e3.grid[5][1]}`);
check('B16 Expense = 40', e3.grid[15][1] === 40);

console.log('\n=== 3.5 BOSS REAL-CALC SCENARIOS (27 Oct order: 5% -> 5%, Cash Given kam kare) ===');
// BOSS CASE 1: Less percent — H=2000, I=5 (Boss "5" type karta hai = 5%) -> J=100, K=1900
const g5 = t27.grid.map((r) => [...r]);
g5[1][7] = 2000; // H2 Bill Amt
g5[1][8] = 5;    // I2 Less — Boss percent-style entry
g5[1][5] = 'Cash';
const e5 = runFormulaEngine(g5);
check('Boss case: 2000 ka 5% = 100 (500% nahi)', e5.grid[1][9] === 100, `got ${e5.grid[1][9]}`);
check('Boss case: K Net = 1900', e5.grid[1][10] === 1900, `got ${e5.grid[1][10]}`);
// BACKWARD-COMPAT: fraction entry I=0.1 -> 10% (old chart convention safe)
const g6 = t27.grid.map((r) => [...r]);
g6[1][7] = 2000;
g6[1][8] = 0.1;
const e6 = runFormulaEngine(g6);
check('fraction compat: I=0.1 -> 200 (10%)', e6.grid[1][9] === 200, `got ${e6.grid[1][9]}`);
// BOSS CASE 2: Cash Given amount 'Cash Given' (N col) me type kiya -> Cash In Hand kam
const g7 = t27.grid.map((r) => [...r]);
g7[2][13] = 200; // N3 — 'Cash Given' header ke niche amount (Boss ka entry style)
const e7 = runFormulaEngine(g7);
check('Cash Given N col: B6 = 200-200 = 0', e7.grid[5][1] === 0, `got ${e7.grid[5][1]}`);
check('Cash Given N col: B16 Expense = 200', e7.grid[15][1] === 200, `got ${e7.grid[15][1]}`);
// O col (Amount) ab bhi kaam karta hai
const g8 = t27.grid.map((r) => [...r]);
g8[2][14] = 50; // O3 Amount
const e8 = runFormulaEngine(g8);
check('Cash Given O col: B6 = 200-50 = 150', e8.grid[5][1] === 150, `got ${e8.grid[5][1]}`);
// N me NAME + O me amount -> dono safe (naam string = 0)
const g9 = t27.grid.map((r) => [...r]);
g9[2][13] = 'Sharma Traders';
g9[2][14] = 80;
const e9 = runFormulaEngine(g9);
check('N=name + O=80 -> B6 = 120 (name ignore)', e9.grid[5][1] === 120, `got ${e9.grid[5][1]}`);

console.log('\n=== 4. DEMO FILE REGRESSION (verifySheet — real CHART COPY.xlsx) ===');
const DEMO = '/home/z/my-project/upload/CHART COPY.xlsx';
if (fs.existsSync(DEMO)) {
  const wb = XLSX.read(fs.readFileSync(DEMO), { type: 'buffer', cellStyles: true });
  let allChecked = 0;
  let allMm = 0;
  for (const sn of ['1', '2', '15', '27']) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as CellValue[][];
    const res = verifySheet(aoa, sn);
    allChecked += res.checked;
    allMm += res.mismatches.length;
    if (res.mismatches.length > 0) {
      console.log(`   sheet ${sn} mismatches:`, res.mismatches.slice(0, 3));
    }
  }
  check(`demo sheets verify: ${allChecked} cells checked, 0 mismatch`, allChecked > 50 && allMm === 0, `mm=${allMm}`);
} else {
  console.log('  SKIP — demo file CI me nahi hai');
}

console.log('\n=== 5. REMINDER TEMPLATE ===');
const rem = buildReminderTemplate();
check('header row exact (Haste/City/Party Name/Date/Amount/Vayda Date/Note/Status)', rem.grid[0][0] === 'Haste' && rem.grid[0][1] === 'City' && rem.grid[0][2] === 'Party Name' && rem.grid[0][3] === 'Date' && rem.grid[0][4] === 'Amount' && rem.grid[0][5] === 'Vayda Date' && rem.grid[0][6] === 'Note' && rem.grid[0][7] === 'Status');
check('95 rows (demo jaisa)', rem.grid.length === 95);
check('navy header style', (rem.styleTable as any[])[0].fill.fgColor.rgb === 'FF073763');

console.log('\n=== 6. SHEET DATA CONVERT (Firestore/outbox doc) ===');
const sd = templateToSheetData('27', { ...t27, grid: fresh.grid }, true);
check('day doc me CANON styles', Array.isArray(sd.styleTable) && (sd.styleTable as unknown[]).length > 60 && Array.isArray(sd.styleIndex));
const sdr = templateToSheetData('Reminder', rem, false);
check('reminder doc me apni style', Array.isArray(sdr.styleTable) && (sdr.styleTable as unknown[]).length === 1);

console.log('\n=== 7. MONTH WORKBOOK NAMES ===');
check('32 sheets (1..31 + Reminder)', ALL_SHEET_NAMES.length === 32 && ALL_SHEET_NAMES[0] === '1' && ALL_SHEET_NAMES[31] === 'Reminder');

console.log('\n=== 8. MIRROR (offline refresh safety L4) ===');
const g = globalThis as { __HM_STORE__?: Record<string, string> };
g.__HM_STORE__ = {}; // fresh shim
mirrorSetSheet('2026-10', '27', { grid: fresh.grid, merges: DAY_SHEET_MERGES, cols: DAY_SHEET_COLS_WCH });
const m27 = mirrorGetSheet('2026-10', '27');
check('mirror roundtrip grid', !!m27 && m27.grid.length === 53 && m27.grid[5][1] === 200);
check('mirror roundtrip merges', !!m27 && m27.merges.length === 20);
mirrorSetMonthDoc('2026-10', { label: 'October-2026', sheetNames: ALL_SHEET_NAMES });
const md = mirrorGetMonthDoc('2026-10');
check('month doc roundtrip', !!md && md.label === 'October-2026' && md.sheetNames.length === 32);
check('mirrorListMonths', mirrorListMonths().includes('2026-10'));
check('missing sheet -> null', mirrorGetSheet('2026-10', '99') === null);
check('missing month -> null', mirrorGetSheet('1999-01', '1') === null);
// corrupt JSON safe
g.__HM_STORE__!['shivam_hisab_mirror_v1:2025-01'] = '{corrupt';
check('corrupt mirror safe', mirrorGetSheet('2025-01', '1') === null);
// prune: 4 months set -> max 3
mirrorSetMonthDoc('2026-01', { label: 'x', sheetNames: [] });
mirrorSetSheet('2026-01', '1', { grid: [[1]], merges: [], cols: [] });
mirrorSetMonthDoc('2025-01', { label: 'x', sheetNames: [] });
mirrorSetSheet('2025-01', '1', { grid: [[1]], merges: [], cols: [] });
mirrorSetMonthDoc('2024-01', { label: 'x', sheetNames: [] });
mirrorSetSheet('2024-01', '1', { grid: [[1]], merges: [], cols: [] });
mirrorSetSheet('2026-10', '28', { grid: [[1]], merges: [], cols: [] }); // touch current
const remaining = mirrorListMonths();
check(`prune -> max 3 months (got ${remaining.length})`, remaining.length <= 3, JSON.stringify(remaining));
check('current month prune survive', remaining.includes('2026-10'));

console.log('\n=== 9. PERCENT DISPLAY RULE (Boss 27 Oct: 5 ka 500% display bug) ===');
// Boss case: engine I=5 (percent-style) — Less box ab "5%" dikhaye, "500%" NAHI
check('display 5 -> "5%" (Boss bug)', formatPercentDisplay('0%', 5) === '5%');
check('display 2.5 -> "2.5%"', formatPercentDisplay('0%', 2.5) === '2.5%');
check('display -5 -> "-5%" (negative sym)', formatPercentDisplay('0%', -5) === '-5%');
// fraction path — engine/demo convention (0.05 = 5%) SSF ko karne do (null)
check('fraction 0.05 -> SSF path (null)', formatPercentDisplay('0%', 0.05) === null);
check('zero 0 -> SSF path (null)', formatPercentDisplay('0%', 0) === null);
check('P1 0.25 -> SSF path (null, 25%)', formatPercentDisplay('0%', 0.25) === null);
// non-percent numFmt / junk — untouched
check('numFmt "0" -> null (non-percent)', formatPercentDisplay('0', 5) === null);
check('numFmt missing -> null', formatPercentDisplay(undefined, 5) === null);
check('NaN -> null', formatPercentDisplay('0%', NaN) === null);
// SSF cross-check: fraction 0.05 se kya dikhta hai
check('SSF confirms 0.05 = "5%"', XLSX.SSF.format('0%', 0.05) === '5%');
check('SSF bug repro: 5 = "500%" tha', XLSX.SSF.format('0%', 5) === '500%');

console.log(`\n========== RESULT: ${pass} PASS, ${fail} FAIL ==========`);
process.exit(fail === 0 ? 0 : 1);

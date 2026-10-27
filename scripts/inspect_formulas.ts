// Dump ORIGINAL Excel formulas from CHART COPY.xlsx (J/K/Y/B6 cells)
import * as XLSXNS from 'xlsx-js-style';
import * as fs from 'fs';
const XLSX: any = ((XLSXNS as any).read ? XLSXNS : (XLSXNS as any).default);

const DEMO = '/home/z/my-project/upload/CHART COPY.xlsx';
const wb = XLSX.read(fs.readFileSync(DEMO), { type: 'buffer', cellStyles: true, cellFormula: true });

const targets = ['J2', 'J3', 'K2', 'K3', 'Y2', 'Y3', 'B4', 'B6', 'C6', 'B8', 'B9', 'B12', 'B14', 'B16', 'AD1', 'AD2', 'AH2', 'AH53', 'AI2'];
for (const sn of ['1', '2']) {
  const ws = wb.Sheets[sn];
  if (!ws) continue;
  console.log(`\n===== SHEET ${sn} formulas =====`);
  for (const addr of targets) {
    const cell = ws[addr];
    if (cell && cell.f) console.log(`${addr}: =${cell.f}`);
    else if (cell) console.log(`${addr}: (value ${JSON.stringify(cell.v)})`);
  }
}

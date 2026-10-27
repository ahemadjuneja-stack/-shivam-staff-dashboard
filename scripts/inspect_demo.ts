// Inspect CHART COPY.xlsx — Less column convention + Cash Given (N/O) usage
import * as XLSXNS from 'xlsx-js-style';
import * as fs from 'fs';
const XLSX: any = ((XLSXNS as any).read ? XLSXNS : (XLSXNS as any).default);

const DEMO = '/home/z/my-project/upload/CHART COPY.xlsx';
const wb = XLSX.read(fs.readFileSync(DEMO), { type: 'buffer', cellStyles: true });

for (const sn of ['1', '2', '15', '27']) {
  const ws = wb.Sheets[sn];
  if (!ws) { console.log(`sheet ${sn}: MISSING`); continue; }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
  console.log(`\n===== SHEET ${sn} =====`);
  console.log('Row1 headers H..P (idx7..15):', JSON.stringify(aoa[0]?.slice(7, 16)));
  // dump rows with any value in H,I,J,M,N,O
  let shown = 0;
  for (let r = 1; r < Math.min(aoa.length, 53) && shown < 12; r++) {
    const row = aoa[r] || [];
    const H = row[7], I = row[8], J = row[9], K = row[10], M = row[12], N = row[13], O = row[14], Y = row[24], U = row[20], V = row[21], W = row[22];
    if (H != null || I != null || J != null || N != null || O != null || U != null || V != null || W != null) {
      console.log(`r${r + 1}: H=${JSON.stringify(H)} I(Less)=${JSON.stringify(I)} J(LessAmt)=${JSON.stringify(J)} K=${JSON.stringify(K)} M=${JSON.stringify(M)} N=${JSON.stringify(N)} O=${JSON.stringify(O)} U,V,W=${JSON.stringify([U, V, W])} Y=${JSON.stringify(Y)}`);
      shown++;
    }
  }
  // Left box A/B/C labels rows 2..17
  console.log('--- left box (A,B,C rows 2..17) ---');
  for (let r = 1; r < 17; r++) {
    const row = aoa[r] || [];
    if (row[0] != null || row[1] != null || row[2] != null) {
      console.log(`r${r + 1}: A=${JSON.stringify(row[0])} B=${JSON.stringify(row[1])} C=${JSON.stringify(row[2])}`);
    }
  }
}

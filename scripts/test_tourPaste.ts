// ============================================================
// TEST: tourPaste parser (Task 93) — real Miracle PDF text shape
// Run: cd /home/z/my-project/dash-hisab && npx tsx scripts/test_tourPaste.ts
// ============================================================
import {
  parseTourPaste, toPaise, suggestTourName,
  ParsedCity
} from '../src/lib/tourPaste';

let pass = 0, fail = 0;
const ok = (cond: unknown, label: string) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
};

// ---------- REAL-SHAPE FIXTURE (PORBANDAR-OCT.pdf se) ----------
const TEXT = `Shivam % Bill Amt. R.G. Amt. Less Amt. Re. Amt. 5814 0 1-Cash, 2-UPI, 3-Chaque
3 0 0
Le
ss
R.G
oo
ds
Mo
ad PORBANDARDate: 24/10/2026 Total Cr. Rs.
PORBANDAR-3@! KANAIYA BANGELS 0 1
15/09/2026 35 4,026.00 4,026.00 0 1
15/09/2026 35 47,780.00 51,806.00 51806 51806 3
PORBANDAR-3D ABHUSHAN NOVELTY 0 1
20/08/2026 61 2,765.00 2,765.00 2765 2750 15 1
PORBANDAR-3D BHAVYA NOVELTY 0 1
09/09/2026 41 1,632.00 1,632.00 0 1
09/10/2026 11 763.00 2,395.00 2395 2275 120 1
PORBANDAR-6D STAR CUTLERY 0 1
22/06/2026 120 2,910.00 1,086.00 0 1
46333 101 2,740.00 8,897.00 0 1
17/07/2026 95 745 5,701.00 0 1
0 1
0 1
Shivam % Bill Amt. R.G. Amt. Less Amt. Re. Amt. 5814 0 1-Cash, 2-UPI, 3-Chaque
3 0 0
Le
ss
R.G
oo
ds
Mo
ad PORBANDARDate: 24/10/2026 Total Cr. Rs.
0 1
0 1
Shivam % Bill Amt. R.G. Amt. Less Amt. Re. Amt. 7428 0 1-Cash, 2-UPI, 3-Chaque
5 0 0
Le
ss
R.G
oo
ds
Mo
ad DWARKA-J.KHAMBHADYADate: 22/10/2026 Total Cr. Rs.
DWARKA-3F SHREE HARIKRUPA NOVELTY 0 1
21/07/2026 91 2,012.00 2,012.00 0 1
13/08/2026 68 21,170.00 23,182.00 0 1
16/09/2026 34 8,070.00 37,948.00 37948 36050 1898 1
DWARKA-3H NAYRAH NOVELTY 0 1
16/09/2026 34 22,850.00 22,850.00 0 1
12/10/2026 8 2,135.00 70,666.00 70666 67130 3536 1
J.KHAMBHALIYA-3D BALAJI NOVELTY 0 1
17/09/2026 33 7,542.00 7,542.00 0 1
J.KHAMBHALIYA-3F DHARA NOVELTY 0 1
17/09/2026 33 3,432.00 3,432.00 0 1
17/09/2026 33 7,280.00 10,712.00 10712 10180 532 1
0 1
0 1
Shivam % Bill Amt. R.G. Amt. Less Amt. Re. Amt. 1287 0 1-Cash, 2-UPI, 3-Chaque
3 0 0
Le
ss
R.G
oo
ds
Mo
de JAMNAGARDate: 20/10/26 Total Cr. Rs.
JAMNAGAR-3D BATUK BHAI 0 1
07/10/2026 13 1,446.00 1,446.00 0 1
JAMNAGAR-3D KRISHNA NOVELTY 0 1
28/01/2026 265 13,250.00 10,250.00 10250 10250 1
JAMNAGAR-3D LADY ZONE 0 1
15/08/2026 66 6,478.00 6,478.00 0 1
01/10/2026 19 3,200.00 14,068.00 5000 5000 1
JAMNAGAR-3D MOMAI COLLECTION 0 1
25/04/2026 178 39,897.00 20,598.00 20600 20600 1
JAMNAGAR-3D S.S BEAUTY PLUS 0 1
19/09/2026 31 2,150.00 2,150.00 2150 2150 1
JAMNAGAR-3H SHREE BALKRISHNA NOVELTY 0 1
18/09/2026 32 4,580.00 4,580.00 0 1
01/10/2026 19 3,407.00 19,937.00 0 1
01/10/2026 19 5,720.00 25,657.00 25657 24370 1287 1
JAMNAGAR\` LADY COLLECTION 0 1
568 5,285.00 0 1
0 1
0 1
Shivam % Bill Amt. R.G. Amt. Less Amt. Re. Amt. 0 0 1-Cash, 2-UPI, 3-Chaque
3 0 0
Le
ss
R.G
oo
ds
Mo
ad City-4Date: Total Cr. Rs.
0 1
0 1
Payment Details Cash Given
less R.Goods CITY CASH UPI CHAQUE Rs. Note Moad
5814 0 PORBANDAR 124955 0 51806 250000 JND T. T shop 1
7428 0 DWARKA-J.
KHAMBHADYA
141030 0 0 250 T. T. KHARCHO 1
1287 0 JAMNAGAR 62370 0 0 7105 Line KHARCHO 1
0 0 City-4 0 0 0 51806 PBR KANAYA 1
14529 0
Totals
328355 0 51806 1
less R.Goods Cash (1) UPI (2) Chaque (3) 1
Net Balance 1.balance 2.balance 3.balance 1
71000 19194 0 51806 1
1
PARTY NAME ITEM QTY PRICE TOTAL NOTE IF ANY
zoya veravl rubber 12 48 576
0
0
0`;

// ---------- TESTS ----------
console.log('\n=== T1: toPaise ===');
ok(toPaise('51,806.00') === 5180600, 'toPaise("51,806.00") = 5180600');
ok(toPaise('745') === 74500, 'toPaise("745") = 74500');
ok(toPaise('0') === 0, 'toPaise("0") = 0');
ok(toPaise('') === 0 && toPaise(undefined) === 0, 'toPaise empty/undefined = 0');
ok(toPaise('1,42,928.00') === 14292800, 'toPaise indian-format 1,42,928.00');

console.log('\n=== T2: parse overall ===');
const res = parseTourPaste(TEXT);
ok(res.ok === true, 'parse ok');
ok(res.tourDate === '24/10/2026', 'tourDate = 24/10/2026 (got ' + res.tourDate + ')');
ok(res.cities.length === 3, '3 cities (empty City-4/5/6 dropped) — got ' + res.cities.length);
ok(res.cities[0].name === 'PORBANDAR', 'city1 = PORBANDAR');
ok(res.cities[1].name === 'DWARKA-J.KHAMBHADYA', 'city2 = DWARKA-J.KHAMBHADYA (got ' + res.cities[1]?.name + ')');
ok(res.cities[2].name === 'JAMNAGAR', 'city3 = JAMNAGAR');

console.log('\n=== T3: PORBANDAR shops ===');
const pbr = res.cities[0];
ok(pbr.date === '24/10/2026', 'PORBANDAR date');
const kan = pbr.shops.find((s: any) => s.name === 'KANAIYA BANGELS');
ok(!!kan, 'KANAIYA BANGELS shop mila');
ok(kan && kan.code === 'PORBANDAR-3@!', 'KANAIYA code = PORBANDAR-3@!');
ok(kan && kan.bills.length === 2, 'KANAIYA 2 bills — got ' + (kan?.bills.length));
ok(kan && kan.bills[1].balP === 5180600, 'KANAIYA last balance 51806 — got ' + (kan ? kan.bills[1].balP : -1));
ok(kan && kan.bills[1].recvP === 5180600, 'KANAIYA recv 51806');
ok(kan && kan.bills[1].mode === 3, 'KANAIYA mode 3 (cheque) — got ' + (kan ? kan.bills[1].mode : -1));
ok(kan && kan.balP === 5180600, 'KANAIYA shop.balP = last bal');
const abh = pbr.shops.find((s: any) => s.name === 'ABHUSHAN NOVELTY');
ok(abh && abh.bills[0].lessP === 1500, 'ABHUSHAN less 15 = 1500p — got ' + (abh ? abh.bills[0].lessP : -1));
ok(abh && abh.bills[0].recvP === 276500 && abh.bills[0].mode === 1, 'ABHUSHAN recv 2765 cash');
const bha = pbr.shops.find((s: any) => s.name === 'BHAVYA NOVELTY');
ok(bha && bha.bills.length === 2 && bha.bills[1].lessP === 12000, 'BHAVYA less 120 = 12000p');
const star = pbr.shops.find((s: any) => s.name === 'STAR CUTLERY');
ok(!!star && star.bills.length === 3, 'STAR CUTLERY 3 bills (orphan 46333 included) — got ' + (star?.bills.length));
ok(star && star.bills[1].no === '46333' && star.bills[1].amtP === 274000, 'orphan bill 46333 amt 2740');
ok(star && star.bills[2].amtP === 74500 && star.bills[2].balP === 570100, '745 amt / 5,701.00 bal bill');
ok(pbr.shops.length === 4, 'PORBANDAR = 4 shops (fixture) — got ' + pbr.shops.length);

console.log('\n=== T4: DWARKA + J.KHAMBHALIYA ===');
const dwk = res.cities[1];
ok(dwk.shops.length === 4, 'DWARKA 4 shops (incl. 2 J.KHAMBHALIYA) — got ' + dwk.shops.length);
const dhara = dwk.shops.find((s: any) => s.name === 'DHARA NOVELTY');
ok(dhara && dhara.bills.length === 2 && dhara.bills[1].lessP === 53200, 'DHARA less 532 = 53200p');
const har = dwk.shops.find((s: any) => s.name === 'SHREE HARIKRUPA NOVELTY');
ok(har && har.bills[2].recvP === 3794800 && har.bills[2].lessP === 189800, 'HARIKRUPA recv 37948 less 1898');

console.log('\n=== T5: JAMNAGAR edge cases ===');
const jam = res.cities[2];
ok(jam.date === '20/10/26', 'JAMNAGAR date 20/10/26 (2-digit year)');
const momai = jam.shops.find((s: any) => s.name === 'MOMAI COLLECTION');
ok(momai && momai.bills[0].recvP === 2060000 && momai.bills[0].mode === 1, 'MOMAI recv 20600 cash (3-token same)');
const lady = jam.shops.find((s: any) => s.name === 'LADY COLLECTION');
ok(!!lady, 'LADY COLLECTION shop mila (backtick code)');
ok(lady && lady.bills.length === 0, 'LADY COLLECTION malformed "568 5,285.00" skip — 0 bills, got ' + (lady?.bills.length));
const balk = jam.shops.find((s: any) => s.name === 'SHREE BALKRISHNA NOVELTY');
ok(balk && balk.bills.length === 3 && balk.bills[2].lessP === 128700, 'BALKRISHNA 3 bills, less 1287');

console.log('\n=== T6: payment details ===');
ok(pbr.cashP === 12495500, 'PORBANDAR cash 124955 — got ' + pbr.cashP);
ok(pbr.cheqP === 5180600, 'PORBANDAR cheque 51806');
ok(pbr.lessRGP === 581400, 'PORBANDAR lessRG 5814');
ok(pbr.note === 'JND T. T shop', 'PORBANDAR note = "JND T. T shop" — got "' + pbr.note + '"');
ok(dwk.cashP === 14103000, 'DWARKA cash 141030 (2-line city name row bhi match)');
ok(dwk.note === 'T. T. KHARCHO', 'DWARKA note — got "' + dwk.note + '"');
ok(jam.cashP === 6237000 && jam.note === 'Line KHARCHO', 'JAMNAGAR cash 62370 + note');
ok(!pbr.upiP, 'PORBANDAR upi 0/undefined');

console.log('\n=== T7: guards ===');
ok(!res.cities.some((c: ParsedCity) => c.name === 'City-4'), 'City-4 drop');
ok(!pbr.shops.some((s: any) => /zoya/i.test(s.name)), '"zoya veravl rubber" shop NAHI bana (orders section)');
const keys = new Set(res.cities.flatMap((c: any) => c.shops.map((s: any) => s.key)));
ok(keys.size === res.cities.reduce((a: number, c: any) => a + c.shops.length, 0), 'shop keys unique');
ok(suggestTourName(res) === 'PORBANDAR', 'suggestTourName = PORBANDAR');

console.log('\n=== T8: garbage input ===');
const bad = parseTourPaste('hello world\nkuch nahi hai');
ok(bad.ok === false && !!bad.reason, 'garbage -> ok:false + reason');
const empty = parseTourPaste('');
ok(empty.ok === false, 'empty -> ok:false');
const cityOnly = parseTourPaste('Moad TESTCITYDate: 24/10/2026 Total Cr. Rs.\n0 1');
ok(cityOnly.ok === false, 'city header only, 0 bills -> ok:false');

console.log('\n=== T9: 2-token & 1-token rest ===');
const r2 = parseTourPaste('Moad CITYXDate: 01/01/2026 Total Cr. Rs.\nCITYX-1A SHOP ONE 0 1\n05/05/2026 10 1,000.00 1,000.00 0 1\nCITYX-2B SHOP TWO 0 1\n06/05/2026 9 2,000.00 2,000.00 500 2');
const s1 = r2.cities[0]?.shops[0];
const s2 = r2.cities[0]?.shops[1];
ok(r2.ok && s1 && s1.bills[0].recvP === 0, '2-token "0 1" -> recv 0');
ok(s2 && s2.bills[0].recvP === 50000 && s2.bills[0].mode === 2, '"500 2" -> recv 500 UPI — got ' + (s2 ? s2.bills[0].recvP + '/' + s2.bills[0].mode : '-'));
ok(s1 && s1.key === 'c0-s0' && s2 && s2.key === 'c0-s1', 'keys c0-s0 / c0-s1');

console.log('\n========================================');
console.log(`PASS: ${pass}  FAIL: ${fail}`);
console.log(fail === 0 ? 'ALL TOUR-PASTE TESTS GREEN ✓' : '!!! FAILURES !!!');
process.exit(fail === 0 ? 0 : 1);

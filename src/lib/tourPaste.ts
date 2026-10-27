// ============================================================
// TOUR PASTE PARSER (Task 93, Boss order 2026-10-28)
// "Dashboard me tour hisab box me aysa pdf ya Miracle software se
//  data past kiya jayga... Sab se pehle puchega ke wo kis Tour ka hai?"
//
// Miracle billing software ke PDF/text export ko PASTE karke parse karta hai:
//   - City blocks  : "...Moad PORBANDARDate: 24/10/2026 Total Cr. Rs."
//   - Shop rows    : "PORBANDAR-3@! KANAIYA BANGELS 0 1"
//   - Bill rows    : "15/09/2026 35 47,780.00 51,806.00 51806 51806 3"
//                    (date days billAmt balance [recv net less] mode)
//   - Payment rows : "5814 0 PORBANDAR 124955 0 51806 250000 JND T. T shop 1"
//                    (lessRG x CITY cash upi cheque rs note moad)
//
// NOTATION: REAL RUPEES -> integer PAISE (ThX convention, cbMoney jaisa).
// Pure functions — node-testable (scripts/test_tourPaste.ts).
// Tolerant by design: PDF text-layer junk (vertical "Le ss R.G oo ds Mo ad"
// columns, repeat page headers, empty City-4/5/6 blocks) sab handle.
// ============================================================

export interface ParsedBill {
  date: string; // '15/09/2026' (jaisa sheet me hai)
  no: string;   // orphan bill no (rare)
  days: number;
  amtP: number;  // bill amount
  balP: number;  // printed running balance
  recvP: number; // received (paisa diya)
  lessP: number; // less/discount
  mode: number;  // 1=Cash 2=UPI 3=Cheque (0 = nahi)
}

export interface ParsedShop {
  key: string;   // 'c0-s3' — stable key (hisab entries isi se map hoti hain)
  code: string;  // 'PORBANDAR-3@!'
  name: string;  // 'KANAIYA BANGELS'
  billsP: number; // sum of bill amounts
  recvP: number;  // miracle data me received
  balP: number;   // aakhri printed balance
  bills: ParsedBill[];
}

export interface ParsedCity {
  name: string;  // 'PORBANDAR'
  date?: string; // header date '24/10/2026'
  shops: ParsedShop[];
  lessRGP?: number; // payment-details 'less R.Goods'
  cashP?: number;   // payment-details cash
  upiP?: number;
  cheqP?: number;
  note?: string;    // payment-details note (jaha jama: 'JND T. T shop')
}

export interface ParseResult {
  ok: boolean;
  reason?: string;
  tourDate?: string;  // pehli city ki header date
  cities: ParsedCity[];
  junkLines: number;  // diagnostics
}

// ---------- low-level helpers ----------

/** "51,806.00" -> 5180600 paise ; "745" -> 74500 ; "" -> 0 */
export function toPaise(s: string | undefined | null): number {
  const t = (s || '').trim().replace(/,/g, '');
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return 0;
  const n = parseFloat(t);
  return Math.round(n * 100);
}

/** city name ko normalize karo (match ke liye): case/space/dot hata do */
const normCity = (s: string): string =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** city-name regex — PDF me separator har jagah alag hota hai
 *  ("DWARKA-J.KHAMBHADYA" vs "DWARKA-J. KHAMBHADYA") — isliye name ko
 *  alnum tokens me todke har gap flexible bana do (escape-backslash trap
 *  se bachne ke liye split-join, escape-relax NAHI) */
const cityPatOf = (name: string): string =>
  (name || '').split(/[^A-Za-z0-9]+/).filter(Boolean).join('[\\.\\-\\s]*');

const JUNK_TOKEN = /^(le|ss|r\.?g|oo|ds|mo|ad|de|e|moad|goods|less)$/i;
const JUNK_LINE = /shivam|% bill|1-cash|total cr|payment details|cash given/i;
const SOLO_JUNK_LINE = /^(le|ss|r\.?g|oo|ds|mo|ad|de|e|moad|goods|less|totails?|totals?)$/i;
const DATE_RE = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;

/** "…Moad PORBANDARDate: 24/10/2026 Total Cr. Rs." -> { name:'PORBANDAR', date:'24/10/2026' } */
function tryCityHeader(line: string): { name: string; date: string } | null {
  const dm = line.match(/Date\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (!dm) return null;
  const before = line.slice(0, dm.index ?? 0);
  // leading junk tokens (vertical PDF column ke tukde) hatao
  const tokens = before.split(/\s+/).filter(Boolean);
  let name = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tk = tokens[i];
    if (JUNK_TOKEN.test(tk) || (tk.length <= 2 && !/[\d]/.test(tk))) continue;
    name = tk + (name ? ' ' + name : '');
  }
  name = name.replace(/[^A-Za-z0-9\.\-\s\/`@!&]/g, '').trim();
  if (!name || !/[A-Za-z]/.test(name)) return null;
  return { name, date: dm[1] };
}

/** bill row: "15/09/2026 35 47,780.00 51,806.00 51806 51806 3" */
function tryBillLine(line: string): ParsedBill | null {
  const m = line.match(
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?:\s+(.*))?$/
  );
  if (!m) return null;
  const rest = m[5] || '';
  const nums = rest.match(/[\d,]+(?:\.\d+)?/g) || [];
  let recvP = 0, lessP = 0, mode = 0;
  if (nums.length === 1) {
    recvP = toPaise(nums[0]);
  } else if (nums.length === 2) {
    recvP = toPaise(nums[0]);
    const mv = parseInt(nums[1], 10);
    if (mv >= 1 && mv <= 3) mode = mv;
    else lessP = toPaise(nums[1]);
  } else if (nums.length === 3) {
    recvP = toPaise(nums[0]);
    const t0 = toPaise(nums[0]);
    const t1 = toPaise(nums[1]);
    if (t0 === t1) { lessP = 0; } // recv net ke barabar = less nahi
    else { lessP = t1; }
    const mv = parseInt(nums[2], 10);
    if (mv >= 1 && mv <= 3) mode = mv;
  } else if (nums.length >= 4) {
    recvP = toPaise(nums[0]);
    lessP = toPaise(nums[2]);
    const mv = parseInt(nums[3], 10);
    if (mv >= 1 && mv <= 3) mode = mv;
  }
  return {
    date: m[1],
    no: '',
    days: parseInt(m[2], 10) || 0,
    amtP: toPaise(m[3]),
    balP: toPaise(m[4]),
    recvP,
    lessP,
    mode
  };
}

/** orphan bill row (date missing): "46333 101 2,740.00 8,897.00 0 1" */
function tryOrphanBill(line: string): ParsedBill | null {
  const m = line.match(
    /^(\d{1,6})\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+(.*))?$/
  );
  if (!m) return null;
  const b = tryBillLine(`01/01/1900 ${m[2]} ${m[3]} ${m[4]} ${m[5] || ''}`);
  if (!b) return null;
  b.date = '';
  b.no = m[1];
  return b;
}

/** shop row: "PORBANDAR-3@! KANAIYA BANGELS 0 1" — trailing 2 chhote ints */
function tryShopLine(line: string): { code: string; name: string } | null {
  if (!/[A-Za-z]/.test(line)) return null;
  if (/[\d],[\d]/.test(line)) return null; // comma-amounts = bill row, shop nahi
  if (/total|net balance|party name|item qty/i.test(line)) return null;
  const m = line.match(/^(.*\S)\s+(\d{1,4})\s+(\d{1,4})$/);
  if (!m) return null;
  const prefix = m[1].trim();
  if (!prefix || !/[A-Za-z]{3,}/.test(prefix)) return null;
  const sp = prefix.split(/\s+/);
  if (sp.length < 2) return null;
  const code = sp[0];
  const name = sp.slice(1).join(' ').trim();
  if (!code || !name) return null;
  return { code, name };
}

// ---------- main ----------

export function parseTourPaste(text: string): ParseResult {
  const lines = (text || '').replace(/\r/g, '').split('\n');
  const cities: ParsedCity[] = [];
  let section: 'cities' | 'payment' | 'orders' = 'cities';
  let junkLines = 0;
  let tourDate: string | undefined;
  let payBuf = ''; // payment row aksar 2-3 lines me toot jata hai (PDF text layer)

  const cityByName = new Map<string, ParsedCity>();
  const ensureCity = (name: string, date?: string): ParsedCity => {
    const k = normCity(name);
    let c = cityByName.get(k);
    if (!c) {
      c = { name: name.trim(), shops: [] };
      cities.push(c);
      cityByName.set(k, c);
    }
    if (date && !c.date) c.date = date;
    return c;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // section switches (order matters)
    if (/payment details/i.test(line)) { section = 'payment'; junkLines++; continue; }
    if (/party name/i.test(line) && /item/i.test(line)) { section = 'orders'; junkLines++; continue; }
    if (/^(totals?|net balance)\b/i.test(line)) { junkLines++; continue; }

    if (section === 'orders') { junkLines++; continue; }

    // payment section ke non-row lines (column headers / legend) — buffer
    // pollute na ho isliye pehle hi kaat do
    if (section === 'payment' &&
        (/r\.?\s?goods\s+city|city\s+cash\s+upi|cash\s*\(1\)|upi\s*\(2\)|chaque\s*\(3\)/i.test(line) ||
         /^(less|balance)\b/i.test(line))) {
      payBuf = '';
      junkLines++;
      continue;
    }

    // city header PEHLE check (line me "Total Cr. Rs." bhi hota hai jo
    // JUNK_LINE se match ho jata — isliye junk-check se pehle aana zaroori)
    if (section === 'cities') {
      const ch0 = tryCityHeader(line);
      if (ch0) {
        if (!tourDate) tourDate = ch0.date;
        ensureCity(ch0.name, ch0.date);
        continue;
      }
    }

    if (JUNK_LINE.test(line) || SOLO_JUNK_LINE.test(line) || /^[\d\s]+$/.test(line)) { junkLines++; continue; }

    if (section === 'cities') {
      const bill = tryBillLine(line) || tryOrphanBill(line);
      if (bill) {
        const cur = cities[cities.length - 1];
        const shop = cur && cur.shops.length ? cur.shops[cur.shops.length - 1] : null;
        if (shop) shop.bills.push(bill);
        else junkLines++;
        continue;
      }
      const shop = tryShopLine(line);
      if (shop) {
        const cur = cities.length ? cities[cities.length - 1] : null;
        if (!cur) { junkLines++; continue; }
        // duplicate guard: same code+name twice (page repeat) — reuse
        const exist = cur.shops.find((s) => s.code === shop.code && s.name === shop.name);
        if (!exist) {
          cur.shops.push({
            key: `c${cities.indexOf(cur)}-s${cur.shops.length}`,
            code: shop.code,
            name: shop.name,
            billsP: 0,
            recvP: 0,
            balP: 0,
            bills: []
          });
        }
        continue;
      }
      junkLines++;
      continue;
    }

    // section === 'payment' — city rows match karke amounts nikaalo.
    // ROW BUFFER: "7428 0 DWARKA-J." / "KHAMBHADYA" / "141030 0 0 250 ..." —
    // 3 lines ek row — jab tak poora na ho buffer jodte raho.
    payBuf = payBuf ? payBuf + ' ' + line : line;
    const hit = cities.find((c) => {
      try { return new RegExp(cityPatOf(c.name), 'i').test(payBuf); } catch { return false; }
    });
    if (!hit) {
      // buffer bekaar ho gaya (row city ke bina) — bade buffer flush
      if (payBuf.split(/\s+/).length > 30) payBuf = '';
      junkLines++;
      continue;
    }
    const lineNoCity = payBuf.replace(new RegExp(cityPatOf(hit.name), 'i'), ' ');
    const nums = (lineNoCity.match(/[\d,]+(?:\.\d+)?/g) || []).map((n) => toPaise(n));
    if (nums.length < 6) { junkLines++; continue; } // row adhoora — agri line ka intezaar
    hit.lessRGP = nums[0];
    hit.cashP = nums[2];
    hit.upiP = nums[3];
    hit.cheqP = nums[4];
    const noteTail = lineNoCity.replace(/[\d,]+(?:\.\d+)?/g, ' ').replace(/\s+/g, ' ').trim();
    const moadTail = noteTail.replace(/\s*\d\s*$/, '').trim();
    if (moadTail && /[A-Za-z]/.test(moadTail)) hit.note = moadTail;
    payBuf = '';
  }

  // totals per shop
  for (const c of cities) {
    for (const s of c.shops) {
      s.billsP = s.bills.reduce((a, b) => a + b.amtP, 0);
      s.recvP = s.bills.reduce((a, b) => a + b.recvP, 0);
      s.balP = s.bills.length ? s.bills[s.bills.length - 1].balP : 0;
    }
  }

  // khali cities (City-4/5/6 jaise) drop — koi shop nahi + koi payment nahi
  const alive = cities.filter((c) => c.shops.length > 0 || (c.cashP || 0) + (c.upiP || 0) + (c.cheqP || 0) > 0);
  const totalShops = alive.reduce((a, c) => a + c.shops.length, 0);
  const totalBills = alive.reduce((a, c) => a + c.shops.reduce((x, s) => x + s.bills.length, 0), 0);

  if (!alive.length || totalBills === 0) {
    return {
      ok: false,
      reason: 'Is paste me koi city/shop/bill nahi mila. Miracle ke report ka text poora select karke paste karo (header se Total Cr. Rs. tak).',
      cities: [],
      junkLines
    };
  }

  return { ok: true, tourDate, cities: alive, junkLines };
}

/** paste se tour ka SUGGESTED naam (pehli city) — Boss edit kar sakta hai */
export function suggestTourName(res: ParseResult): string {
  const c = res.cities.find((x) => x.shops.length > 0) || res.cities[0];
  return c ? c.name : '';
}

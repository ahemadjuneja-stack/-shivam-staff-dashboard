import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as limitQ,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { UserProfile, ScheduleEntry } from '../types';
import Avatar from '../components/Avatar';
import {
  Upload,
  CalendarRange,
  MapPin,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
  Save
} from 'lucide-react';

interface ToursProps {
  currentUser: { uid: string; email?: string | null } | null;
}

// ============================================================
// TOURS & LINE SCHEDULE (Boss order 2026-10-27):
// 1) XL UPLOAD — tour plan file (Phone/Mobile/Name + Date + City) upload
//    karo -> rows staff se match -> line_schedule me import. Import ke baad
//    salesmen ke app home par turant dikhta hai (live listener).
// 2) MONTHLY BUILDER — kisi ek salesman ka poora month day-by-day banao;
//    save hote hi app me show.
// 3) GREEN/RED VERIFICATION — jo date likhi hai us din ki GPS trail
//    (loc_sessions points) city coords se match: gaya = GREEN VISITED,
//    nahi gaya = RED NOT VISITED. City coords Nominatim (free OSM) se.
// ============================================================

const CITY_VISIT_RADIUS_M = 25000; // city visit = us din koi GPS point city center ke 25km andar
const GEO_CACHE_KEY = 'shivam_city_geo_v1';

const cityKeyOf = (c: string): string => (c || '').trim().toLowerCase().replace(/\s+/g, ' ');
const scheduleDocId = (uid: string, date: string, ck: string): string =>
  `lsch-${uid}-${date}-${ck.replace(/[^a-z0-9]+/g, '')}`.slice(0, 140);
const pad2 = (n: number): string => String(n).padStart(2, '0');
const ymdOfMs = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const ymdOfParts = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- City geocoding (Nominatim free, 1 req/sec, localStorage cache) ----------
interface GeoPoint {
  lat: number;
  lng: number;
}
function loadGeoCache(): Record<string, GeoPoint> {
  try {
    return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveGeoCache(cache: Record<string, GeoPoint>) {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}
const geoCache = loadGeoCache();
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function geocodeCity(city: string): Promise<GeoPoint | null> {
  const key = cityKeyOf(city);
  if (!key) return null;
  if (geoCache[key]) return geoCache[key];
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 9000);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(city)}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    window.clearTimeout(t);
    if (!res.ok) return null;
    const json: any = await res.json();
    if (Array.isArray(json) && json.length > 0) {
      const lat = Number(json[0].lat);
      const lng = Number(json[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const pt = { lat, lng };
        geoCache[key] = pt;
        saveGeoCache(geoCache);
        return pt;
      }
    }
  } catch {
    /* offline / rate limit — null */
  }
  return null;
}

// ---------- Excel column detection + date parsing ----------
const normKey = (s: string): string => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const PHONE_KEYS = ['phone', 'mobile', 'number', 'mobileno', 'phoneno', 'contact', 'contactno', 'staffphone', 'salesmanphone', 'whatsapp', 'phonemobile'];
const NAME_KEYS = ['name', 'staff', 'staffname', 'salesman', 'salesmanname', 'employeename', 'employee', 'staffmember', 'salesperson'];
const DATE_KEYS = ['date', 'tarikh', 'visitdate', 'tourdate', 'scheduledate', 'day', 'tourplan'];
const CITY_KEYS = ['city', 'town', 'place', 'line', 'linecity', 'tourcity', 'destination', 'area', 'market', 'location', 'cityname'];

function pickCell(row: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(normKey(k))) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

function parseDateCell(v: string): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  // Excel serial number
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d && d.y && d.m && d.d) return ymdOfParts(d.y, d.m, d.d);
  }
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymdOfParts(Number(m[1]), Number(m[2]), Number(m[3]));
  // DD-MM-YYYY / DD/MM/YYYY (Indian style)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return ymdOfParts(yy, mm, dd);
  }
  // Date object string fallback
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return ymdOfMs(parsed.getTime());
  return null;
}

type VisitStatus = 'visited' | 'missed' | 'today' | 'upcoming' | 'unverified';

interface ParsedRow {
  ok: boolean;
  uid?: string;
  staffName?: string;
  phone?: string;
  name?: string;
  date?: string;
  city?: string;
  error?: string;
}

interface SessionPoint {
  lat: number;
  lng: number;
  ymd: string;
}

export default function Tours({ currentUser }: ToursProps) {
  // ---------- Users (active) ----------
  const [users, setUsers] = useState<UserProfile[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'users'), where('status', '==', 'active'));
    const unsub = onSnapshot(
      q,
      (snap) => setUsers(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }))),
      () => {}
    );
    return () => unsub();
  }, []);
  const salesUsers = useMemo(() => users.filter((u) => u.role === 'sales' || u.role === 'salesman'), [users]);
  const userByUid = useMemo(() => Object.fromEntries(users.map((u) => [u.uid, u])), [users]);

  // ---------- Entries ----------
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'line_schedule'),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEntry, 'id'>) }));
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.city.localeCompare(b.city)));
        setEntries(rows);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // ---------- GPS sessions (verification data) ----------
  const [sessionsMap, setSessionsMap] = useState<Record<string, SessionPoint[]>>({});
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLoadedAt, setSessionsLoadedAt] = useState(0);
  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const map: Record<string, SessionPoint[]> = {};
      for (const u of salesUsers) {
        try {
          const snap = await getDocs(
            query(collection(db, 'loc_sessions'), where('uid', '==', u.uid), orderBy('startedAt', 'desc'), limitQ(60))
          );
          const pts: SessionPoint[] = [];
          snap.forEach((d) => {
            const data = d.data() as Record<string, any>;
            const arr = Array.isArray(data.points) ? data.points : [];
            arr.forEach((p: any) => {
              const at = Number(p?.at) || 0;
              if (!at || typeof p?.lat !== 'number' || typeof p?.lng !== 'number') return;
              pts.push({ lat: p.lat, lng: p.lng, ymd: ymdOfMs(at) });
            });
            if (typeof data.startLat === 'number' && typeof data.startLng === 'number' && Number(data.startedAt) > 0) {
              pts.push({ lat: data.startLat, lng: data.startLng, ymd: ymdOfMs(Number(data.startedAt)) });
            }
            if (typeof data.endLat === 'number' && typeof data.endLng === 'number' && Number(data.endedAt) > 0) {
              pts.push({ lat: data.endLat, lng: data.endLng, ymd: ymdOfMs(Number(data.endedAt)) });
            }
          });
          map[u.uid] = pts;
        } catch {
          /* skip this user */
        }
      }
      setSessionsMap(map);
      setSessionsLoadedAt(Date.now());
    } finally {
      setSessionsLoading(false);
    }
  };
  const sessionsBootRef = useRef(false);
  useEffect(() => {
    if (sessionsBootRef.current || salesUsers.length === 0) return;
    sessionsBootRef.current = true;
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesUsers.length]);

  const todayYmd = ymdOfMs(Date.now());
  const statusOf = (e: ScheduleEntry): VisitStatus => {
    if (e.date > todayYmd) return 'upcoming';
    if (typeof e.cityLat !== 'number' || typeof e.cityLng !== 'number') return 'unverified';
    const pts = sessionsMap[e.uid] || [];
    const hit = pts.some(
      (p) => p.ymd === e.date && haversineM(p.lat, p.lng, e.cityLat as number, e.cityLng as number) <= CITY_VISIT_RADIUS_M
    );
    if (hit) return 'visited';
    return e.date === todayYmd ? 'today' : 'missed';
  };

  // ---------- XL UPLOAD ----------
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parsedFileName, setParsedFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setImportMsg('');
    setParsedFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('Empty file');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const out: ParsedRow[] = [];
      rows.forEach((r, idx) => {
        const phoneRaw = pickCell(r, PHONE_KEYS);
        const nameRaw = pickCell(r, NAME_KEYS);
        const dateRaw = pickCell(r, DATE_KEYS);
        const cityRaw = pickCell(r, CITY_KEYS);
        const base = { phone: phoneRaw, name: nameRaw, date: dateRaw, city: cityRaw };
        if (!phoneRaw && !nameRaw) {
          out.push({ ...base, ok: false, error: `Row ${idx + 2}: staff phone/name missing` });
          return;
        }
        if (!dateRaw) {
          out.push({ ...base, ok: false, error: `Row ${idx + 2}: date missing` });
          return;
        }
        const date = parseDateCell(dateRaw);
        if (!date) {
          out.push({ ...base, ok: false, error: `Row ${idx + 2}: unreadable date "${dateRaw}"` });
          return;
        }
        if (!cityRaw) {
          out.push({ ...base, ok: false, error: `Row ${idx + 2}: city missing` });
          return;
        }
        // staff resolve: phone (last 10 digits) pehle, phir naam
        let staff: UserProfile | undefined;
        const digits = phoneRaw.replace(/\D/g, '');
        if (digits.length >= 10) {
          const tail = digits.slice(-10);
          staff = users.find((u) => String(u.mobile || '').replace(/\D/g, '').endsWith(tail));
        }
        if (!staff && nameRaw) {
          const nk = nameRaw.trim().toLowerCase();
          staff = users.find((u) => String(u.name || '').trim().toLowerCase() === nk);
        }
        if (!staff) {
          out.push({ ...base, ok: false, error: `Row ${idx + 2}: no active staff matched "${nameRaw || phoneRaw}"` });
          return;
        }
        out.push({ ok: true, uid: staff.uid, staffName: staff.name, date, city: cityRaw });
      });
      setParsedRows(out);
    } catch (e: any) {
      setImportMsg('Could not read file: ' + String(e?.message || e));
      setParsedRows([]);
    }
  };

  const importRows = async () => {
    const okRows = parsedRows.filter((r) => r.ok && r.uid && r.date && r.city);
    if (okRows.length === 0 || importing) return;
    setImporting(true);
    setImportMsg('');
    try {
      // unique cities geocode (1.1s delay — Nominatim policy)
      const uniqueCities = Array.from(new Set(okRows.map((r) => r.city as string)));
      const coords: Record<string, GeoPoint | null> = {};
      let done = 0;
      setGeocodeProgress({ done: 0, total: uniqueCities.length });
      for (const c of uniqueCities) {
        coords[c] = await geocodeCity(c);
        done += 1;
        setGeocodeProgress({ done, total: uniqueCities.length });
        if (done < uniqueCities.length) await sleep(1100);
      }
      setGeocodeProgress(null);
      const geok = uniqueCities.filter((c) => !coords[c]).length;
      // batch writes (chunk 400)
      const mgrName = 'Dashboard';
      let chunk: ReturnType<typeof writeBatch> = writeBatch(db);
      let ops = 0;
      let written = 0;
      const commit = async () => {
        if (ops > 0) {
          await chunk.commit();
          chunk = writeBatch(db);
          ops = 0;
        }
      };
      for (const r of okRows) {
        const uid = r.uid as string;
        const date = r.date as string;
        const city = (r.city as string).trim();
        const ck = cityKeyOf(city);
        const pt = coords[city] || null;
        const staff = userByUid[uid];
        chunk.set(doc(db, 'line_schedule', scheduleDocId(uid, date, ck)), {
          uid,
          name: staff?.name || r.staffName || '',
          phone: staff?.mobile || '',
          date,
          city,
          cityKey: ck,
          month: date.slice(0, 7),
          source: 'dashboard',
          createdBy: mgrName,
          createdAt: Date.now(),
          ...(pt ? { cityLat: pt.lat, cityLng: pt.lng } : {})
        });
        ops += 1;
        written += 1;
        if (ops >= 400) await commit();
      }
      await commit();
      setImportMsg(
        `Imported ${written} schedule entries for ${new Set(okRows.map((r) => r.uid)).size} staff members.` +
          (geok > 0 ? ` ${geok} city name(s) could not be located on the map — they will show as UNVERIFIED until re-uploaded.` : '')
      );
      setParsedRows([]);
      setParsedFileName('');
    } catch (e: any) {
      setImportMsg('Import failed: ' + String(e?.message || e));
    } finally {
      setImporting(false);
      setGeocodeProgress(null);
    }
  };

  // ---------- MONTHLY BUILDER ----------
  const [builderUid, setBuilderUid] = useState('');
  const [builderMonth, setBuilderMonth] = useState(() => todayYmd.slice(0, 7));
  const [dayCity, setDayCity] = useState<Record<number, string>>({});
  const [builderSaving, setBuilderSaving] = useState(false);
  const [builderMsg, setBuilderMsg] = useState('');

  const builderUser = salesUsers.find((u) => u.uid === builderUid);
  useEffect(() => {
    // staff/month select -> existing entries prefill
    const map: Record<number, string> = {};
    entries.forEach((e) => {
      if (e.uid === builderUid && e.month === builderMonth) {
        const d = Number(e.date.slice(8, 10));
        map[d] = e.city;
      }
    });
    setDayCity(map);
    setBuilderMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderUid, builderMonth]);

  const saveBuilder = async () => {
    if (!builderUser || !builderMonth) {
      window.alert('Please select a salesman and a month first.');
      return;
    }
    if (builderSaving) return;
    const [yy, mm] = builderMonth.split('-').map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const citiesToGeo = Array.from(
      new Set(
        Object.entries(dayCity)
          .filter(([d, c]) => Number(d) >= 1 && Number(d) <= daysInMonth && String(c || '').trim())
          .map(([, c]) => String(c).trim())
      )
    );
    setBuilderSaving(true);
    setBuilderMsg('');
    try {
      const coords: Record<string, GeoPoint | null> = {};
      if (citiesToGeo.length > 0) {
        setGeocodeProgress({ done: 0, total: citiesToGeo.length });
        let done = 0;
        for (const c of citiesToGeo) {
          coords[c] = await geocodeCity(c);
          done += 1;
          setGeocodeProgress({ done, total: citiesToGeo.length });
          if (done < citiesToGeo.length) await sleep(1100);
        }
        setGeocodeProgress(null);
      }
      const batch = writeBatch(db);
      let writes = 0;
      let deletes = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const city = String(dayCity[d] || '').trim();
        if (city) {
          const ck = cityKeyOf(city);
          const pt = coords[city] || null;
          batch.set(doc(db, 'line_schedule', scheduleDocId(builderUser.uid, ymdOfParts(yy, mm, d), ck)), {
            uid: builderUser.uid,
            name: builderUser.name,
            phone: builderUser.mobile || '',
            date: ymdOfParts(yy, mm, d),
            city,
            cityKey: ck,
            month: builderMonth,
            source: 'dashboard',
            createdBy: 'Dashboard',
            createdAt: Date.now(),
            ...(pt ? { cityLat: pt.lat, cityLng: pt.lng } : {})
          });
          writes += 1;
        } else {
          // day cleared -> existing entry delete (agar hai)
          const existing = entries.find((e) => e.uid === builderUser.uid && e.date === ymdOfParts(yy, mm, d));
          if (existing && existing.id) {
            batch.delete(doc(db, 'line_schedule', existing.id));
            deletes += 1;
          }
        }
      }
      await batch.commit();
      setBuilderMsg(`Saved ${writes} day(s)` + (deletes ? `, removed ${deletes} day(s)` : '') + ' — live in the salesman app now.');
    } catch (e: any) {
      setBuilderMsg('Save failed: ' + String(e?.message || e));
    } finally {
      setBuilderSaving(false);
      setGeocodeProgress(null);
    }
  };

  // ---------- Schedule table filters ----------
  const months = useMemo(() => Array.from(new Set(entries.map((e) => e.month))).sort().reverse(), [entries]);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterUid, setFilterUid] = useState('');
  const filtered = useMemo(
    () =>
      entries.filter((e) => (!filterMonth || e.month === filterMonth) && (!filterUid || e.uid === filterUid)).slice(0, 250),
    [entries, filterMonth, filterUid]
  );
  const stats = useMemo(() => {
    let visited = 0;
    let missed = 0;
    entries.forEach((e) => {
      const s = statusOf(e);
      if (s === 'visited') visited += 1;
      if (s === 'missed') missed += 1;
    });
    return { total: entries.length, visited, missed, upcoming: entries.filter((e) => e.date > todayYmd).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sessionsMap, todayYmd]);

  const statusChip = (s: VisitStatus) => {
    switch (s) {
      case 'visited':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-black text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> VISITED
          </span>
        );
      case 'missed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[9.5px] font-black text-rose-300">
            <XCircle className="h-3 w-3" /> NOT VISITED
          </span>
        );
      case 'today':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[9.5px] font-black text-sky-300">
            <Clock className="h-3 w-3" /> TODAY
          </span>
        );
      case 'unverified':
        return (
          <span
            title="City location could not be resolved — re-upload or re-save this entry"
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[9.5px] font-black text-amber-300"
          >
            <AlertTriangle className="h-3 w-3" /> UNVERIFIED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/70 px-2 py-0.5 text-[9.5px] font-black text-slate-300">
            UPCOMING
          </span>
        );
    }
  };

  const builderDays = useMemo(() => {
    if (!builderMonth) return 31;
    const [yy, mm] = builderMonth.split('-').map(Number);
    return new Date(yy, mm, 0).getDate();
  }, [builderMonth]);

  return (
    <div className="space-y-5">
      {/* HEADER + STATS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Schedule', value: stats.total, cls: 'text-white' },
          { label: 'Visited (Green)', value: stats.visited, cls: 'text-emerald-400' },
          { label: 'Missed (Red)', value: stats.missed, cls: 'text-rose-400' },
          { label: 'Upcoming', value: stats.upcoming, cls: 'text-sky-400' }
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{s.label}</div>
            <div className={`mt-1 text-2xl font-black tabular-nums ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* XL UPLOAD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-400" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Upload Tour XL</h3>
          </div>
          <span className="text-[10px] font-medium text-slate-500">
            Columns: Phone / Mobile / Name + Date + City
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition"
        >
          <Upload className="h-4 w-4" /> Choose XL / CSV File
        </button>
        {parsedFileName && (
          <div className="mt-2 text-[11px] font-bold text-slate-400">File: {parsedFileName}</div>
        )}
        {importMsg && (
          <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-[11px] font-semibold text-indigo-200">
            {importMsg}
          </div>
        )}
        {geocodeProgress && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-[11px] font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            Locating cities on the map… {geocodeProgress.done}/{geocodeProgress.total}
          </div>
        )}
        {parsedRows.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 max-h-64 overflow-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-[11px] text-slate-300">
                <thead className="sticky top-0 bg-slate-800/90 uppercase text-[9px] text-slate-400">
                  <tr>
                    <th className="px-2.5 py-1.5">Staff</th>
                    <th className="px-2.5 py-1.5">Date</th>
                    <th className="px-2.5 py-1.5">City</th>
                    <th className="px-2.5 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {parsedRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2.5 py-1 font-bold text-white">{r.ok ? r.staffName : r.name || r.phone || '—'}</td>
                      <td className="px-2.5 py-1">{r.date || '—'}</td>
                      <td className="px-2.5 py-1">{r.city || '—'}</td>
                      <td className="px-2.5 py-1">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-bold text-rose-400">
                            <XCircle className="h-3.5 w-3.5" /> {r.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={importRows}
              disabled={importing || parsedRows.filter((r) => r.ok).length === 0}
              className="mt-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/25 disabled:opacity-50 transition"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? 'Importing…' : `Import ${parsedRows.filter((r) => r.ok).length} Schedule Entries`}
            </button>
          </div>
        )}
      </div>

      {/* MONTHLY BUILDER */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarRange className="h-4.5 w-4.5 text-sky-400" />
          <h3 className="text-sm font-black uppercase tracking-wider text-white">Monthly Line Schedule Builder</h3>
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Salesman</label>
            <select
              value={builderUid}
              onChange={(e) => setBuilderUid(e.target.value)}
              className="mt-1 w-56 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— Select salesman —</option>
              {salesUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name} ({u.mobile || 'no phone'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Month</label>
            <input
              type="month"
              value={builderMonth}
              onChange={(e) => setBuilderMonth(e.target.value)}
              className="mt-1 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            onClick={saveBuilder}
            disabled={builderSaving || !builderUid}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 transition"
          >
            {builderSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {builderSaving ? 'Saving…' : 'Save Month Schedule'}
          </button>
        </div>
        {geocodeProgress && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-[11px] font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            Locating cities on the map… {geocodeProgress.done}/{geocodeProgress.total}
          </div>
        )}
        {builderMsg && (
          <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] font-semibold text-emerald-200">
            {builderMsg}
          </div>
        )}
        {!builderUid ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-[11px] font-semibold text-slate-500">
            Select a salesman to build their month — saved days appear in their app instantly.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {Array.from({ length: builderDays }, (_, i) => i + 1).map((d) => {
              const [yy, mm] = builderMonth.split('-').map(Number);
              const dt = new Date(yy, mm - 1, d);
              const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
              const isToday = ymdOfParts(yy, mm, d) === todayYmd;
              return (
                <div
                  key={d}
                  className={`rounded-xl border px-2 py-2 ${isToday ? 'border-sky-500/50 bg-sky-500/10' : 'border-slate-800 bg-slate-800/40'}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-black text-white">{d}</span>
                    <span className="text-[8.5px] font-bold uppercase text-slate-500">{weekday}</span>
                  </div>
                  <input
                    value={dayCity[d] || ''}
                    onChange={(e) => setDayCity((m) => ({ ...m, [d]: e.target.value }))}
                    placeholder="City"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-[11px] text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SCHEDULE TABLE */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4.5 w-4.5 text-rose-400" />
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Schedule & Visit Status</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-[11px] font-bold text-white focus:outline-none"
            >
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={filterUid}
              onChange={(e) => setFilterUid(e.target.value)}
              className="max-w-[180px] rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-[11px] font-bold text-white focus:outline-none"
            >
              <option value="">All staff</option>
              {salesUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadSessions()}
              disabled={sessionsLoading}
              title="Re-check visit status from latest GPS trails"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
            >
              {sessionsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh GPS Check
            </button>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[9.5px] font-bold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Visited
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> Not visited
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" /> Today
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> City not located
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-500" /> Upcoming
          </span>
          {sessionsLoadedAt > 0 && (
            <span className="ml-auto font-medium text-slate-600">GPS trails checked: {new Date(sessionsLoadedAt).toLocaleTimeString()}</span>
          )}
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-[11px] font-semibold text-slate-500">
            No schedule entries yet — upload a tour XL or build a month above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] text-slate-300">
              <thead className="bg-slate-800/40 uppercase text-[9px] text-slate-400">
                <tr>
                  <th className="px-2.5 py-1.5">Staff</th>
                  <th className="px-2.5 py-1.5">Date</th>
                  <th className="px-2.5 py-1.5">City</th>
                  <th className="px-2.5 py-1.5">Source</th>
                  <th className="px-2.5 py-1.5">Visit Status</th>
                  <th className="px-2.5 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filtered.map((e) => {
                  const u = userByUid[e.uid];
                  return (
                    <tr key={e.id} className="hover:bg-slate-800/30 transition">
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-bold text-white">
                        <span className="mr-2 inline-flex align-middle">
                          <Avatar photo={u?.photo} name={e.name || u?.name || '?'} size={24} />
                        </span>
                        {e.name || u?.name || '—'}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-bold tabular-nums">{e.date}</td>
                      <td className="px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1 font-bold text-slate-200">
                          <MapPin className="h-3 w-3 text-emerald-400/80" />
                          {e.city}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                            e.source === 'dashboard'
                              ? 'border border-sky-500/30 bg-sky-500/10 text-sky-300'
                              : 'border border-slate-600 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {e.source === 'dashboard' ? 'XL/BUILDER' : 'SELF'}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5">{statusChip(statusOf(e))}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        <button
                          onClick={async () => {
                            if (e.id && window.confirm(`Remove ${e.city} on ${e.date} for ${e.name}?`)) {
                              await deleteDoc(doc(db, 'line_schedule', e.id)).catch(() => {});
                            }
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-400 transition"
                          title="Remove entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {entries.length > 250 && (
              <div className="mt-2 text-center text-[10px] font-semibold text-slate-600">
                Showing latest 250 of {entries.length} entries — use month/staff filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

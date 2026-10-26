// ============================================================
// LOCATION INTELLIGENCE (Boss order 2026-10-26 — Staff Detail panel):
// "Location se har information dashboard me aani chahiye — last kaha
//  location on kiya kaha off kiya, location on hote huwe wo kaha kaha
//  ghuma poora road map, staff inventory me unki sari information,
//  mobile model, jab jab location aur net dono on kare sari info."
//
// DATA (staff app v1.0.0-65+ likhta hai — lib/locTrack.ts):
//   users/{uid}.lastLocation/.lastSeenAt/.deviceModel/.osVersion/
//               .appVersion/.netType   <- har 5 min + har gate open
//   loc_sessions                    <- location ON period + road-map points[]
//   loc_events                      <- ON/OFF history (kahan + kab)
// Live onSnapshot listeners — salesman phone se data aate hi panel update.
// Map: Leaflet + CARTO dark tiles (no API key, free).
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, collection, query, where, orderBy, limit as fsLimit } from 'firebase/firestore';
import { db } from '../firebase';
import { MapPin, Navigation2, Smartphone, Wifi, Route, CircleDot, Power } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface SessionPoint { lat: number; lng: number; at: number; acc?: number }
interface LocSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  status?: string;
  closedReason?: string;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
  points?: SessionPoint[];
  deviceModel?: string;
  versionCode?: number;
}
interface LocEvent {
  id: string;
  type: string;
  at: number;
  lat?: number;
  lng?: number;
  deviceModel?: string;
  versionCode?: number;
}
interface DeviceInfo {
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  appVersionCode?: number;
  lastSeenAt?: number;
  netType?: string;
  lastLocation?: { lat: number; lng: number; at: number; accuracy?: number };
}

const mapsLink = (lat?: number, lng?: number) =>
  lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;

const fmtDT = (at?: number) =>
  typeof at === 'number' && at > 0
    ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    : '—';

const fmtClock = (at?: number) =>
  typeof at === 'number' && at > 0
    ? new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    : '—';

const agoStr = (at?: number) => {
  if (typeof at !== 'number' || at <= 0) return '—';
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtDur = (from: number, to?: number) => {
  const ms = Math.max(0, (to || Date.now()) - from);
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// Leaflet default icon assets bundler me break hote hain — divIcon use
const dotIcon = (color: string, label: string) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
      <div style="background:${color};color:#020617;font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6);">${label}</div>
      <div style="width:10px;height:10px;border-radius:99px;background:${color};border:2px solid #020617;margin-top:2px;box-shadow:0 2px 8px rgba(0,0,0,.6);"></div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });

interface LocationIntelProps {
  uid: string;
  name: string;
  isSales: boolean;
}

export default function LocationIntel({ uid, name, isSales }: LocationIntelProps) {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [sessions, setSessions] = useState<LocSession[]>([]);
  const [events, setEvents] = useState<LocEvent[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // ---------- LIVE listeners ----------
  useEffect(() => {
    setDevice(null);
    setSessions([]);
    setEvents([]);
    setSelIdx(0);
    const un1 = onSnapshot(doc(db, 'users', uid), (s) => setDevice(s.exists() ? (s.data() as DeviceInfo) : null), () => {});
    const un2 = onSnapshot(
      query(collection(db, 'loc_sessions'), where('uid', '==', uid), orderBy('startedAt', 'desc'), fsLimit(6)),
      (s) => {
        const list: LocSession[] = [];
        s.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<LocSession, 'id'>) }));
        setSessions(list);
      },
      () => {}
    );
    const un3 = onSnapshot(
      query(collection(db, 'loc_events'), where('uid', '==', uid), orderBy('at', 'desc'), fsLimit(12)),
      (s) => {
        const list: LocEvent[] = [];
        s.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<LocEvent, 'id'>) }));
        setEvents(list);
      },
      () => {}
    );
    return () => {
      un1();
      un2();
      un3();
    };
  }, [uid]);

  const sel = sessions[Math.min(selIdx, Math.max(0, sessions.length - 1))] || null;

  // ---------- ROAD MAP (Leaflet) ----------
  const pts = useMemo<SessionPoint[]>(() => (sel && Array.isArray(sel.points) ? sel.points.filter((p) => p && typeof p.lat === 'number') : []), [sel]);

  useEffect(() => {
    if (!mapHostRef.current) return;
    // session switch par map fresh banao (koi stale tile/ghost line nahi)
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    if (!sel || pts.length === 0) return;
    const map = L.map(mapHostRef.current, {
      center: [pts[0].lat, pts[0].lng],
      zoom: 15,
      attributionControl: true,
      zoomControl: true,
      scrollWheelZoom: false
    });
    mapRef.current = map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    // ROAD MAP: poori route polyline + ON (green) / OFF (red) markers
    L.polyline(pts.map((p) => [p.lat, p.lng] as [number, number]), {
      color: '#38bdf8',
      weight: 3,
      opacity: 0.85
    }).addTo(map);
    pts.forEach((p, i) => {
      if (i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 12) === 0) {
        L.circleMarker([p.lat, p.lng], { radius: 3, color: '#38bdf8', fillOpacity: 0.9, weight: 1 }).addTo(map);
      }
    });
    if (sel.startLat != null && sel.startLng != null) {
      L.marker([sel.startLat, sel.startLng], { icon: dotIcon('#34d399', `ON ${fmtClock(sel.startedAt)}`) }).addTo(map);
    }
    if (sel.endLat != null && sel.endLng != null) {
      L.marker([sel.endLat, sel.endLng], { icon: dotIcon('#fb7185', `OFF ${fmtClock(sel.endedAt)}`) }).addTo(map);
    } else if (pts.length) {
      const last = pts[pts.length - 1];
      L.marker([last.lat, last.lng], { icon: dotIcon('#fbbf24', 'LATEST') }).addTo(map);
    }
    // bounds — poora route fit
    try {
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25));
    } catch {
      /* single point — center hi kaafi */
    }
    setTimeout(() => map.invalidateSize(), 120);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [sel?.id, pts.length]);

  const lastLoc = device?.lastLocation;
  const liveSession = sessions.find((s) => s.status === 'open');

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <Navigation2 className="h-4 w-4 text-sky-400" />
          Location Intelligence
        </span>
        {liveSession ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LOCATION ON NOW
          </span>
        ) : (
          <span className="text-[10px] font-bold text-slate-500">location off</span>
        )}
      </div>

      {/* ---------- DEVICE INVENTORY (sari possible info) ---------- */}
      <div>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
          <Smartphone className="h-3 w-3" /> Device Inventory
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="text-[9.5px] text-slate-500 font-bold uppercase">Mobile Model</p>
            <p className="font-semibold text-slate-100 mt-0.5 break-words">{device?.deviceModel || '—'}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="text-[9.5px] text-slate-500 font-bold uppercase">OS / App</p>
            <p className="font-semibold text-slate-100 mt-0.5">{device?.osVersion || '—'} {device?.appVersion ? `• v${device.appVersion}` : device?.appVersionCode ? `• code ${device.appVersionCode}` : ''}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="text-[9.5px] text-slate-500 font-bold uppercase flex items-center gap-1"><Wifi className="h-3 w-3" /> Network</p>
            <p className="font-semibold text-slate-100 mt-0.5">{device?.netType || '—'}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="text-[9.5px] text-slate-500 font-bold uppercase">Last Seen</p>
            <p className="font-semibold text-slate-100 mt-0.5">{agoStr(device?.lastSeenAt)}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 md:col-span-2">
            <p className="text-[9.5px] text-slate-500 font-bold uppercase flex items-center gap-1"><MapPin className="h-3 w-3" /> Last Known Location</p>
            {lastLoc ? (
              <p className="font-semibold text-slate-100 mt-0.5">
                {lastLoc.lat.toFixed(5)}, {lastLoc.lng.toFixed(5)}
                <span className="text-slate-500 font-normal"> ({agoStr(lastLoc.at)})</span>
                {mapsLink(lastLoc.lat, lastLoc.lng) && (
                  <a href={mapsLink(lastLoc.lat, lastLoc.lng)!} target="_blank" rel="noreferrer" className="ml-2 text-sky-400 underline">Open in Maps</a>
                )}
              </p>
            ) : (
              <p className="font-semibold text-slate-500 mt-0.5">waiting for first report…</p>
            )}
          </div>
        </div>
      </div>

      {/* ---------- ROAD MAP (sales location sessions) ---------- */}
      {isSales && (
        <div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
            <Route className="h-3 w-3" /> Road Map — where they traveled with location ON
          </p>
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-500 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              No location sessions yet. Sessions start automatically when {name || 'this staff'} opens the app with location ON.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {sessions.map((s, i) => {
                  const isLive = s.status === 'open';
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelIdx(i)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition ${
                        i === Math.min(selIdx, sessions.length - 1)
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                          : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {isLive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1" />}
                      {fmtDT(s.startedAt)}
                      <span className="text-slate-500 font-semibold"> · {fmtDur(s.startedAt, s.endedAt)}</span>
                    </button>
                  );
                })}
              </div>
              {sel && pts.length === 0 ? (
                <p className="text-xs text-slate-500 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  This session has no map points yet (GPS fix was not available / net was off). It fills in every 3 minutes while location is ON.
                </p>
              ) : (
                <div className="rounded-xl overflow-hidden border border-slate-800">
                  <div ref={mapHostRef} style={{ height: 260, width: '100%', background: '#0b1120' }} />
                </div>
              )}
              {sel && (
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-slate-500 font-bold uppercase text-[9px] flex items-center gap-1"><Power className="h-2.5 w-2.5 text-emerald-400" /> Location ON</p>
                    <p className="text-slate-200 font-semibold mt-0.5">{fmtClock(sel.startedAt)}</p>
                    {mapsLink(sel.startLat, sel.startLng) ? (
                      <a className="text-sky-400 underline" href={mapsLink(sel.startLat, sel.startLng)!} target="_blank" rel="noreferrer">{sel.startLat?.toFixed(5)}, {sel.startLng?.toFixed(5)}</a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-slate-500 font-bold uppercase text-[9px] flex items-center gap-1"><Power className="h-2.5 w-2.5 text-rose-400" /> Location OFF</p>
                    <p className="text-slate-200 font-semibold mt-0.5">{sel.endedAt ? fmtClock(sel.endedAt) : 'still ON'}</p>
                    {mapsLink(sel.endLat, sel.endLng) ? (
                      <a className="text-sky-400 underline" href={mapsLink(sel.endLat, sel.endLng)!} target="_blank" rel="noreferrer">{sel.endLat?.toFixed(5)}, {sel.endLng?.toFixed(5)}</a>
                    ) : (
                      <span className="text-slate-500">{sel.status === 'open' ? 'live now' : sel.closedReason || '—'}</span>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-slate-500 font-bold uppercase text-[9px]">Duration</p>
                    <p className="text-slate-200 font-semibold mt-0.5">{fmtDur(sel.startedAt, sel.endedAt)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                    <p className="text-slate-500 font-bold uppercase text-[9px] flex items-center gap-1"><CircleDot className="h-2.5 w-2.5" /> Track Points</p>
                    <p className="text-slate-200 font-semibold mt-0.5">{pts.length}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- ON/OFF HISTORY (kahan ON kiya, kahan OFF) ---------- */}
      <div>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
          <Power className="h-3 w-3" /> Location ON / OFF History
        </p>
        {events.length === 0 ? (
          <p className="text-xs text-slate-500 rounded-xl border border-slate-800 bg-slate-950/60 p-3">No location events yet — recorded from the staff app automatically.</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {events.map((e) => {
              const on = e.type === 'on';
              return (
                <div key={e.id} className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full shrink-0 border ${on ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/40 bg-rose-500/10 text-rose-400'}`}>
                    <Power className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-bold text-slate-200">
                      Location turned <span className={on ? 'text-emerald-400' : 'text-rose-400'}>{on ? 'ON' : 'OFF'}</span>
                      <span className="text-slate-500 font-semibold"> · {fmtDT(e.at)} · {agoStr(e.at)}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {e.lat != null && e.lng != null ? (
                        <>
                          <a className="text-sky-400 underline" href={mapsLink(e.lat, e.lng)!} target="_blank" rel="noreferrer">{e.lat.toFixed(5)}, {e.lng.toFixed(5)}</a>
                          {e.deviceModel ? ` · ${e.deviceModel}` : ''}
                        </>
                      ) : (
                        e.deviceModel || 'coords not available'
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

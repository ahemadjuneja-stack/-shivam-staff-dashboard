// ============================================================
// BOSS-LOCKED SHOP CENTER (2026-10-26)
// Boss: "Hamare shop ka exect location ye hai... Aur koi nahi dena"
// Source: Boss ka Google Maps share link (Shivam Store place).
// Ye AUTHORITY hai — staff app geofence bhi yahi center use karta hai
// (staff app src/lib/geofence.ts SHOP_CENTER_LOCKED — same values).
// Remote config ka lat/lng AB IGNORE — center permanently locked,
// galti se galat capture ya kisi aur jagah ka center possible nahi.
// Radius hi config ('config/shop') se tune hota hai.
// ============================================================
export const SHOP_CENTER_LOCKED = { lat: 21.5191279, lng: 70.4621545 } as const;
export const SHOP_ADDRESS_LOCKED =
  'Shivam Store, Pushpak Plaza, Shopping Centre, Mangnath Rd, near Shriram Temple, Junagadh, Gujarat 362001';
export const DEFAULT_RADIUS_M = 100;

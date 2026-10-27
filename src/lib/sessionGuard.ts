// ============================================================
// SESSION GUARD (Task 92 — Boss complaint 2026-10-28: "Ye dashboard apne
// aap logout kyo ho jaata hai?" — screenshot: 'Access Denied — This account
// is not active or not authorized. You have been signed out.')
//
// ROOT CAUSE (code-trace se confirm):
//   App.tsx onAuthStateChanged -> getDoc(admins) + getDoc(users) -> CATCH ->
//   signOut(auth) + AccessDenied. Koi bhi Firestore error = FORCED LOGOUT.
//   Network errors kahan se aate hain:
//     - Battery-guard (App hidden = disableNetwork) + tab kill + page reload
//       = fresh load par getDoc jab tak WebSocket reconnect nahi -> 'unavailable'
//     - 5G/WiFi switch, lift me net chala gaya, Firebase hiccup
//   Matlab Boss SACH me logout hua hi nahi tha — app ne khud sign-out kar
//   diya tha. Firebase session to tabhi tooti jab humne KHUD signOut kiya.
//
// FIX RULE (honest + safe):
//   'net'  = session ZINDA rakho, retry karo (reconnect screen)
//   'deny' = sirf permission-denied (rules ne mana kiya / token dead —
//            re-login se hi hoga) -> signOut + Access Denied sahi hai
//   Data-based denials (doc nahi / status inactive / role unknown) App.tsx
//   me alag handle hote hain — ye sirf ERROR classification hai.
// Pure function — koi Firebase/React import nahi (node-testable).
// ============================================================

export type SessionErrKind = 'net' | 'deny';

export function classifySessionError(err: unknown): SessionErrKind {
  // Firestore errors {code: '...'} aate hain; bina-code ka error (TypeError
  // fetch failed etc.) bhi network-family hi hota hai.
  const code = String(
    (err as { code?: string } | null)?.code || (err as Error | null)?.name || ''
  );
  if (!code) return 'net';
  // Sirf HARD denial: rules ne read se mana kiya (stale/dead token par bhi
  // yahi aata hai) — re-login hi ilaaj hai. Baaki SAB net = retry-able:
  //   unavailable (offline/reconnecting), deadline-exceeded (slow), internal,
  //   aborted, cancelled, unknown (wrapped TypeErrors), unauthenticated
  //   (token refresh abhi net par nahi hua), failed-precondition,
  //   resource-exhausted (quota — logout karne se quota nahi badhta),
  //   invalid-argument (retry-safe, logout se behtar)
  if (code === 'permission-denied') return 'deny';
  return 'net';
}

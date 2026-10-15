/**
 * Team check-ins on the website: talking to the ops function's /checkin API, and signing in with
 * Planning Center (PKCE, in the browser; the code is exchanged by the function).
 *
 * The session token is kept on this phone (localStorage). Planning Center's own tokens never
 * reach the phone.
 */
import { SUPABASE_URL } from "@shared/cloud";
import type { CheckinConfig, CheckinLocation, CheckinMe, CheckinPlanData, CheckinServices, CheckinSetup } from "@shared/ops/checkin";

const BASE = (process.env.NEXT_PUBLIC_OPS_URL || `${SUPABASE_URL}/functions/v1/ops`).replace(/\/+$/, "");
const TOKEN = "sundays.checkin.token";
const PENDING = "sundays.checkin.pending";

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

export const token = () => get(TOKEN);
export const setToken = (t: string | null) => put(TOKEN, t);

export class CheckinError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const t = auth ? token() : null;
  const res = await fetch(`${BASE}${path}`, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new CheckinError(0, "Can’t reach Sundays. Check your connection."); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) setToken(null);
    throw new CheckinError(res.status, data?.error ?? "Something went wrong", data?.status);
  }
  return data as T;
}

export const CheckinApi = {
  me: () => call<CheckinMe>("GET", "/checkin/me"),
  /** Last week's and upcoming services, or every service on one day ("YYYY-MM-DD"). */
  services: (date?: string) => call<CheckinServices>("GET", `/checkin/services${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  plan: (st: string, plan: string) => call<CheckinPlanData>("GET", `/checkin/plan?st=${encodeURIComponent(st)}&plan=${encodeURIComponent(plan)}`),
  check: (st: string, plan: string, personId: string, undo = false) =>
    call<{ ok: true; services?: number; teams?: number; undone?: number }>("POST", "/checkin/check", { st, plan, personId, undo }),
  /** Service types, teams and events by name; each event's areas come from `locations`. */
  setup: () => call<CheckinSetup>("GET", "/checkin/setup?lazy=1"),
  locations: (eventId: string) => call<{ locations: CheckinLocation[] }>("GET", `/checkin/setup/locations?event=${encodeURIComponent(eventId)}`),
  saveSettings: (c: CheckinConfig) => call<CheckinConfig>("PUT", "/checkin/settings", c),
  signOut: async () => { await call("POST", "/checkin/signout").catch(() => null); setToken(null); },
};

/* ───────────── Signing in with Planning Center ───────────── */

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * The check-in address (sundays-checkin.vercel.app; checkin.localhost when testing). Vercel serves
 * the site's own front page there before any rewrite, so pages check the address themselves.
 */
export const isCheckinHost = () => /^(sundays-checkin\.|checkin\.)/.test(location.hostname);

/** Where Planning Center comes back to: /callback on the check-in address, else /checkin/callback. */
export function redirectUri() {
  return `${location.origin}${isCheckinHost() ? "/callback" : "/checkin/callback"}`;
}

export async function startSignIn() {
  const cfg = await call<{ clientId: string; authorizeUrl: string; scope: string }>("GET", "/checkin/config", undefined, false);
  const verifier = random(48);
  const state = random(24);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirect = redirectUri();
  put(PENDING, JSON.stringify({ state, verifier, redirect, at: Date.now() }));
  const u = new URL(cfg.authorizeUrl);
  u.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: redirect, response_type: "code", scope: cfg.scope, state,
    code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  location.assign(u.toString());
}

type Pending = { state: string; verifier: string; redirect: string; at: number };
export const pending = (): Pending | null => {
  try { const p = JSON.parse(get(PENDING) ?? "null") as Pending | null; return p && Date.now() - p.at < 10 * 60_000 ? p : null; } catch { return null; }
};
export const clearPending = () => put(PENDING, null);

/**
 * Back from Planning Center. If this browser started the sign-in, finish it here. If not (an
 * iPhone home-screen app opened it in a separate browser view), leave the code for the app to
 * claim and say so.
 */
export async function finishSignIn(code: string, state: string): Promise<"signed-in" | "handed-off"> {
  const p = pending();
  if (p && p.state === state) {
    // Finished either way: a refusal (no access, not connected) must not leave the app waiting.
    const r = await call<{ token: string; me: CheckinMe }>("POST", "/checkin/session", { code, verifier: p.verifier, redirectUri: p.redirect }, false)
      .finally(clearPending);
    setToken(r.token);
    return "signed-in";
  }
  await call("POST", "/checkin/handoff", { state, code, redirectUri: redirectUri() }, false);
  return "handed-off";
}

/** The home-screen app, while a sign-in it started is waiting: has the other view left the code? */
export async function claimSignIn(): Promise<boolean> {
  const p = pending();
  if (!p) return false;
  try {
    const r = await call<{ token: string; me: CheckinMe }>("POST", "/checkin/handoff/claim", { state: p.state, verifier: p.verifier }, false);
    clearPending();
    setToken(r.token);
    return true;
  } catch (e) {
    if (e instanceof CheckinError && e.code === "waiting") return false;
    clearPending();
    throw e;
  }
}

/**
 * One Sundays server for every Sundays app on this Mac (see shared/apps.ts).
 *
 * The app that opened first hosts the server; the others ("guests") show their windows on it. A
 * guest proves it's the same Mac user's Sundays with the engine key (a hash of the key in
 * ~/Library/Application Support/Sundays/key.txt, which only this Mac user can read).
 *
 * Some things only an app itself can do (its own Check for Updates, Preferences in its own
 * window). The host does them directly; a guest picks up requests for it
 * here (a long poll) and answers them, so the screens don't care which app hosts the server.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTIVE_APP_IDS, APPS, type AppId } from "../../../shared/apps.js";
import type { UpdateBridge } from "../../../shared/updates.js";
import { config } from "../config.js";

/** What an app does for its own windows. */
export interface AppBridge {
  updates?: UpdateBridge;
  prefs?: (section: string) => void;
}
export type AppMethod = "updates.status" | "updates.check" | "updates.install" | "prefs.open";

/** sha256 of the engine key, what guests send as X-Sundays-Engine. */
export const engineToken = (key = config.tokenKey) => crypto.createHash("sha256").update(`sundays-engine:${key}`).digest("hex");
export function engineAuthorized(header: string | undefined): boolean {
  if (!config.tokenKey || !header) return false;
  const a = Buffer.from(engineToken()), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── Apps in this process (the host) ── */

let hostApp: AppId = "sundays";
const local = new Map<AppId, AppBridge>();
/** The host registers what it can do (desktop/src/main.ts). */
export function registerLocalApp(id: AppId, b: AppBridge) { hostApp = id; local.set(id, { ...local.get(id), ...b }); }
export const engineHost = () => hostApp;

/* ── Guests (long poll) ── */

interface Call { id: string; method: AppMethod; args: unknown }
interface Guest {
  queue: Call[];
  wake: (() => void) | null;
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  seen: number;
  version: string | null;
}
const guests = new Map<AppId, Guest>();
const ALIVE_MS = 45_000;
const alive = (g: Guest | undefined): g is Guest => Boolean(g && Date.now() - g.seen < ALIVE_MS);

function guest(id: AppId): Guest {
  let g = guests.get(id);
  if (!g) { g = { queue: [], wake: null, pending: new Map(), seen: 0, version: null }; guests.set(id, g); }
  return g;
}

/** A guest app asks for its next requests (answers within 25 s, empty if there were none). */
export async function nextCalls(id: AppId, version: string | null): Promise<Call[]> {
  const g = guest(id);
  g.seen = Date.now();
  g.version = version;
  if (!g.queue.length) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { g.wake = null; resolve(); }, 25_000);
      t.unref?.();
      g.wake = () => { clearTimeout(t); g.wake = null; resolve(); };
    });
  }
  g.seen = Date.now();
  return g.queue.splice(0);
}

export function callResult(id: AppId, r: { id: string; ok: boolean; value?: unknown; error?: string }) {
  const g = guests.get(id);
  const p = g?.pending.get(r.id);
  if (!g || !p) return;
  g.pending.delete(r.id);
  clearTimeout(p.timer);
  if (r.ok) p.resolve(r.value); else p.reject(new Error(r.error ?? "That app couldn’t do it."));
}

/** Leaving (the guest quit): drop what it was asked. */
export function guestGone(id: AppId) {
  const g = guests.get(id);
  if (!g) return;
  for (const p of g.pending.values()) { clearTimeout(p.timer); p.reject(new Error("That app was closed.")); }
  guests.delete(id);
}

function remote(id: AppId, method: AppMethod, args: unknown): Promise<unknown> {
  const g = guest(id);
  const call: Call = { id: crypto.randomUUID(), method, args };
  const ms = method === "updates.install" ? 15 * 60_000 : 20_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { g.pending.delete(call.id); reject(new Error("That app didn’t answer.")); }, ms);
    g.pending.set(call.id, { resolve, reject, timer });
    g.queue.push(call);
    g.wake?.();
  });
}

async function onLocal(b: AppBridge, method: AppMethod, args: unknown): Promise<unknown> {
  switch (method) {
    case "updates.status": return b.updates ? b.updates.status() : undefined;
    case "updates.check": return b.updates ? b.updates.check() : undefined;
    case "updates.install": return b.updates ? b.updates.install() : undefined;
    case "prefs.open": b.prefs?.(String(args ?? "")); return b.prefs ? { ok: true } : undefined;
  }
}

/** Which app answers for a window of `app` (itself if it's open, else the host). Null in a browser. */
function target(app: AppId | null): { local: AppBridge } | { guest: AppId } | null {
  if (app && local.has(app)) return { local: local.get(app)! };
  if (app && alive(guests.get(app))) return { guest: app };
  const h = local.get(hostApp);
  return h ? { local: h } : null;
}

/** Ask the app a window belongs to (or the host) to do something. Undefined when no app can. */
export async function appCall(app: AppId | null, method: AppMethod, args?: unknown): Promise<unknown> {
  const t = target(app);
  if (!t) return undefined;
  return "local" in t ? onLocal(t.local, method, args) : remote(t.guest, method, args);
}
/** Is there an app that can do this (for "only in the Mac app" checks)? */
export function appCan(app: AppId | null, what: keyof AppBridge): boolean {
  const t = target(app);
  if (!t) return false;
  return "local" in t ? Boolean(t.local[what]) : true;
}

/* ── The other Sundays apps on this Mac ── */

function bundlePath(id: AppId): string | null {
  const name = `${APPS[id].name}.app`;
  for (const dir of ["/Applications", path.join(os.homedir(), "Applications")]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface AppListing { id: AppId; name: string; short: string; blurb: string; installed: boolean; running: boolean; current: boolean }
export function appListing(current: AppId | null): AppListing[] {
  const mac = process.platform === "darwin";
  return ACTIVE_APP_IDS.map((id) => {
    const running = local.has(id) || alive(guests.get(id));
    return {
      id, name: APPS[id].name, short: APPS[id].short, blurb: APPS[id].blurb,
      installed: running || (mac && Boolean(bundlePath(id))), running, current: id === current,
    };
  });
}

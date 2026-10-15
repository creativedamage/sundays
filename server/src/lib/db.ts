/**
 * Sundays storage — a small JSON file on the Mac, no database engine to install or break.
 *
 * Location: <DATA_DIR>/cool-services.json (in the Mac app that's
 * ~/Library/Application Support/Sundays/). Writes are debounced and atomic
 * (write temp file → rename), so a crash can't leave a half-written file.
 *
 * Planning Center is the source of truth for people, workflows and plans; this file only holds
 * what belongs to the app itself: who has signed in, their encrypted Planning Center tokens,
 * sessions, staff-only notes and an action history.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { KEY_ROOTS, TUNING_EXTRAS } from "../../../shared/types.js";
import type { AppSettings, MicAssignment, MicSetup, Ministry, MinistryPaging, PagingConfig } from "../../../shared/types.js";

/* ───────────── Models ───────────── */

export interface StaffUser {
  id: string;
  pcoPersonId: string;
  pcoOrgId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string;
}

/** Planning Center sign-in tokens, encrypted (see lib/crypto.ts). */
export interface OAuthToken {
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  scope: string;
  expiresAt: string;
  updatedAt: string;
}

export interface Session {
  id: string; // value of the cc_sid cookie
  userId: string;
  demo: boolean; // "Explore with sample data"
  createdAt: string;
  expiresAt: string;
}

/** Staff-only notes that never leave the app. */
export interface InternalNote {
  id: string;
  pcoPersonId: string;
  pcoCardId: string | null;
  body: string;
  authorId: string;
  createdAt: string;
}

/** Who did what, through the app. */
export interface AuditEntry {
  id: string;
  actorId: string;
  action: string; // card.move | card.note | card.email | plan.schedule | plan.status | plan.remove
  targetType: string;
  targetId: string;
  meta: unknown;
  createdAt: string;
}

interface Data {
  version: 1;
  users: StaffUser[];
  tokens: OAuthToken[];
  sessions: Session[];
  notes: InternalNote[];
  audit: AuditEntry[];
  /** Mics & packs: this Mac's receivers and channels. */
  micSetup: MicSetup | null;
  /** Mic assignments per plan. */
  planMics: Record<string, { assignments: MicAssignment[] }>;
  /** "<kind>:<personId>" → channelId they used most recently (one per mic kind). */
  micUsual: Record<string, string>;
  settings: AppSettings | null;
  /** Parent paging (ProPresenter) and the Kids/Nursery iPad pages. */
  paging: PagingStored | null;
  /** Other ProPresenter computers to watch/control, dashboard layout, Smaart. */
  extras: Record<string, unknown>;
}

export interface PagingStored {
  config: Omit<PagingConfig, "ministries"> & { ministries: Record<Ministry, Omit<MinistryPaging, "hasPin">> };
  /** scrypt hashes; `version` changes with every new PIN, which signs the iPads out. */
  pins: Partial<Record<Ministry, { hash: string; salt: string; version: number }>>;
  kioskSessions: { token: string; ministry: Ministry; pinVersion: number; createdAt: string; lastSeen: string }[];
  /** Whose Planning Center access the iPad pages use (the person who set them up). */
  owner: { userId: string; demo: boolean } | null;
  /** FOH companion computers linked to this one (token hashes only). */
  companions?: { id: string; name: string; tokenHash: string; pairedAt: string; lastSeen: string | null }[];
}

/* ───────────── File handling ───────────── */

const empty = (): Data => ({ version: 1, users: [], tokens: [], sessions: [], notes: [], audit: [], micSetup: null, planMics: {}, micUsual: {}, settings: null, paging: null, extras: {} });
const file = () => path.resolve(process.cwd(), config.dataDir, "cool-services.json");
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

let data: Data | null = null;
let timer: NodeJS.Timeout | null = null;

function load(): Data {
  if (data) return data;
  try {
    data = { ...empty(), ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      // Unreadable file: keep a copy for recovery and start fresh rather than refusing to open.
      try { fs.copyFileSync(file(), `${file()}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
    data = empty();
  }
  return data!;
}

function save() {
  if (timer) return;
  timer = setTimeout(flush, 200);
}

/** Write now (also called on shutdown). */
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!data) return;
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/* ───────────── Repositories ───────────── */

export const users = {
  get: (id: string) => load().users.find((u) => u.id === id) ?? null,
  list: (): StaffUser[] => [...load().users],
  /** Create or refresh the record for a Planning Center person. */
  upsert(p: Omit<StaffUser, "id" | "createdAt" | "lastLoginAt">): StaffUser {
    const d = load();
    let u = d.users.find((x) => x.pcoPersonId === p.pcoPersonId);
    if (u) Object.assign(u, p, { lastLoginAt: now() });
    else d.users.push((u = { ...p, id: newId(), createdAt: now(), lastLoginAt: now() }));
    save();
    return u;
  },
};

export const tokens = {
  get: (userId: string) => load().tokens.find((t) => t.userId === userId) ?? null,
  /** Planning Center no longer accepts this sign-in: forget it, so the person is asked to sign in. */
  remove(userId: string) {
    const d = load();
    d.tokens = d.tokens.filter((x) => x.userId !== userId);
    save();
  },
  save(t: Omit<OAuthToken, "updatedAt">) {
    const d = load();
    d.tokens = d.tokens.filter((x) => x.userId !== t.userId);
    d.tokens.push({ ...t, updatedAt: now() });
    save();
  },
};

export const sessions = {
  create(s: Omit<Session, "createdAt">): Session {
    const d = load();
    const row = { ...s, createdAt: now() };
    const nowIso = now();
    d.sessions = d.sessions.filter((x) => x.expiresAt > nowIso); // prune expired
    d.sessions.push(row);
    save();
    return row;
  },
  get(id: string): Session | null {
    const s = load().sessions.find((x) => x.id === id);
    return s && s.expiresAt > now() ? s : null;
  },
  /** The session signed in most recently (another Sundays app on this Mac starts as that person). */
  newest(): Session | null {
    const n = now();
    return load().sessions.filter((x) => x.expiresAt > n).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },
  delete(id: string) {
    const d = load();
    d.sessions = d.sessions.filter((x) => x.id !== id);
    save();
  },
  deleteForUser(userId: string) {
    const d = load();
    d.sessions = d.sessions.filter((x) => x.userId !== userId);
    save();
  },
};

export const notes = {
  forPerson: (pcoPersonId: string) =>
    load().notes.filter((n) => n.pcoPersonId === pcoPersonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  create(n: Omit<InternalNote, "id" | "createdAt">): InternalNote {
    const row = { ...n, id: newId(), createdAt: now() };
    load().notes.push(row);
    save();
    return row;
  },
};

export async function audit(actorId: string, action: string, targetType: string, targetId: string, meta?: unknown) {
  const d = load();
  d.audit.push({ id: newId(), actorId, action, targetType, targetId, meta: meta ?? null, createdAt: now() });
  if (d.audit.length > 5000) d.audit = d.audit.slice(-5000); // keep the file small
  save();
}

/* ───────────── Settings ───────────── */

const defaultSettings = (): AppSettings => ({
  theme: "dark", logo: null, startView: { kind: "workflows" }, serviceView: {},
  // Nothing matched until someone enters their own SuperRack snapshot numbers.
  waves: {
    enabled: false, output: null, channel: 1, numbering: "externalId", hideFromTuning: ["Vocal Warm Ups"],
    snapshots: Object.fromEntries([...KEY_ROOTS, ...TUNING_EXTRAS.map((x) => x.id)].map((k) => [k, null])),
  },
});
const settingsListeners = new Set<(s: AppSettings) => void>();

export const settings = {
  get: (): AppSettings => {
    const d = defaultSettings();
    const s = load().settings ?? {};
    const w = (s as Partial<AppSettings>).waves;
    const { ndi: _old, ...rest } = s as Partial<AppSettings> & { ndi?: unknown }; // NDI was removed in 1.13
    return { ...d, ...rest, waves: { ...d.waves, ...(w ?? {}), snapshots: { ...d.waves.snapshots, ...(w?.snapshots ?? {}) } } };
  },
  save(patch: Partial<Omit<AppSettings, "waves">> & { waves?: Partial<AppSettings["waves"]> }): AppSettings {
    const cur = settings.get();
    const next = {
      ...cur, ...patch,
      waves: { ...cur.waves, ...(patch.waves ?? {}), snapshots: { ...cur.waves.snapshots, ...(patch.waves?.snapshots ?? {}) } },
    };
    load().settings = next;
    save();
    for (const fn of settingsListeners) fn(next);
    return next;
  },
  /** Listeners for settings changes. */
  onChange(fn: (s: AppSettings) => void) {
    settingsListeners.add(fn);
    return () => settingsListeners.delete(fn);
  },
};

/* ───────────── Paging ───────────── */

export const pagingStore = {
  get: (): PagingStored | null => load().paging,
  set(v: PagingStored) {
    load().paging = v;
    save();
  },
};

/** Settings sync (lib/sync.ts) reads and replaces these sections whole. */
type SyncField = "micSetup" | "planMics" | "micUsual";
export const syncRaw = {
  get: (k: SyncField): unknown => load()[k] ?? null,
  set(k: SyncField, v: unknown) { (load() as unknown as Record<string, unknown>)[k] = v; save(); },
};

/** Small keyed settings that don't need their own model (ProPresenter computers, dashboard, Smaart). */
export const extras = {
  get<T>(key: string, fallback: T): T { return ((load().extras ?? {})[key] as T | undefined) ?? fallback; },
  set(key: string, value: unknown) { const d = load(); d.extras = { ...(d.extras ?? {}), [key]: value }; save(); },
};

/** Uploaded files (mic board backgrounds and logo) in <DATA_DIR>/files. */
export const files = {
  dir: () => path.resolve(process.cwd(), config.dataDir, "files"),
  save(buf: Buffer, ext: "png" | "jpg" | "webp"): string {
    const id = `${newId()}.${ext}`;
    fs.mkdirSync(files.dir(), { recursive: true });
    fs.writeFileSync(path.join(files.dir(), id), buf, { mode: 0o600 });
    return id;
  },
  /** A file from another Mac, under the id it has there (settings sync). */
  saveAs(id: string, buf: Buffer) {
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(id)) return;
    fs.mkdirSync(files.dir(), { recursive: true });
    fs.writeFileSync(path.join(files.dir(), id), buf, { mode: 0o600 });
  },
  path(id: string): string | null {
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(id)) return null;
    const p = path.join(files.dir(), id);
    return fs.existsSync(p) ? p : null;
  },
};

/* ───────────── Mics & packs ───────────── */

/** A starting point that matches a typical worship setup; edited in the app's "Set up mics". */
const starterMics = (): MicSetup => ({
  receivers: [{ id: "rx-a", name: "Rack A", model: "ULXD", ip: "", channels: 4 }],
  channels: [
    { id: "ch-vox1", label: "Vox 1", kind: "vocal", receiverId: "rx-a", channel: 1, positions: ["Worship Leader"] },
    { id: "ch-vox2", label: "Vox 2", kind: "vocal", receiverId: "rx-a", channel: 2, positions: ["Vocals"] },
    { id: "ch-vox3", label: "Vox 3", kind: "vocal", receiverId: "rx-a", channel: 3, positions: ["Vocals"] },
    { id: "ch-vox4", label: "Vox 4", kind: "vocal", receiverId: "rx-a", channel: 4, positions: ["Vocals"] },
    { id: "ch-ag", label: "AG Pack", kind: "pack", receiverId: null, channel: 1, positions: ["Acoustic Guitar"] },
  ],
});

export const mics = {
  setup: (): MicSetup => load().micSetup ?? starterMics(),
  saveSetup(m: MicSetup) {
    load().micSetup = m;
    save();
  },
  plan(planId: string) {
    const d = load();
    return { assignments: d.planMics[planId]?.assignments ?? [], usual: d.micUsual };
  },
  savePlan(planId: string, assignments: MicAssignment[]) {
    const d = load();
    d.planMics[planId] = { assignments };
    const kinds = new Map((d.micSetup ?? starterMics()).channels.map((c) => [c.id, c.kind]));
    for (const a of assignments) d.micUsual[`${kinds.get(a.channelId) ?? "other"}:${a.personId}`] = a.channelId; // remember "their" mic
    save();
  },
};

/* ───────────── In-memory cache of Planning Center responses ───────────── */

const mem = new Map<string, { value: unknown; fetched: number; fresh: number }>();
const inflight = new Map<string, Promise<unknown>>();

/*
 * The cache is also kept on disk (cache.json), so reopening the app shows the last-seen boards
 * and services instantly while fresh data loads in the background.
 */
const cacheFile = () => path.resolve(process.cwd(), config.dataDir, "cache.json");
let cacheLoaded = false;
let cacheTimer: NodeJS.Timeout | null = null;
function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const rows = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as [string, { value: unknown; fetched: number; fresh: number }][];
    const weekAgo = Date.now() - 7 * 864e5;
    for (const [k, v] of rows) if (v.fetched > weekAgo) mem.set(k, v);
  } catch { /* first run or unreadable: start empty */ }
}
function saveCache() {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    try {
      const f = cacheFile();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify([...mem.entries()]), { mode: 0o600 });
      fs.renameSync(`${f}.tmp`, f);
    } catch { /* cache is optional */ }
  }, 2000);
}

/** Run fn once per key at a time: concurrent callers share the same request. */
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    loadCache();
    const hit = mem.get(key);
    if (!hit || hit.fetched + hit.fresh * 1000 < Date.now()) return null;
    return hit.value as T;
  },
  async set(key: string, value: unknown, ttlSec: number) {
    mem.set(key, { value, fetched: Date.now(), fresh: ttlSec });
    saveCache();
  },
  /** Fresh for ttlSec; after that, fetch again (concurrent callers share one request). */
  async wrap<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    const hit = await cache.get<T>(key);
    if (hit !== null) return hit;
    return once(key, async () => {
      const fresh = await fn();
      await cache.set(key, fresh, ttlSec);
      return fresh;
    });
  },
  /**
   * Stale-while-revalidate: answer instantly from memory, and if the copy is older than freshSec,
   * refresh it in the background for next time. Copies older than maxStaleSec are refetched first.
   */
  async swr<T>(key: string, freshSec: number, fn: () => Promise<T>, maxStaleSec = 7 * 86400): Promise<T> {
    loadCache();
    const hit = mem.get(key);
    const age = hit ? (Date.now() - hit.fetched) / 1000 : Infinity;
    const load = () => once(key, async () => {
      const v = await fn();
      mem.set(key, { value: v, fetched: Date.now(), fresh: freshSec });
      saveCache();
      return v;
    });
    if (hit && age <= freshSec) return hit.value as T;
    if (hit && age <= maxStaleSec) {
      load().catch(() => {}); // refresh quietly; keep serving the stale copy on failure
      return hit.value as T;
    }
    return load();
  },
  /** Forget every key that starts with `prefix`. */
  async bust(prefix: string) {
    for (const k of mem.keys()) if (k.startsWith(prefix)) mem.delete(k);
    saveCache();
  },
};

/* ───────────── Slow-request log ───────────── */

/** Planning Center calls slower than 1s are noted in cool-services.log, to help diagnose slowness. */
/** A line in cool-services.log (sign-in problems etc.; never tokens or personal data). */
export function logEvent(message: string) {
  writeLog(`${new Date().toISOString()} ${message}\n`);
}

export function logSlow(method: string, url: string, ms: number, status: number) {
  if (ms < 1000) return;
  writeLog(`${new Date().toISOString()} ${method} ${url.replace(/^https?:\/\/[^/]+/, "")} ${status} ${ms}ms\n`);
}

function writeLog(line: string) {
  try {
    const f = path.resolve(process.cwd(), config.dataDir, "cool-services.log");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 1_000_000) fs.renameSync(f, `${f}.old`);
    fs.appendFileSync(f, line);
  } catch { /* logging is optional */ }
}

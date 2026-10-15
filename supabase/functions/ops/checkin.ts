/**
 * Team check-ins on the website (sundays-checkin.vercel.app), under /checkin/… in the ops function.
 *
 * Sign-in is each person's own Planning Center account (the page does PKCE; the code is exchanged
 * here so the tokens never live on the phone). Every Planning Center call is made with that
 * person's token, so they see exactly what Planning Center lets them see. Sundays adds whether
 * they may use check-ins at all (ops.users.checkin_level, see lib/checkin.ts), matched by the
 * email addresses on their Planning Center profile in the organization linked to their Planning
 * Center organization.
 *
 *   POST /checkin/session   {code, verifier, redirectUri} → {token, me}
 *   POST /checkin/handoff · /checkin/handoff/claim   (iPhone home-screen apps, see handoff below)
 *   GET  /checkin/me · POST /checkin/signout
 *   GET  /checkin/services[?date=YYYY-MM-DD] → last week's and upcoming services, or that day's
 *   GET  /checkin/plan?st=&plan=          → teams, who's in, ministries
 *   POST /checkin/check  {st, plan, personId, undo?}
 *   GET  /checkin/setup · GET /checkin/setup/locations?event= · PUT /checkin/settings   (Manage)
 *
 * Planning Center's Check-Ins API can't create check-ins, so "Check in" here is Sundays' own
 * record (ops.staff_checkins), shown next to real Check-Ins scans, as on the Mac.
 */
import { z, ZodError } from "zod";
import { BLOCKED_STATUSES, type OrgStatus } from "./lib/billing.ts";
import { checkinAtLeast, checkinLevelFor, type CheckinConfig, type CheckinLevel, type CheckinMe, type CheckinPerson, type CheckinPlanData, type CheckinService, type CheckinSetup, type CheckinTeam } from "./lib/checkin.ts";
import { env, HttpError, inOrg, raw, sql } from "./db.ts";
import { loadOrg } from "./auth.ts";

const PCO = (env("PCO_API_BASE") ?? "https://api.planningcenteronline.com").replace(/\/+$/, "");
/** Sundays' public Planning Center app (no secret: PKCE). The same app the Mac signs in with. */
export const PCO_CLIENT_ID = env("PCO_CLIENT_ID") ?? "e7343566b677dacdb16bddea2d86dbbced0228a82cef10ca135b7c4f78d84f35";
const UA = "Sundays Check-ins";
const S = "/services/v2";

/* ───────────── Tokens at rest (AES-GCM, key "checkin_key" in public.app_secrets) ───────────── */

let keyP: Promise<CryptoKey> | null = null;
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function key(): Promise<CryptoKey> {
  return (keyP ??= (async () => {
    let [row] = await raw`select value from public.app_secrets where name = 'checkin_key'`;
    if (!row) {
      await raw`insert into public.app_secrets (name, value) values ('checkin_key', ${b64(crypto.getRandomValues(new Uint8Array(32)))}) on conflict (name) do nothing`;
      [row] = await raw`select value from public.app_secrets where name = 'checkin_key'`;
    }
    return crypto.subtle.importKey("raw", unb64(row.value), "AES-GCM", false, ["encrypt", "decrypt"]);
  })().catch((e) => { keyP = null; throw e; }));
}
async function seal(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain))))}`;
}
async function unseal(sealed: string) {
  const [iv, ct] = sealed.split(".").map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct));
}
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newToken = () => `ck_${b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

/* ───────────── Planning Center ───────────── */

type Flat = Record<string, any> & { id: string; rel: Record<string, any> };
type Doc = { data: any; included?: any[]; links?: { next?: string } };
function flatten(doc: Doc): Flat[] {
  const index = new Map<string, any>();
  for (const inc of doc.included ?? []) index.set(`${inc.type}:${inc.id}`, inc);
  const shallow = (r: any): Flat => ({ id: r.id, type: r.type, ...r.attributes, rel: {} });
  const data = Array.isArray(doc.data) ? doc.data : [doc.data];
  return data.filter(Boolean).map((r: any) => {
    const f = shallow(r);
    for (const [name, rel] of Object.entries<any>(r.relationships ?? {})) {
      const d = rel?.data;
      if (!d) continue;
      const look = (ref: any) => { const hit = index.get(`${ref.type}:${ref.id}`); return hit ? shallow(hit) : { id: ref.id, type: ref.type, rel: {} }; };
      f.rel[name] = Array.isArray(d) ? d.map(look) : look(d);
    }
    return f;
  });
}

interface Tokens { access: string; refresh: string | null; expiresAt: Date }
async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${PCO}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ ...body, client_id: PCO_CLIENT_ID }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 400 || r.status === 401 ? 401 : 502, j.error_description ?? "Planning Center didn’t accept the sign-in. Try again.", { status: "signed-out" });
  return { access: j.access_token, refresh: j.refresh_token ?? null, expiresAt: new Date(Date.now() + Number(j.expires_in ?? 7200) * 1000) };
}

class PcoError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Planning Center as one signed-in person. Refreshes their token when it's about to run out. */
class Pco {
  constructor(private tokens: Tokens, private onRefresh?: (t: Tokens) => Promise<void>) {}
  private async access(force = false) {
    if (force || this.tokens.expiresAt.getTime() - Date.now() < 60_000) {
      if (!this.tokens.refresh) throw new HttpError(401, "Your Planning Center sign-in ran out. Sign in again.", { status: "signed-out" });
      this.tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: this.tokens.refresh });
      await this.onRefresh?.(this.tokens);
    }
    return this.tokens.access;
  }
  async doc(path: string, tries = 0): Promise<Doc> {
    const url = path.startsWith("http") ? path : `${PCO}${path}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await this.access(tries === 1)}`, "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 401 && tries === 0) return this.doc(path, 1); // expired early: refresh once
    if (r.status === 401) throw new HttpError(401, "Your Planning Center sign-in ran out. Sign in again.", { status: "signed-out" });
    if (r.status === 429 && tries < 3) {
      await new Promise((res) => setTimeout(res, Math.min(8, Number(r.headers.get("retry-after") ?? 2)) * 1000));
      return this.doc(path, tries + 2);
    }
    if (!r.ok) throw new PcoError(r.status, `Planning Center answered ${r.status}`);
    return r.json();
  }
  async get(path: string): Promise<Flat> { return flatten(await this.doc(path))[0]; }
  async list(path: string, maxPages = 10): Promise<Flat[]> {
    const out: Flat[] = [];
    let next: string | undefined = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    for (let i = 0; next && i < maxPages; i++) {
      const d: Doc = await this.doc(next);
      out.push(...flatten(d));
      next = d.links?.next;
    }
    return out;
  }
}

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
  return out;
}

/** A small per-instance memo (Edge Function instances are reused for a while). */
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
function cached<T>(k: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn();
  memo.set(k, { at: Date.now(), p });
  p.catch(() => memo.delete(k));
  if (memo.size > 2000) for (const [mk, v] of memo) if (Date.now() - v.at > 600_000) memo.delete(mk);
  return p;
}

/* ───────────── Sessions ───────────── */

interface Session {
  hash: string; orgId: string; userId: string; pcoPersonId: string; pcoOrgId: string; name: string; avatarUrl: string | null;
  level: CheckinLevel; church: string; logo: string | null; timeZone: string; pco: Pco;
}

const NO_ACCESS = "You don’t have team check-ins in Sundays yet. Ask your church’s Sundays admin to give you check-in access (Operations → Settings → People).";

/** The org row, its PCO time zone (kept on the session) and the person's membership → a Session. */
async function sessionFrom(token: string): Promise<Session> {
  const hash = await sha256(token);
  const [s] = await raw`select s.*, u.active, u.role, u.synced_role, u.checkin_level, o.status as org_status, o.name as org_name, o.pco_org_name
    from ops.checkin_sessions s join ops.users u on u.id = s.user_id join ops.organization o on o.id = s.org_id where s.token_hash = ${hash}`;
  if (!s) throw new HttpError(401, "Sign in with Planning Center.", { status: "signed-out" });
  if (BLOCKED_STATUSES.includes(s.orgStatus as OrgStatus)) throw new HttpError(403, `${s.orgName ?? "Your church"}’s Sundays is ${String(s.orgStatus).toLowerCase()}.`, { status: "suspended" });
  const level = checkinLevelFor({ role: s.role, syncedRole: s.syncedRole, checkinLevel: s.checkinLevel });
  if (!s.active || level === "NONE") {
    await raw`delete from ops.checkin_sessions where token_hash = ${hash}`;
    throw new HttpError(403, NO_ACCESS, { status: "no-access" });
  }
  if (Date.now() - new Date(s.lastSeenAt).getTime() > 3600_000) await raw`update ops.checkin_sessions set last_seen_at = now() where token_hash = ${hash}`;
  const tokens: Tokens = { access: await unseal(s.accessEnc), refresh: s.refreshEnc ? await unseal(s.refreshEnc) : null, expiresAt: new Date(s.accessExpiresAt) };
  const pco = new Pco(tokens, async (t) => {
    await raw`update ops.checkin_sessions set access_enc = ${await seal(t.access)}, refresh_enc = ${t.refresh ? await seal(t.refresh) : null}, access_expires_at = ${t.expiresAt} where token_hash = ${hash}`;
  });
  const org = await cached(`pcoorg:${s.pcoOrgId}:${s.pcoPersonId}`, 3600_000, () => pco.get("/people/v2"));
  return {
    hash, orgId: s.orgId, userId: s.userId, pcoPersonId: s.pcoPersonId, pcoOrgId: s.pcoOrgId, name: s.name, avatarUrl: s.avatarUrl,
    level, church: s.orgName || org.name || "Your church", logo: org.avatar_url ?? null, timeZone: org.time_zone || "America/Chicago", pco,
  };
}

const meOf = (s: Session): CheckinMe => ({ name: s.name, avatarUrl: s.avatarUrl, level: s.level, church: s.church, logo: s.logo, timeZone: s.timeZone });

/**
 * Sign-in: exchange the code, read who they are and their Planning Center organization, find the
 * Sundays organization linked to it (linking it on a System admin's first sign-in), then their
 * membership by email.
 */
const SignIn = z.object({ code: z.string().min(4).max(400), verifier: z.string().min(43).max(128), redirectUri: z.string().url().max(300) });
async function signIn(body: unknown) {
  const b = SignIn.parse(body);
  const tokens = await tokenRequest({ grant_type: "authorization_code", code: b.code, code_verifier: b.verifier, redirect_uri: b.redirectUri });
  const pco = new Pco(tokens);
  const [me, porg] = await Promise.all([pco.get("/people/v2/me?include=emails"), pco.get("/people/v2")]);
  const emails = [...new Set((me.rel.emails ?? []).map((e: Flat) => String(e.address ?? "").trim().toLowerCase()).filter(Boolean))] as string[];
  const name = me.name || `${me.first_name ?? ""} ${me.last_name ?? ""}`.trim() || "Someone";

  let [o] = await raw`select id, name from ops.organization where pco_org_id = ${porg.id}`;
  if (!o) {
    // Not linked yet: a System admin of exactly one unlinked organization links it by signing in.
    const cands = emails.length ? await raw`select distinct o.id, o.name from ops.organization o join ops.users u on u.org_id = o.id
      where o.pco_org_id is null and u.active and u.source <> 'PLATFORM' and (u.role = 'ADMIN' or u.synced_role = 'ADMIN') and u.email = any(${emails})` : [];
    if (cands.length !== 1) {
      throw new HttpError(403, cands.length > 1
        ? "You’re a System admin of more than one Sundays organization. Ask Sundays support to connect the right one to Planning Center."
        : `${porg.name ?? "Your church"} isn’t connected to Sundays yet. A Sundays System admin connects it by signing in here once with Planning Center.`, { status: "not-linked" });
    }
    o = cands[0];
    await raw`update ops.organization set pco_org_id = ${porg.id}, pco_org_name = ${porg.name ?? null}, updated_at = now() where id = ${o.id} and pco_org_id is null`;
    await raw`insert into ops.activity_log (org_id, actor_label, action, detail, area) values (${o.id}, ${name}, 'Connected Planning Center', ${`Team check-ins: ${porg.name ?? porg.id}`}, 'ADMIN')`.catch(() => {});
  }
  const loaded = await loadOrg(o.id);
  if (!loaded) throw new HttpError(404, "Organization not found");
  if (BLOCKED_STATUSES.includes(loaded.row.status as OrgStatus)) throw new HttpError(403, `${loaded.row.name ?? "Your church"}’s Sundays is ${String(loaded.row.status).toLowerCase()}.`, { status: "suspended" });

  const members = emails.length ? await raw`select * from ops.users where org_id = ${o.id} and active and source <> 'PLATFORM' and email = any(${emails})` : [];
  const best = members.map((u) => ({ u, level: checkinLevelFor(u as never) })).sort((a, b) => ["NONE", "VIEW", "CHECKIN", "MANAGER"].indexOf(b.level) - ["NONE", "VIEW", "CHECKIN", "MANAGER"].indexOf(a.level))[0];
  if (!best || best.level === "NONE") {
    throw new HttpError(403, `${NO_ACCESS}${emails.length ? ` They’ll need to add ${emails[0]}.` : " Add an email address to your Planning Center profile first."}`, { status: "no-access" });
  }
  const token = newToken();
  await raw`insert into ops.checkin_sessions ${raw({
    tokenHash: await sha256(token), orgId: o.id, userId: best.u.id, pcoPersonId: me.id, pcoOrgId: porg.id, name, avatarUrl: me.avatar ?? null,
    accessEnc: await seal(tokens.access), refreshEnc: tokens.refresh ? await seal(tokens.refresh) : null, accessExpiresAt: tokens.expiresAt,
  })}`;
  await raw`update ops.users set last_login_at = now() where id = ${best.u.id}`;
  // Sessions nobody has used for 90 days go.
  await raw`delete from ops.checkin_sessions where last_seen_at < now() - interval '90 days'`;
  return { token, me: meOf(await sessionFrom(token)) };
}

/**
 * Handoff. On an iPhone, a check-in app saved to the home screen opens Planning Center's sign-in in
 * a separate browser view with its own storage, so the page Planning Center returns to can't
 * finish signing in (the PKCE verifier stays in the app). That page leaves the code here; the app
 * claims it with the verifier when you switch back. Codes are kept for 10 minutes and are useless
 * without the verifier.
 */
async function handoff(body: unknown) {
  const b = z.object({ state: z.string().min(20).max(200), code: z.string().min(4).max(400), redirectUri: z.string().url().max(300) }).parse(body);
  await raw`delete from ops.checkin_handoffs where created_at < now() - interval '10 minutes'`;
  await raw`insert into ops.checkin_handoffs (state_hash, code, redirect_uri) values (${await sha256(b.state)}, ${b.code}, ${b.redirectUri}) on conflict (state_hash) do nothing`;
  return { ok: true };
}
async function claim(body: unknown) {
  const b = z.object({ state: z.string().min(20).max(200), verifier: z.string().min(43).max(128) }).parse(body);
  const [h] = await raw`delete from ops.checkin_handoffs where state_hash = ${await sha256(b.state)} and created_at > now() - interval '10 minutes' returning code, redirect_uri`;
  if (!h) throw new HttpError(404, "Still waiting for Planning Center.", { status: "waiting" });
  return signIn({ code: h.code, verifier: b.verifier, redirectUri: h.redirectUri });
}

/* ───────────── Dates in the church's time zone ───────────── */

const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** Midnight to midnight of that local day, as instants. */
function dayWindow(iso: string, tz: string) {
  const d = localDay(iso, tz);
  const guess = Date.parse(`${d}T00:00:00Z`);
  // The zone's offset at that time: how far its wall clock is from UTC.
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  const from = guess - off(guess);
  return { from: new Date(from).toISOString(), to: new Date(from + 864e5 - 1).toISOString() };
}

/* ───────────── Services ───────────── */

async function serviceTypes(s: Session) {
  return cached(`st:${s.pcoOrgId}:${s.pcoPersonId}`, 600_000, async () => {
    const [top, folders] = await Promise.all([s.pco.list(`${S}/service_types?order=sequence`, 5), s.pco.list(`${S}/folders`, 5).catch(() => [] as Flat[])]);
    const inFolders = await mapLimit(folders, 3, (f) => s.pco.list(`${S}/folders/${f.id}/service_types?order=sequence`, 5).catch(() => [] as Flat[]));
    const seen = new Set<string>();
    return [...top, ...inFolders.flat()].filter((r) => !r.archived_at && !r.deleted_at && !seen.has(r.id) && Boolean(seen.add(r.id))).map((r) => ({ id: r.id as string, name: (r.name ?? "") as string }));
  });
}

const toService = (t: { id: string; name: string }, p: Flat): CheckinService =>
  ({ id: p.id, serviceTypeId: t.id, serviceTypeName: t.name, title: p.title || p.series_title || p.dates || "", sortDate: p.sort_date as string });
const noPlans = (e: unknown) => (e instanceof PcoError ? [] as Flat[] : Promise.reject(e));

/** Upcoming services. */
async function upcoming(s: Session): Promise<CheckinService[]> {
  return cached(`up:${s.pcoOrgId}:${s.pcoPersonId}`, 60_000, async () => {
    const types = await serviceTypes(s);
    const per = await mapLimit(types, 6, async (t) => {
      const plans = await s.pco.list(`${S}/service_types/${t.id}/plans?filter=future&order=sort_date`, 1).catch(noPlans);
      return plans.slice(0, 5).map((p) => toService(t, p));
    });
    const cutoff = Date.now() - 8 * 3600e3;
    return per.flat().filter((p) => Date.parse(p.sortDate) > cutoff).sort((a, b) => a.sortDate.localeCompare(b.sortDate)).slice(0, 20);
  });
}

/** Services in the last week (so Sunday's are still there on Monday). */
async function recent(s: Session): Promise<CheckinService[]> {
  return cached(`past:${s.pcoOrgId}:${s.pcoPersonId}`, 5 * 60_000, async () => {
    const types = await serviceTypes(s);
    const per = await mapLimit(types, 6, async (t) => {
      const plans = await s.pco.list(`${S}/service_types/${t.id}/plans?filter=past&order=-sort_date`, 1).catch(noPlans);
      return plans.slice(0, 3).map((p) => toService(t, p));
    });
    const since = Date.now() - 7 * 864e5;
    return per.flat().filter((p) => Date.parse(p.sortDate) > since);
  });
}

/** The services list: last week's and upcoming ones, in date order. */
async function serviceList(s: Session): Promise<CheckinService[]> {
  const [past, next] = await Promise.all([recent(s), upcoming(s)]);
  const seen = new Set<string>();
  return [...past, ...next].filter((x) => !seen.has(x.id) && Boolean(seen.add(x.id))).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}

/** Every service on one local day ("YYYY-MM-DD" in the church's time zone), past or future. */
async function servicesOn(s: Session, day: string): Promise<CheckinService[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "Pick a date.");
  return cached(`on:${s.pcoOrgId}:${s.pcoPersonId}:${day}`, 60_000, async () => {
    const types = await serviceTypes(s);
    const after = new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const per = await mapLimit(types, 6, async (t) => {
      const plans = await s.pco.list(`${S}/service_types/${t.id}/plans?filter=after&after=${after}&order=sort_date`, 1).catch(noPlans);
      return plans.slice(0, 8).map((p) => toService(t, p)).filter((p) => p.sortDate && localDay(p.sortDate, s.timeZone) === day);
    });
    return per.flat().sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  });
}

interface Plan { id: string; serviceTypeId: string; sortDate: string; times: { startsAt: string; endsAt: string | null }[]; roster: Flat[]; teamOrder: string[] }
async function plan(s: Session, st: string, planId: string): Promise<Plan> {
  if (!/^\w{1,30}$/.test(st) || !/^\w{1,30}$/.test(planId)) throw new HttpError(400, "Unknown service");
  return cached(`plan:${s.pcoPersonId}:${planId}`, 10_000, async () => {
    const base = `${S}/service_types/${st}/plans/${planId}`;
    const [p, roster, teams] = await Promise.all([
      s.pco.get(`${base}?include=plan_times`),
      s.pco.list(`${base}/team_members?include=team`, 10),
      cached(`teams:${s.pcoPersonId}:${st}`, 600_000, () => s.pco.list(`${S}/service_types/${st}/teams`, 3)),
    ]).catch((e) => { if (e instanceof PcoError && (e.status === 403 || e.status === 404)) throw new HttpError(404, "You can’t see that service in Planning Center."); throw e; });
    return {
      id: planId, serviceTypeId: st, sortDate: p.sort_date,
      times: (p.rel.plan_times ?? []).map((t: Flat) => ({ startsAt: t.starts_at, endsAt: t.ends_at ?? null })).filter((t: { startsAt: string }) => t.startsAt),
      roster, teamOrder: teams.map((t) => t.id),
    };
  });
}

async function settings(): Promise<CheckinConfig> {
  const [r] = await sql`select * from ops.checkin_settings`;
  return { events: r?.events ?? {}, teamLocations: r?.teamLocations ?? {}, groups: r?.groups ?? [] };
}

/** Check-Ins scans in the service's window (its times ± 2 hours, else that day), for its volunteer event if one is set. */
async function checkIns(s: Session, p: Plan, event: { id: string; name: string } | null) {
  const w = p.times.length
    ? { from: new Date(Math.min(...p.times.map((t) => Date.parse(t.startsAt))) - 2 * 3600e3).toISOString(), to: new Date(Math.max(...p.times.map((t) => Date.parse(t.endsAt || t.startsAt))) + 2 * 3600e3).toISOString() }
    : dayWindow(p.sortDate, s.timeZone);
  const range = `where[created_at][gte]=${encodeURIComponent(w.from)}&where[created_at][lte]=${encodeURIComponent(w.to)}`;
  const path = event ? `/check-ins/v2/events/${event.id}/check_ins?include=locations,person&order=-created_at&${range}` : `/check-ins/v2/check_ins?include=event,locations,person&order=-created_at&${range}`;
  const rows = await cached(`ci:${s.pcoPersonId}:${p.id}:${event?.id ?? ""}`, 8_000, () => s.pco.list(path, event ? 10 : 30));
  return rows.map((f) => ({
    personId: (f.rel.person?.id ?? null) as string | null, at: f.created_at as string,
    eventId: event?.id ?? f.rel.event?.id ?? null, locations: (f.rel.locations ?? []).map((l: Flat) => l.name).filter(Boolean) as string[],
  }));
}

async function planData(s: Session, st: string, planId: string): Promise<CheckinPlanData> {
  const [p, cfg] = await Promise.all([plan(s, st, planId), settings()]);
  const event = cfg.events[st] ?? null;
  let scans: Awaited<ReturnType<typeof checkIns>> = [];
  let checkInsError: string | null = null;
  try { scans = await checkIns(s, p, event); }
  catch (e) {
    if (e instanceof HttpError) throw e;
    checkInsError = e instanceof PcoError && (e.status === 401 || e.status === 403)
      ? "Your Planning Center account can’t see Check-Ins, so only check-ins made here show."
      : "Planning Center Check-Ins couldn’t be read just now.";
  }
  if (event) scans = scans.filter((r) => !r.eventId || r.eventId === event.id);
  const first = new Map<string, (typeof scans)[number]>();
  for (const r of scans) if (r.personId && (!first.has(r.personId) || r.at < first.get(r.personId)!.at)) first.set(r.personId, r);
  const staff = await sql`select * from ops.staff_checkins where plan_id = ${planId} order by at`;

  const teams = new Map<string, CheckinTeam>();
  for (const m of p.roster) {
    if (m.status === "D") continue;
    const personId = m.rel.person?.id as string, teamId = m.rel.team?.id as string;
    if (!personId || !teamId) continue;
    const t = teams.get(teamId) ?? { teamId, teamName: m.rel.team?.name ?? "", people: [] };
    teams.set(teamId, t);
    const same = t.people.find((x) => x.personId === personId);
    if (same) { if (m.team_position_name && !same.positions.includes(m.team_position_name)) same.positions.push(m.team_position_name); continue; }
    const scan = first.get(personId);
    const byStaff = staff.find((x) => x.personId === personId && x.teamId === teamId) ?? staff.find((x) => x.personId === personId);
    const via = scan && (!byStaff || scan.at <= new Date(byStaff.at).toISOString()) ? "checkins" : byStaff ? "staff" : undefined;
    const expected = cfg.teamLocations[teamId]?.name ?? null;
    const person: CheckinPerson = {
      personId, name: m.name ?? "", avatarUrl: m.photo_thumbnail ?? null, positions: m.team_position_name ? [m.team_position_name] : [], status: (m.status ?? "U") as CheckinPerson["status"],
      checkedInAt: via === "checkins" ? scan!.at : via === "staff" ? new Date(byStaff!.at).toISOString() : null,
      checkedInVia: via, checkedInBy: via === "staff" ? byStaff!.byName : undefined,
      location: via === "checkins" ? scan!.locations[0] ?? null : via === "staff" ? byStaff!.locationName ?? expected : null,
      expectedLocation: expected,
    };
    t.people.push(person);
  }
  const order = p.teamOrder;
  return {
    teams: [...teams.values()].sort((a, b) => (order.indexOf(a.teamId) + 1 || 999) - (order.indexOf(b.teamId) + 1 || 999) || a.teamName.localeCompare(b.teamName)),
    groups: cfg.groups, checkInsError, event, fetchedAt: new Date().toISOString(),
  };
}

/** Every service that local day the person is on (not declined), with each of their teams. */
async function sameDay(s: Session, st: string, planId: string, personId: string) {
  const here = await plan(s, st, planId);
  const day = localDay(here.sortDate, s.timeZone);
  const others = (await servicesOn(s, day)).filter((x) => x.id !== planId);
  const plans = [here, ...(await mapLimit(others, 3, (x) => plan(s, x.serviceTypeId, x.id).catch(() => null))).filter((x): x is Plan => Boolean(x))];
  return plans.flatMap((p) => {
    const mine = p.roster.filter((m) => m.rel.person?.id === personId && m.status !== "D");
    return [...new Set(mine.map((m) => m.rel.team?.id as string))].filter(Boolean).map((teamId) => ({ plan: p, teamId, name: mine[0].name as string }));
  });
}

async function check(s: Session, body: unknown) {
  if (!checkinAtLeast(s.level, "CHECKIN")) throw new HttpError(403, "You can see check-ins but not check people in. Ask your Sundays admin if you need to.");
  const b = z.object({ st: z.string().regex(/^\w{1,30}$/), plan: z.string().regex(/^\w{1,30}$/), personId: z.string().regex(/^\w{1,30}$/), undo: z.boolean().optional() }).parse(body);
  if (b.undo) {
    const here = await plan(s, b.st, b.plan);
    const day = localDay(here.sortDate, s.timeZone);
    const ids = [b.plan, ...(await servicesOn(s, day)).map((x) => x.id)];
    const gone = await sql`delete from ops.staff_checkins where person_id = ${b.personId} and plan_id = any(${ids}) returning id`;
    return { ok: true, undone: gone.length };
  }
  const spots = await sameDay(s, b.st, b.plan, b.personId);
  if (!spots.length) throw new HttpError(404, "They aren’t scheduled on this service.");
  const cfg = await settings();
  const have = await sql`select plan_id, team_id from ops.staff_checkins where person_id = ${b.personId} and plan_id = any(${spots.map((x) => x.plan.id)})`;
  const rows = spots.filter((x) => !have.some((h) => h.planId === x.plan.id && h.teamId === x.teamId)).map((x) => {
    const ev = cfg.events[x.plan.serviceTypeId] ?? null, loc = cfg.teamLocations[x.teamId] ?? null;
    return {
      personId: b.personId, name: x.name, planId: x.plan.id, serviceTypeId: x.plan.serviceTypeId, teamId: x.teamId, byName: s.name, byUserId: s.userId, byPcoPersonId: s.pcoPersonId,
      eventId: ev?.id ?? null, eventName: ev?.name ?? null, locationId: loc?.id ?? null, locationName: loc?.name ?? null,
    };
  });
  if (rows.length) await sql`insert into ops.staff_checkins ${sql(rows)}`;
  await sql`delete from ops.staff_checkins where at < now() - interval '120 days'`;
  return { ok: true, services: new Set(spots.map((x) => x.plan.id)).size, teams: new Set(spots.map((x) => x.teamId)).size };
}

/* ───────────── Settings (Manage) ───────────── */

/**
 * Service types with their teams, and the Check-Ins events by name. Each event's locations come
 * separately (eventLocations), only for the events someone picks: reading every event's locations up
 * front made this take a minute or more at churches with many events.
 */
async function setup(s: Session, lazy: boolean): Promise<CheckinSetup> {
  const teamsOf = () => cached(`setupteams:${s.pcoOrgId}:${s.pcoPersonId}`, 5 * 60_000, async () => {
    const types = await serviceTypes(s);
    return mapLimit(types, 6, async (t) => ({
      id: t.id, name: t.name,
      teams: (await cached(`teams:${s.pcoPersonId}:${t.id}`, 600_000, () => s.pco.list(`${S}/service_types/${t.id}/teams`, 3)).catch(() => [] as Flat[]))
        .filter((x) => !x.archived_at && !x.deleted_at).map((x) => ({ id: x.id, name: (x.name ?? "") as string })).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });
  const eventsOf = () => cached(`setupevents:${s.pcoOrgId}:${s.pcoPersonId}`, 5 * 60_000, async () => {
    const evs = (await s.pco.list(`/check-ins/v2/events?order=name`, 5)).filter((e) => !e.archived_at);
    const vol = (n: string) => (/volunteer|serve|team/i.test(n) ? 0 : 1);
    return evs.map((e) => ({ id: e.id, name: (e.name ?? "") as string, locations: null })).sort((a, b) => vol(a.name) - vol(b.name) || a.name.localeCompare(b.name));
  });
  let eventsError: string | null = null;
  const [withTeams, events, config] = await Promise.all([
    teamsOf(),
    eventsOf().then(async (evs) => lazy ? evs
      // Pages from before 1.43 expect every event's locations in this answer.
      : mapLimit(evs, 4, async (e) => ({ ...e, locations: (await eventLocations(s, e.id).catch(() => ({ locations: [] }))).locations }))).catch((e) => {
      if (e instanceof HttpError) throw e;
      eventsError = e instanceof PcoError && (e.status === 401 || e.status === 403) ? "Your Planning Center account can’t read Check-Ins." : "Check-Ins couldn’t be read.";
      return [] as CheckinSetup["events"];
    }),
    settings(),
  ]);
  return { config, serviceTypes: withTeams, events, eventsError };
}

/** One Check-Ins event's locations (areas), with their folders. */
async function eventLocations(s: Session, eventId: string) {
  if (!/^\w{1,30}$/.test(eventId)) throw new HttpError(400, "Unknown event");
  return cached(`locs:${s.pcoOrgId}:${s.pcoPersonId}:${eventId}`, 5 * 60_000, async () => {
    const rows = await s.pco.list(`/check-ins/v2/events/${eventId}/locations?include=parent&order=position`, 5)
      .catch((e) => { if (e instanceof PcoError && (e.status === 403 || e.status === 404)) throw new HttpError(404, "That event isn’t in Check-Ins any more."); throw e; });
    return { locations: rows.filter((l) => l.kind !== "Folder").map((l) => ({ id: l.id, name: (l.name ?? "") as string, folder: (l.rel.parent?.name ?? null) as string | null })) };
  });
}

const Ref = z.object({ id: z.string().min(1).max(100), name: z.string().max(300) });
export const ConfigSchema = z.object({
  events: z.record(z.string().max(40), Ref).refine((r) => Object.keys(r).length <= 500),
  teamLocations: z.record(z.string().max(40), Ref).refine((r) => Object.keys(r).length <= 3000),
  groups: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(100), teamIds: z.array(z.string().max(40)).max(500) })).max(100),
});

/** Save check-in settings (the whole set) in the current organization. */
export async function saveCheckinSettings(cfg: z.infer<typeof ConfigSchema>, by: string) {
  await sql`insert into ops.checkin_settings ${sql({ events: sql.json(cfg.events), teamLocations: sql.json(cfg.teamLocations), groups: sql.json(cfg.groups), updatedBy: by, updatedAt: new Date() } as never)}
    on conflict (org_id) do update set events = excluded.events, team_locations = excluded.team_locations, groups = excluded.groups, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
  return settings();
}
export { settings as checkinSettings };

/* ───────────── Router ───────────── */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** /checkin/… (path already without the /ops prefix). */
export async function handleCheckin(req: Request, path: string, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const route = `${req.method} ${path}`;
    if (route === "GET /checkin/config") return json({ clientId: PCO_CLIENT_ID, authorizeUrl: `${PCO}/oauth/authorize`, scope: "people services check_ins" });
    if (route === "POST /checkin/session") return json(await signIn(await req.json().catch(() => ({}))));
    if (route === "POST /checkin/handoff") return json(await handoff(await req.json().catch(() => ({}))));
    if (route === "POST /checkin/handoff/claim") return json(await claim(await req.json().catch(() => ({}))));

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token.startsWith("ck_")) throw new HttpError(401, "Sign in with Planning Center.", { status: "signed-out" });
    if (route === "POST /checkin/signout") { await raw`delete from ops.checkin_sessions where token_hash = ${await sha256(token)}`; return json({ ok: true }); }
    const s = await sessionFrom(token);
    if (route === "GET /checkin/me") return json(meOf(s));
    if (route === "GET /checkin/services") {
      const day = url.searchParams.get("date");
      return json({ services: day ? await servicesOn(s, day) : await serviceList(s), today: localDay(new Date().toISOString(), s.timeZone) });
    }

    const loaded = await loadOrg(s.orgId);
    if (!loaded) throw new HttpError(404, "Organization not found");
    const inside = <T>(fn: () => Promise<T>) => inOrg({ id: s.orgId, row: loaded.row, modules: loaded.modules }, fn);
    if (route === "GET /checkin/plan") return json(await inside(() => planData(s, url.searchParams.get("st") ?? "", url.searchParams.get("plan") ?? "")));
    if (route === "POST /checkin/check") { const b = await req.json().catch(() => ({})); return json(await inside(() => check(s, b))); }
    if (route === "GET /checkin/setup" || route === "GET /checkin/setup/locations" || route === "PUT /checkin/settings") {
      if (!checkinAtLeast(s.level, "MANAGER")) throw new HttpError(403, "Only people who manage check-ins can change these.");
      if (route === "GET /checkin/setup") return json(await inside(() => setup(s, url.searchParams.get("lazy") === "1")));
      if (route === "GET /checkin/setup/locations") return json(await eventLocations(s, url.searchParams.get("event") ?? ""));
      const cfg = ConfigSchema.parse(await req.json().catch(() => ({})));
      return json(await inside(() => saveCheckinSettings(cfg, s.name)));
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    if (e instanceof ZodError) { const i = e.issues[0]; return json({ error: i ? `${i.path.join(".") || "Input"}: ${i.message}` : "Invalid input" }, 422); }
    if (e instanceof PcoError) return json({ error: "Planning Center couldn’t be reached just now. Try again." }, 502);
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
}

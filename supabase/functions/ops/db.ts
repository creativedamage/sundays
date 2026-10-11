/**
 * The ops database (schema "ops"), reached with the function's own database connection. Nobody
 * else can read these tables: the ops schema isn't exposed by the API and every table has RLS on.
 * Columns are snake_case in Postgres and camelCase here.
 *
 * Organizations: every request for an organization runs in one transaction as the `ops_app` role
 * with app.org_id set (see inOrg). Row-level security then keeps every query, insert and update
 * inside that organization, and new rows get its org_id by default. `sql` follows the request: in
 * an organization it's that transaction (and sql.begin becomes a savepoint); outside one (sign-in,
 * the super-admin console) it's the plain connection, `raw`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import type { ModuleKey } from "./lib/billing.ts";
import type { OpsSessionUser } from "./lib/types.ts";

const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k) ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];

/** The plain connection: no organization, no row-level security (owner). */
export const raw = postgres(env("SUPABASE_DB_URL") ?? env("OPS_DB_URL")!, {
  transform: postgres.camel,
  prepare: false, // through Supabase's pooler
  max: 5,
  idle_timeout: 20,
  connection: { search_path: "ops" },
});
export type Sql = typeof raw;
export type Tx = postgres.TransactionSql;
export { env };

export interface OrgCtx { tx: Tx; orgId: string; org: Record<string, any>; modules: ModuleKey[]; user: OpsSessionUser | null; after: (() => Promise<void>)[] }
const als = new AsyncLocalStorage<OrgCtx>();
export const ctx = () => als.getStore() ?? null;
export function org(): OrgCtx {
  const c = als.getStore();
  if (!c) throw new Error("No organization for this request");
  return c;
}
export const orgId = () => org().orgId;
export const hasModule = (k: ModuleKey) => org().modules.includes(k);

/** Run fn inside an organization: one transaction, as ops_app, with app.org_id set. */
export async function inOrg<T>(o: { id: string; row: Record<string, any>; modules: ModuleKey[] }, fn: () => Promise<T>): Promise<T> {
  const after: OrgCtx["after"] = [];
  const out = await (raw.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${o.id}, true)`;
    await tx`set local role ops_app`;
    return als.run({ tx, orgId: o.id, org: o.row, modules: o.modules, user: null, after }, fn);
  }) as Promise<T>);
  // Saved: now the things that wait for it (emails), without holding up the answer.
  for (const f of after) background(f());
  return out;
}

/** Run after this request's changes are saved (only if they are). */
export function afterCommit(fn: () => Promise<void>) {
  const c = als.getStore();
  if (c) c.after.push(fn); else background(fn());
}

/** Keep working after the response has gone (Supabase's EdgeRuntime.waitUntil), logging failures. */
export function background(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("background task failed", e));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  rt?.waitUntil(guarded);
}

/** The current request's connection (see the note at the top). */
export const sql = new Proxy(raw, {
  apply(_t, _this, args: unknown[]) {
    const c = als.getStore();
    return (c ? c.tx : raw)(...(args as [TemplateStringsArray]));
  },
  get(t, p, r) {
    const c = als.getStore();
    if (!c) return Reflect.get(t, p, r);
    if (p === "begin") return (fn: (tx: Tx) => unknown) => c.tx.savepoint(fn as never);
    const v = (c.tx as unknown as Record<string | symbol, unknown>)[p];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c.tx) : v;
  },
}) as Sql;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

/** Atomic numbers per kind and year within the organization: CC-Q-2026-0001. */
export async function nextNumber(db: Sql | Tx, kind: "Q" | "PO" | "R" | "WO" | "INV", prefix = "CC"): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${kind}:${year}`;
  const [row] = await db`insert into ops.counters (key, value) values (${key}, 1)
    on conflict (org_id, key) do update set value = ops.counters.value + 1 returning value`;
  return `${prefix}-${kind}-${year}-${String(row.value).padStart(4, "0")}`;
}

/** This organization's details (name, address, numbering). */
export async function getOrg(db: Sql | Tx = sql) {
  const [o] = await db`select * from ops.organization where id = ${orgId()}`;
  if (!o) throw new HttpError(404, "Organization not found");
  return o;
}

/** This organization's AVL business profile and quote defaults. */
export async function getAvl(db: Sql | Tx = sql) {
  const [a] = await db`select * from ops.avl_business where id = ${orgId()}`;
  if (a) return a;
  const o = await getOrg(db);
  const [n] = await db`insert into ops.avl_business (id, name, quote_prefix) values (${orgId()}, ${o.name}, 'AV')
    on conflict (id) do update set id = excluded.id returning *`;
  return n;
}

/** Drop undefined keys (postgres.js won't take them in insert/update helpers). */
export const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export async function logActivity(a: {
  actorId?: string | null; actorLabel?: string; action: string; detail?: string | null; area: "AUTH" | "AVL" | "REQUESTS" | "ADMIN" | "SYNC";
  entityType?: string; entityId?: string; href?: string; campusId?: string | null;
}) {
  try {
    // A savepoint inside an organization, so a failed log line can't spoil the request.
    await sql.begin(async (tx) => {
      await tx`insert into ops.activity_log ${tx(defined({
        actorId: a.actorId ?? null, actorLabel: a.actorLabel ?? null, action: a.action, detail: a.detail ?? null, area: a.area,
        entityType: a.entityType ?? null, entityId: a.entityId ?? null, href: a.href ?? null, campusId: a.campusId ?? null,
      }))}`;
    });
  } catch (e) {
    console.error("activity log failed", e);
  }
}

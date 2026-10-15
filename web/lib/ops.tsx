"use client";
/**
 * Sundays | Operations and Sundays | AVL — in the Mac app (Full Mode) and on the website (ops-web).
 * People sign in with their own account (Supabase Auth: register, then a manager approves them);
 * every screen talks to the "ops" Edge Function, which checks their access each time.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { OpsMe } from "@shared/ops/types";
import { Api } from "@/lib/api";
import { CONFIRMED_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@shared/cloud";

export interface CloudConfig { supabaseUrl: string; publishableKey: string; opsUrl: string; testToken: string | null }

/** The website build (no Sundays server behind it): talks to Sundays' cloud directly. */
export const STANDALONE = process.env.NEXT_PUBLIC_OPS_STANDALONE === "1";

let cfgP: Promise<CloudConfig> | null = null;
const cloud = () => (cfgP ??= (STANDALONE
  ? Promise.resolve({
    supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY,
    // NEXT_PUBLIC_OPS_URL / _TEST_TOKEN: a local copy of the ops function, for testing a website build.
    opsUrl: process.env.NEXT_PUBLIC_OPS_URL || `${SUPABASE_URL}/functions/v1/ops`, testToken: testToken(),
  })
  : Api.cloud()).catch((e) => { cfgP = null; throw e; }));

/** Test builds only (NEXT_PUBLIC_OPS_TEST_TOKEN set at build time): sign in as a test person. Real builds never set it. */
function testToken(): string | null {
  const t = process.env.NEXT_PUBLIC_OPS_TEST_TOKEN;
  if (t === "localStorage") { try { return localStorage.getItem("ops-test-token"); } catch { return null; } }
  return t || null;
}

/** Where the "confirm your email" link lands: the website itself, or (from a Mac app) Sundays' confirmation page. */
export const confirmRedirect = () => (STANDALONE && typeof window !== "undefined" && /^https?:$/.test(window.location.protocol) ? `${window.location.origin}/` : CONFIRMED_URL);

let client: SupabaseClient | null = null;
export async function supabase(): Promise<SupabaseClient> {
  if (client) return client;
  const c = await cloud();
  client = createClient(c.supabaseUrl, c.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "sundays-ops-auth", detectSessionInUrl: STANDALONE },
  });
  return client;
}

/** Signed in to Sundays | Operations? (undefined while checking) */
export function useOpsSession(): { session: Session | null | undefined; test: boolean } {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [test, setTest] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    (async () => {
      const c = await cloud();
      if (c.testToken) { if (alive) { setTest(true); setSession({ access_token: c.testToken } as Session); } return; }
      const sb = await supabase();
      const { data } = await sb.auth.getSession();
      if (alive) setSession(data.session);
      const sub = sb.auth.onAuthStateChange((_e, s) => setSession(s));
      off = () => sub.data.subscription.unsubscribe();
    })().catch(() => alive && setSession(null));
    return () => { alive = false; off?.(); };
  }, []);
  return { session, test };
}

/* ── Which organization (the switcher). Sent as X-Org; the server checks they belong to it. ── */
const ORG_KEY = "sundays-ops-org";
export const currentOrgId = (): string | null => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } };
export function rememberOrg(id: string | null) {
  try { if (id) localStorage.setItem(ORG_KEY, id); else localStorage.removeItem(ORG_KEY); } catch { /* private window */ }
}

export class OpsError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

async function token(): Promise<string | null> {
  const c = await cloud();
  if (c.testToken) return c.testToken;
  const { data } = await (await supabase()).auth.getSession();
  return data.session?.access_token ?? null;
}

/** Call the ops function: ops("/requests/mine"), ops("/requests", { method: "POST", json: {...} }). */
export async function ops<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const c = await cloud();
  const t = await token();
  if (!t) throw new OpsError("Sign in to Sundays | Operations.", 401);
  const res = await fetch(`${c.opsUrl}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${t}`, apikey: c.publishableKey, ...(currentOrgId() ? { "X-Org": currentOrgId()! } : {}),
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new OpsError(String(body.error ?? `Sundays | Operations error (${res.status})`), res.status, body);
  return body as T;
}

export const opsKey = (...k: unknown[]) => ["ops", ...k] as const;

/** A Sundays | Operations query (cached under ["ops", …]; cleared on sign-out). */
export function useOps<T>(path: string | null, opts: Omit<UseQueryOptions<T>, "queryKey" | "queryFn"> = {}) {
  return useQuery<T>({
    queryKey: opsKey(path),
    queryFn: () => ops<T>(path!),
    enabled: Boolean(path) && (opts.enabled ?? true),
    retry: (n, e) => !(e instanceof OpsError && e.status < 500) && n < 2,
    ...opts,
  });
}

export function useOpsMe(enabled = true) {
  const q = useOps<OpsMe>("/me", { enabled, staleTime: 30_000, refetchInterval: 60_000 });
  // Keep the remembered organization in step with the one the server picked.
  const picked = q.data && "org" in q.data ? q.data.org.id : null;
  useEffect(() => { if (picked && picked !== currentOrgId()) rememberOrg(picked); }, [picked]);
  return q;
}

/** Switch organization: everything reloads for the new one. */
export function useSwitchOrg() {
  const qc = useQueryClient();
  return async (id: string, go?: string) => {
    rememberOrg(id);
    qc.removeQueries({ queryKey: ["ops"] });
    if (go && typeof window !== "undefined") window.location.assign(go);
    else await qc.invalidateQueries({ queryKey: ["ops"] });
  };
}

/** A no-sign-in call (the client's proposal page: the link is the key). */
export async function opsPublic<T>(path: string, json?: unknown): Promise<T> {
  const c = await cloud();
  const res = await fetch(`${c.opsUrl}${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { apikey: c.publishableKey, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  }).catch(() => { throw new OpsError("Can’t reach the server. Check your connection and try again.", 0); });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new OpsError(String(body.error ?? `Something went wrong (${res.status})`), res.status, body);
  return body as T;
}

/** The client portal: signed in with its own token (an emailed code), not a Sundays account. */
export async function opsPortal<T>(path: string, token: string | null, json?: unknown): Promise<T> {
  const c = await cloud();
  const res = await fetch(`${c.opsUrl}${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { apikey: c.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  }).catch(() => { throw new OpsError("Can’t reach the server. Check your connection and try again.", 0); });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new OpsError(String(body.error ?? `Something went wrong (${res.status})`), res.status, body);
  return body as T;
}

/** Public plans and add-ons (no sign-in needed). */
export async function publicPricing<T>(): Promise<T> {
  const c = await cloud();
  const res = await fetch(`${c.opsUrl}/public/pricing`, { headers: { apikey: c.publishableKey } });
  if (!res.ok) throw new OpsError("Couldn't load plans.", res.status);
  return res.json() as Promise<T>;
}

/** After a change: refetch every Sundays | Operations screen. */
export function useOpsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["ops"] });
}

export async function opsSignOut() {
  const c = await cloud();
  rememberOrg(null);
  if (!c.testToken) await (await supabase()).auth.signOut();
}

/* ── Formatting ── */
export const fmtMoney = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const money0 = (c: number) => (c < 0 ? "-" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");
export const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function fmtAge(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 60) return `${Math.max(m, 0)}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

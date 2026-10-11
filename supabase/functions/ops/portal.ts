/**
 * The client portal: a business's clients sign in with a 6-digit code sent to their email (no
 * password) and see their proposals, change orders, schedule, shared files, invoices, selections
 * and messages.
 *
 * Who a client is: any email on a client record (the client's own email, or one of its contacts),
 * in any business on Sundays. One email can be a client of several businesses; the portal opens one
 * at a time. A session is a random token (only its hash is kept), good for 30 days.
 *
 *   POST /public/portal/code     { email, org? }        send a code
 *   POST /public/portal/verify   { email, code }        → { token }
 *   GET  /public/portal?b=org                          the portal (Authorization: Bearer <token>)
 *   POST /public/portal/messages { b, jobId, body }
 *   POST /public/portal/selections/:id { b, optionId }
 *   GET  /public/portal/files/:id?b=org                a link to a shared file
 *   POST /public/portal/signout
 */
import { z } from "zod";
import { HttpError, inOrg, logActivity, raw, sql } from "./db.ts";
import { loadOrg } from "./auth.ts";
import { isEmail, render, SITE } from "./mail.ts";
import { businessName, first, money as $, queue } from "./avlmail.ts";
import { invoiceRows, invoiceUrl, pick, portalUrl, selectionsOf } from "./invoicing.ts";
import { proposalUrl } from "./quotes.ts";
import { coUrl } from "./purchasing.ts";
import { readLinks } from "./storage.ts";
import { isoDay, type PortalBusiness, type PortalHome, type PortalJob } from "./lib/invoicing.ts";

const CODE_MINUTES = 10;
const SESSION_DAYS = 30;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const norm = (e: string) => e.trim().toLowerCase();
const n = (v: unknown) => Number(v ?? 0);
const day = (d: unknown) => (d ? (d instanceof Date ? isoDay(d) : String(d).slice(0, 10)) : null);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Businesses (organizations with AVL) where this email is on a client record. */
async function businessesOf(email: string): Promise<string[]> {
  const rows = await raw`select distinct c.org_id from ops.customers c
    left join ops.customer_contacts cc on cc.customer_id = c.id
    where lower(c.email) = ${email} or lower(cc.email) = ${email}`;
  const out: string[] = [];
  for (const r of rows) { const o = await loadOrg(r.orgId); if (o?.modules.includes("avl")) out.push(r.orgId); }
  return out;
}
async function enter<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const o = await loadOrg(orgId);
  if (!o || !o.modules.includes("avl")) throw new HttpError(404, "That business isn't on Sundays any more.");
  return inOrg({ id: orgId, row: o.row, modules: o.modules }, fn);
}

/* ───────────── Sign-in ───────────── */

export const CodeSchema = z.object({ email: z.string().trim().max(200), b: z.string().max(60).nullish() });
export async function sendCode(input: z.infer<typeof CodeSchema>) {
  const email = norm(input.email);
  if (!isEmail(email)) throw new HttpError(422, "Enter your email address.");
  const [{ c }] = await raw`select count(*)::int as c from ops.portal_codes where lower(email) = ${email} and created_at > now() - interval '1 hour'`;
  if (c >= 5) throw new HttpError(429, "Too many codes asked for. Wait a little, then try again.");
  const orgs = await businessesOf(email);
  // Same answer either way, so the form doesn't tell anyone who is a client.
  if (!orgs.length) return { sent: true };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await raw`insert into ops.portal_codes (email, code_hash, expires_at) values (${email}, ${await sha(`${email}:${code}`)}, now() + ${`${CODE_MINUTES} minutes`}::interval)`;
  const org = input.b && orgs.includes(input.b) ? input.b : orgs[0];
  await enter(org, async () => {
    const biz = await businessName();
    const { html, text } = render({
      org: biz.name, heading: `Your sign-in code: ${code}`,
      intro: [`Enter this code to open your client portal with ${biz.name}. It works for ${CODE_MINUTES} minutes.`, "If you didn’t ask for it, you can ignore this email."],
      rows: [["Code", code]], buttons: [],
      footer: `Sent by Sundays for ${biz.name}.`, accent: "#0F766E",
    });
    const msg = { to: { email }, subject: `${code} is your sign-in code for ${biz.name}`, html, text, replyTo: biz.replyTo };
    const err = await queue([{ ...msg, kind: "avl.portal.code" }], biz.name);
    if (err) throw new HttpError(503, `${biz.name} hasn't set up email in Sundays yet, so a code can't be sent. Contact them directly.`);
  });
  return { sent: true };
}

export const VerifySchema = z.object({ email: z.string().trim().max(200), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });
export async function verifyCode(input: z.infer<typeof VerifySchema>) {
  const email = norm(input.email);
  const [c] = await raw`select id, code_hash, attempts from ops.portal_codes where lower(email) = ${email} and used_at is null and expires_at > now() order by created_at desc limit 1`;
  if (!c) throw new HttpError(422, "That code has expired. Ask for a new one.");
  if (c.attempts >= 5) throw new HttpError(429, "Too many tries. Ask for a new code.");
  if (c.codeHash !== await sha(`${email}:${input.code}`)) {
    await raw`update ops.portal_codes set attempts = attempts + 1 where id = ${c.id}`;
    throw new HttpError(422, "That code isn't right. Check the latest email and try again.");
  }
  await raw`update ops.portal_codes set used_at = now() where id = ${c.id}`;
  const token = `pt_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  await raw`insert into ops.portal_sessions (token_hash, email, expires_at) values (${await sha(token)}, ${email}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  await raw`delete from ops.portal_codes where expires_at < now() - interval '1 day'`;
  return { token, email };
}

/** The signed-in client's email (from the Authorization header). */
export async function portalEmail(req: Request): Promise<string> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("pt_")) throw new HttpError(401, "Sign in to the client portal.", { status: "signin" });
  const [s] = await raw`update ops.portal_sessions set last_seen_at = now() where token_hash = ${await sha(token)} and expires_at > now() returning email`;
  if (!s) throw new HttpError(401, "Your sign-in has expired. Sign in again.", { status: "signin" });
  return s.email as string;
}
export async function signOut(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token) await raw`delete from ops.portal_sessions where token_hash = ${await sha(token)}`;
}

/** Run inside the business the client picked (or their only one), as long as they're its client. */
export async function asClient<T>(email: string, b: string | null, fn: (ctx: { customerIds: string[]; orgId: string; orgs: string[] }) => Promise<T>): Promise<T> {
  const orgs = await businessesOf(email);
  if (!orgs.length) throw new HttpError(403, "This email isn't on file with any business any more.", { status: "signin" });
  const orgId = b && orgs.includes(b) ? b : orgs[0];
  return enter(orgId, async () => {
    const ids = (await sql`select distinct c.id from ops.customers c left join ops.customer_contacts cc on cc.customer_id = c.id
      where lower(c.email) = ${email} or lower(cc.email) = ${email}`).map((r) => r.id as string);
    return fn({ customerIds: ids, orgId, orgs });
  });
}

async function businessCard(orgId: string): Promise<PortalBusiness> {
  return enter(orgId, async () => {
    const [[a], [o], assets] = await Promise.all([
      sql`select name, email, phone from ops.avl_business`, sql`select name from ops.organization`,
      sql`select key, mime, data_b64 from ops.org_assets where key in ('avl-logo', 'logo')`,
    ]);
    const x = assets.find((r) => r.key === "avl-logo") ?? assets.find((r) => r.key === "logo");
    return { orgId, name: (a?.name as string) || (o?.name as string) || "Your AV team", email: a?.email ?? null, phone: a?.phone ?? null, logo: x ? `data:${x.mime};base64,${x.dataB64}` : null };
  });
}

async function jobOf(jobId: string, customerIds: string[]) {
  const [j] = await sql`select id, customer_id, name, number, manager_id, created_by_id from ops.jobs where id = ${jobId} and customer_id = any(${customerIds})`;
  if (!j) throw new HttpError(404, "That project isn't here.");
  return j;
}

/* ───────────── The portal ───────────── */

export async function portalHome(email: string, b: string | null): Promise<PortalHome> {
  return asClient(email, b, async ({ customerIds, orgId, orgs }) => {
    const ids = customerIds;
    const [customers, quotes, jobs, cos, invoices] = await Promise.all([
      sql`select c.name, c.contact_name, (select cc.name from ops.customer_contacts cc where cc.customer_id = c.id and lower(cc.email) = ${email} limit 1) as contact
        from ops.customers c where c.id = any(${ids})`,
      sql`select id, number, title, status, sent_total_cents, public_token, coalesce(sent_at, created_at) as at from ops.quotes
        where customer_id = any(${ids}) and status <> 'DRAFT' order by at desc limit 100`,
      sql`select j.* from ops.jobs j where j.customer_id = any(${ids}) and j.status <> 'CANCELLED' order by j.start_date desc nulls last, j.created_at desc limit 50`,
      sql`select c.id, c.number, c.title, c.status, c.public_token, c.sent_total_cents, j.name as job_name from ops.change_orders c join ops.jobs j on j.id = c.job_id
        where j.customer_id = any(${ids}) and c.status in ('SENT', 'APPROVED', 'DECLINED') order by c.created_at desc`,
      sql`select id, public_token from ops.job_invoices where customer_id = any(${ids}) and status in ('SENT', 'PAID')`,
    ]);
    const jobIds = jobs.map((j) => j.id as string);
    const tokens = new Map(invoices.map((i) => [i.id as string, i.publicToken as string | null]));
    const [rows, phases, files, msgs, billing] = await Promise.all([
      invoices.length ? invoiceRows(sql`i.id = any(${invoices.map((i) => i.id)})`, sql`i.issue_date desc, i.number desc`) : [],
      jobIds.length ? sql`select id, job_id, name, start_date, end_date, status from ops.job_phases where job_id = any(${jobIds}) order by sort_order, start_date nulls last` : [],
      jobIds.length ? sql`select id, job_id, name, mime, size_bytes, created_at from ops.job_files where job_id = any(${jobIds}) and shared and ready order by created_at desc` : [],
      jobIds.length ? sql`select m.*, u.name as staff_name from ops.portal_messages m left join ops.users u on u.id = m.author_user_id where m.job_id = any(${jobIds}) order by m.created_at` : [],
      jobIds.length ? sql`select j.id,
          coalesce((select sum(round(b.quantity * b.unit_price_cents)) from ops.budget_items b where b.job_id = j.id and b.kind = 'ITEM'), 0)::bigint as contract,
          coalesce((select sum(i.subtotal_cents) from ops.job_invoices i where i.job_id = j.id and i.status in ('SENT', 'PAID')), 0)::bigint as invoiced,
          coalesce((select sum(p.amount_cents) from ops.payments p join ops.job_invoices i on i.id = p.invoice_id where i.job_id = j.id and p.status = 'SUCCEEDED'), 0)::bigint as paid
        from ops.jobs j where j.id = any(${jobIds})` : [],
    ]);
    // Messages from the business are read once the client opens the portal.
    if (jobIds.length) await sql`update ops.portal_messages set read_at = now() where job_id = any(${jobIds}) and not from_client and read_at is null`;
    const portalJobs: PortalJob[] = [];
    for (const j of jobs) {
      const sels = await selectionsOf(j.id);
      const bl = billing.find((x) => x.id === j.id);
      portalJobs.push({
        id: j.id, number: j.number, name: j.name, status: j.status,
        site: [j.siteLine1, [j.siteCity, j.siteState].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null,
        startDate: day(j.startDate), endDate: day(j.endDate),
        phases: phases.filter((p) => p.jobId === j.id).map((p) => ({ id: p.id, name: p.name, startDate: day(p.startDate), endDate: day(p.endDate), status: p.status })),
        files: files.filter((f) => f.jobId === j.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime ?? null, sizeBytes: n(f.sizeBytes), createdAt: iso(f.createdAt)! })),
        selections: sels.map(({ budgetItemId: _b, options, ...s }) => ({ ...s, options: options.map(({ costCents: _c, ...o }) => o) })),
        messages: msgs.filter((m) => m.jobId === j.id).map((m) => ({ id: m.id, fromClient: m.fromClient, author: m.fromClient ? m.authorName ?? "You" : m.staffName ?? m.authorName ?? null, body: m.body, at: iso(m.createdAt)!, readAt: iso(m.readAt) })),
        contractCents: n(bl?.contract), invoicedCents: n(bl?.invoiced), paidCents: n(bl?.paid),
      });
    }
    const me = customers[0];
    return {
      email,
      businesses: await Promise.all(orgs.map(businessCard)),
      business: await businessCard(orgId),
      clientName: (me?.contact as string) || (me?.contactName as string) || (me?.name as string) || null,
      proposals: quotes.map((q) => ({ id: q.id, number: q.number, title: q.title, status: q.status, totalCents: n(q.sentTotalCents), date: day(q.at), url: q.publicToken ? proposalUrl(q.publicToken) : null })),
      changeOrders: cos.map((c) => ({ id: c.id, number: c.number, title: c.title, status: c.status, amountCents: n(c.sentTotalCents), job: c.jobName, url: c.publicToken ? coUrl(c.publicToken) : null })),
      invoices: rows.map((r) => ({ ...r, url: tokens.get(r.id) ? invoiceUrl(tokens.get(r.id)!) : null })),
      jobs: portalJobs,
      balanceCents: rows.reduce((s, r) => s + r.balanceCents, 0),
    };
  });
}

export const MessageSchema = z.object({ b: z.string().max(60).nullish(), jobId: z.string().max(60), body: z.string().trim().min(1, "Write a message.").max(5000) });
export async function clientMessage(email: string, input: z.infer<typeof MessageSchema>) {
  return asClient(email, input.b ?? null, async ({ customerIds }) => {
    const j = await jobOf(input.jobId, customerIds);
    const [c] = await sql`select coalesce((select cc.name from ops.customer_contacts cc where cc.customer_id = c.id and lower(cc.email) = ${email} limit 1), c.contact_name, c.name) as who
      from ops.customers c where c.id = ${j.customerId}`;
    await sql`insert into ops.portal_messages ${sql({ jobId: j.id, fromClient: true, authorName: c?.who ?? email, authorEmail: email, body: input.body })}`;
    await logActivity({ actorId: null, actorLabel: `${c?.who ?? email} (client)`, action: "Client sent a message", detail: `${j.number} · ${input.body.slice(0, 80)}`, area: "AVL", entityType: "Job", entityId: j.id, href: `/avl/jobs/view?id=${j.id}&tab=client` });
    await notifyStaff(j as never, c?.who ?? email, input.body);
  });
}

/** Tell the job's manager (or whoever made it) the client wrote. */
async function notifyStaff(j: { id: string; number: string; name: string; managerId: string | null; createdById: string | null }, who: string, body: string) {
  try {
    const [p] = await sql`select name, email from ops.users where id = coalesce(${j.managerId}, ${j.createdById}) and active and email is not null`;
    if (!p?.email) return;
    const biz = await businessName();
    const { html, text } = render({
      org: biz.name, heading: `${who} sent a message`,
      intro: [`Hi ${first(p.name)}, ${who} wrote about ${j.name} in the client portal:`, body.length > 1200 ? `${body.slice(0, 1200)}…` : body],
      rows: [["Job", `${j.number} · ${j.name}`]],
      buttons: [{ label: "Answer in Sundays", url: `${SITE}/avl/jobs/view?id=${encodeURIComponent(j.id)}&tab=client` }],
      footer: `Sent by Sundays for ${biz.name}.`, accent: "#0F766E",
    });
    await queue([{ kind: "avl.portal.message", to: { email: p.email, name: p.name }, subject: `${who} · ${j.name}`, html, text }], biz.name);
  } catch (e) { console.error("portal message email failed", e); }
}

/** The business answered: email the client a nudge to the portal. */
export async function notifyClient(jobId: string, from: string, body: string) {
  try {
    const [j] = await sql`select j.name, j.customer_id, c.email, c.contact_name, j.org_id from ops.jobs j left join ops.customers c on c.id = j.customer_id where j.id = ${jobId}`;
    if (!j || !isEmail(j.email)) return null;
    const biz = await businessName();
    const { html, text } = render({
      org: biz.name, heading: `A message about ${j.name}`,
      intro: [`Hi ${first(j.contactName)}, ${from} wrote:`, body.length > 1200 ? `${body.slice(0, 1200)}…` : body],
      rows: [], buttons: [{ label: "Answer in your client portal", url: portalUrl(j.orgId) }],
      footer: `Sent by Sundays for ${biz.name}. Reply in the portal so it stays with your project.`, accent: "#0F766E",
    });
    return await queue([{ kind: "avl.portal.reply", to: { email: j.email, name: j.contactName ?? null }, subject: `${biz.name}: a message about ${j.name}`, html, text, replyTo: biz.replyTo }], biz.name);
  } catch (e) { console.error("portal reply email failed", e); return null; }
}

export const PickSchema = z.object({ b: z.string().max(60).nullish(), optionId: z.string().max(60) });
export async function clientPick(email: string, selectionId: string, input: z.infer<typeof PickSchema>) {
  return asClient(email, input.b ?? null, async ({ customerIds }) => {
    const [s] = await sql`select s.job_id from ops.job_selections s where s.id = ${selectionId}`;
    if (!s) throw new HttpError(404, "That selection isn't here.");
    const j = await jobOf(s.jobId, customerIds);
    const [c] = await sql`select coalesce(contact_name, name) as who from ops.customers where id = ${j.customerId}`;
    const who = `${c?.who ?? email} (client)`;
    const r = await pick(selectionId, input.optionId, who);
    await logActivity({ actorId: null, actorLabel: who, action: "Client made a selection", detail: `${j.number} · ${r.title}: ${r.option}${r.priceCents ? ` (${r.priceCents > 0 ? "+" : "−"}${$(Math.abs(r.priceCents))})` : ""}`, area: "AVL", entityType: "Job", entityId: j.id, href: `/avl/jobs/view?id=${j.id}&tab=client` });
  });
}

export async function clientFile(email: string, fileId: string, b: string | null) {
  return asClient(email, b, async ({ customerIds }) => {
    const [f] = await sql`select f.path, f.name, f.job_id from ops.job_files f where f.id = ${fileId} and f.shared and f.ready`;
    if (!f) throw new HttpError(404, "That file isn't shared any more.");
    await jobOf(f.jobId, customerIds);
    const link = (await readLinks([{ path: f.path, name: f.name }], 600)).get(f.path);
    if (!link) throw new HttpError(502, "The file couldn't be opened. Try again.");
    return link;
  });
}

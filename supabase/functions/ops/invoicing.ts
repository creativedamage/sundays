/**
 * Sundays AVL billing: client invoices on a job (deposit, progress, final, change order), payments
 * (recorded by hand, or by card through the business's own Stripe account), receipts, the job's
 * invoicing figures, aging, selections and reports. The math is in lib/invoicing.ts.
 */
import { z } from "zod";
import type { OpsSessionUser } from "./lib/types.ts";
import {
  addAging, draftInvoice, emptyAging, invoiceState, invoiceTotals, isoDay, shownLines,
  type AgingBuckets, type AvlReports, type BillingBasis, type ClientInvoicePage, type DraftRequest, type Invoice, type InvoiceLine, type InvoiceRow,
  type InvoicesPage, type InvoiceStatus, type JobBilling, type PaymentRow, type Selection,
} from "./lib/invoicing.ts";
import { stageLabel, type LeadStage } from "./lib/crm.ts";
import { budgetOf } from "./jobs.ts";
import { env, getAvl, HttpError, inOrg, nextNumber, raw, sql } from "./db.ts";
import { loadOrg } from "./auth.ts";
import { newPublicToken } from "./quotes.ts";
import { isEmail, keyUpdate, render, SITE, unseal } from "./mail.ts";
import { businessName, first, money as $, queue } from "./avlmail.ts";
import { letterhead } from "./purchasing.ts";

type U = OpsSessionUser;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const day = (d: unknown) => (d ? (d instanceof Date ? isoDay(d) : String(d).slice(0, 10)) : null);
const n = (v: unknown) => Number(v ?? 0);
const optText = (len: number) => z.string().trim().max(len).nullish().transform((v) => v || null);
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null);
const ACCENT = "#0F766E";

export const invoiceUrl = (t: string) => `${SITE}/invoice?t=${encodeURIComponent(t)}`;
export const portalUrl = (orgId?: string | null) => `${SITE}/portal${orgId ? `?b=${encodeURIComponent(orgId)}` : ""}`;
const invoiceHref = (id: string) => `/avl/invoices/view?id=${id}`;
const addDays = (d: string, k: number) => { const [y, m, dd] = d.split("-").map(Number); return isoDay(new Date(y, m - 1, dd + k)); };
const today = () => isoDay(new Date());

/* ═════════════ The job's billing basis ═════════════ */

const LIVE = sql`i.status <> 'VOID'`;

export async function basisOf(jobId: string): Promise<BillingBasis> {
  const [items, billed, phases, cos, [j], biz] = await Promise.all([
    budgetOf(jobId),
    sql`select l.budget_item_id, l.phase_id, l.kind, sum(l.amount_cents)::bigint as c from ops.job_invoice_lines l join ops.job_invoices i on i.id = l.invoice_id
      where i.job_id = ${jobId} and ${LIVE} group by 1, 2, 3`,
    sql`select id, name, status, bill_bps from ops.job_phases where job_id = ${jobId} order by sort_order, start_date nulls last`,
    sql`select c.id, c.number, c.title, c.status from ops.change_orders c where c.job_id = ${jobId} and c.status = 'APPROVED' order by c.created_at`,
    sql`select q.sent_deposit_cents, q.status from ops.jobs j left join ops.quotes q on q.id = j.quote_id where j.id = ${jobId}`,
    getAvl(),
  ]);
  const groups = new Map(items.filter((i) => i.kind === "GROUP").map((g) => [g.id, g.name]));
  const perItem = new Map<string, number>(), perPhase = new Map<string, number>();
  let depositBilled = 0, depositApplied = 0, progress = 0;
  for (const r of billed) {
    const c = n(r.c);
    if (r.kind === "DEPOSIT") depositBilled += c;
    else if (r.kind === "DEPOSIT_APPLIED") depositApplied -= c;
    else if (r.kind === "ITEM" && r.budgetItemId) {
      perItem.set(r.budgetItemId, (perItem.get(r.budgetItemId) ?? 0) + c);
      progress += c;
      if (r.phaseId) perPhase.set(r.phaseId, (perPhase.get(r.phaseId) ?? 0) + c);
    }
  }
  const basisItems = items.filter((i) => i.kind === "ITEM").map((i) => ({
    id: i.id, name: i.name, group: i.parentId ? groups.get(i.parentId) ?? null : null,
    priceCents: Math.round(i.quantity * i.unitPriceCents), taxable: i.taxable, changeOrderId: i.changeOrderId ?? null, billedCents: perItem.get(i.id) ?? 0,
  }));
  return {
    contractCents: basisItems.reduce((s, i) => s + i.priceCents, 0),
    items: basisItems,
    phases: phases.map((p) => ({ id: p.id, name: p.name, status: p.status, billBps: p.billBps ?? null, billedCents: perPhase.get(p.id) ?? 0 })),
    depositBilledCents: depositBilled, depositAppliedCents: depositApplied, progressBilledCents: progress,
    changeOrders: cos.map((c) => {
      const mine = basisItems.filter((i) => i.changeOrderId === c.id);
      return { id: c.id, number: c.number, title: c.title, status: c.status, priceCents: mine.reduce((s, i) => s + i.priceCents, 0), billedCents: mine.reduce((s, i) => s + i.billedCents, 0) };
    }),
    proposalDepositCents: j?.sentDepositCents != null && j.sentDepositCents > 0 ? n(j.sentDepositCents) : null,
    defaultDepositBps: n(biz.defaultDepositBps),
  };
}

/** Tax for a new invoice: the proposal's rate, else the business default; none for a tax-exempt client. */
async function taxFor(jobId: string) {
  const [r] = await sql`select q.tax_bps, cu.tax_exempt from ops.jobs j left join ops.quotes q on q.id = j.quote_id left join ops.customers cu on cu.id = j.customer_id where j.id = ${jobId}`;
  if (r?.taxExempt) return 0;
  if (r?.taxBps != null) return n(r.taxBps);
  return n((await getAvl()).defaultTaxBps);
}

/* ═════════════ Invoices ═════════════ */

const ROW_SQL = (where: unknown, order: unknown = sql`i.issue_date desc, i.number desc`, limit = 1000) => sql`
  select i.*, j.number as job_number, j.name as job_name, c.name as customer_name,
    coalesce((select sum(p.amount_cents) from ops.payments p where p.invoice_id = i.id and p.status = 'SUCCEEDED'), 0)::bigint as paid
  from ops.job_invoices i join ops.jobs j on j.id = i.job_id left join ops.customers c on c.id = i.customer_id
  where ${where as never} order by ${order as never} limit ${limit}`;

function toRow(r: Row): InvoiceRow {
  const paid = n(r.paid), total = n(r.totalCents);
  const status = r.status as InvoiceStatus;
  return {
    id: r.id, number: r.number, kind: r.kind, method: r.method ?? null, title: r.title, status,
    state: invoiceState({ status, totalCents: total, paidCents: paid, dueDate: day(r.dueDate) }),
    issueDate: day(r.issueDate)!, dueDate: day(r.dueDate), subtotalCents: n(r.subtotalCents), totalCents: total, paidCents: paid,
    balanceCents: status === "DRAFT" || status === "VOID" ? 0 : Math.max(0, total - paid),
    job: { id: r.jobId, number: r.jobNumber, name: r.jobName },
    customer: r.customerId ? { id: r.customerId, name: r.customerName } : null,
    sentAt: iso(r.sentAt), viewedAt: iso(r.viewedAt),
  };
}
export async function invoiceRows(where: unknown, order?: unknown, limit?: number) { return (await ROW_SQL(where, order, limit)).map(toRow); }

const toLine = (l: Row): InvoiceLine => ({
  id: l.id, kind: l.kind, budgetItemId: l.budgetItemId ?? null, phaseId: l.phaseId ?? null, groupLabel: l.groupLabel ?? null,
  description: l.description, percentBps: l.percentBps ?? null, amountCents: n(l.amountCents), taxable: l.taxable,
});
const toPayment = (p: Row): PaymentRow => ({
  id: p.id, invoiceId: p.invoiceId ?? null, amountCents: n(p.amountCents), method: p.method ?? null, provider: p.provider, status: p.status,
  reference: p.reference ?? null, receivedOn: day(p.receivedOn), note: p.note ?? null, recordedBy: p.recordedBy ?? null,
  receiptSentTo: p.receiptSentTo ?? null, createdAt: iso(p.createdAt)!,
});

export async function invoiceDetail(id: string): Promise<Invoice> {
  const [r] = await ROW_SQL(sql`i.id = ${id}`);
  if (!r) throw new HttpError(404, "Invoice not found");
  const [lines, payments, [extra]] = await Promise.all([
    sql`select * from ops.job_invoice_lines where invoice_id = ${id} order by sort_order, id`,
    sql`select p.*, u.name as recorded_by from ops.payments p left join ops.users u on u.id = p.recorded_by_id where p.invoice_id = ${id} order by coalesce(p.received_on, p.created_at::date), p.created_at`,
    sql`select co.number as co_number, co.title as co_title, u.name as created_by, cu.email as customer_email
      from ops.job_invoices i left join ops.change_orders co on co.id = i.change_order_id left join ops.users u on u.id = i.created_by_id
      left join ops.customers cu on cu.id = i.customer_id where i.id = ${id}`,
  ]);
  return {
    ...toRow(r), percentBps: r.percentBps ?? null,
    changeOrder: r.changeOrderId ? { id: r.changeOrderId, number: extra.coNumber, title: extra.coTitle } : null,
    taxBps: r.taxBps, taxCents: n(r.taxCents), summarize: r.summarize, notes: r.notes ?? null,
    lines: lines.map(toLine), payments: payments.map(toPayment),
    publicToken: r.publicToken ?? null, sentTo: r.sentTo ?? null, createdBy: extra?.createdBy ?? null, customerEmail: extra?.customerEmail ?? null,
    createdAt: iso(r.createdAt)!,
  };
}

const LineSchema = z.object({
  kind: z.enum(["ITEM", "DEPOSIT", "DEPOSIT_APPLIED", "OTHER"]),
  budgetItemId: z.string().max(60).nullish().transform((v) => v || null),
  phaseId: z.string().max(60).nullish().transform((v) => v || null),
  groupLabel: optText(200),
  description: z.string().trim().min(1, "Every line needs a description.").max(500),
  percentBps: z.number().int().min(0).max(10_000).nullish().transform((v) => v ?? null),
  amountCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  taxable: z.boolean().default(false),
});
export const InvoiceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: optDate,
  taxBps: z.number().int().min(0).max(5000),
  summarize: z.boolean(),
  notes: optText(5000),
  lines: z.array(LineSchema).max(1000),
});
export const DraftSchema = z.union([
  z.object({ kind: z.literal("DEPOSIT"), amountCents: z.number().int().min(1).max(1_000_000_000) }),
  z.object({ kind: z.literal("PROGRESS"), method: z.literal("PERCENT"), percentBps: z.number().int().min(1).max(10_000) }),
  z.object({ kind: z.literal("PROGRESS"), method: z.literal("PHASE"), phaseIds: z.array(z.string().max(60)).min(1).max(100) }),
  z.object({ kind: z.literal("PROGRESS"), method: z.literal("LINES"), percents: z.record(z.string().max(60), z.number().int().min(0).max(10_000)) }),
  z.object({ kind: z.literal("FINAL") }),
  z.object({ kind: z.literal("CHANGE_ORDER"), changeOrderId: z.string().max(60) }),
  z.object({ kind: z.literal("OTHER") }),
]);

async function writeLines(invoiceId: string, lines: InvoiceLine[], taxBps: number) {
  await sql`delete from ops.job_invoice_lines where invoice_id = ${invoiceId}`;
  if (lines.length) {
    await sql`insert into ops.job_invoice_lines ${sql(lines.map((l, i) => ({
      invoiceId, kind: l.kind, budgetItemId: l.budgetItemId, phaseId: l.phaseId, groupLabel: l.groupLabel, description: l.description,
      percentBps: l.percentBps, amountCents: l.amountCents, taxable: l.taxable && taxBps > 0, sortOrder: i,
    })))}`;
  }
  const t = invoiceTotals(lines.map((l) => ({ ...l, taxable: l.taxable && taxBps > 0 })), taxBps);
  await sql`update ops.job_invoices set subtotal_cents = ${t.subtotalCents}, tax_cents = ${t.taxCents}, total_cents = ${t.totalCents}, updated_at = now() where id = ${invoiceId}`;
}

/** A new draft invoice for a job, worked out from what's been billed so far. */
export async function createInvoice(jobId: string, req: DraftRequest, userId: string): Promise<{ id: string; number: string }> {
  const [j] = await sql`select id, customer_id from ops.jobs where id = ${jobId} for update`;
  if (!j) throw new HttpError(404, "Job not found");
  const basis = await basisOf(jobId);
  if (req.kind !== "DEPOSIT" && req.kind !== "OTHER" && basis.contractCents === 0 && !basis.items.length) throw new HttpError(422, "This job's budget is empty: add its lines before billing.");
  let draft;
  try { draft = draftInvoice(basis, req); } catch (e) { throw new HttpError(422, (e as Error).message); }
  const biz = await getAvl();
  const taxBps = await taxFor(jobId);
  const issue = today();
  const number = await nextNumber(sql, "INV", (biz.quotePrefix as string) || "AV");
  const [inv] = await sql`insert into ops.job_invoices ${sql({
    jobId, customerId: j.customerId ?? null, number, kind: draft.kind, method: draft.method, percentBps: draft.percentBps, changeOrderId: draft.changeOrderId,
    title: draft.title, issueDate: issue, dueDate: addDays(issue, n(biz.invoiceDueDays ?? 30)), taxBps, summarize: draft.summarize,
    notes: (biz.invoiceNotes as string) || null, createdById: userId,
  })} returning id, number`;
  await writeLines(inv.id, draft.lines, taxBps);
  return { id: inv.id, number: inv.number };
}

export async function saveInvoice(id: string, input: z.infer<typeof InvoiceSchema>) {
  const [inv] = await sql`select status, job_id from ops.job_invoices where id = ${id} for update`;
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.status !== "DRAFT") throw new HttpError(409, "Only a draft invoice can be changed. Void it and make a new one, or take it back to draft if nothing's been paid.");
  const items = new Set((await sql`select id from ops.budget_items where job_id = ${inv.jobId} and kind = 'ITEM'`).map((r) => r.id as string));
  const lines = input.lines.map((l) => ({ ...l, budgetItemId: l.budgetItemId && items.has(l.budgetItemId) ? l.budgetItemId : null, kind: l.kind === "ITEM" && !(l.budgetItemId && items.has(l.budgetItemId)) ? "OTHER" as const : l.kind }));
  if (input.dueDate && input.dueDate < input.issueDate) throw new HttpError(422, "The due date is before the invoice date.");
  const { lines: _l, ...head } = input;
  await sql`update ops.job_invoices set ${sql({ ...head, updatedAt: new Date() })} where id = ${id}`;
  await writeLines(id, lines as InvoiceLine[], input.taxBps);
}

export type InvoiceEvent = "SEND" | "MARK_SENT" | "VOID" | "REOPEN";
export async function invoiceEvent(id: string, event: InvoiceEvent, opts: { emailTo?: string | null } = {}) {
  const [i] = await sql`select * from ops.job_invoices where id = ${id} for update`;
  if (!i) throw new HttpError(404, "Invoice not found");
  const [{ paid }] = await sql`select coalesce(sum(amount_cents), 0)::bigint as paid from ops.payments where invoice_id = ${id} and status = 'SUCCEEDED'`;
  const now = new Date();
  if (event === "SEND" || event === "MARK_SENT") {
    const [{ c }] = await sql`select count(*)::int as c from ops.job_invoice_lines where invoice_id = ${id}`;
    if (!c) throw new HttpError(422, "Add at least one line first.");
    if (i.status === "VOID") throw new HttpError(409, "A void invoice can't be sent.");
    if (event === "SEND" && !isEmail((opts.emailTo ?? "").trim())) throw new HttpError(422, "Enter the client's email address.");
    await sql`update ops.job_invoices set ${sql({
      status: i.status === "DRAFT" ? "SENT" : i.status, sentAt: i.sentAt ?? now, publicToken: i.publicToken ?? newPublicToken(),
      ...(event === "SEND" ? { sentTo: opts.emailTo!.trim() } : {}), updatedAt: now,
    })} where id = ${id}`;
  } else if (event === "VOID") {
    if (n(paid) > 0) throw new HttpError(409, "This invoice has payments. Remove them first (refund the client outside Sundays), then void it.");
    await sql`update ops.job_invoices set status = 'VOID', voided_at = ${now}, updated_at = ${now} where id = ${id}`;
  } else if (event === "REOPEN") {
    if (n(paid) > 0) throw new HttpError(409, "This invoice has payments, so it stays as sent.");
    if (i.status === "DRAFT") throw new HttpError(409, "It's a draft already.");
    await sql`update ops.job_invoices set status = 'DRAFT', voided_at = null, updated_at = ${now} where id = ${id}`;
  }
  const inv = await invoiceDetail(id);
  if (event === "SEND") {
    const err = await emailInvoice(inv, opts.emailTo!.trim());
    if (err) throw new HttpError(409, `${err} You can mark it sent and share the link instead.`);
  }
  return inv;
}

/** Paid in full → PAID; a payment removed → back to SENT. */
export async function refreshPaid(invoiceId: string) {
  await sql`update ops.job_invoices i set
      status = case when i.status in ('SENT', 'PAID') then (case when i.total_cents > 0 and p.paid >= i.total_cents then 'PAID' else 'SENT' end) else i.status end,
      paid_at = case when i.total_cents > 0 and p.paid >= i.total_cents then coalesce(i.paid_at, now()) else null end,
      updated_at = now()
    from (select coalesce(sum(amount_cents), 0)::bigint as paid from ops.payments where invoice_id = ${invoiceId} and status = 'SUCCEEDED') p
    where i.id = ${invoiceId}`;
}

export const PaymentSchema = z.object({
  amountCents: z.number().int().min(1, "Enter the amount.").max(1_000_000_000),
  method: z.enum(["CHECK", "ACH", "CASH", "CARD", "OTHER"]),
  reference: optText(120),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: optText(2000),
  /** Email a receipt to this address. */
  receiptTo: z.string().trim().max(200).nullish().transform((v) => v || null),
});
export async function recordPayment(invoiceId: string, input: z.infer<typeof PaymentSchema>, u: U) {
  const [i] = await sql`select * from ops.job_invoices where id = ${invoiceId} for update`;
  if (!i) throw new HttpError(404, "Invoice not found");
  if (i.status === "DRAFT" || i.status === "VOID") throw new HttpError(409, "Send the invoice before recording a payment on it.");
  const [{ paid }] = await sql`select coalesce(sum(amount_cents), 0)::bigint as paid from ops.payments where invoice_id = ${invoiceId} and status = 'SUCCEEDED'`;
  const balance = n(i.totalCents) - n(paid);
  if (input.amountCents > balance) throw new HttpError(422, `That's more than the ${$(Math.max(0, balance))} still owed on this invoice.`);
  if (input.receiptTo && !isEmail(input.receiptTo)) throw new HttpError(422, "That receipt email address isn't right.");
  const [p] = await sql`insert into ops.payments ${sql({
    invoiceId, jobId: i.jobId, customerId: i.customerId ?? null, provider: "MANUAL", amountCents: input.amountCents, status: "SUCCEEDED",
    method: input.method, reference: input.reference, receivedOn: input.receivedOn, note: input.note, recordedById: u.id,
  })} returning id`;
  await refreshPaid(invoiceId);
  let receiptError: string | null = null;
  if (input.receiptTo) receiptError = await emailReceipt(p.id, input.receiptTo);
  return { paymentId: p.id as string, receiptError };
}

export async function deletePayment(paymentId: string) {
  const [p] = await sql`delete from ops.payments where id = ${paymentId} and provider = 'MANUAL' returning invoice_id, amount_cents`;
  if (!p) throw new HttpError(409, "Only a payment recorded by hand can be removed here. Card payments are refunded in Stripe.");
  if (p.invoiceId) await refreshPaid(p.invoiceId);
  return p as { invoiceId: string | null; amountCents: number };
}

/* ═════════════ The job's invoicing view and the invoices list ═════════════ */

export async function stripeConnected() {
  const [c] = await sql`select 1 from ops.connections where provider = 'STRIPE'`;
  return Boolean(c);
}

export async function jobBilling(jobId: string): Promise<JobBilling> {
  const [basis, invoices, [j], biz, card] = await Promise.all([
    basisOf(jobId), invoiceRows(sql`i.job_id = ${jobId}`, sql`i.issue_date, i.number`),
    sql`select cu.email from ops.jobs j left join ops.customers cu on cu.id = j.customer_id where j.id = ${jobId}`,
    getAvl(), stripeConnected(),
  ]);
  const sent = invoices.filter((i) => i.status === "SENT" || i.status === "PAID");
  const invoiced = sent.reduce((s, i) => s + i.subtotalCents, 0);
  const deposit = basis.proposalDepositCents ?? Math.round((basis.contractCents * basis.defaultDepositBps) / 10_000);
  return {
    contractCents: basis.contractCents,
    invoicedCents: invoiced,
    invoicedBps: basis.contractCents > 0 ? Math.round((invoiced * 10_000) / basis.contractCents) : 0,
    collectedCents: invoices.reduce((s, i) => s + (i.status === "VOID" ? 0 : i.paidCents), 0),
    receivableCents: sent.reduce((s, i) => s + i.balanceCents, 0),
    toInvoiceCents: Math.max(0, basis.contractCents - invoiced),
    draftCents: invoices.filter((i) => i.status === "DRAFT").reduce((s, i) => s + i.subtotalCents, 0),
    invoices, basis,
    defaults: { dueDays: n(biz.invoiceDueDays ?? 30), taxBps: await taxFor(jobId), depositCents: basis.depositBilledCents > 0 ? 0 : deposit },
    cardPayments: card,
    clientEmail: j?.email ?? null,
  };
}

export async function invoicesPage(filter: string, q: string): Promise<InvoicesPage> {
  const like = `%${q}%`;
  const search = q ? sql`and (i.number ilike ${like} or i.title ilike ${like} or j.name ilike ${like} or j.number ilike ${like} or c.name ilike ${like})` : sql``;
  const t = today();
  const all = await invoiceRows(sql`true ${search}`, sql`i.issue_date desc, i.number desc`, 2000);
  const counts = { DRAFT: 0, OPEN: 0, OVERDUE: 0, PAID: 0, ALL: all.length };
  for (const i of all) {
    if (i.state === "DRAFT") counts.DRAFT++;
    else if (i.state === "PAID") counts.PAID++;
    else if (i.state === "OVERDUE") { counts.OVERDUE++; counts.OPEN++; }
    else if (i.state === "OPEN" || i.state === "PARTIAL") counts.OPEN++;
  }
  const shown = all.filter((i) => filter === "ALL" ? true : filter === "DRAFT" ? i.state === "DRAFT" : filter === "PAID" ? i.state === "PAID"
    : filter === "OVERDUE" ? i.state === "OVERDUE" : ["OPEN", "PARTIAL", "OVERDUE"].includes(i.state));
  const aging = emptyAging();
  const per = new Map<string, { customer: { id: string; name: string } | null; aging: AgingBuckets; oldestDue: string | null }>();
  for (const i of all) {
    if (i.balanceCents <= 0) continue;
    addAging(aging, i.balanceCents, i.dueDate, t);
    const k = i.customer?.id ?? "";
    let c = per.get(k);
    if (!c) per.set(k, c = { customer: i.customer, aging: emptyAging(), oldestDue: null });
    addAging(c.aging, i.balanceCents, i.dueDate, t);
    if (i.dueDate && (!c.oldestDue || i.dueDate < c.oldestDue)) c.oldestDue = i.dueDate;
  }
  const monthStart = `${t.slice(0, 7)}-01`;
  const [{ c }] = await sql`select coalesce(sum(amount_cents), 0)::bigint as c from ops.payments where invoice_id is not null and status = 'SUCCEEDED' and coalesce(received_on, created_at::date) >= ${monthStart}`;
  return { invoices: shown, counts, aging, byClient: [...per.values()].sort((a, b) => b.aging.totalCents - a.aging.totalCents), collectedThisMonthCents: n(c) };
}

/* ═════════════ Emails: the invoice and receipts ═════════════ */

async function emailInvoice(inv: Invoice, to: string): Promise<string | null> {
  const biz = await businessName();
  const [cu] = await sql`select contact_name from ops.customers where id = ${inv.customer?.id ?? ""}`;
  const card = await stripeConnected();
  const balance = inv.totalCents - inv.paidCents;
  const { html, text } = render({
    org: biz.name, heading: `Invoice ${inv.number}`,
    intro: [`Hi ${first(cu?.contactName)}, here is our invoice for ${inv.job.name}.`, card ? "You can view it and pay online by card, or pay the way you usually do." : "Open it to see the details."],
    rows: [["Invoice", inv.number], ["For", inv.title], ["Amount due", $(balance)], ["Due", inv.dueDate ? new Date(`${inv.dueDate}T12:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "On receipt"]],
    buttons: [{ label: card ? "View and pay" : "View the invoice", url: invoiceUrl(inv.publicToken!) }],
    footer: `Sent by Sundays for ${biz.name}. Questions? Reply to this email.`, accent: ACCENT,
  });
  return queue([{ kind: "avl.invoice", to: { email: to, name: cu?.contactName ?? null }, subject: `Invoice ${inv.number} from ${biz.name}: ${$(balance)}`, html, text, replyTo: biz.replyTo }], biz.name);
}

export async function emailReceipt(paymentId: string, to: string): Promise<string | null> {
  const [p] = await sql`select p.*, i.number, i.title, i.public_token, i.id as inv_id, cu.contact_name from ops.payments p join ops.job_invoices i on i.id = p.invoice_id
    left join ops.customers cu on cu.id = i.customer_id where p.id = ${paymentId}`;
  if (!p) return "Payment not found.";
  const inv = await invoiceDetail(p.invId);
  const biz = await businessName();
  const { html, text } = render({
    org: biz.name, heading: "Payment received, thank you",
    intro: [`Hi ${first(p.contactName)}, we received your payment of ${$(n(p.amountCents))} on invoice ${p.number}.`],
    rows: [["Invoice", `${p.number} · ${p.title}`], ["Paid", $(n(p.amountCents))], ["How", p.provider === "STRIPE" ? "Card (online)" : { CHECK: `Check${p.reference ? ` #${p.reference}` : ""}`, ACH: "Bank transfer", CASH: "Cash", CARD: "Card", OTHER: "Payment" }[p.method as string] ?? "Payment"],
      ["Date", new Date(`${day(p.receivedOn) ?? isoDay(new Date(p.createdAt))}T12:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })], ["Still owed", $(Math.max(0, inv.totalCents - inv.paidCents))]],
    buttons: p.publicToken ? [{ label: "View the invoice", url: invoiceUrl(p.publicToken) }] : [],
    footer: `Sent by Sundays for ${biz.name}. Keep this email as your receipt.`, accent: ACCENT,
  });
  const err = await queue([{ kind: "avl.receipt", to: { email: to, name: p.contactName ?? null }, subject: `Receipt: ${$(n(p.amountCents))} on invoice ${p.number}`, html, text, replyTo: biz.replyTo }], biz.name);
  if (!err) await sql`update ops.payments set receipt_sent_to = ${to}, receipt_sent_at = now() where id = ${paymentId}`;
  return err;
}

/* ═════════════ Stripe (the business's own account) ═════════════ */

const STRIPE = () => (env("STRIPE_API_BASE") ?? "https://api.stripe.com").replace(/\/+$/, "");

async function stripeCall(key: string, method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<Row> {
  let res: Response;
  try {
    res = await fetch(`${STRIPE()}/v1/${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
      body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new HttpError(502, "Stripe didn't answer. Try again in a minute."); }
  const body = await res.json().catch(() => ({})) as Row;
  if (!res.ok) throw new HttpError(res.status === 401 ? 422 : 502, res.status === 401 ? "Stripe didn't accept that key." : `Stripe: ${body?.error?.message ?? `error ${res.status}`}`);
  return body;
}

async function stripeKey(): Promise<string | null> {
  const [c] = await sql`select secret_enc from ops.connections where provider = 'STRIPE'`;
  return c ? unseal(c.secretEnc) : null;
}

export async function connectionsPage() {
  const [s] = await sql`select c.account_id, c.account_name, c.livemode, c.connected_at, u.name as connected_by from ops.connections c left join ops.users u on u.id = c.connected_by_id where c.provider = 'STRIPE'`;
  return {
    stripe: s ? { accountId: s.accountId ?? null, accountName: s.accountName ?? null, livemode: s.livemode, connectedAt: iso(s.connectedAt)!, connectedBy: s.connectedBy ?? null } : null,
  };
}

/** Check a pasted Stripe secret (or restricted) key against Stripe, then keep it sealed. */
export async function connectStripe(key: string, userId: string) {
  const k = key.trim();
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(k)) throw new HttpError(422, "That doesn't look like a Stripe secret key. It starts with sk_live_ (or sk_test_ to try things out).");
  const acct = await stripeCall(k, "GET", "account");
  const name = acct?.settings?.dashboard?.display_name || acct?.business_profile?.name || acct?.email || null;
  const secretEnc = await keyUpdate(k, null);
  await sql`insert into ops.connections ${sql({ provider: "STRIPE", secretEnc, accountId: acct?.id ?? null, accountName: name, livemode: k.includes("_live_"), connectedById: userId, connectedAt: new Date() })}
    on conflict (org_id, provider) do update set secret_enc = excluded.secret_enc, account_id = excluded.account_id, account_name = excluded.account_name,
      livemode = excluded.livemode, connected_by_id = excluded.connected_by_id, connected_at = excluded.connected_at`;
  return connectionsPage();
}
export async function disconnectStripe() { await sql`delete from ops.connections where provider = 'STRIPE'`; }

/** Start a card payment for what's owed on an invoice: a Stripe Checkout page in the business's account. */
export async function startCheckout(invoiceId: string, orgId: string): Promise<{ url: string }> {
  const key = await stripeKey();
  if (!key) throw new HttpError(409, "Card payments aren't set up for this business. Pay the way the invoice says, or ask them.");
  const inv = await invoiceDetail(invoiceId);
  if (inv.status !== "SENT") throw new HttpError(409, inv.status === "PAID" ? "This invoice is paid. Thank you!" : "This invoice can't be paid online.");
  const balance = inv.totalCents - inv.paidCents;
  if (balance <= 0) throw new HttpError(409, "Nothing is owed on this invoice.");
  const biz = await businessName();
  const back = invoiceUrl(inv.publicToken!);
  const form: Record<string, string> = {
    mode: "payment",
    success_url: `${back}&paid={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(balance),
    "line_items[0][price_data][product_data][name]": `Invoice ${inv.number}: ${inv.title}`.slice(0, 250),
    "line_items[0][price_data][product_data][description]": `${biz.name} · ${inv.job.name}`.slice(0, 250),
    client_reference_id: inv.id,
    "metadata[invoice_id]": inv.id, "metadata[invoice_number]": inv.number, "metadata[org_id]": orgId,
    "payment_intent_data[description]": `Invoice ${inv.number} · ${inv.job.name}`.slice(0, 250),
    "payment_intent_data[metadata][invoice_id]": inv.id,
  };
  if (isEmail(inv.customerEmail)) form.customer_email = inv.customerEmail;
  const s = await stripeCall(key, "POST", "checkout/sessions", form);
  await sql`insert into ops.payments ${sql({ invoiceId: inv.id, jobId: inv.job.id, customerId: inv.customer?.id ?? null, provider: "STRIPE", providerRef: s.id, amountCents: balance, status: "PENDING", method: "CARD" })}`;
  return { url: s.url as string };
}

/**
 * Ask Stripe about card payments still pending on an invoice (after the client comes back from
 * Checkout, or whenever the invoice is opened): paid ones are recorded and a receipt goes out.
 */
export async function settleCheckouts(invoiceId: string) {
  const pending = await sql`select id, provider_ref, amount_cents, created_at from ops.payments where invoice_id = ${invoiceId} and provider = 'STRIPE' and status = 'PENDING'`;
  if (!pending.length) return 0;
  const key = await stripeKey();
  if (!key) return 0;
  let paid = 0;
  for (const p of pending) {
    let s: Row;
    try { s = await stripeCall(key, "GET", `checkout/sessions/${encodeURIComponent(p.providerRef)}`); } catch { continue; }
    if (s.payment_status === "paid") {
      const [ok] = await sql`update ops.payments set status = 'SUCCEEDED', amount_cents = ${n(s.amount_total) || n(p.amountCents)}, reference = ${typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null},
        received_on = current_date, updated_at = now() where id = ${p.id} and status = 'PENDING' returning id`;
      if (ok) {
        paid++;
        const to = s.customer_details?.email ?? s.customer_email;
        if (isEmail(to)) await emailReceipt(p.id, to);
      }
    } else if (s.status === "expired" || Date.now() - new Date(p.createdAt).getTime() > 2 * 86_400_000) {
      await sql`update ops.payments set status = 'FAILED', updated_at = now() where id = ${p.id} and status = 'PENDING'`;
    }
  }
  if (paid) await refreshPaid(invoiceId);
  return paid;
}

/* ═════════════ The client's invoice page (no sign-in: the link is the key) ═════════════ */

async function invoiceByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new HttpError(404, "This invoice link isn’t right.");
  const [r] = await raw`select id, org_id, status from ops.job_invoices where public_token = ${token}`;
  if (!r || r.status === "DRAFT") throw new HttpError(404, "This invoice link isn’t right, or the invoice was withdrawn.");
  const o = await loadOrg(r.orgId);
  if (!o || !o.modules.includes("avl")) throw new HttpError(404, "This invoice isn’t available any more.");
  return { id: r.id as string, org: { id: r.orgId as string, row: o.row, modules: o.modules } };
}
export const withInvoice = <T>(token: string, fn: (id: string, orgId: string) => Promise<T>) =>
  invoiceByToken(token).then(({ id, org }) => inOrg(org, () => fn(id, org.id)));

export async function clientInvoicePage(id: string, confirming = false): Promise<ClientInvoicePage> {
  await settleCheckouts(id);
  await sql`update ops.job_invoices set viewed_at = now() where id = ${id} and viewed_at is null`;
  const inv = await invoiceDetail(id);
  const [[c], [j], { business, logo }, card] = await Promise.all([
    sql`select name, contact_name, address_line1, address_line2, city, state, postal_code from ops.customers where id = ${inv.customer?.id ?? ""}`,
    sql`select site_line1, site_city, site_state from ops.jobs where id = ${inv.job.id}`,
    letterhead(), stripeConnected(),
  ]);
  const { payments, createdBy: _c, publicToken: _p, lines, ...rest } = inv;
  return {
    invoice: { ...rest, lines: shownLines(lines, inv.summarize) },
    payments: payments.filter((p) => p.status === "SUCCEEDED").map((p) => ({ amountCents: p.amountCents, method: p.provider === "STRIPE" ? "Card" : p.method, at: p.receivedOn ?? p.createdAt.slice(0, 10) })),
    business, logo,
    customer: c ? { name: c.name, contactName: c.contactName ?? null, address: [c.addressLine1, c.addressLine2, [c.city, c.state, c.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null } : null,
    site: j ? [j.siteLine1, [j.siteCity, j.siteState].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null : null,
    cardPayments: card && inv.status === "SENT",
    confirming: confirming && inv.status === "SENT",
    terms: null,
  };
}

/* ═════════════ Selections ═════════════ */

const OptionSchema = z.object({
  id: z.string().max(60).nullish(),
  name: z.string().trim().min(1, "Name every option.").max(200),
  description: optText(2000),
  priceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  costCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
});
export const SelectionSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  description: optText(5000),
  dueDate: optDate,
  options: z.array(OptionSchema).min(2, "Give the client at least two options.").max(30),
});

export async function selectionsOf(jobId: string): Promise<Selection[]> {
  const [sels, opts] = await Promise.all([
    sql`select * from ops.job_selections where job_id = ${jobId} order by sort_order, created_at`,
    sql`select o.* from ops.job_selection_options o join ops.job_selections s on s.id = o.selection_id where s.job_id = ${jobId} order by o.sort_order, o.id`,
  ]);
  return sels.map((s) => ({
    id: s.id, title: s.title, description: s.description ?? null, dueDate: day(s.dueDate), status: s.status,
    options: opts.filter((o) => o.selectionId === s.id).map((o) => ({ id: o.id, name: o.name, description: o.description ?? null, priceCents: n(o.priceCents), costCents: n(o.costCents) })),
    chosenOptionId: s.chosenOptionId ?? null, chosenBy: s.chosenBy ?? null, chosenAt: iso(s.chosenAt), budgetItemId: s.budgetItemId ?? null,
  }));
}

async function writeOptions(selectionId: string, options: z.infer<typeof OptionSchema>[]) {
  const keep = options.filter((o) => o.id).map((o) => o.id as string);
  await sql`delete from ops.job_selection_options where selection_id = ${selectionId} ${keep.length ? sql`and id <> all(${keep})` : sql``}`;
  for (const [i, o] of options.entries()) {
    const row = { name: o.name, description: o.description, priceCents: o.priceCents, costCents: o.costCents, sortOrder: i };
    const [u] = o.id ? await sql`update ops.job_selection_options set ${sql(row)} where id = ${o.id} and selection_id = ${selectionId} returning id` : [];
    if (!u) await sql`insert into ops.job_selection_options ${sql({ ...row, selectionId })}`;
  }
}

export async function createSelection(jobId: string, input: z.infer<typeof SelectionSchema>) {
  const [{ c }] = await sql`select count(*)::int as c from ops.job_selections where job_id = ${jobId}`;
  const { options, ...rest } = input;
  const [s] = await sql`insert into ops.job_selections ${sql({ ...rest, jobId, sortOrder: c })} returning id`;
  await writeOptions(s.id, options);
  return s.id as string;
}

async function selectionRow(id: string) {
  const [s] = await sql`select * from ops.job_selections where id = ${id} for update`;
  if (!s) throw new HttpError(404, "Selection not found");
  return s;
}
async function billedItem(budgetItemId: string | null) {
  if (!budgetItemId) return false;
  const [b] = await sql`select 1 from ops.job_invoice_lines l join ops.job_invoices i on i.id = l.invoice_id where l.budget_item_id = ${budgetItemId} and i.status <> 'VOID' limit 1`;
  return Boolean(b);
}

export async function saveSelection(id: string, input: z.infer<typeof SelectionSchema>) {
  const s = await selectionRow(id);
  if (s.status === "LOCKED") throw new HttpError(409, "This selection is locked. Unlock it to change it.");
  const { options, ...rest } = input;
  await sql`update ops.job_selections set ${sql(rest)} where id = ${id}`;
  await writeOptions(id, options);
  // The chosen option may have changed price or gone.
  if (s.chosenOptionId) {
    const [o] = await sql`select id from ops.job_selection_options where id = ${s.chosenOptionId}`;
    if (o) await pick(id, s.chosenOptionId, s.chosenBy ?? "the business");
    else await clearPick(id);
  }
}

async function clearPick(id: string) {
  const s = await selectionRow(id);
  if (await billedItem(s.budgetItemId)) throw new HttpError(409, "This pick is already on an invoice, so it can't change.");
  if (s.budgetItemId) await sql`delete from ops.budget_items where id = ${s.budgetItemId}`;
  await sql`update ops.job_selections set status = 'OPEN', chosen_option_id = null, chosen_by = null, chosen_at = null, budget_item_id = null where id = ${id}`;
}

/** The client's (or the business's) pick: it goes into the job's budget under "Selections". */
export async function pick(id: string, optionId: string, who: string) {
  const s = await selectionRow(id);
  if (s.status === "LOCKED") throw new HttpError(409, "This selection is final. Ask the business if you need to change it.");
  if (s.dueDate && day(s.dueDate)! < today() && who.endsWith("(client)") && s.chosenOptionId) throw new HttpError(409, "The deadline for this selection has passed. Ask the business if you need to change it.");
  const [o] = await sql`select * from ops.job_selection_options where id = ${optionId} and selection_id = ${id}`;
  if (!o) throw new HttpError(404, "That option isn't here any more.");
  if (s.budgetItemId && s.chosenOptionId !== optionId && await billedItem(s.budgetItemId)) throw new HttpError(409, "This pick is already on an invoice, so it can't change.");
  let [g] = await sql`select id from ops.budget_items where job_id = ${s.jobId} and kind = 'GROUP' and parent_id is null and name = 'Selections'`;
  if (!g) {
    const [{ m }] = await sql`select coalesce(max(sort_order), 0) + 1 as m from ops.budget_items where job_id = ${s.jobId} and parent_id is null`;
    [g] = await sql`insert into ops.budget_items ${sql({ jobId: s.jobId, kind: "GROUP", name: "Selections", sortOrder: m })} returning id`;
  }
  const item = { name: `${s.title}: ${o.name}`, description: o.description ?? null, costType: "MATERIAL", quantity: 1, unit: "ea", unitCostCents: n(o.costCents), unitPriceCents: n(o.priceCents), taxable: true };
  let itemId = s.budgetItemId as string | null;
  if (itemId) {
    const [u] = await sql`update ops.budget_items set ${sql(item)} where id = ${itemId} returning id`;
    if (!u) itemId = null;
  }
  if (!itemId) {
    const [{ m }] = await sql`select coalesce(max(sort_order), 0) + 1 as m from ops.budget_items where parent_id = ${g.id}`;
    [{ id: itemId }] = await sql`insert into ops.budget_items ${sql({ ...item, jobId: s.jobId, parentId: g.id, kind: "ITEM", sortOrder: m })} returning id`;
  }
  await sql`update ops.job_selections set status = 'CHOSEN', chosen_option_id = ${optionId}, chosen_by = ${who}, chosen_at = now(), budget_item_id = ${itemId} where id = ${id}`;
  await sql`update ops.jobs set updated_at = now() where id = ${s.jobId}`;
  return { jobId: s.jobId as string, title: s.title as string, option: o.name as string, priceCents: n(o.priceCents) };
}

export async function lockSelection(id: string, locked: boolean) {
  const s = await selectionRow(id);
  if (locked && !s.chosenOptionId) throw new HttpError(409, "Nothing has been picked yet.");
  await sql`update ops.job_selections set status = ${locked ? "LOCKED" : s.chosenOptionId ? "CHOSEN" : "OPEN"} where id = ${id}`;
}
export async function deleteSelection(id: string) {
  const s = await selectionRow(id);
  if (await billedItem(s.budgetItemId)) throw new HttpError(409, "This pick is already on an invoice. Lock it instead.");
  if (s.budgetItemId) await sql`delete from ops.budget_items where id = ${s.budgetItemId}`;
  await sql`delete from ops.job_selections where id = ${id}`;
  return s.jobId as string;
}

/* ═════════════ Reports ═════════════ */

export async function reports(from: string, to: string): Promise<AvlReports> {
  const months: string[] = [];
  { const [y, m] = to.split("-").map(Number); for (let k = 11; k >= 0; k--) { const d = new Date(y, m - 1 - k, 1); months.push(isoDay(d).slice(0, 7)); } }
  const start = `${months[0]}-01`;
  const [pipe, [wl], inv, paid, jobs, unpaid, hours] = await Promise.all([
    sql`select stage, count(*)::int as c, coalesce(sum(value_cents), 0)::bigint as v from ops.leads where stage not in ('WON', 'LOST') group by stage`,
    sql`select count(*) filter (where stage = 'WON')::int as won, count(*) filter (where stage = 'LOST')::int as lost,
          coalesce(sum(value_cents) filter (where stage = 'WON'), 0)::bigint as won_value
        from ops.leads where stage in ('WON', 'LOST') and coalesce(won_at, lost_at, updated_at)::date between ${from} and ${to}`,
    sql`select to_char(issue_date, 'YYYY-MM') as m, sum(subtotal_cents)::bigint as c from ops.job_invoices where status in ('SENT', 'PAID') and issue_date >= ${start} group by 1`,
    sql`select to_char(coalesce(received_on, created_at::date), 'YYYY-MM') as m, sum(amount_cents)::bigint as c from ops.payments
        where invoice_id is not null and status = 'SUCCEEDED' and coalesce(received_on, created_at::date) >= ${start} group by 1`,
    sql`select j.id, j.number, j.name, j.status,
          coalesce((select sum(round(b.quantity * b.unit_price_cents)) from ops.budget_items b where b.job_id = j.id and b.kind = 'ITEM'), 0)::bigint as price,
          coalesce((select sum(round(b.quantity * b.unit_cost_cents)) from ops.budget_items b where b.job_id = j.id and b.kind = 'ITEM'), 0)::bigint as budget_cost,
          (coalesce((select sum(round(l.quantity * l.unit_cost_cents)) from ops.vendor_bill_lines l join ops.vendor_bills vb on vb.id = l.bill_id where vb.job_id = j.id and vb.status <> 'VOID'), 0)
            + coalesce((select sum(other_cents) from ops.vendor_bills vb where vb.job_id = j.id and vb.status <> 'VOID'), 0)
            + coalesce((select sum(round(t.minutes * t.cost_rate_cents / 60.0)) from ops.time_entries t where t.job_id = j.id), 0))::bigint as actual
        from ops.jobs j where j.status <> 'CANCELLED' and (j.status <> 'COMPLETE' or j.updated_at::date >= ${from}) order by j.number desc limit 200`,
    invoiceRows(sql`i.status = 'SENT'`, sql`i.due_date nulls last, i.number`, 500),
    sql`select j.id, j.number, j.name, coalesce(sum(t.minutes), 0)::int as minutes, coalesce(sum(round(t.minutes * t.cost_rate_cents / 60.0)), 0)::bigint as cost,
          (select sum(round(b.quantity * 60))::int from ops.budget_items b where b.job_id = j.id and b.kind = 'ITEM' and b.cost_type = 'LABOR' and lower(coalesce(b.unit, '')) in ('hr', 'hrs', 'hour', 'hours', 'h')) as budget
        from ops.jobs j join ops.time_entries t on t.job_id = j.id and t.work_date between ${from} and ${to}
        group by j.id order by minutes desc limit 100`,
  ]);
  const t = today();
  const aging = emptyAging();
  const open = unpaid.filter((i) => i.balanceCents > 0);
  for (const i of open) addAging(aging, i.balanceCents, i.dueDate, t);
  const won = n(wl?.won), lost = n(wl?.lost);
  const order: LeadStage[] = ["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL"];
  return {
    from, to,
    pipeline: order.map((s) => { const r = pipe.find((x) => x.stage === s); return { stage: s, label: stageLabel(s), count: n(r?.c), valueCents: n(r?.v) }; }),
    winRate: { won, lost, bps: won + lost ? Math.round((won * 10_000) / (won + lost)) : 0, wonValueCents: n(wl?.wonValue) },
    revenueByMonth: months.map((m) => ({ month: m, invoicedCents: n(inv.find((r) => r.m === m)?.c), collectedCents: n(paid.find((r) => r.m === m)?.c) })),
    marginByJob: jobs.filter((j) => n(j.price) > 0).map((j) => {
      const price = n(j.price), projected = Math.max(n(j.budgetCost), n(j.actual));
      return { id: j.id, number: j.number, name: j.name, status: j.status, priceCents: price, projectedCostCents: projected, actualCostCents: n(j.actual), marginBps: price > 0 ? Math.round(((price - projected) * 10_000) / price) : 0 };
    }),
    unpaid: open,
    aging,
    hoursByJob: hours.map((h) => ({ id: h.id, number: h.number, name: h.name, minutes: n(h.minutes), budgetMinutes: h.budget ?? null, costCents: n(h.cost) })),
  };
}

export { invoiceHref };

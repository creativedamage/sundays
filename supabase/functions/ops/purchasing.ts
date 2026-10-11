/**
 * AVL purchasing and job costing: purchase orders (approved by an AVL Manager, then emailed to the
 * vendor), receiving, work orders for subcontractors and installers, vendor bills, change orders
 * the client signs online, and the job costing figures (see lib/purchasing.ts).
 *
 * Every line of a PO, work order, bill or change order can point at a job budget item; committed
 * and actual cost are sums over those links.
 */
import { z } from "zod";
import { can } from "./lib/rbac.ts";
import type { OpsSessionUser } from "./lib/types.ts";
import {
  billTotal, coTotals, jobCosting, PO_COMMITTED, poEditable, poReceivable, poTotals, WO_COMMITTED,
  type BillLink, type BillRow, type BillStatus, type ChangeOrder, type ClientChangeOrderPage, type CoLine, type CoRow, type CoStatus, type CostLink,
  type ItemCosts, type JobCosting, type OrderableLine, type PoEvent, type PoRow, type PoStatus, type PublicWorkOrderPage, type PurchaseOrder,
  type PurchasingPage, type VendorBill, type VendorPoPage, type WoRow, type WorkOrder, type WoStatus,
} from "./lib/purchasing.ts";
import { budgetOf } from "./jobs.ts";
import { getAvl, hasModule, HttpError, inOrg, nextNumber, raw, sql, type Tx } from "./db.ts";
import { loadOrg } from "./auth.ts";
import { newPublicToken } from "./quotes.ts";
import { readLinks } from "./storage.ts";
import { isEmail, render, SITE } from "./mail.ts";
import { businessName, first, money as $, queue } from "./avlmail.ts";

type U = OpsSessionUser;
type Db = typeof sql | Tx;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const day = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const n = (v: unknown) => Number(v ?? 0);
const cents = z.number().int().min(0).max(1_000_000_000);
const signedCents = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const optText = (len: number) => z.string().trim().max(len).nullish().transform((v) => v || null);
const optId = z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null);
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null);
const ref = (id: unknown, number: unknown, name?: unknown) => (id ? { id: id as string, number: number as string, ...(name !== undefined ? { name: name as string } : {}) } : null);

export const canApprovePo = (u: U) => can(u, "AVL_PURCHASING");
export const poUrl = (t: string) => `${SITE}/vendor-po?t=${encodeURIComponent(t)}`;
export const woUrl = (t: string) => `${SITE}/work-order?t=${encodeURIComponent(t)}`;
export const coUrl = (t: string) => `${SITE}/change-order?t=${encodeURIComponent(t)}`;

async function prefix() { return ((await getAvl()).quotePrefix as string) || "AV"; }

/** Budget items of this job by id (to check that lines point at the right job). */
async function jobItems(jobId: string | null, db: Db = sql) {
  if (!jobId) return new Set<string>();
  return new Set((await db`select id from ops.budget_items where job_id = ${jobId} and kind = 'ITEM'`).map((r) => r.id as string));
}
async function mustJob(jobId: string, db: Db = sql) {
  const [j] = await db`select id, number, name, quote_id from ops.jobs where id = ${jobId}`;
  if (!j) throw new HttpError(404, "Job not found");
  return j;
}

/* ═════════════ Purchase orders ═════════════ */

const PoLineSchema = z.object({
  budgetItemId: optId, productId: optId,
  sku: optText(120), name: z.string().trim().min(1, "Name each line.").max(300), description: optText(2000),
  quantity: z.number().int().min(1, "Quantities start at 1.").max(100_000), unit: optText(20), unitCostCents: cents,
});
export const PoSchema = z.object({
  vendorId: z.string().min(1, "Pick the vendor.").max(60),
  jobId: optId,
  expectedDate: optDate, shipTo: optText(500), notes: optText(5000),
  shippingCents: cents.default(0), taxCents: cents.default(0),
  lines: z.array(PoLineSchema).max(500),
});
type PoInput = z.infer<typeof PoSchema>;

const poTotal = sql`(select coalesce(sum(round(i.quantity * i.unit_cost_cents)), 0) from ops.purchase_order_items i where i.po_id = p.id) + p.shipping_cents + p.tax_cents`;
const billTotalSql = sql`(select coalesce(sum(round(l.quantity * l.unit_cost_cents)), 0) from ops.vendor_bill_lines l where l.bill_id = b.id) + b.other_cents`;

export async function poRows(where: unknown, limit = 500): Promise<PoRow[]> {
  const rows = await sql`select p.id, p.number, p.status, p.vendor_id, v.name as vendor_name, p.job_id, j.number as job_number, j.name as job_name,
      p.expected_date, p.created_at, u.name as created_name, ${poTotal} as total,
      (select count(*)::int from ops.purchase_order_items i where i.po_id = p.id) as lines,
      (select coalesce(sum(i.received_qty), 0)::float / nullif(sum(i.quantity), 0) from ops.purchase_order_items i where i.po_id = p.id) as received
    from ops.purchase_orders p left join ops.vendors v on v.id = p.vendor_id left join ops.jobs j on j.id = p.job_id left join ops.users u on u.id = p.created_by_id
    where ${where as never}
    order by case p.status when 'PENDING_APPROVAL' then 0 when 'APPROVED' then 1 when 'ORDERED' then 2 when 'PARTIAL' then 3 when 'DRAFT' then 4 else 5 end, p.created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, vendor: r.vendorId ? { id: r.vendorId, name: r.vendorName } : null,
    job: ref(r.jobId, r.jobNumber, r.jobName) as PoRow["job"], totalCents: n(r.total), lines: r.lines, receivedPct: Math.round(n(r.received) * 100),
    expectedDate: day(r.expectedDate), createdAt: iso(r.createdAt)!, createdBy: r.createdName ?? null,
  }));
}

export async function poDetail(id: string, db: Db = sql): Promise<PurchaseOrder> {
  const [p] = await db`select p.*, v.name as vendor_name, v.rep_name, v.rep_email, v.account_no, j.number as job_number, j.name as job_name,
      cu.name as created_name, au.name as approved_name
    from ops.purchase_orders p left join ops.vendors v on v.id = p.vendor_id left join ops.jobs j on j.id = p.job_id
      left join ops.users cu on cu.id = p.created_by_id left join ops.users au on au.id = p.approved_by_id
    where p.id = ${id}`;
  if (!p) throw new HttpError(404, "Purchase order not found");
  const [lines, receipts, bills] = await Promise.all([
    db`select i.*, coalesce((select sum(bl.quantity) from ops.vendor_bill_lines bl join ops.vendor_bills b on b.id = bl.bill_id where bl.po_item_id = i.id and b.status <> 'VOID'), 0) as billed
      from ops.purchase_order_items i where i.po_id = ${id} order by i.sort_order, i.id`,
    db`select r.*, u.name as by_name from ops.po_receipts r left join ops.users u on u.id = r.received_by_id where r.po_id = ${id} order by r.received_at desc`,
    db`select b.id, b.bill_number, b.status, b.bill_date, ${billTotalSql} as total from ops.vendor_bills b where b.po_id = ${id} order by b.bill_date desc`,
  ]);
  const ls = lines.map((l) => ({
    id: l.id, budgetItemId: l.budgetItemId ?? null, productId: l.productId ?? null, sku: l.sku ?? null, name: l.name, description: l.description ?? null,
    quantity: n(l.quantity), unit: l.unit ?? null, unitCostCents: n(l.unitCostCents), receivedQty: n(l.receivedQty), billedQty: n(l.billed), sortOrder: l.sortOrder,
  }));
  const t = poTotals(ls, n(p.shippingCents), n(p.taxCents));
  const bl = bills.map((b) => ({ id: b.id, billNumber: b.billNumber ?? null, status: b.status, billDate: day(b.billDate)!, totalCents: n(b.total) })) as BillLink[];
  return {
    id: p.id, number: p.number, status: p.status,
    vendor: p.vendorId ? { id: p.vendorId, name: p.vendorName, repName: p.repName ?? null, repEmail: p.repEmail ?? null, accountNo: p.accountNo ?? null } : null,
    job: ref(p.jobId, p.jobNumber, p.jobName) as PurchaseOrder["job"],
    lines: ls, subtotalCents: t.subtotalCents, shippingCents: n(p.shippingCents), taxCents: n(p.taxCents), totalCents: t.totalCents,
    expectedDate: day(p.expectedDate), shipTo: p.shipTo ?? null, notes: p.notes ?? null, rejectedNote: p.rejectedNote ?? null,
    createdBy: p.createdName ?? null, createdAt: iso(p.createdAt)!, submittedAt: iso(p.submittedAt), approvedAt: iso(p.approvedAt), approvedBy: p.approvedName ?? null,
    sentAt: iso(p.sentAt), sentTo: p.sentTo ?? null, orderedAt: iso(p.orderedAt), vendorUrl: p.publicToken ? poUrl(p.publicToken) : null,
    receipts: receipts.map((r) => ({ id: r.id, at: iso(r.receivedAt)!, by: r.byName ?? null, note: r.note ?? null, lines: r.lines ?? [] })),
    bills: bl, billedCents: bl.filter((b) => b.status !== "VOID").reduce((s, b) => s + b.totalCents, 0),
  };
}

async function writePoLines(db: Db, poId: string, jobId: string | null, lines: PoInput["lines"]) {
  const ok = await jobItems(jobId, db);
  await db`delete from ops.purchase_order_items where po_id = ${poId}`;
  if (!lines.length) return;
  await db`insert into ops.purchase_order_items ${db(lines.map((l, i) => ({
    poId, budgetItemId: l.budgetItemId && ok.has(l.budgetItemId) ? l.budgetItemId : null, productId: l.productId, sku: l.sku, name: l.name,
    description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents, receivedQty: 0, sortOrder: i,
  })))}`;
}

export async function createPo(input: PoInput, userId: string): Promise<{ id: string; number: string }> {
  if (input.jobId) await mustJob(input.jobId);
  const number = await nextNumber(sql, "PO", await prefix());
  const [p] = await sql`insert into ops.purchase_orders ${sql({
    number, vendorId: input.vendorId, jobId: input.jobId, createdById: userId, status: "DRAFT", expectedDate: input.expectedDate,
    shipTo: input.shipTo, notes: input.notes, shippingCents: input.shippingCents, taxCents: input.taxCents,
  })} returning id, number`;
  await writePoLines(sql, p.id, input.jobId, input.lines);
  return { id: p.id, number: p.number };
}

export async function savePo(id: string, input: PoInput) {
  const [p] = await sql`select status from ops.purchase_orders where id = ${id} for update`;
  if (!p) throw new HttpError(404, "Purchase order not found");
  if (!poEditable(p.status)) throw new HttpError(409, "This purchase order is approved, so it can't change. Cancel it and make a new one if you need to.");
  if (input.jobId) await mustJob(input.jobId);
  await sql`update ops.purchase_orders set ${sql({
    vendorId: input.vendorId, jobId: input.jobId, expectedDate: input.expectedDate, shipTo: input.shipTo, notes: input.notes,
    shippingCents: input.shippingCents, taxCents: input.taxCents, updatedAt: new Date(),
  })} where id = ${id}`;
  await writePoLines(sql, id, input.jobId, input.lines);
}

export async function deletePo(id: string) {
  const [p] = await sql`select status, number from ops.purchase_orders where id = ${id}`;
  if (!p) throw new HttpError(404, "Purchase order not found");
  if (p.status !== "DRAFT" && p.status !== "CANCELLED") throw new HttpError(409, "Only a draft or cancelled purchase order can be deleted.");
  const [b] = await sql`select 1 from ops.vendor_bills where po_id = ${id} limit 1`;
  if (b) throw new HttpError(409, "This purchase order has bills, so it stays.");
  await sql`delete from ops.purchase_orders where id = ${id}`;
  return p.number as string;
}

const PO_FROM: Record<PoEvent, PoStatus[]> = {
  SUBMIT: ["DRAFT"],
  APPROVE: ["DRAFT", "PENDING_APPROVAL"],
  REJECT: ["PENDING_APPROVAL"],
  SEND: ["APPROVED", "ORDERED", "PARTIAL"],
  MARK_ORDERED: ["APPROVED"],
  CANCEL: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"],
  REOPEN: ["CANCELLED"],
};

/** Move a PO along. Returns the PO and, for SEND, where the email went (or why it didn't). */
export async function poEvent(id: string, event: PoEvent, u: U, opts: { note?: string | null; emailTo?: string | null } = {}) {
  const [p] = await sql`select * from ops.purchase_orders where id = ${id} for update`;
  if (!p) throw new HttpError(404, "Purchase order not found");
  if (!PO_FROM[event].includes(p.status)) throw new HttpError(409, `A purchase order that is ${p.status.toLowerCase().replace("_", " ")} can't do that.`);
  const now = new Date();
  const set: Row = { updatedAt: now };
  let mail: { emailedTo: string | null; emailError: string | null } | null = null;
  switch (event) {
    case "SUBMIT": {
      const [{ c }] = await sql`select count(*)::int as c from ops.purchase_order_items where po_id = ${id}`;
      if (!c) throw new HttpError(422, "Add at least one line first.");
      Object.assign(set, { status: "PENDING_APPROVAL", submittedAt: now, rejectedNote: null });
      break;
    }
    case "APPROVE": {
      if (!canApprovePo(u)) throw new HttpError(403, "An AVL Manager approves purchase orders.");
      const [{ c }] = await sql`select count(*)::int as c from ops.purchase_order_items where po_id = ${id}`;
      if (!c) throw new HttpError(422, "Add at least one line first.");
      Object.assign(set, { status: "APPROVED", approvedAt: now, approvedById: u.id, submittedAt: p.submittedAt ?? now, rejectedNote: null, publicToken: p.publicToken ?? newPublicToken() });
      break;
    }
    case "REJECT":
      if (!canApprovePo(u)) throw new HttpError(403, "An AVL Manager approves purchase orders.");
      if (!opts.note?.trim()) throw new HttpError(422, "Say what needs to change.");
      Object.assign(set, { status: "DRAFT", rejectedNote: opts.note.trim(), submittedAt: null });
      break;
    case "SEND": {
      const to = (opts.emailTo ?? "").trim();
      if (!isEmail(to)) throw new HttpError(422, "Enter the vendor's email address.");
      Object.assign(set, { status: p.status === "APPROVED" ? "ORDERED" : p.status, orderedAt: p.orderedAt ?? now, sentAt: now, sentTo: to, publicToken: p.publicToken ?? newPublicToken() });
      break;
    }
    case "MARK_ORDERED":
      Object.assign(set, { status: "ORDERED", orderedAt: now, publicToken: p.publicToken ?? newPublicToken() });
      break;
    case "CANCEL": {
      const [r] = await sql`select 1 from ops.purchase_order_items where po_id = ${id} and received_qty > 0 limit 1`;
      if (r) throw new HttpError(409, "Some of this order has been received, so it can't be cancelled.");
      Object.assign(set, { status: "CANCELLED", cancelledAt: now });
      break;
    }
    case "REOPEN":
      Object.assign(set, { status: "DRAFT", cancelledAt: null, approvedAt: null, approvedById: null, submittedAt: null });
      break;
  }
  await sql`update ops.purchase_orders set ${sql(set)} where id = ${id}`;
  const po = await poDetail(id);
  if (event === "SEND") {
    mail = await emailPo(po, opts.emailTo!.trim());
    // Nothing changes when the email can't go (the request is one transaction).
    if (!mail.emailedTo) throw new HttpError(409, `${mail.emailError} You can mark it ordered instead.`);
  }
  if (event === "SUBMIT") await notifyApprovers(po, u);
  if (event === "REJECT") await notifyRejected(po, u, opts.note!.trim());
  return { po, mail };
}

export const ReceiveSchema = z.object({
  lines: z.array(z.object({ itemId: z.string().min(1).max(60), qty: z.number().int().min(-100_000).max(100_000) })).min(1).max(500),
  note: optText(2000),
});
/** Record what arrived (a negative quantity corrects an earlier count). */
export async function receivePo(id: string, u: U, input: z.infer<typeof ReceiveSchema>) {
  const [p] = await sql`select * from ops.purchase_orders where id = ${id} for update`;
  if (!p) throw new HttpError(404, "Purchase order not found");
  if (!poReceivable(p.status) && !(p.status === "RECEIVED" && input.lines.some((l) => l.qty < 0))) throw new HttpError(409, "Only an ordered purchase order can be received.");
  const items = await sql`select id, name, quantity, received_qty from ops.purchase_order_items where po_id = ${id}`;
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const done: { itemId: string; name: string; qty: number }[] = [];
  for (const l of input.lines) {
    if (!l.qty) continue;
    const it = byId.get(l.itemId);
    if (!it) throw new HttpError(422, "A line isn't on this purchase order.");
    const next = n(it.receivedQty) + l.qty;
    if (next < 0) throw new HttpError(422, `“${it.name}”: that's more than was received.`);
    if (next > n(it.quantity)) throw new HttpError(422, `“${it.name}”: only ${n(it.quantity) - n(it.receivedQty)} more ${n(it.quantity) - n(it.receivedQty) === 1 ? "is" : "are"} on order.`);
    await sql`update ops.purchase_order_items set received_qty = ${next} where id = ${it.id}`;
    it.receivedQty = next;
    done.push({ itemId: it.id, name: it.name, qty: l.qty });
  }
  if (!done.length) throw new HttpError(422, "Enter how many arrived.");
  const all = items.every((i) => n(i.receivedQty) >= n(i.quantity));
  const any = items.some((i) => n(i.receivedQty) > 0);
  await sql`update ops.purchase_orders set ${sql({ status: all ? "RECEIVED" : any ? "PARTIAL" : "ORDERED", orderedAt: p.orderedAt ?? new Date(), updatedAt: new Date() })} where id = ${id}`;
  await sql`insert into ops.po_receipts ${sql({ poId: id, receivedById: u.id, note: input.note, lines: sql.json(done) })}`;
  return poDetail(id);
}

/** Material lines on the job's budget not yet fully on purchase orders, with the vendor from the catalog. */
export async function orderable(jobId: string): Promise<OrderableLine[]> {
  const rows = await sql`select b.id, b.name, b.quantity, b.unit, b.unit_cost_cents, b.product_id, p.sku, p.vendor_id, v.name as vendor_name, g.name as group_name,
      coalesce((select sum(i.quantity) from ops.purchase_order_items i join ops.purchase_orders po on po.id = i.po_id where i.budget_item_id = b.id and po.status <> 'CANCELLED'), 0) as ordered
    from ops.budget_items b left join ops.products p on p.id = b.product_id left join ops.vendors v on v.id = p.vendor_id and v.active
      left join ops.budget_items g on g.id = b.parent_id
    where b.job_id = ${jobId} and b.kind = 'ITEM' and b.cost_type = 'MATERIAL' and b.quantity > 0
    order by g.sort_order nulls first, b.sort_order`;
  return rows.map((r) => {
    const budgetQty = Math.ceil(n(r.quantity)), orderedQty = n(r.ordered);
    return {
      budgetItemId: r.id, name: r.name, group: r.groupName ?? null, sku: r.sku ?? null, productId: r.productId ?? null,
      vendorId: r.vendorName ? r.vendorId : null, vendorName: r.vendorName ?? null,
      budgetQty, orderedQty, remainingQty: Math.max(0, budgetQty - orderedQty), unit: r.unit ?? null, unitCostCents: n(r.unitCostCents),
    };
  }).filter((r) => r.remainingQty > 0);
}

export const FromBudgetSchema = z.object({
  lines: z.array(z.object({ budgetItemId: z.string().min(1).max(60), vendorId: z.string().min(1, "Pick a vendor for each line.").max(60), quantity: z.number().int().min(1).max(100_000), unitCostCents: cents })).min(1, "Pick at least one line.").max(500),
});
/** Draft purchase orders from budget lines, one per vendor. */
export async function posFromBudget(jobId: string, input: z.infer<typeof FromBudgetSchema>, userId: string) {
  await mustJob(jobId);
  const items = await sql`select b.id, b.name, b.description, b.unit, b.product_id, p.sku from ops.budget_items b left join ops.products p on p.id = b.product_id
    where b.job_id = ${jobId} and b.kind = 'ITEM' and b.id = any(${input.lines.map((l) => l.budgetItemId)})`;
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const byVendor = new Map<string, PoInput["lines"]>();
  for (const l of input.lines) {
    const b = byId.get(l.budgetItemId);
    if (!b) throw new HttpError(422, "A line isn't on this job's budget.");
    byVendor.set(l.vendorId, [...(byVendor.get(l.vendorId) ?? []), {
      budgetItemId: b.id, productId: b.productId ?? null, sku: b.sku ?? null, name: b.name, description: null, quantity: l.quantity, unit: b.unit ?? null, unitCostCents: l.unitCostCents,
    }]);
  }
  const vendors = await sql`select id, name from ops.vendors where id = any(${[...byVendor.keys()]})`;
  if (vendors.length !== byVendor.size) throw new HttpError(422, "Pick a vendor for each line.");
  const out: { id: string; number: string; vendor: string }[] = [];
  for (const [vendorId, lines] of byVendor) {
    const po = await createPo({ vendorId, jobId, expectedDate: null, shipTo: null, notes: null, shippingCents: 0, taxCents: 0, lines }, userId);
    out.push({ ...po, vendor: vendors.find((v) => v.id === vendorId)!.name });
  }
  return out;
}

/* ═════════════ Work orders ═════════════ */

export const WoSchema = z.object({
  title: z.string().trim().min(1, "Give the work order a title.").max(200),
  vendorId: optId,
  assigneeName: optText(200),
  assigneeEmail: z.string().trim().email("That email doesn't look right.").max(200).nullish().or(z.literal("")).transform((v) => v || null),
  scope: optText(20000), startDate: optDate, dueDate: optDate,
  lines: z.array(z.object({ budgetItemId: optId, description: z.string().trim().min(1, "Describe each line.").max(500), quantity: z.number().positive().max(100_000), unit: optText(20), unitCostCents: cents })).max(200),
});
type WoInput = z.infer<typeof WoSchema>;
const woTotal = sql`(select coalesce(sum(round(i.quantity * i.unit_cost_cents)), 0) from ops.work_order_items i where i.work_order_id = w.id)`;

export async function woRows(where: unknown, limit = 500): Promise<WoRow[]> {
  const rows = await sql`select w.id, w.number, w.title, w.status, w.due_date, w.created_at, w.assignee_name, v.name as vendor_name, j.id as job_id, j.number as job_number, j.name as job_name, ${woTotal} as total
    from ops.work_orders w join ops.jobs j on j.id = w.job_id left join ops.vendors v on v.id = w.vendor_id
    where ${where as never} order by case w.status when 'DRAFT' then 0 when 'SENT' then 1 when 'ACCEPTED' then 2 else 3 end, w.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, number: r.number, title: r.title, status: r.status, who: r.vendorName ?? r.assigneeName ?? null,
    job: { id: r.jobId, number: r.jobNumber, name: r.jobName }, totalCents: n(r.total), dueDate: day(r.dueDate), createdAt: iso(r.createdAt)!,
  }));
}

export async function woDetail(id: string): Promise<WorkOrder> {
  const [w] = await sql`select w.*, v.name as vendor_name, v.rep_email, j.number as job_number, j.name as job_name, u.name as created_name
    from ops.work_orders w join ops.jobs j on j.id = w.job_id left join ops.vendors v on v.id = w.vendor_id left join ops.users u on u.id = w.created_by_id where w.id = ${id}`;
  if (!w) throw new HttpError(404, "Work order not found");
  const [lines, bills] = await Promise.all([
    sql`select * from ops.work_order_items where work_order_id = ${id} order by sort_order, id`,
    sql`select b.id, b.bill_number, b.status, b.bill_date, ${billTotalSql} as total from ops.vendor_bills b where b.work_order_id = ${id} order by b.bill_date desc`,
  ]);
  const ls = lines.map((l) => ({ id: l.id, budgetItemId: l.budgetItemId ?? null, description: l.description, quantity: n(l.quantity), unit: l.unit ?? null, unitCostCents: n(l.unitCostCents), sortOrder: l.sortOrder }));
  const bl = bills.map((b) => ({ id: b.id, billNumber: b.billNumber ?? null, status: b.status, billDate: day(b.billDate)!, totalCents: n(b.total) })) as BillLink[];
  return {
    id: w.id, number: w.number, title: w.title, status: w.status, job: { id: w.jobId, number: w.jobNumber, name: w.jobName },
    vendor: w.vendorId ? { id: w.vendorId, name: w.vendorName, repEmail: w.repEmail ?? null } : null,
    assigneeName: w.assigneeName ?? null, assigneeEmail: w.assigneeEmail ?? null, scope: w.scope ?? null, startDate: day(w.startDate), dueDate: day(w.dueDate),
    lines: ls, totalCents: ls.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0),
    sentAt: iso(w.sentAt), sentTo: w.sentTo ?? null, acceptedAt: iso(w.acceptedAt), acceptedBy: w.acceptedBy ?? null, doneAt: iso(w.doneAt),
    createdBy: w.createdName ?? null, createdAt: iso(w.createdAt)!, publicUrl: w.publicToken ? woUrl(w.publicToken) : null,
    bills: bl, billedCents: bl.filter((b) => b.status !== "VOID").reduce((s, b) => s + b.totalCents, 0),
  };
}

async function writeWoLines(woId: string, jobId: string, lines: WoInput["lines"]) {
  const ok = await jobItems(jobId);
  await sql`delete from ops.work_order_items where work_order_id = ${woId}`;
  if (lines.length) await sql`insert into ops.work_order_items ${sql(lines.map((l, i) => ({ workOrderId: woId, budgetItemId: l.budgetItemId && ok.has(l.budgetItemId) ? l.budgetItemId : null, description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents, sortOrder: i })))}`;
}

export async function createWo(jobId: string, input: WoInput, userId: string) {
  await mustJob(jobId);
  const number = await nextNumber(sql, "WO", await prefix());
  const { lines, ...rest } = input;
  const [w] = await sql`insert into ops.work_orders ${sql({ ...rest, jobId, number, createdById: userId })} returning id, number`;
  await writeWoLines(w.id, jobId, lines);
  return { id: w.id as string, number: w.number as string };
}

export async function saveWo(id: string, input: WoInput) {
  const [w] = await sql`select status, job_id from ops.work_orders where id = ${id} for update`;
  if (!w) throw new HttpError(404, "Work order not found");
  if (w.status === "DONE" || w.status === "CANCELLED") throw new HttpError(409, "This work order is closed.");
  const { lines, ...rest } = input;
  await sql`update ops.work_orders set ${sql({ ...rest, updatedAt: new Date() })} where id = ${id}`;
  await writeWoLines(id, w.jobId, lines);
}

export type WoEvent = "SEND" | "MARK_SENT" | "MARK_ACCEPTED" | "DONE" | "CANCEL" | "REOPEN";
const WO_FROM: Record<WoEvent, WoStatus[]> = { SEND: ["DRAFT", "SENT", "ACCEPTED"], MARK_SENT: ["DRAFT"], MARK_ACCEPTED: ["SENT"], DONE: ["SENT", "ACCEPTED"], CANCEL: ["DRAFT", "SENT", "ACCEPTED"], REOPEN: ["CANCELLED", "DONE"] };
export async function woEvent(id: string, event: WoEvent, u: U, opts: { emailTo?: string | null } = {}) {
  const [w] = await sql`select * from ops.work_orders where id = ${id} for update`;
  if (!w) throw new HttpError(404, "Work order not found");
  if (!WO_FROM[event].includes(w.status)) throw new HttpError(409, `A work order that is ${w.status.toLowerCase()} can't do that.`);
  const now = new Date();
  const set: Row = { updatedAt: now };
  if (event === "SEND" || event === "MARK_SENT") {
    const [{ c }] = await sql`select count(*)::int as c from ops.work_order_items where work_order_id = ${id}`;
    if (!c && !w.scope) throw new HttpError(422, "Add the scope or at least one line first.");
  }
  if (event === "SEND") {
    if (!isEmail((opts.emailTo ?? "").trim())) throw new HttpError(422, "Enter who to email it to.");
    Object.assign(set, { status: w.status === "DRAFT" ? "SENT" : w.status, sentAt: now, sentTo: opts.emailTo!.trim(), publicToken: w.publicToken ?? newPublicToken() });
  }
  if (event === "MARK_SENT") Object.assign(set, { status: "SENT", sentAt: now, publicToken: w.publicToken ?? newPublicToken() });
  if (event === "MARK_ACCEPTED") Object.assign(set, { status: "ACCEPTED", acceptedAt: now, acceptedBy: u.name });
  if (event === "DONE") Object.assign(set, { status: "DONE", doneAt: now });
  if (event === "CANCEL") Object.assign(set, { status: "CANCELLED" });
  if (event === "REOPEN") Object.assign(set, { status: w.sentAt ? "SENT" : "DRAFT", doneAt: null });
  await sql`update ops.work_orders set ${sql(set)} where id = ${id}`;
  const wo = await woDetail(id);
  if (event === "SEND") {
    const mail = await emailWo(wo, opts.emailTo!.trim());
    if (!mail.emailedTo) throw new HttpError(409, `${mail.emailError} You can mark it sent and share the link instead.`);
  }
  return wo;
}

/* ═════════════ Vendor bills ═════════════ */

export const BillSchema = z.object({
  vendorId: optId, jobId: optId, poId: optId, workOrderId: optId,
  billNumber: optText(80), billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the bill date."), dueDate: optDate,
  otherCents: signedCents.default(0), notes: optText(5000), fileId: optId,
  lines: z.array(z.object({
    budgetItemId: optId, poItemId: optId, workOrderItemId: optId,
    description: z.string().trim().min(1, "Describe each line.").max(500),
    quantity: z.number().min(-100_000).max(100_000).refine((v) => v !== 0, "Quantities can't be 0."),
    unitCostCents: signedCents,
  })).max(500),
});
type BillInput = z.infer<typeof BillSchema>;

export async function billRows(where: unknown, limit = 500): Promise<BillRow[]> {
  const rows = await sql`select b.id, b.bill_number, b.status, b.bill_date, b.due_date, b.vendor_id, v.name as vendor_name, b.job_id, j.number as job_number, j.name as job_name,
      b.po_id, p.number as po_number, ${billTotalSql} as total
    from ops.vendor_bills b left join ops.vendors v on v.id = b.vendor_id left join ops.jobs j on j.id = b.job_id left join ops.purchase_orders p on p.id = b.po_id
    where ${where as never} order by case b.status when 'OPEN' then 0 else 1 end, b.due_date nulls last, b.bill_date desc limit ${limit}`;
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({
    id: r.id, billNumber: r.billNumber ?? null, status: r.status, vendor: r.vendorId ? { id: r.vendorId, name: r.vendorName } : null,
    job: ref(r.jobId, r.jobNumber, r.jobName) as BillRow["job"], po: ref(r.poId, r.poNumber) as BillRow["po"],
    billDate: day(r.billDate)!, dueDate: day(r.dueDate), totalCents: n(r.total), overdue: r.status === "OPEN" && !!r.dueDate && day(r.dueDate)! < today,
  }));
}

export async function billDetail(id: string): Promise<VendorBill> {
  const [b] = await sql`select b.*, v.name as vendor_name, j.number as job_number, j.name as job_name, p.number as po_number, w.number as wo_number, u.name as created_name,
      f.name as file_name, f.path as file_path
    from ops.vendor_bills b left join ops.vendors v on v.id = b.vendor_id left join ops.jobs j on j.id = b.job_id left join ops.purchase_orders p on p.id = b.po_id
      left join ops.work_orders w on w.id = b.work_order_id left join ops.users u on u.id = b.created_by_id left join ops.job_files f on f.id = b.file_id
    where b.id = ${id}`;
  if (!b) throw new HttpError(404, "Bill not found");
  const lines = await sql`select * from ops.vendor_bill_lines where bill_id = ${id} order by sort_order, id`;
  const ls = lines.map((l) => ({ id: l.id, budgetItemId: l.budgetItemId ?? null, poItemId: l.poItemId ?? null, workOrderItemId: l.workOrderItemId ?? null, description: l.description, quantity: n(l.quantity), unitCostCents: n(l.unitCostCents), sortOrder: l.sortOrder }));
  let file: VendorBill["file"] = null;
  if (b.fileId) {
    const links = await readLinks([{ path: b.filePath, name: b.fileName }]).catch(() => new Map());
    file = { id: b.fileId, name: b.fileName, url: links.get(b.filePath)?.url ?? null };
  }
  return {
    id: b.id, billNumber: b.billNumber ?? null, status: b.status, vendor: b.vendorId ? { id: b.vendorId, name: b.vendorName } : null,
    job: ref(b.jobId, b.jobNumber, b.jobName) as VendorBill["job"], po: ref(b.poId, b.poNumber) as VendorBill["po"], workOrder: ref(b.workOrderId, b.woNumber) as VendorBill["workOrder"],
    billDate: day(b.billDate)!, dueDate: day(b.dueDate), paidAt: iso(b.paidAt), lines: ls, otherCents: n(b.otherCents), totalCents: billTotal(ls, n(b.otherCents)),
    notes: b.notes ?? null, file, createdBy: b.createdName ?? null, createdAt: iso(b.createdAt)!,
  };
}

/** Check a bill's links, fill in the job and vendor from its PO or work order, and point PO lines at their budget items. */
async function prepBill(input: BillInput) {
  let { jobId, vendorId } = input;
  const poItems = new Map<string, string | null>(), woItems = new Map<string, string | null>();
  if (input.poId) {
    const [p] = await sql`select job_id, vendor_id from ops.purchase_orders where id = ${input.poId}`;
    if (!p) throw new HttpError(422, "That purchase order isn't here.");
    jobId = jobId ?? p.jobId; vendorId = vendorId ?? p.vendorId;
    for (const r of await sql`select id, budget_item_id from ops.purchase_order_items where po_id = ${input.poId}`) poItems.set(r.id, r.budgetItemId ?? null);
  }
  if (input.workOrderId) {
    const [w] = await sql`select job_id, vendor_id from ops.work_orders where id = ${input.workOrderId}`;
    if (!w) throw new HttpError(422, "That work order isn't here.");
    jobId = jobId ?? w.jobId; vendorId = vendorId ?? w.vendorId;
    for (const r of await sql`select id, budget_item_id from ops.work_order_items where work_order_id = ${input.workOrderId}`) woItems.set(r.id, r.budgetItemId ?? null);
  }
  if (jobId) await mustJob(jobId);
  if (!vendorId) throw new HttpError(422, "Pick the vendor.");
  const ok = await jobItems(jobId);
  const lines = input.lines.map((l, i) => {
    const poItemId = l.poItemId && poItems.has(l.poItemId) ? l.poItemId : null;
    const woItemId = l.workOrderItemId && woItems.has(l.workOrderItemId) ? l.workOrderItemId : null;
    const budgetItemId = l.budgetItemId && ok.has(l.budgetItemId) ? l.budgetItemId : (poItemId ? poItems.get(poItemId) : woItemId ? woItems.get(woItemId) : null) ?? null;
    return { budgetItemId, poItemId, workOrderItemId: woItemId, description: l.description, quantity: l.quantity, unitCostCents: l.unitCostCents, sortOrder: i };
  });
  if (input.fileId && jobId) {
    const [f] = await sql`select 1 from ops.job_files where id = ${input.fileId} and job_id = ${jobId}`;
    if (!f) throw new HttpError(422, "That file isn't on this job.");
  }
  if (!lines.length && !input.otherCents) throw new HttpError(422, "Add what the bill is for.");
  return { jobId, vendorId, lines };
}

export async function createBill(input: BillInput, userId: string) {
  const { jobId, vendorId, lines } = await prepBill(input);
  const [b] = await sql`insert into ops.vendor_bills ${sql({
    jobId, vendorId, poId: input.poId, workOrderId: input.workOrderId, billNumber: input.billNumber, billDate: input.billDate, dueDate: input.dueDate,
    otherCents: input.otherCents, notes: input.notes, fileId: jobId ? input.fileId : null, createdById: userId,
  })} returning id`;
  if (lines.length) await sql`insert into ops.vendor_bill_lines ${sql(lines.map((l) => ({ ...l, billId: b.id })))}`;
  return b.id as string;
}

export async function saveBill(id: string, input: BillInput) {
  const [cur] = await sql`select status from ops.vendor_bills where id = ${id} for update`;
  if (!cur) throw new HttpError(404, "Bill not found");
  if (cur.status === "VOID") throw new HttpError(409, "This bill is void.");
  const { jobId, vendorId, lines } = await prepBill(input);
  await sql`update ops.vendor_bills set ${sql({
    jobId, vendorId, poId: input.poId, workOrderId: input.workOrderId, billNumber: input.billNumber, billDate: input.billDate, dueDate: input.dueDate,
    otherCents: input.otherCents, notes: input.notes, fileId: jobId ? input.fileId : null, updatedAt: new Date(),
  })} where id = ${id}`;
  await sql`delete from ops.vendor_bill_lines where bill_id = ${id}`;
  if (lines.length) await sql`insert into ops.vendor_bill_lines ${sql(lines.map((l) => ({ ...l, billId: id })))}`;
}

export async function setBillStatus(id: string, status: BillStatus) {
  const [b] = await sql`update ops.vendor_bills set ${sql({ status, paidAt: status === "PAID" ? new Date() : null, updatedAt: new Date() })} where id = ${id} returning id`;
  if (!b) throw new HttpError(404, "Bill not found");
}

/* ═════════════ Change orders ═════════════ */

export const CoSchema = z.object({
  title: z.string().trim().min(1, "Give the change order a title.").max(200),
  description: optText(20000),
  taxBps: z.number().int().min(0).max(5000),
  lines: z.array(z.object({
    groupName: z.string().trim().min(1).max(120).default("Changes"),
    name: z.string().trim().min(1, "Name each line.").max(300), description: optText(5000),
    costType: z.enum(["MATERIAL", "LABOR", "SUBCONTRACT", "OTHER"]).default("MATERIAL"),
    quantity: z.number().min(-100_000).max(100_000).refine((v) => v !== 0, "Quantities can't be 0 (use a negative number for a credit)."),
    unit: optText(20), unitCostCents: cents, unitPriceCents: cents, taxable: z.boolean().default(true), productId: optId,
  })).max(300),
});
type CoInput = z.infer<typeof CoSchema>;

export async function coRows(jobId: string): Promise<CoRow[]> {
  const rows = await sql`select c.*, (select coalesce(json_agg(json_build_object('q', i.quantity, 'p', i.unit_price_cents, 'c', i.unit_cost_cents, 't', i.taxable)), '[]') from ops.change_order_items i where i.change_order_id = c.id) as ls
    from ops.change_orders c where c.job_id = ${jobId} order by c.created_at`;
  return rows.map((r) => ({
    id: r.id, number: r.number, title: r.title, status: r.status, createdAt: iso(r.createdAt)!, approvedAt: iso(r.approvedAt),
    totalCents: coTotals((r.ls as Row[]).map((l) => ({ quantity: n(l.q), unitPriceCents: n(l.p), unitCostCents: n(l.c), taxable: !!l.t })), r.taxBps).totalCents,
  }));
}

async function coRow(id: string, db: Db = sql) {
  const [c] = await db`select c.*, j.number as job_number, j.name as job_name, u.name as created_name from ops.change_orders c join ops.jobs j on j.id = c.job_id left join ops.users u on u.id = c.created_by_id where c.id = ${id}`;
  if (!c) throw new HttpError(404, "Change order not found");
  const lines: CoLine[] = (await db`select * from ops.change_order_items where change_order_id = ${id} order by sort_order, id`).map((l) => ({
    id: l.id, groupName: l.groupName, name: l.name, description: l.description ?? null, costType: l.costType, quantity: n(l.quantity), unit: l.unit ?? null,
    unitCostCents: n(l.unitCostCents), unitPriceCents: n(l.unitPriceCents), taxable: l.taxable, productId: l.productId ?? null, budgetItemId: l.budgetItemId ?? null, sortOrder: l.sortOrder,
  }));
  return { c, lines };
}

export async function coDetail(id: string, db: Db = sql): Promise<ChangeOrder> {
  const { c, lines } = await coRow(id, db);
  return {
    id: c.id, number: c.number, title: c.title, description: c.description ?? null, status: c.status, job: { id: c.jobId, number: c.jobNumber, name: c.jobName },
    taxBps: c.taxBps, lines, totals: coTotals(lines, c.taxBps),
    sentAt: iso(c.sentAt), approvedAt: iso(c.approvedAt), approvedNote: c.approvedNote ?? null, declinedAt: iso(c.declinedAt), declineNote: c.declineNote ?? null,
    signature: c.signedAt ? { signerName: c.signerName, signerEmail: c.signerEmail ?? null, signerTitle: c.signerTitle ?? null, signedAt: iso(c.signedAt)!, totalCents: n(c.signedTotalCents), image: c.signatureImage ?? null } : null,
    clientUrl: c.publicToken ? coUrl(c.publicToken) : null, createdBy: c.createdName ?? null, createdAt: iso(c.createdAt)!,
  };
}

async function writeCoLines(id: string, lines: CoInput["lines"]) {
  await sql`delete from ops.change_order_items where change_order_id = ${id}`;
  if (lines.length) await sql`insert into ops.change_order_items ${sql(lines.map((l, i) => ({ ...l, changeOrderId: id, sortOrder: i })))}`;
}

export async function createCo(jobId: string, input: CoInput, userId: string) {
  const j = await mustJob(jobId);
  const [row] = await sql`insert into ops.counters (key, value) values (${`CO:${jobId}`}, 1)
    on conflict (org_id, key) do update set value = ops.counters.value + 1 returning value`;
  const { lines, ...rest } = input;
  const [c] = await sql`insert into ops.change_orders ${sql({ ...rest, jobId, number: `${j.number}-CO${row.value}`, createdById: userId })} returning id, number`;
  await writeCoLines(c.id, lines);
  return { id: c.id as string, number: c.number as string };
}

/** The tax rate a new change order starts with: the job's proposal, else the business default. */
export async function defaultCoTax(jobId: string) {
  const [j] = await sql`select q.tax_bps from ops.jobs j left join ops.quotes q on q.id = j.quote_id where j.id = ${jobId}`;
  return (j?.taxBps as number | null) ?? ((await getAvl()).defaultTaxBps as number) ?? 0;
}

export async function saveCo(id: string, input: CoInput) {
  const [c] = await sql`select status from ops.change_orders where id = ${id} for update`;
  if (!c) throw new HttpError(404, "Change order not found");
  if (c.status !== "DRAFT") throw new HttpError(409, "Only a draft change order can be edited. Revise it first.");
  const { lines, ...rest } = input;
  await sql`update ops.change_orders set ${sql({ ...rest, updatedAt: new Date() })} where id = ${id}`;
  await writeCoLines(id, lines);
}

/** An approved change order's lines join the job's budget, each under its cost group. */
async function applyCo(id: string) {
  const { c, lines } = await coRow(id);
  const groups = await sql`select id, name from ops.budget_items where job_id = ${c.jobId} and kind = 'GROUP' and parent_id is null`;
  const [{ m }] = await sql`select coalesce(max(sort_order), 0) as m from ops.budget_items where job_id = ${c.jobId}`;
  let order = Number(m) + 1;
  const groupId = new Map(groups.map((g) => [String(g.name).trim().toLowerCase(), g.id as string]));
  for (const l of lines) {
    const key = l.groupName.trim().toLowerCase();
    let gid = groupId.get(key);
    if (!gid) {
      const [g] = await sql`insert into ops.budget_items ${sql({ jobId: c.jobId, kind: "GROUP", name: l.groupName.trim(), costType: "OTHER", quantity: 0, sortOrder: order++ })} returning id`;
      gid = g.id as string; groupId.set(key, gid);
    }
    const [b] = await sql`insert into ops.budget_items ${sql({
      jobId: c.jobId, parentId: gid, kind: "ITEM", name: `${c.number}: ${l.name}`, description: l.description, costType: l.costType, quantity: l.quantity, unit: l.unit,
      unitCostCents: l.unitCostCents, unitPriceCents: l.unitPriceCents, taxable: l.taxable, productId: l.productId, changeOrderId: id, sortOrder: order++,
    })} returning id`;
    await sql`update ops.change_order_items set budget_item_id = ${b.id} where id = ${l.id}`;
  }
  await sql`update ops.jobs set updated_at = now() where id = ${c.jobId}`;
}

export type CoEvent = "SEND" | "MARK_SENT" | "MARK_APPROVED" | "REVISE" | "CANCEL";
const CO_FROM: Record<CoEvent, CoStatus[]> = { SEND: ["DRAFT", "SENT"], MARK_SENT: ["DRAFT"], MARK_APPROVED: ["DRAFT", "SENT"], REVISE: ["SENT", "DECLINED"], CANCEL: ["DRAFT", "SENT", "DECLINED"] };
export async function coEvent(id: string, event: CoEvent, u: U, opts: { note?: string | null; emailTo?: string | null } = {}) {
  const [c] = await sql`select * from ops.change_orders where id = ${id} for update`;
  if (!c) throw new HttpError(404, "Change order not found");
  if (!CO_FROM[event].includes(c.status)) throw new HttpError(409, `A change order that is ${c.status.toLowerCase()} can't do that.`);
  const now = new Date();
  const set: Row = { updatedAt: now };
  const { lines } = await coRow(id);
  if ((event === "SEND" || event === "MARK_SENT" || event === "MARK_APPROVED") && !lines.length) throw new HttpError(422, "Add at least one line first.");
  const total = coTotals(lines, c.taxBps).totalCents;
  if (event === "SEND" || event === "MARK_SENT") {
    if (event === "SEND" && !isEmail((opts.emailTo ?? "").trim())) throw new HttpError(422, "Enter the client's email address.");
    Object.assign(set, { status: "SENT", sentAt: now, sentTotalCents: total, publicToken: c.publicToken ?? newPublicToken() });
  }
  if (event === "MARK_APPROVED") {
    if (!can(u, "QUOTE_APPROVE")) throw new HttpError(403, "An AVL Manager records a client's approval.");
    if (!opts.note?.trim()) throw new HttpError(422, "Say how the client approved it (email, phone, on site).");
    Object.assign(set, { status: "APPROVED", approvedAt: now, approvedNote: opts.note.trim(), sentTotalCents: total });
  }
  if (event === "REVISE") Object.assign(set, { status: "DRAFT", declinedAt: null, declineNote: null });
  if (event === "CANCEL") Object.assign(set, { status: "CANCELLED" });
  await sql`update ops.change_orders set ${sql(set)} where id = ${id}`;
  if (event === "MARK_APPROVED") await applyCo(id);
  const co = await coDetail(id);
  if (event === "SEND") {
    const mail = await emailCo(co, opts.emailTo!.trim());
    if (!mail.emailedTo) throw new HttpError(409, `${mail.emailError} You can mark it sent and share the link instead.`);
  }
  return co;
}

/* ═════════════ Job costing ═════════════ */

export async function costing(jobId: string): Promise<JobCosting> {
  const j = await mustJob(jobId);
  const [items, poLines, woLines, billLines, extras, time, links, open, waiting] = await Promise.all([
    budgetOf(jobId),
    sql`select i.budget_item_id, sum(round(i.quantity * i.unit_cost_cents))::bigint as c from ops.purchase_order_items i join ops.purchase_orders p on p.id = i.po_id
      where p.job_id = ${jobId} and p.status = any(${PO_COMMITTED}) group by 1`,
    sql`select i.budget_item_id, sum(round(i.quantity * i.unit_cost_cents))::bigint as c from ops.work_order_items i join ops.work_orders w on w.id = i.work_order_id
      where w.job_id = ${jobId} and w.status = any(${WO_COMMITTED}) group by 1`,
    sql`select l.budget_item_id, sum(round(l.quantity * l.unit_cost_cents))::bigint as c from ops.vendor_bill_lines l join ops.vendor_bills b on b.id = l.bill_id
      where b.job_id = ${jobId} and b.status <> 'VOID' group by 1`,
    sql`select (select coalesce(sum(shipping_cents + tax_cents), 0) from ops.purchase_orders where job_id = ${jobId} and status = any(${PO_COMMITTED}))::bigint as po_extra,
        (select coalesce(sum(other_cents), 0) from ops.vendor_bills where job_id = ${jobId} and status <> 'VOID')::bigint as bill_extra`,
    sql`select coalesce(sum(round(minutes * cost_rate_cents / 60.0)), 0)::bigint as c from ops.time_entries where job_id = ${jobId}`,
    sql`select i.budget_item_id as item, 'PO' as kind, p.id, p.number as label from ops.purchase_order_items i join ops.purchase_orders p on p.id = i.po_id where p.job_id = ${jobId} and p.status <> 'CANCELLED'
      union select i.budget_item_id, 'WORK_ORDER', w.id, w.number from ops.work_order_items i join ops.work_orders w on w.id = i.work_order_id where w.job_id = ${jobId} and w.status <> 'CANCELLED'
      union select l.budget_item_id, 'BILL', b.id, coalesce('Bill ' || b.bill_number, 'Bill ' || to_char(b.bill_date, 'Mon DD')) from ops.vendor_bill_lines l join ops.vendor_bills b on b.id = l.bill_id where b.job_id = ${jobId} and b.status <> 'VOID'
      union select bi.id, 'CHANGE_ORDER', c.id, c.number from ops.budget_items bi join ops.change_orders c on c.id = bi.change_order_id where bi.job_id = ${jobId}
      union select bi.id, 'PROPOSAL', q.id, q.number from ops.budget_items bi join ops.quote_items qi on qi.id = bi.quote_item_id join ops.quotes q on q.id = qi.quote_id where bi.job_id = ${jobId}`,
    sql`select coalesce(sum(${billTotalSql}), 0)::bigint as c from ops.vendor_bills b where b.job_id = ${jobId} and b.status = 'OPEN'`,
    sql`select count(*)::int as c from ops.purchase_orders where job_id = ${jobId} and status = 'PENDING_APPROVAL'`,
  ]);
  void j;
  const per = new Map<string, ItemCosts>();
  const at = (id: string) => { let x = per.get(id); if (!x) per.set(id, x = { committedCents: 0, actualCents: 0, links: [] }); return x; };
  const unassigned = { committedCents: n(extras[0].poExtra), actualCents: n(extras[0].billExtra), links: [] as CostLink[] };
  for (const r of [...poLines, ...woLines]) { if (r.budgetItemId) at(r.budgetItemId).committedCents += n(r.c); else unassigned.committedCents += n(r.c); }
  for (const r of billLines) { if (r.budgetItemId) at(r.budgetItemId).actualCents += n(r.c); else unassigned.actualCents += n(r.c); }
  const order: Record<string, number> = { PROPOSAL: 0, CHANGE_ORDER: 1, PO: 2, WORK_ORDER: 3, BILL: 4 };
  for (const l of [...links].sort((a, b) => order[a.kind] - order[b.kind])) {
    const link = { kind: l.kind, id: l.id, label: l.label } as CostLink;
    if (l.item) at(l.item).links.push(link);
    else if (!unassigned.links.some((x) => x.id === link.id)) unassigned.links.push(link);
  }
  return jobCosting(items, per, n(time[0].c), unassigned, { openBillsCents: n(open[0].c), waitingApproval: waiting[0].c });
}

export async function setFinal(budgetItemId: string, final: boolean) {
  const [b] = await sql`update ops.budget_items set final = ${final} where id = ${budgetItemId} and kind = 'ITEM' returning job_id`;
  if (!b) throw new HttpError(404, "Budget item not found");
  return b.jobId as string;
}

/* ═════════════ Lists ═════════════ */

export async function purchasingPage(u: U, jobId: string | null): Promise<PurchasingPage> {
  const pw = jobId ? sql`p.job_id = ${jobId}` : sql`true`;
  const bw = jobId ? sql`b.job_id = ${jobId}` : sql`true`;
  const ww = jobId ? sql`w.job_id = ${jobId}` : sql`true`;
  const [pos, bills, workOrders, [counts], vendors, jobs] = await Promise.all([
    poRows(pw), billRows(bw), woRows(ww),
    sql`select (select count(*)::int from ops.purchase_orders p where ${pw} and p.status = 'PENDING_APPROVAL') as waiting,
        (select count(*)::int from ops.purchase_orders p where ${pw} and p.status in ('ORDERED', 'PARTIAL')) as to_receive,
        (select count(*)::int from ops.vendor_bills b where ${bw} and b.status = 'OPEN') as open_bills,
        (select coalesce(sum(${billTotalSql}), 0)::bigint from ops.vendor_bills b where ${bw} and b.status = 'OPEN') as open_cents,
        (select count(*)::int from ops.vendor_bills b where ${bw} and b.status = 'OPEN' and b.due_date < current_date) as overdue`,
    sql`select id, name, rep_email from ops.vendors where active order by name`,
    sql`select id, number, name from ops.jobs where status in ('PLANNING', 'IN_PROGRESS', 'ON_HOLD') or id = ${jobId ?? ""} order by number desc limit 500`,
  ]);
  return {
    pos, bills, workOrders,
    counts: { waitingApproval: counts.waiting, toReceive: counts.toReceive, openBills: counts.openBills, openBillsCents: n(counts.openCents), overdueBills: counts.overdue },
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, repEmail: v.repEmail ?? null })), jobs: jobs.map((j) => ({ id: j.id, number: j.number, name: j.name })),
    canApprove: canApprovePo(u),
  };
}

/* ═════════════ Pages without sign-in (the link is the key) ═════════════ */

async function byToken(table: "purchase_orders" | "work_orders" | "change_orders", token: string, what: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new HttpError(404, `This ${what} link isn’t right.`);
  const [r] = table === "purchase_orders" ? await raw`select id, org_id from ops.purchase_orders where public_token = ${token}`
    : table === "work_orders" ? await raw`select id, org_id from ops.work_orders where public_token = ${token}`
    : await raw`select id, org_id from ops.change_orders where public_token = ${token}`;
  if (!r) throw new HttpError(404, `This ${what} link isn’t right, or the ${what} was withdrawn.`);
  const o = await loadOrg(r.orgId);
  if (!o || !o.modules.includes("avl")) throw new HttpError(404, `This ${what} isn’t available any more.`);
  return { id: r.id as string, org: { id: r.orgId as string, row: o.row, modules: o.modules } };
}
export const withToken = <T>(table: "purchase_orders" | "work_orders" | "change_orders", token: string, what: string, fn: (id: string) => Promise<T>) =>
  byToken(table, token, what).then(({ id, org }) => inOrg(org, () => fn(id)));

export async function letterhead() {
  const biz = await getAvl();
  const [org] = await sql`select name from ops.organization`;
  const addr = [biz.addressLine1, biz.addressLine2, [biz.city, biz.state, biz.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  let logo: string | null = null;
  if (hasModule("branding")) {
    const a = await sql`select key, mime, data_b64 from ops.org_assets where key in ('avl-logo', 'logo')`;
    const x = a.find((r) => r.key === "avl-logo") ?? a.find((r) => r.key === "logo");
    logo = x ? `data:${x.mime};base64,${x.dataB64}` : null;
  }
  return { business: { name: (biz.name as string) || (org?.name as string) || "Your AV team", address: addr || null, phone: biz.phone ?? null, email: biz.email ?? null }, logo };
}

export async function vendorPoPage(id: string): Promise<VendorPoPage> {
  const po = await poDetail(id);
  if (po.status === "DRAFT" || po.status === "PENDING_APPROVAL") throw new HttpError(404, "This purchase order isn’t ready yet.");
  const { business, logo } = await letterhead();
  return {
    po: {
      number: po.number, status: po.status, subtotalCents: po.subtotalCents, shippingCents: po.shippingCents, taxCents: po.taxCents, totalCents: po.totalCents,
      expectedDate: po.expectedDate, shipTo: po.shipTo, notes: po.notes, sentAt: po.sentAt ?? po.orderedAt,
      lines: po.lines.map((l) => ({ sku: l.sku, name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents })),
      vendor: po.vendor ? { name: po.vendor.name, accountNo: po.vendor.accountNo } : null,
      jobRef: po.job ? `${po.job.number} · ${po.job.name}` : null,
    },
    business, logo,
  };
}

export async function publicWoPage(id: string): Promise<PublicWorkOrderPage> {
  const wo = await woDetail(id);
  if (wo.status === "DRAFT") throw new HttpError(404, "This work order isn’t ready yet.");
  const [j] = await sql`select site_line1, site_line2, site_city, site_state, site_postal_code from ops.jobs where id = ${wo.job.id}`;
  const { business, logo } = await letterhead();
  return {
    wo: {
      number: wo.number, title: wo.title, status: wo.status, scope: wo.scope, startDate: wo.startDate, dueDate: wo.dueDate, totalCents: wo.totalCents,
      assigneeName: wo.assigneeName, acceptedAt: wo.acceptedAt, acceptedBy: wo.acceptedBy,
      lines: wo.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents })),
      vendor: wo.vendor?.name ?? null, jobName: wo.job.name,
      site: [j?.siteLine1, j?.siteLine2, [j?.siteCity, j?.siteState, j?.sitePostalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null,
    },
    business: { name: business.name, phone: business.phone, email: business.email }, logo,
    canAccept: wo.status === "SENT",
  };
}

export async function acceptWo(id: string, name: string) {
  const [w] = await sql`select status from ops.work_orders where id = ${id} for update`;
  if (w?.status !== "SENT") throw new HttpError(409, "This work order can’t be accepted any more.");
  await sql`update ops.work_orders set ${sql({ status: "ACCEPTED", acceptedAt: new Date(), acceptedBy: name, updatedAt: new Date() })} where id = ${id}`;
  await notifyCreator("work_orders", id, "accepted", name);
}

export async function clientCoPage(id: string): Promise<ClientChangeOrderPage> {
  const { c, lines } = await coRow(id);
  if (c.status === "DRAFT") throw new HttpError(409, "This change order is being updated. You’ll get the new version soon.", { status: "draft" });
  if (c.status === "CANCELLED") throw new HttpError(404, "This change order was withdrawn.");
  const [[j], [contract], [changes], { business, logo }] = await Promise.all([
    sql`select j.number, j.name, cu.name as customer_name, cu.contact_name, cu.email from ops.jobs j left join ops.customers cu on cu.id = j.customer_id where j.id = ${c.jobId}`,
    sql`select coalesce(q.sent_total_cents, 0)::bigint as c from ops.jobs j left join ops.quotes q on q.id = j.quote_id where j.id = ${c.jobId}`,
    sql`select coalesce(sum(sent_total_cents), 0)::bigint as c from ops.change_orders where job_id = ${c.jobId} and status = 'APPROVED' and id <> ${id}`,
    letterhead(),
  ]);
  const t = coTotals(lines, c.taxBps);
  return {
    co: { number: c.number, title: c.title, description: c.description ?? null, status: c.status, sentAt: iso(c.sentAt), taxBps: c.taxBps,
      lines: lines.map((l) => ({ groupName: l.groupName, name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, unitPriceCents: l.unitPriceCents })),
      totals: { subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents } },
    job: { number: j.number, name: j.name, contractCents: n(contract?.c), approvedChangesCents: n(changes?.c) },
    customer: j.customerName ? { name: j.customerName, contactName: j.contactName ?? null, email: j.email ?? null } : null,
    business, logo,
    canAnswer: c.status === "SENT",
    signature: c.signedAt ? { signerName: c.signerName, signerTitle: c.signerTitle ?? null, signedAt: iso(c.signedAt)!, totalCents: n(c.signedTotalCents) } : null,
    declined: c.status === "DECLINED" ? { at: iso(c.declinedAt)!, note: c.declineNote ?? null } : null,
  };
}

export const CoSignSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200),
  title: z.string().trim().max(120).nullish().transform((v) => v || null),
  signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
  totalCents: z.number().int(), agree: z.literal(true),
});
export async function signCo(id: string, input: z.infer<typeof CoSignSchema>, ip: string | null, ua: string | null) {
  const { c, lines } = await coRow(id);
  if (c.status !== "SENT") throw new HttpError(409, "This change order can’t be signed any more.");
  const total = coTotals(lines, c.taxBps).totalCents;
  if (total !== input.totalCents) throw new HttpError(409, "The change order changed while you had it open. Look it over again, then sign.", { status: "changed" });
  const now = new Date();
  await sql`update ops.change_orders set ${sql({
    status: "APPROVED", approvedAt: now, signedAt: now, signerName: input.name, signerEmail: input.email, signerTitle: input.title, signatureImage: input.signature,
    signedIp: ip, signedUserAgent: ua, signedTotalCents: total, sentTotalCents: total, updatedAt: now,
  })} where id = ${id}`;
  await applyCo(id);
  await notifyCreator("change_orders", id, "signed", input.name);
}
export async function declineCo(id: string, name: string, note: string | null) {
  const [c] = await sql`select status from ops.change_orders where id = ${id} for update`;
  if (c?.status !== "SENT") throw new HttpError(409, "This change order can’t be answered any more.");
  await sql`update ops.change_orders set ${sql({ status: "DECLINED", declinedAt: new Date(), declineNote: note, updatedAt: new Date() })} where id = ${id}`;
  await notifyCreator("change_orders", id, "declined", name, note);
}

/* ═════════════ Emails ═════════════ */

type Mail = { emailedTo: string | null; emailError: string | null };
const ACCENT = "#0F766E";

async function emailPo(po: PurchaseOrder, to: string): Promise<Mail> {
  const biz = await businessName();
  const items = po.lines.map((l) => `${l.quantity} × ${l.name}${l.sku ? ` (${l.sku})` : ""}  ${$(Math.round(l.quantity * l.unitCostCents))}`).join("\n");
  const { html, text } = render({
    org: biz.name, heading: `Purchase order ${po.number}`,
    intro: [`Hi ${first(po.vendor?.repName)}, please process this order from ${biz.name}${po.vendor?.accountNo ? ` (account ${po.vendor.accountNo})` : ""}.`, "Open it for the full order, or print it as a PDF."],
    rows: [["PO number", po.number], ["Total", $(po.totalCents)], ["Needed by", po.expectedDate ? new Date(po.expectedDate + "T12:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null], ["Ship to", po.shipTo], ["Job", po.job ? `${po.job.number} · ${po.job.name}` : null]],
    note: { label: `${po.lines.length} line${po.lines.length === 1 ? "" : "s"}`, text: items + (po.notes ? `\n\n${po.notes}` : "") },
    buttons: [{ label: "View the purchase order", url: po.vendorUrl! }],
    footer: `Sent by Sundays for ${biz.name}. Questions about this order? Reply to this email.`, accent: ACCENT,
  });
  const err = await queue([{ kind: "avl.po", to: { email: to, name: po.vendor?.repName ?? null }, subject: `Purchase order ${po.number} from ${biz.name}`, html, text, replyTo: biz.replyTo }], biz.name);
  return err ? { emailedTo: null, emailError: err } : { emailedTo: to, emailError: null };
}

async function emailWo(wo: WorkOrder, to: string): Promise<Mail> {
  const biz = await businessName();
  const { html, text } = render({
    org: biz.name, heading: `Work order ${wo.number}: ${wo.title}`,
    intro: [`Hi ${first(wo.assigneeName ?? wo.vendor?.name)}, here is a work order from ${biz.name} for ${wo.job.name}.`, "Open it to see the scope and accept it."],
    rows: [["Work order", wo.number], ["Starts", wo.startDate], ["Due", wo.dueDate], ["Amount", wo.totalCents ? $(wo.totalCents) : null]],
    buttons: [{ label: "View and accept", url: wo.publicUrl! }],
    footer: `Sent by Sundays for ${biz.name}. Questions? Reply to this email.`, accent: ACCENT,
  });
  const err = await queue([{ kind: "avl.wo", to: { email: to, name: wo.assigneeName }, subject: `Work order ${wo.number}: ${wo.title}`, html, text, replyTo: biz.replyTo }], biz.name);
  return err ? { emailedTo: null, emailError: err } : { emailedTo: to, emailError: null };
}

async function emailCo(co: ChangeOrder, to: string): Promise<Mail> {
  const biz = await businessName();
  const [cu] = await sql`select cu.contact_name from ops.jobs j left join ops.customers cu on cu.id = j.customer_id where j.id = ${co.job.id}`;
  const { html, text } = render({
    org: biz.name, heading: `Change order: ${co.title}`,
    intro: [`Hi ${first(cu?.contactName)}, here is a change to ${co.job.name}.`, "Open it to read the details and sign it online."],
    rows: [["Change order", co.number], [co.totals.totalCents < 0 ? "Credit" : "Amount", $(Math.abs(co.totals.totalCents))]],
    buttons: [{ label: "Review and sign", url: co.clientUrl! }],
    footer: `Sent by Sundays for ${biz.name}. Questions? Reply to this email.`, accent: ACCENT,
  });
  const err = await queue([{ kind: "avl.co", to: { email: to, name: cu?.contactName ?? null }, subject: `Change order ${co.number}: ${co.title}`, html, text, replyTo: biz.replyTo }], biz.name);
  return err ? { emailedTo: null, emailError: err } : { emailedTo: to, emailError: null };
}

/** Tell the AVL Managers a PO is waiting for them. */
async function notifyApprovers(po: PurchaseOrder, by: U) {
  try {
    const people = await sql`select name, email from ops.users where active and not pending and source <> 'PLATFORM' and email is not null and id <> ${by.id}
      and (avl_level = 'MANAGER' or synced_avl_level = 'MANAGER' or role = 'ADMIN')`;
    if (!people.length) return;
    const biz = await businessName();
    const msgs = people.map((p) => {
      const { html, text } = render({
        org: biz.name, heading: `Purchase order to approve: ${po.number}`,
        intro: [`Hi ${first(p.name)}, ${by.name} sent ${po.number} to ${po.vendor?.name ?? "a vendor"} for approval.`],
        rows: [["Vendor", po.vendor?.name], ["Job", po.job ? `${po.job.number} · ${po.job.name}` : "Not for a job"], ["Total", $(po.totalCents)]],
        buttons: [{ label: "Review the purchase order", url: `${SITE}/avl/purchasing/po?id=${encodeURIComponent(po.id)}` }],
        footer: `Sent by Sundays for ${biz.name}. You’re getting this because you approve purchase orders.`, accent: ACCENT,
      });
      return { kind: "avl.po.approval", to: { email: p.email as string, name: p.name as string }, subject: `Approve ${po.number}: ${po.vendor?.name ?? ""} ${$(po.totalCents)}`, html, text };
    });
    await queue(msgs, biz.name);
  } catch (e) { console.error("po approval email failed", e); }
}

async function notifyRejected(po: PurchaseOrder, by: U, note: string) {
  try {
    const [maker] = await sql`select u.name, u.email from ops.purchase_orders p join ops.users u on u.id = p.created_by_id where p.id = ${po.id} and u.active and u.email is not null and u.id <> ${by.id}`;
    if (!maker) return;
    const biz = await businessName();
    const { html, text } = render({
      org: biz.name, heading: `${po.number} needs changes`, intro: [`Hi ${first(maker.name)}, ${by.name} sent ${po.number} back.`],
      note: { label: "What to change", text: note },
      buttons: [{ label: "Open the purchase order", url: `${SITE}/avl/purchasing/po?id=${encodeURIComponent(po.id)}` }],
      footer: `Sent by Sundays for ${biz.name}.`, accent: ACCENT,
    });
    await queue([{ kind: "avl.po.rejected", to: { email: maker.email, name: maker.name }, subject: `${po.number} needs changes`, html, text }], biz.name);
  } catch (e) { console.error("po rejected email failed", e); }
}

async function notifyCreator(table: "work_orders" | "change_orders", id: string, what: "accepted" | "signed" | "declined", who: string, note?: string | null) {
  try {
    const [r] = table === "work_orders"
      ? await sql`select t.number, t.title, u.name, u.email from ops.work_orders t join ops.users u on u.id = t.created_by_id where t.id = ${id} and u.active and u.email is not null`
      : await sql`select t.number, t.title, u.name, u.email from ops.change_orders t join ops.users u on u.id = t.created_by_id where t.id = ${id} and u.active and u.email is not null`;
    if (!r) return;
    const biz = await businessName();
    const kind = table === "work_orders" ? "work order" : "change order";
    const link = table === "work_orders" ? `${SITE}/avl/purchasing/wo?id=${encodeURIComponent(id)}` : `${SITE}/avl/jobs/change-order?id=${encodeURIComponent(id)}`;
    const { html, text } = render({
      org: biz.name, heading: `${who} ${what} ${r.number}`, intro: [`Hi ${first(r.name)}, ${who} ${what} the ${kind} “${r.title}”.${what === "signed" ? " Its lines are now in the job’s budget." : ""}`],
      note: note ? { label: "Their note", text: note } : null,
      buttons: [{ label: `Open the ${kind}`, url: link, tone: what === "declined" ? "bad" : "good" }],
      footer: `Sent by Sundays for ${biz.name}. You’re getting this because you made this ${kind}.`, accent: ACCENT,
    });
    await queue([{ kind: `avl.${table === "work_orders" ? "wo" : "co"}.${what}`, to: { email: r.email, name: r.name }, subject: `${r.number} ${what} by ${who}`, html, text }], biz.name);
  } catch (e) { console.error("creator email failed", e); }
}

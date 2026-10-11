// Generated from shared/ops/invoicing.ts by supabase/build-ops.mjs — edit that file instead.
/**
 * Sundays AVL billing: client invoices, payments, the job's invoicing figures, aging, selections
 * and the client portal.
 *
 *   contract   = the job's approved price: its budget at sell price, change orders included
 *   invoiced   = sent and paid invoices, before tax
 *   collected  = payments received
 *   receivable = what's still owed on sent invoices
 *
 * Every invoice line that bills part of the contract points at the budget item it bills, so a job
 * can be billed by percent of the contract, by schedule phase or line by line, and the final
 * invoice still bills exactly what's left of every line. A deposit is billed on its own and taken
 * off later invoices (its share of each progress invoice, the rest on the final). Money is cents.
 */

/* ───────────── Invoices ───────────── */

export type InvoiceKind = "DEPOSIT" | "PROGRESS" | "FINAL" | "CHANGE_ORDER" | "OTHER";
export type InvoiceMethod = "PERCENT" | "PHASE" | "LINES";
export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "VOID";
/** What the invoice is, payments and the due date counted. */
export type InvoiceState = "DRAFT" | "OPEN" | "PARTIAL" | "OVERDUE" | "PAID" | "VOID";

export const INVOICE_KINDS: { id: InvoiceKind; label: string }[] = [
  { id: "DEPOSIT", label: "Deposit" },
  { id: "PROGRESS", label: "Progress" },
  { id: "FINAL", label: "Final" },
  { id: "CHANGE_ORDER", label: "Change order" },
  { id: "OTHER", label: "Other" },
];
export const invoiceKindLabel = (k: InvoiceKind) => INVOICE_KINDS.find((x) => x.id === k)?.label ?? k;

export const INVOICE_STATES: { id: InvoiceState; label: string; tone: "muted" | "warn" | "accent" | "ok" | "bad" }[] = [
  { id: "DRAFT", label: "Draft", tone: "muted" },
  { id: "OPEN", label: "Sent", tone: "accent" },
  { id: "PARTIAL", label: "Partly paid", tone: "warn" },
  { id: "OVERDUE", label: "Overdue", tone: "bad" },
  { id: "PAID", label: "Paid", tone: "ok" },
  { id: "VOID", label: "Void", tone: "muted" },
];
export const invoiceStateInfo = (s: InvoiceState) => INVOICE_STATES.find((x) => x.id === s) ?? INVOICE_STATES[0];

export function invoiceState(i: { status: InvoiceStatus; totalCents: number; paidCents: number; dueDate: string | null }, today = isoDay(new Date())): InvoiceState {
  if (i.status === "DRAFT" || i.status === "VOID") return i.status;
  if (i.status === "PAID" || (i.totalCents > 0 && i.paidCents >= i.totalCents)) return "PAID";
  if (i.dueDate && i.dueDate < today) return "OVERDUE";
  return i.paidCents > 0 ? "PARTIAL" : "OPEN";
}

export type LineKind = "ITEM" | "DEPOSIT" | "DEPOSIT_APPLIED" | "OTHER";
export interface InvoiceLine {
  id?: string;
  kind: LineKind;
  budgetItemId: string | null;
  phaseId: string | null;
  groupLabel: string | null;
  description: string;
  /** Budget lines: how far along the item is, counting this invoice. */
  percentBps: number | null;
  amountCents: number;
  taxable: boolean;
}

export interface InvoiceTotals { subtotalCents: number; taxCents: number; totalCents: number }
export function invoiceTotals(lines: Pick<InvoiceLine, "amountCents" | "taxable">[], taxBps: number): InvoiceTotals {
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxable = lines.reduce((s, l) => s + (l.taxable ? l.amountCents : 0), 0);
  const taxCents = Math.max(0, Math.round((taxable * taxBps) / 10_000));
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** What the client sees: the lines, or one per heading when the invoice is summarized. */
export function shownLines(lines: InvoiceLine[], summarize: boolean): { heading: string | null; lines: { description: string; amountCents: number; percentBps: number | null }[] }[] {
  const out: { heading: string | null; lines: { description: string; amountCents: number; percentBps: number | null }[] }[] = [];
  const at = (h: string | null) => { let g = out.find((x) => x.heading === h); if (!g) out.push(g = { heading: h, lines: [] }); return g; };
  for (const l of lines) {
    if (summarize && l.kind === "ITEM") {
      const label = l.groupLabel ?? "Work completed";
      const g = at(null);
      const row = g.lines.find((x) => x.description === label);
      if (row) row.amountCents += l.amountCents; else g.lines.push({ description: label, amountCents: l.amountCents, percentBps: null });
    } else if (l.kind === "ITEM") at(l.groupLabel).lines.push({ description: l.description, amountCents: l.amountCents, percentBps: l.percentBps });
    else at(null).lines.push({ description: l.description, amountCents: l.amountCents, percentBps: null });
  }
  // Headings with their lines first, then the loose ones (deposit, deposit taken off, extras).
  return [...out.filter((g) => g.heading !== null), ...out.filter((g) => g.heading === null)];
}

export interface PaymentRow {
  id: string;
  invoiceId: string | null;
  amountCents: number;
  method: PaymentMethod | null;
  provider: "MANUAL" | "STRIPE" | string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
  reference: string | null;
  receivedOn: string | null;
  note: string | null;
  recordedBy: string | null;
  receiptSentTo: string | null;
  createdAt: string;
}
export type PaymentMethod = "CHECK" | "ACH" | "CASH" | "CARD" | "OTHER";
export const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "CHECK", label: "Check" },
  { id: "ACH", label: "Bank transfer (ACH)" },
  { id: "CARD", label: "Card" },
  { id: "CASH", label: "Cash" },
  { id: "OTHER", label: "Other" },
];
export const paymentMethodLabel = (m: string | null) => PAYMENT_METHODS.find((x) => x.id === m)?.label ?? (m ? m : "Payment");

export interface InvoiceRow {
  id: string;
  number: string;
  kind: InvoiceKind;
  method: InvoiceMethod | null;
  title: string;
  status: InvoiceStatus;
  state: InvoiceState;
  issueDate: string;
  dueDate: string | null;
  subtotalCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  job: { id: string; number: string; name: string };
  customer: { id: string; name: string } | null;
  sentAt: string | null;
  viewedAt: string | null;
}

export interface Invoice extends InvoiceRow {
  percentBps: number | null;
  changeOrder: { id: string; number: string; title: string } | null;
  taxBps: number;
  taxCents: number;
  summarize: boolean;
  notes: string | null;
  lines: InvoiceLine[];
  payments: PaymentRow[];
  publicToken: string | null;
  sentTo: string | null;
  createdBy: string | null;
  customerEmail: string | null;
  createdAt: string;
}

export interface InvoicePage {
  invoice: Invoice;
  /** The business has its Stripe account connected: clients can pay by card. */
  cardPayments: boolean;
  clientUrl: string | null;
  canEdit: boolean;
}

/* ───────────── The job's billing ───────────── */

export interface BasisItem { id: string; name: string; group: string | null; priceCents: number; taxable: boolean; changeOrderId: string | null; billedCents: number }
export interface BasisPhase { id: string; name: string; status: string; billBps: number | null; billedCents: number }
export interface BillingBasis {
  contractCents: number;
  items: BasisItem[];
  phases: BasisPhase[];
  /** Deposits asked for (not void), and how much of them later invoices have taken off. */
  depositBilledCents: number;
  depositAppliedCents: number;
  /** Billed against budget lines so far (not void, drafts included so nothing is billed twice). */
  progressBilledCents: number;
  changeOrders: { id: string; number: string; title: string; status: string; priceCents: number; billedCents: number }[];
  /** The deposit on the signed proposal, if there was one. */
  proposalDepositCents: number | null;
  defaultDepositBps: number;
}

/** Each phase's share of the contract: what's set, and the rest split evenly over the others. */
export function phaseShares(phases: Pick<BasisPhase, "id" | "billBps">[]): Map<string, number> {
  const set = phases.filter((p) => p.billBps != null);
  const left = Math.max(0, 10_000 - set.reduce((s, p) => s + (p.billBps ?? 0), 0));
  const unset = phases.filter((p) => p.billBps == null);
  const out = new Map<string, number>();
  for (const p of set) out.set(p.id, p.billBps!);
  unset.forEach((p, i) => out.set(p.id, Math.floor(left / unset.length) + (i < left % unset.length ? 1 : 0)));
  return out;
}

export type DraftRequest =
  | { kind: "DEPOSIT"; amountCents: number }
  | { kind: "PROGRESS"; method: "PERCENT"; percentBps: number }
  | { kind: "PROGRESS"; method: "PHASE"; phaseIds: string[] }
  | { kind: "PROGRESS"; method: "LINES"; percents: Record<string, number> }
  | { kind: "FINAL" }
  | { kind: "CHANGE_ORDER"; changeOrderId: string }
  | { kind: "OTHER" };

export interface Draft { kind: InvoiceKind; method: InvoiceMethod | null; percentBps: number | null; changeOrderId: string | null; title: string; summarize: boolean; lines: InvoiceLine[] }

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/**
 * Split an amount over budget items in proportion to what's left to bill on each, to the cent
 * (the rounding left over goes to the largest shares).
 */
export function spread(amount: number, items: { id: string; leftCents: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const pool = items.filter((i) => i.leftCents !== 0);
  const total = pool.reduce((s, i) => s + i.leftCents, 0);
  if (!amount || !total) return out;
  const raw = pool.map((i) => ({ id: i.id, x: (amount * i.leftCents) / total }));
  const floor = raw.map((r) => ({ id: r.id, v: Math.trunc(r.x), frac: r.x - Math.trunc(r.x) }));
  let rest = amount - floor.reduce((s, r) => s + r.v, 0);
  const step = Math.sign(rest);
  const order = [...floor].sort((a, b) => step > 0 ? b.frac - a.frac : a.frac - b.frac);
  for (let k = 0; rest !== 0 && order.length; k = (k + 1) % order.length) { order[k].v += step; rest -= step; }
  for (const r of floor) if (r.v) out.set(r.id, r.v);
  return out;
}

/** The lines (and title) for a new invoice. Throws Error with words for the person when there's nothing to bill. */
export function draftInvoice(b: BillingBasis, r: DraftRequest): Draft {
  const left = new Map(b.items.map((i) => [i.id, i.priceCents - i.billedCents]));
  const byId = new Map(b.items.map((i) => [i.id, i]));
  const contractLeft = () => b.items.map((i) => ({ id: i.id, leftCents: left.get(i.id)! }));
  const lines: InvoiceLine[] = [];
  const itemLine = (id: string, amount: number, extra: Partial<InvoiceLine> = {}) => {
    const i = byId.get(id)!;
    left.set(id, left.get(id)! - amount);
    lines.push({ kind: "ITEM", budgetItemId: id, phaseId: null, groupLabel: i.group, description: i.name, percentBps: null, amountCents: amount, taxable: i.taxable, ...extra });
  };
  const unapplied = Math.max(0, b.depositBilledCents - b.depositAppliedCents);
  const applyDeposit = (all: boolean) => {
    if (!unapplied) return;
    const progress = lines.filter((l) => l.kind === "ITEM").reduce((s, l) => s + l.amountCents, 0);
    const share = all ? unapplied : b.contractCents > 0 ? Math.round((b.depositBilledCents * progress) / b.contractCents) : 0;
    const take = Math.min(unapplied, Math.max(0, share));
    if (take) lines.push({ kind: "DEPOSIT_APPLIED", budgetItemId: null, phaseId: null, groupLabel: null, description: "Less deposit received", percentBps: null, amountCents: -take, taxable: false });
  };

  switch (r.kind) {
    case "DEPOSIT": {
      if (r.amountCents <= 0) throw new Error("Enter the deposit amount.");
      lines.push({ kind: "DEPOSIT", budgetItemId: null, phaseId: null, groupLabel: null, description: "Deposit", percentBps: null, amountCents: r.amountCents, taxable: false });
      const share = b.contractCents > 0 ? Math.round((r.amountCents * 10_000) / b.contractCents) : null;
      return { kind: "DEPOSIT", method: null, percentBps: null, changeOrderId: null, title: share ? `Deposit (${pct(share)} of the contract)` : "Deposit", summarize: false, lines };
    }
    case "PROGRESS": {
      if (r.method === "PERCENT") {
        if (r.percentBps <= 0 || r.percentBps > 10_000) throw new Error("Enter a percent between 0 and 100.");
        const target = Math.round((b.contractCents * r.percentBps) / 10_000);
        const amount = target - b.progressBilledCents;
        if (amount <= 0) throw new Error(`${pct(r.percentBps)} of the contract has already been billed (${pct(Math.round((b.progressBilledCents * 10_000) / Math.max(1, b.contractCents)))} so far).`);
        const label = `Progress billing: ${pct(r.percentBps)} of the contract`;
        for (const [id, a] of spread(amount, contractLeft())) itemLine(id, a, { groupLabel: label });
        applyDeposit(false);
        return { kind: "PROGRESS", method: "PERCENT", percentBps: r.percentBps, changeOrderId: null, title: `Progress billing (through ${pct(r.percentBps)})`, summarize: true, lines };
      }
      if (r.method === "PHASE") {
        const shares = phaseShares(b.phases);
        const picked = b.phases.filter((p) => r.phaseIds.includes(p.id));
        if (!picked.length) throw new Error("Pick the phases to bill.");
        // Billed through: the picked phases and any billed before, as a share of the contract. Billing
        // done some other way (a percent, budget lines) counts toward it, so nothing is billed twice.
        const through = b.phases.filter((p) => picked.includes(p) || p.billedCents > 0).reduce((s, p) => s + (shares.get(p.id) ?? 0), 0);
        const amount = Math.round((b.contractCents * through) / 10_000) - b.progressBilledCents;
        const owed = picked.map((p) => ({ id: p.id, leftCents: Math.max(0, Math.round((b.contractCents * (shares.get(p.id) ?? 0)) / 10_000) - p.billedCents) }));
        if (amount > 0) {
          for (const [pid, part] of spread(Math.min(amount, owed.reduce((s, o) => s + o.leftCents, 0)), owed)) {
            const p = picked.find((x) => x.id === pid)!;
            for (const [id, a] of spread(part, contractLeft())) itemLine(id, a, { phaseId: p.id, groupLabel: `${p.name} (${pct(shares.get(p.id) ?? 0)} of the contract)` });
          }
        }
        if (!lines.length) throw new Error(picked.length === 1 ? `${picked[0].name} has already been billed.` : "Those phases have already been billed.");
        applyDeposit(false);
        return { kind: "PROGRESS", method: "PHASE", percentBps: null, changeOrderId: null, title: `Progress billing: ${picked.map((p) => p.name).join(", ")}`, summarize: true, lines };
      }
      for (const [id, bps] of Object.entries(r.percents)) {
        const i = byId.get(id);
        if (!i || bps < 0 || bps > 10_000) continue;
        const amount = Math.round((i.priceCents * bps) / 10_000) - i.billedCents;
        if (amount) itemLine(id, amount, { percentBps: bps });
      }
      if (!lines.length) throw new Error("Set how far along at least one line is, past what's been billed.");
      applyDeposit(false);
      return { kind: "PROGRESS", method: "LINES", percentBps: null, changeOrderId: null, title: "Progress billing", summarize: false, lines };
    }
    case "FINAL": {
      for (const i of b.items) { const l = left.get(i.id)!; if (l) itemLine(i.id, l, { percentBps: 10_000 }); }
      applyDeposit(true);
      if (!lines.length) throw new Error("Everything on this job has been billed.");
      return { kind: "FINAL", method: null, percentBps: null, changeOrderId: null, title: "Final invoice", summarize: false, lines };
    }
    case "CHANGE_ORDER": {
      const co = b.changeOrders.find((c) => c.id === r.changeOrderId);
      if (!co) throw new Error("Pick an approved change order.");
      for (const i of b.items.filter((x) => x.changeOrderId === co.id)) { const l = left.get(i.id)!; if (l) itemLine(i.id, l, { percentBps: 10_000, groupLabel: `${co.number}: ${co.title}` }); }
      if (!lines.length) throw new Error(`${co.number} has already been billed.`);
      return { kind: "CHANGE_ORDER", method: null, percentBps: null, changeOrderId: co.id, title: `Change order ${co.number}: ${co.title}`, summarize: false, lines };
    }
    case "OTHER":
      return { kind: "OTHER", method: null, percentBps: null, changeOrderId: null, title: "Invoice", summarize: false, lines };
  }
}

export interface JobBilling {
  /** The approved price, before tax. */
  contractCents: number;
  /** Sent and paid invoices, before tax. */
  invoicedCents: number;
  invoicedBps: number;
  collectedCents: number;
  receivableCents: number;
  /** The contract not on a sent invoice yet. */
  toInvoiceCents: number;
  /** On draft invoices. */
  draftCents: number;
  invoices: InvoiceRow[];
  basis: BillingBasis;
  /** For a new invoice: due in this many days, and the tax rate. */
  defaults: { dueDays: number; taxBps: number; depositCents: number };
  cardPayments: boolean;
  /** The client's email (where invoices go), and whether they can sign in to the portal. */
  clientEmail: string | null;
}

/* ───────────── Aging ───────────── */

export interface AgingBuckets { currentCents: number; d1to30Cents: number; d31to60Cents: number; d61to90Cents: number; over90Cents: number; totalCents: number }
export const emptyAging = (): AgingBuckets => ({ currentCents: 0, d1to30Cents: 0, d31to60Cents: 0, d61to90Cents: 0, over90Cents: 0, totalCents: 0 });

export function isoDay(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
export function daysLate(dueDate: string | null, today: string): number {
  if (!dueDate || dueDate >= today) return 0;
  const [a, b] = [dueDate, today].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86_400_000);
}
/** Add one open invoice's balance to its bucket (by days past due). */
export function addAging(a: AgingBuckets, balanceCents: number, dueDate: string | null, today: string) {
  if (balanceCents <= 0) return a;
  const late = daysLate(dueDate, today);
  if (late === 0) a.currentCents += balanceCents;
  else if (late <= 30) a.d1to30Cents += balanceCents;
  else if (late <= 60) a.d31to60Cents += balanceCents;
  else if (late <= 90) a.d61to90Cents += balanceCents;
  else a.over90Cents += balanceCents;
  a.totalCents += balanceCents;
  return a;
}

export interface InvoicesPage {
  invoices: InvoiceRow[];
  counts: Record<"DRAFT" | "OPEN" | "OVERDUE" | "PAID" | "ALL", number>;
  aging: AgingBuckets;
  byClient: { customer: { id: string; name: string } | null; aging: AgingBuckets; oldestDue: string | null }[];
  collectedThisMonthCents: number;
}

/* ───────────── Selections ───────────── */

export type SelectionStatus = "OPEN" | "CHOSEN" | "LOCKED";
export interface SelectionOption { id: string; name: string; description: string | null; priceCents: number; costCents: number }
export interface Selection {
  id: string; title: string; description: string | null; dueDate: string | null; status: SelectionStatus;
  options: SelectionOption[];
  chosenOptionId: string | null; chosenBy: string | null; chosenAt: string | null;
  budgetItemId: string | null;
}

/* ───────────── Messages and the portal ───────────── */

export interface PortalMessage { id: string; fromClient: boolean; author: string | null; body: string; at: string; readAt: string | null }

export interface PortalBusiness { orgId: string; name: string; logo: string | null; email: string | null; phone: string | null }

export interface PortalJob {
  id: string; number: string; name: string; status: string;
  site: string | null; startDate: string | null; endDate: string | null;
  phases: { id: string; name: string; startDate: string | null; endDate: string | null; status: string }[];
  files: { id: string; name: string; mime: string | null; sizeBytes: number; createdAt: string }[];
  selections: (Omit<Selection, "budgetItemId" | "options"> & { options: Omit<SelectionOption, "costCents">[] })[];
  messages: PortalMessage[];
  /** Approved price (before tax), invoiced and paid. */
  contractCents: number; invoicedCents: number; paidCents: number;
}

export interface PortalHome {
  email: string;
  /** Every business this email is a client of; one is open. */
  businesses: PortalBusiness[];
  business: PortalBusiness | null;
  clientName: string | null;
  proposals: { id: string; number: string; title: string; status: string; totalCents: number; date: string | null; url: string | null }[];
  changeOrders: { id: string; number: string; title: string; status: string; amountCents: number; job: string; url: string | null }[];
  invoices: (InvoiceRow & { url: string | null })[];
  jobs: PortalJob[];
  balanceCents: number;
}

/** The invoice page a client opens from the email (no sign-in: the link is the key). */
export interface ClientInvoicePage {
  invoice: Omit<Invoice, "payments" | "createdBy" | "publicToken" | "lines"> & { lines: ReturnType<typeof shownLines> };
  payments: { amountCents: number; method: string | null; at: string }[];
  business: { name: string; address: string | null; phone: string | null; email: string | null };
  logo: string | null;
  customer: { name: string; contactName: string | null; address: string | null } | null;
  site: string | null;
  cardPayments: boolean;
  /** Just paid by card: it's being confirmed. */
  confirming: boolean;
  terms: string | null;
}

/* ───────────── Reports ───────────── */

export interface AvlReports {
  from: string; to: string;
  pipeline: { stage: string; label: string; count: number; valueCents: number }[];
  winRate: { won: number; lost: number; bps: number; wonValueCents: number };
  revenueByMonth: { month: string; invoicedCents: number; collectedCents: number }[];
  marginByJob: { id: string; number: string; name: string; status: string; priceCents: number; projectedCostCents: number; actualCostCents: number; marginBps: number }[];
  unpaid: InvoiceRow[];
  aging: AgingBuckets;
  hoursByJob: { id: string; number: string; name: string; minutes: number; budgetMinutes: number | null; costCents: number }[];
}

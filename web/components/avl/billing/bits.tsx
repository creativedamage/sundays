"use client";
/** Pieces shared by the billing screens: status pills, the invoices table, money that can go negative, recording a payment, and starting an invoice. */
import clsx from "clsx";
import { Check as CheckIcon, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  invoiceKindLabel, invoiceStateInfo, PAYMENT_METHODS, phaseShares,
  type Invoice, type InvoiceRow, type InvoiceState, type JobBilling, type PaymentMethod,
} from "@shared/ops/invoicing";
import { parseMoneyToCents } from "@shared/ops/math";
import { fmtMoney, ops, useOpsRefresh } from "@/lib/ops";
import { Empty, Field, MoneyInput, PercentInput, Pill, Table, Tabs } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

export const InvoicePill = ({ s }: { s: InvoiceState }) => { const x = invoiceStateInfo(s); return <Pill tone={x.tone}>{x.label}</Pill>; };
export const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const dayText = (d: string | null) => (d ? new Date(`${d}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Dollars that may be negative (a credit, the deposit taken off). Commits on blur / Enter. */
export function SignedMoney({ cents, onChange, className, disabled }: { cents: number; onChange: (c: number) => void; className?: string; disabled?: boolean }) {
  const fmt = (c: number) => (c / 100).toFixed(2);
  const [text, setText] = useState(fmt(cents));
  useEffect(() => setText(fmt(cents)), [cents]);
  const commit = () => {
    const neg = /^\s*[-−(]/.test(text);
    const v = parseMoneyToCents(text.replace(/[-−()]/g, ""));
    if (v === null) return setText(fmt(cents));
    const c = neg ? -v : v;
    if (c !== cents) onChange(c); else setText(fmt(cents));
  };
  return (
    <div className={clsx("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">$</span>
      <input inputMode="decimal" disabled={disabled} className={clsx("input py-1 pl-6 text-right tabular-nums", cents < 0 && "text-bad")} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

export function InvoiceTable({ rows, showJob = true, empty }: { rows: InvoiceRow[]; showJob?: boolean; empty: React.ReactNode }) {
  const router = useRouter();
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <Table min={showJob ? 860 : 700} head={<tr><th>Invoice</th>{showJob && <th>Job</th>}<th>Status</th><th>Dated</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Owed</th></tr>}>
      {rows.map((i) => (
        <tr key={i.id} className="cursor-pointer" onClick={() => router.push(`/avl/invoices/view?id=${i.id}`)}>
          <td>
            <Link href={`/avl/invoices/view?id=${i.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{i.title}</Link>
            <div className="text-[11px] text-ink-faint"><span className="font-mono">{i.number}</span> · {invoiceKindLabel(i.kind)}</div>
          </td>
          {showJob && <td className="text-ink-soft"><div>{i.customer?.name ?? "—"}</div><div className="text-[11px] text-ink-faint">{i.job.number} · {i.job.name}</div></td>}
          <td><InvoicePill s={i.state} /></td>
          <td className="whitespace-nowrap text-xs text-ink-muted">{dayText(i.issueDate)}</td>
          <td className={clsx("whitespace-nowrap text-xs", i.state === "OVERDUE" ? "font-medium text-bad" : "text-ink-muted")}>{dayText(i.dueDate)}</td>
          <td className="text-right font-mono">{fmtMoney(i.totalCents)}</td>
          <td className={clsx("text-right font-mono", i.balanceCents > 0 ? "text-ink" : "text-ink-faint")}>{i.status === "DRAFT" || i.status === "VOID" ? "—" : fmtMoney(i.balanceCents)}</td>
        </tr>
      ))}
    </Table>
  );
}

/** Record a check, transfer or cash (and email a receipt). */
export function PaymentModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (inv: Invoice) => void }) {
  const balance = invoice.totalCents - invoice.paidCents;
  const [f, setF] = useState({ amountCents: balance, method: "CHECK" as PaymentMethod, reference: "", receivedOn: todayIso(), note: "", receipt: Boolean(invoice.customerEmail), receiptTo: invoice.customerEmail ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (x: Partial<typeof f>) => setF({ ...f, ...x });
  return (
    <Modal open onClose={onClose} title={`Record a payment on ${invoice.number}`} width={520}>
      <form className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const out = await ops<{ invoice: Invoice; receiptError: string | null }>(`/invoices/${invoice.id}/payments`, { json: {
            amountCents: f.amountCents, method: f.method, reference: f.reference || null, receivedOn: f.receivedOn, note: f.note || null, receiptTo: f.receipt ? f.receiptTo : null,
          } });
          if (out.receiptError) toast.warning(`Payment recorded, but the receipt didn’t go: ${out.receiptError}`); else toast.success(f.receipt ? "Payment recorded, receipt sent" : "Payment recorded");
          onDone(out.invoice);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" hint={`Owed: ${fmtMoney(balance)}`}><MoneyInput cents={f.amountCents} onChange={(v) => set({ amountCents: v ?? 0 })} /></Field>
          <Field label="Received"><input type="date" className="input" value={f.receivedOn} onChange={(e) => set({ receivedOn: e.target.value })} /></Field>
          <Field label="How"><select className="input" value={f.method} onChange={(e) => set({ method: e.target.value as PaymentMethod })}>{PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
          <Field label={f.method === "CHECK" ? "Check number" : "Reference"}><input className="input" value={f.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={f.method === "CHECK" ? "1042" : "Optional"} /></Field>
          <Field label="Note" className="sm:col-span-2"><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="Optional, only your team sees it" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.receipt} onChange={(e) => set({ receipt: e.target.checked })} /> Email a receipt to</label>
        {f.receipt && <input type="email" required className="input" value={f.receiptTo} onChange={(e) => set({ receiptTo: e.target.value })} placeholder="client@example.org" />}
        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || f.amountCents <= 0}>{busy ? <Spinner /> : <CheckIcon size={14} />} Record {fmtMoney(f.amountCents)}</button></div>
      </form>
    </Modal>
  );
}

type Kind = "DEPOSIT" | "PROGRESS" | "FINAL" | "CHANGE_ORDER" | "OTHER";
type Method = "PERCENT" | "PHASE" | "LINES";

/** Start an invoice for a job: what kind, and (for progress) how much. The draft opens to check before sending. */
export function NewInvoiceModal({ jobId, billing, onClose, onPhasesSaved }: { jobId: string; billing: JobBilling; onClose: () => void; onPhasesSaved: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const b = billing.basis;
  const deposited = b.depositBilledCents > 0;
  const billedBps = b.contractCents > 0 ? Math.round((b.progressBilledCents * 10_000) / b.contractCents) : 0;
  const openCos = b.changeOrders.filter((c) => c.billedCents !== c.priceCents);
  const left = b.items.reduce((s, i) => s + (i.priceCents - i.billedCents), 0);
  const [kind, setKind] = useState<Kind>(!deposited && billing.invoices.length === 0 ? "DEPOSIT" : left !== 0 ? "PROGRESS" : openCos.length ? "CHANGE_ORDER" : "OTHER");
  const [method, setMethod] = useState<Method>(b.phases.length ? "PHASE" : "PERCENT");
  const [deposit, setDeposit] = useState(billing.defaults.depositCents || Math.round(b.contractCents * 0.3));
  const [through, setThrough] = useState(Math.min(10_000, billedBps + 2500));
  const [phaseIds, setPhaseIds] = useState<string[]>([]);
  const [shares, setShares] = useState<Record<string, number | null>>(Object.fromEntries(b.phases.map((p) => [p.id, p.billBps])));
  const [sharesDirty, setSharesDirty] = useState(false);
  const [lines, setLines] = useState<Record<string, number>>({});
  const [coId, setCoId] = useState(openCos[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => phaseShares(b.phases.map((p) => ({ id: p.id, billBps: shares[p.id] ?? null }))), [b.phases, shares]);
  const setTotal = Object.values(shares).reduce<number>((s, v) => s + (v ?? 0), 0);

  async function create() {
    setBusy(true); setError(null);
    try {
      if (kind === "PROGRESS" && method === "PHASE" && sharesDirty) {
        await ops(`/jobs/${jobId}/phase-billing`, { method: "PUT", json: { shares } });
        setSharesDirty(false); onPhasesSaved();
      }
      const body = kind === "DEPOSIT" ? { kind, amountCents: deposit }
        : kind === "PROGRESS" ? (method === "PERCENT" ? { kind, method, percentBps: through } : method === "PHASE" ? { kind, method, phaseIds } : { kind, method, percents: lines })
        : kind === "CHANGE_ORDER" ? { kind, changeOrderId: coId } : { kind };
      const inv = await ops<{ id: string }>(`/jobs/${jobId}/invoices`, { json: body });
      void refresh();
      router.push(`/avl/invoices/view?id=${inv.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const kinds: { key: Kind; label: string; hint: string; off?: boolean }[] = [
    { key: "DEPOSIT", label: "Deposit", hint: deposited ? "A deposit has been asked for already." : "Before work starts; taken off later invoices.", off: deposited },
    { key: "PROGRESS", label: "Progress", hint: "Part of the job, as it gets done.", off: left === 0 },
    { key: "FINAL", label: "Final", hint: "Everything left, less the rest of the deposit.", off: left === 0 && b.depositAppliedCents >= b.depositBilledCents },
    { key: "CHANGE_ORDER", label: "Change order", hint: openCos.length ? "An approved change order on its own." : "No approved change order left to bill.", off: !openCos.length },
    { key: "OTHER", label: "Blank", hint: "Type the lines yourself." },
  ];
  return (
    <Modal open onClose={onClose} title="New invoice" width={720}>
      <div className="space-y-4 p-5">
        <div className="grid gap-2 sm:grid-cols-5">
          {kinds.map((k) => (
            <button key={k.key} type="button" disabled={k.off} onClick={() => setKind(k.key)}
              className={clsx("rounded-lg border px-3 py-2 text-left transition disabled:opacity-40", kind === k.key ? "border-accent bg-accent-soft" : "border-line hover:bg-hover/40")}>
              <div className="text-sm font-semibold">{k.label}</div><div className="text-[11px] leading-snug text-ink-muted">{k.hint}</div>
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-hover/40 px-3 py-2 text-xs text-ink-muted">
          Contract {fmtMoney(b.contractCents)} · billed so far {fmtMoney(b.progressBilledCents)} ({pct(billedBps)}) · left {fmtMoney(left)}
          {b.depositBilledCents > 0 && <> · deposit {fmtMoney(b.depositBilledCents)}, {fmtMoney(b.depositBilledCents - b.depositAppliedCents)} still to take off</>}
        </div>

        {kind === "DEPOSIT" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Deposit" hint={b.contractCents ? `${pct(Math.round((deposit * 10_000) / b.contractCents))} of the contract` : undefined}><MoneyInput cents={deposit} onChange={(v) => setDeposit(v ?? 0)} /></Field>
            <div className="text-xs text-ink-muted sm:col-span-2 sm:pt-6">{b.proposalDepositCents ? `The signed proposal asked for ${fmtMoney(b.proposalDepositCents)}.` : "Each later invoice takes its share of the deposit off; the final takes off the rest."}</div>
          </div>
        )}

        {kind === "PROGRESS" && left === 0 && <p className="text-sm text-ink-muted">Everything on the budget has been billed.</p>}
        {kind === "PROGRESS" && left !== 0 && (
          <div className="space-y-3">
            <Tabs value={method} onChange={setMethod} items={[{ key: "PHASE", label: "By schedule phase" }, { key: "PERCENT", label: "Percent of the contract" }, { key: "LINES", label: "By budget lines" }]} />
            {method === "PERCENT" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Bill through" hint={`Billed so far: ${pct(billedBps)}`}><PercentInput bps={through} onChange={(v) => setThrough(Math.max(0, Math.min(10_000, v)))} /></Field>
                <div className="text-sm sm:col-span-2 sm:pt-6">This invoice: <b className="font-mono">{fmtMoney(Math.max(0, Math.round((b.contractCents * through) / 10_000) - b.progressBilledCents))}</b> before tax and the deposit.</div>
              </div>
            )}
            {method === "PHASE" && (b.phases.length ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-muted">Each phase is a share of the contract. Tick the phases that are done; phases with no share split what’s left evenly.</p>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {b.phases.map((p) => {
                    const target = Math.round((b.contractCents * (shown.get(p.id) ?? 0)) / 10_000);
                    const done = p.billedCents >= target && target > 0;
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                          <input type="checkbox" disabled={done} checked={phaseIds.includes(p.id)} onChange={(e) => setPhaseIds(e.target.checked ? [...phaseIds, p.id] : phaseIds.filter((x) => x !== p.id))} />
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="hidden text-[11px] text-ink-faint sm:inline">{p.status === "DONE" ? "Done" : p.status === "IN_PROGRESS" ? "In progress" : "Not started"}{done ? " · billed" : p.billedCents ? ` · ${fmtMoney(p.billedCents)} billed` : ""}</span>
                        </label>
                        <div className="w-24"><PercentInput bps={shares[p.id] ?? shown.get(p.id) ?? 0} onChange={(v) => { setShares({ ...shares, [p.id]: v }); setSharesDirty(true); }} /></div>
                        <div className="w-24 text-right font-mono text-sm">{fmtMoney(target)}</div>
                      </div>
                    );
                  })}
                </div>
                {setTotal > 10_000 && <p className="text-xs text-bad">The phases add up to more than 100%.</p>}
              </div>
            ) : <p className="text-sm text-ink-muted">This job has no schedule phases yet. Add them on the Schedule tab, or bill by percent or budget lines.</p>)}
            {method === "LINES" && (
              <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.06em] text-ink-muted"><tr><th className="px-3 py-2">Line</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Billed</th><th className="w-28 px-3 py-2">Through</th><th className="px-3 py-2 text-right">This invoice</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {b.items.filter((i) => i.priceCents !== 0).map((i) => {
                      const was = i.priceCents ? Math.round((i.billedCents * 10_000) / i.priceCents) : 0;
                      const v = lines[i.id];
                      const amt = v == null ? 0 : Math.round((i.priceCents * v) / 10_000) - i.billedCents;
                      return (
                        <tr key={i.id}>
                          <td className="px-3 py-1.5"><div>{i.name}</div><div className="text-[11px] text-ink-faint">{i.group}</div></td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtMoney(i.priceCents)}</td>
                          <td className="px-3 py-1.5 text-right text-xs text-ink-muted">{pct(was)}</td>
                          <td className="px-3 py-1.5"><PercentInput bps={v ?? was} onChange={(x) => setLines({ ...lines, [i.id]: Math.max(0, Math.min(10_000, x)) })} /></td>
                          <td className={clsx("px-3 py-1.5 text-right font-mono text-xs", amt < 0 && "text-bad")}>{amt ? fmtMoney(amt) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {kind === "FINAL" && <p className="text-sm">Bills what’s left on every line, <b className="font-mono">{fmtMoney(left)}</b>, and takes off the rest of the deposit, <b className="font-mono">{fmtMoney(Math.max(0, b.depositBilledCents - b.depositAppliedCents))}</b>.</p>}
        {kind === "CHANGE_ORDER" && (
          <Field label="Change order"><select className="input" value={coId} onChange={(e) => setCoId(e.target.value)}>{openCos.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.title} · {fmtMoney(c.priceCents - c.billedCents)}</option>)}</select></Field>
        )}
        {kind === "OTHER" && <p className="text-sm text-ink-muted">A blank invoice opens for you to add lines (a service call, a rental, anything not on the budget).</p>}

        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || (kind === "PROGRESS" && method === "PHASE" && (!phaseIds.length || setTotal > 10_000))} onClick={() => void create()}>{busy ? <Spinner /> : <Plus size={14} />} Make the draft</button></div>
      </div>
    </Modal>
  );
}

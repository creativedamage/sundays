"use client";
/**
 * One client invoice: a draft to check and edit (lines, dates, tax), then sent by email or marked
 * sent; payments recorded by hand (with a receipt) or paid by card through Stripe; void or back to
 * draft while nothing's paid.
 */
import clsx from "clsx";
import { ArrowLeft, Ban, Check, Copy, CreditCard, ExternalLink, Mail, Plus, RotateCcw, Send, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { invoiceKindLabel, invoiceTotals, paymentMethodLabel, type Invoice, type InvoiceLine } from "@shared/ops/invoicing";
import { fmtDateTime, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check as Tick, Empty, ErrorBox, Field, Loading, PercentInput } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { Facts, SendModal } from "@/components/avl/purchasing/bits";
import { dayText, InvoicePill, PaymentModal, pct, SignedMoney } from "@/components/avl/billing/bits";

interface Page { invoice: Invoice; cardPayments: boolean; clientUrl: string | null; canEdit: boolean; budget: { id: string; name: string; taxable: boolean }[] }
type Line = InvoiceLine & { key: string };
type Draft = { title: string; issueDate: string; dueDate: string | null; taxBps: number; summarize: boolean; notes: string | null; lines: Line[] };

export default function Page() { return <Suspense><InvoiceView /></Suspense>; }
const key = () => Math.random().toString(36).slice(2, 10);
const toDraft = (i: Invoice): Draft => ({ title: i.title, issueDate: i.issueDate, dueDate: i.dueDate, taxBps: i.taxBps, summarize: i.summarize, notes: i.notes, lines: i.lines.map((l) => ({ ...l, key: l.id ?? key() })) });

function InvoiceView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const refresh = useOpsRefresh();
  const d = useOps<Page>(id ? `/invoices/${id}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"send" | "pay" | "receipt" | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const inv = d.data?.invoice;
  useEffect(() => { if (inv && !dirty) setDraft(toDraft(inv)); }, [inv, dirty]);
  if (!d.data || !draft) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const i = d.data.invoice;
  const editable = i.status === "DRAFT";
  const t = editable ? invoiceTotals(draft.lines.map((l) => ({ ...l, taxable: l.taxable && draft.taxBps > 0 })), draft.taxBps) : { subtotalCents: i.subtotalCents, taxCents: i.taxCents, totalCents: i.totalCents };
  const set = (x: Partial<Draft>) => { setDraft({ ...draft, ...x }); setDirty(true); };
  const setLine = (k: string, x: Partial<Line>) => set({ lines: draft.lines.map((l) => (l.key === k ? { ...l, ...x } : l)) });
  const back = `/avl/jobs/view?id=${i.job.id}&tab=invoicing`;

  async function save(quiet = false) {
    setBusy("save");
    try { await ops(`/invoices/${id}`, { method: "PUT", json: { ...draft, lines: draft!.lines.map(({ key: _k, id: _i, ...l }) => l) } }); setDirty(false); await d.refetch(); if (!quiet) toast.success("Saved"); return true; }
    catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(null); }
  }
  async function event(event: string, extra: Record<string, unknown> = {}, done?: string) {
    if (dirty && !(await save(true))) return;
    setBusy(event);
    try { await ops(`/invoices/${id}/events`, { json: { event, ...extra } }); await d.refetch(); void refresh(); if (done) toast.success(done); setModal(null); }
    catch (e) { if (event === "SEND") throw e; toast.error((e as Error).message); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!window.confirm(`Delete draft ${i.number}?`)) return;
    try { await ops(`/invoices/${id}`, { method: "DELETE" }); void refresh(); router.push(back); } catch (e) { toast.error((e as Error).message); }
  }
  async function removePayment(pid: string) {
    if (!window.confirm("Remove this payment? Only do this if it was recorded by mistake or bounced.")) return;
    try { await ops(`/payments/${pid}`, { method: "DELETE" }); await d.refetch(); void refresh(); } catch (e) { toast.error((e as Error).message); }
  }
  async function checkCard() {
    setBusy("card");
    try { const r = await ops<{ settled: number }>(`/invoices/${id}/check-card`, { json: {} }); await d.refetch(); toast.success(r.settled ? "Card payment found and recorded" : "No new card payments"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  const groups = [...new Set(draft.lines.map((l) => l.groupLabel ?? ""))];
  const pendingCard = i.payments.some((p) => p.provider === "STRIPE" && p.status === "PENDING");

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> {i.job.number} · {i.job.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{invoiceKindLabel(i.kind)} invoice</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{editable ? draft.title : i.title} <span className="font-mono text-lg text-ink-muted">{i.number}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><InvoicePill s={i.state} />{i.customer && <span>{i.customer.name}</span>}{i.changeOrder && <Link href={`/avl/jobs/change-order?id=${i.changeOrder.id}`} className="hover:text-accent">{i.changeOrder.number}</Link>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <>
            <button className="btn-ghost text-bad" onClick={() => void remove()}><Trash2 size={14} /> Delete</button>
            {dirty && <button className="btn-outline" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save</button>}
            <button className="btn-outline" disabled={!!busy} onClick={() => void event("MARK_SENT", {}, "Marked sent")}>Mark sent</button>
            <button className="btn-primary" disabled={!!busy} onClick={() => setModal("send")}><Send size={14} /> Email to client</button>
          </>}
          {!editable && i.status !== "VOID" && <>
            {d.data.clientUrl && <button className="btn-ghost" onClick={() => { void navigator.clipboard.writeText(d.data!.clientUrl!); toast.success("Client link copied"); }}><Copy size={14} /> Link</button>}
            {d.data.clientUrl && <a className="btn-ghost" href={d.data.clientUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Client copy</a>}
            {i.payments.every((p) => p.status !== "SUCCEEDED") && <button className="btn-ghost" onClick={() => void event("REOPEN", {}, "Back to draft")}><Undo2 size={14} /> Back to draft</button>}
            {i.payments.every((p) => p.status !== "SUCCEEDED") && <button className="btn-ghost text-bad" onClick={() => { if (window.confirm(`Void ${i.number}? It stays on record but no longer counts as billed.`)) void event("VOID", {}, "Voided"); }}><Ban size={14} /> Void</button>}
            {i.status === "SENT" && <button className="btn-outline" onClick={() => setModal("send")}><Mail size={14} /> Email again</button>}
            {i.status === "SENT" && <button className="btn-primary" onClick={() => setModal("pay")}><Plus size={14} /> Record payment</button>}
          </>}
          {i.status === "VOID" && <button className="btn-outline" onClick={() => void event("REOPEN", {}, "Back to draft")}><RotateCcw size={14} /> Back to draft</button>}
        </div>
      </div>

      <Facts items={[
        ["Total", <span key="t" className="font-mono font-semibold">{fmtMoney(t.totalCents)}</span>],
        ["Paid", i.paidCents ? <span key="p" className="font-mono text-ok">{fmtMoney(i.paidCents)}</span> : null],
        ["Owed", !editable && i.status !== "VOID" ? <span key="o" className={clsx("font-mono", i.state === "OVERDUE" && "text-bad")}>{fmtMoney(i.balanceCents)}</span> : null],
        ["Dated", dayText(i.issueDate)],
        ["Due", dayText(i.dueDate)],
        ["Sent", i.sentAt ? `${fmtDateTime(i.sentAt)}${i.sentTo ? ` to ${i.sentTo}` : ""}` : null],
        ["Client opened it", i.viewedAt ? fmtDateTime(i.viewedAt) : null],
        ["Made", `${fmtDateTime(i.createdAt)}${i.createdBy ? ` by ${i.createdBy}` : ""}`],
      ]} />

      {pendingCard && <p className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm"><CreditCard size={15} /> The client started a card payment. It’s recorded here once Stripe confirms it. <button className="btn-ghost py-1 text-xs" disabled={busy === "card"} onClick={() => void checkCard()}>{busy === "card" ? <Spinner /> : null} Check now</button></p>}

      {editable && (
        <Card eyebrow="Invoice" title="Details">
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Title" className="sm:col-span-2"><input className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Dated"><input type="date" className="input" value={draft.issueDate} onChange={(e) => set({ issueDate: e.target.value })} /></Field>
            <Field label="Due"><input type="date" className="input" value={draft.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} /></Field>
            <Field label="Tax" hint="On taxable lines"><PercentInput bps={draft.taxBps} onChange={(v) => set({ taxBps: Math.max(0, Math.min(5000, v)) })} /></Field>
            <div className="sm:col-span-2 lg:col-span-5"><Tick label="Show the client one line per heading (a phase, “40% of the contract”) instead of every budget line" checked={draft.summarize} onChange={(v) => set({ summarize: v })} /></div>
            <Field label="Notes for the client" className="sm:col-span-2 lg:col-span-5"><textarea rows={2} className="input" value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} placeholder="How to pay by check or transfer, thank-you note…" /></Field>
          </div>
        </Card>
      )}

      <Card eyebrow="Lines" title={editable ? "What it bills" : "Lines"} action={editable && <button className="btn-ghost text-xs" onClick={() => set({ lines: [...draft.lines, { key: key(), kind: "OTHER", budgetItemId: null, phaseId: null, groupLabel: null, description: "", percentBps: null, amountCents: 0, taxable: draft.taxBps > 0 }] })}><Plus size={13} /> Line</button>}>
        {!draft.lines.length ? <Empty>No lines yet. Add what you’re billing.</Empty> : (
          <div className="divide-y divide-line">
            {groups.map((g) => (
              <div key={g}>
                {g && <div className="bg-hover/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{g}</div>}
                {draft.lines.filter((l) => (l.groupLabel ?? "") === g).map((l) => (
                  <div key={l.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[1fr_70px_140px_70px_32px]">
                    <div className="min-w-0">
                      {editable ? <input className="input py-1" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                        : <div className="text-sm">{l.description}</div>}
                      <div className="text-[11px] text-ink-faint">{l.kind === "ITEM" ? "Budget line" : l.kind === "DEPOSIT" ? "Deposit" : l.kind === "DEPOSIT_APPLIED" ? "Deposit taken off" : "Added by hand"}{l.percentBps != null ? ` · through ${pct(l.percentBps)}` : ""}</div>
                    </div>
                    <div className="hidden text-right text-xs text-ink-muted sm:block">{l.taxable && (editable ? draft.taxBps : i.taxBps) > 0 ? "Taxed" : ""}</div>
                    <div>{editable ? <SignedMoney cents={l.amountCents} onChange={(v) => setLine(l.key, { amountCents: v })} /> : <div className={clsx("text-right font-mono text-sm", l.amountCents < 0 && "text-bad")}>{fmtMoney(l.amountCents)}</div>}</div>
                    {editable ? <label className="hidden items-center justify-end gap-1 text-[11px] text-ink-muted sm:flex"><input type="checkbox" checked={l.taxable} disabled={l.kind === "DEPOSIT" || l.kind === "DEPOSIT_APPLIED"} onChange={(e) => setLine(l.key, { taxable: e.target.checked })} /> Tax</label> : <span className="hidden sm:block" />}
                    {editable ? <button className="btn-ghost hidden p-1.5 text-ink-faint hover:text-bad sm:inline-flex" onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}><X size={14} /></button> : <span className="hidden sm:block" />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="ml-auto max-w-xs space-y-1 border-t border-line px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span className="font-mono">{fmtMoney(t.subtotalCents)}</span></div>
          {t.taxCents > 0 && <div className="flex justify-between"><span className="text-ink-muted">Tax ({pct(editable ? draft.taxBps : i.taxBps)})</span><span className="font-mono">{fmtMoney(t.taxCents)}</span></div>}
          <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="font-mono">{fmtMoney(t.totalCents)}</span></div>
          {i.paidCents > 0 && <div className="flex justify-between text-ok"><span>Paid</span><span className="font-mono">−{fmtMoney(i.paidCents)}</span></div>}
          {!editable && i.status !== "VOID" && <div className="flex justify-between font-semibold"><span>Owed</span><span className="font-mono">{fmtMoney(i.balanceCents)}</span></div>}
        </div>
      </Card>

      {!editable && (
        <Card eyebrow="Payments" title="Received" action={i.status === "SENT" && <button className="btn-ghost text-xs" onClick={() => setModal("pay")}><Plus size={13} /> Record payment</button>}>
          {!i.payments.filter((p) => p.status !== "FAILED").length ? <Empty>No payments yet.{d.data.cardPayments ? " The client can pay by card from the invoice link." : ""}</Empty> : (
            <ul className="divide-y divide-line">
              {i.payments.filter((p) => p.status !== "FAILED").map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{p.provider === "STRIPE" ? "Card (Stripe)" : paymentMethodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""} {p.status === "PENDING" && <span className="text-xs text-warn">waiting for Stripe</span>}</div>
                    <div className="text-[11px] text-ink-faint">{dayText(p.receivedOn ?? p.createdAt.slice(0, 10))}{p.recordedBy ? ` · recorded by ${p.recordedBy}` : ""}{p.receiptSentTo ? ` · receipt to ${p.receiptSentTo}` : ""}{p.note ? ` · ${p.note}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-2 font-mono">{fmtMoney(p.amountCents)}</span>
                    {p.status === "SUCCEEDED" && <button className="btn-ghost p-1.5" title="Email a receipt" onClick={() => { setReceiptFor(p.id); setModal("receipt"); }}><Mail size={14} /></button>}
                    {p.provider === "MANUAL" && <button className="btn-ghost p-1.5 text-ink-faint hover:text-bad" title="Remove" onClick={() => void removePayment(p.id)}><Trash2 size={14} /></button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {modal === "send" && <SendModal title={`Email ${i.number}`} defaultTo={i.sentTo ?? i.customerEmail} button="Send invoice"
        intro={<>The client gets a link to view the invoice{d.data.cardPayments ? " and pay by card" : ""}, print it or save a PDF.</>}
        onSend={(to) => event("SEND", { emailTo: to }, `Emailed to ${to}`)} onClose={() => setModal(null)} />}
      {modal === "pay" && <PaymentModal invoice={i} onClose={() => setModal(null)} onDone={() => { setModal(null); void d.refetch(); void refresh(); }} />}
      {modal === "receipt" && receiptFor && <SendModal title="Email a receipt" defaultTo={i.customerEmail} button="Send receipt" intro="A receipt for this payment, with what's still owed."
        onSend={async (to) => { await ops(`/payments/${receiptFor}/receipt`, { json: { to } }); toast.success(`Receipt sent to ${to}`); setModal(null); void d.refetch(); }} onClose={() => setModal(null)} />}
    </div>
  );
}

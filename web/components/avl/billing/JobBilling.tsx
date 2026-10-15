"use client";
/**
 * A job's billing (approved price, invoiced, collected, owed, left to invoice, and its invoices)
 * and its client side (selections the client picks in the portal, and messages).
 */
import clsx from "clsx";
import { Copy, CreditCard, ExternalLink, Lock, LockOpen, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import type { JobBilling, PortalMessage, Selection, SelectionOption } from "@shared/ops/invoicing";
import { fmtDateTime, fmtMoney, ops, useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, KpiRow, Loading, MoneyInput, Pill } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { dayText, InvoiceTable, NewInvoiceModal, pct, SignedMoney } from "./bits";

/* ───────────── Invoicing ───────────── */

export function JobInvoicingTab({ page }: { page: JobPage }) {
  const d = useOps<JobBilling>(`/jobs/${page.job.id}/billing`);
  const [adding, setAdding] = useState(false);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const b = d.data;
  const bar = (v: number) => `${Math.max(0, Math.min(100, b.contractCents ? (v / b.contractCents) * 100 : 0))}%`;
  return (
    <div className="space-y-4">
      <KpiRow items={[
        { value: fmtMoney(b.contractCents), label: "Approved price (before tax)" },
        { value: fmtMoney(b.invoicedCents), label: `Invoiced · ${pct(b.invoicedBps)}`, tone: "accent" },
        { value: fmtMoney(b.collectedCents), label: "Collected", tone: "ok" },
        { value: fmtMoney(b.receivableCents), label: "Owed now", tone: b.invoices.some((i) => i.state === "OVERDUE") ? "bad" : b.receivableCents ? "warn" : undefined },
        { value: fmtMoney(b.toInvoiceCents), label: b.draftCents ? `To invoice · ${fmtMoney(b.draftCents)} in drafts` : "To invoice" },
      ]} />
      <div className="panel space-y-2 px-4 py-3">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-hover">
          <div className="absolute inset-y-0 left-0 bg-accent/35" style={{ width: bar(b.invoicedCents) }} />
          <div className="absolute inset-y-0 left-0 bg-ok" style={{ width: bar(Math.min(b.collectedCents, b.invoicedCents)) }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Collected</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent/50" />Invoiced</span>
          <span>{b.basis.depositBilledCents > 0 ? `Deposit ${fmtMoney(b.basis.depositBilledCents)}, ${fmtMoney(b.basis.depositBilledCents - b.basis.depositAppliedCents)} still to take off later invoices` : "No deposit asked for yet"}</span>
        </div>
      </div>
      <Card eyebrow="Billing" title="Invoices" action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> New invoice</button>}>
        <InvoiceTable rows={b.invoices} showJob={false} empty="No invoices yet. Start with a deposit, then bill progress by phase, by percent or line by line, and finish with the final invoice." />
      </Card>
      {!b.cardPayments && <p className="flex items-center gap-2 text-xs text-ink-muted"><CreditCard size={13} /> Clients can pay invoices by card once you connect your Stripe account in <Link href="/avl/settings#connections" className="text-accent hover:underline">AVL → Business → Connections</Link>.</p>}
      {adding && <NewInvoiceModal jobId={page.job.id} billing={b} onClose={() => setAdding(false)} onPhasesSaved={() => void d.refetch()} />}
    </div>
  );
}

/* ───────────── Client: selections and messages ───────────── */

interface ClientSide { selections: Selection[]; messages: PortalMessage[]; client: { name: string; email: string | null } | null; portalUrl: string }

export function JobClientTab({ page }: { page: JobPage }) {
  const d = useOps<ClientSide>(`/jobs/${page.job.id}/client`);
  const [editing, setEditing] = useState<Selection | "new" | null>(null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const c = d.data;
  const act = async (path: string, json?: unknown, method?: string) => {
    try { await ops(path, { json, method }); await d.refetch(); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card eyebrow="Client portal" title={c.client ? c.client.name : "No client on this job"}>
          <div className="space-y-2 p-4 text-sm">
            {c.client?.email
              ? <p className="text-ink-soft">{c.client.email} signs in to the portal with a code sent to that email. They see their proposals, change orders, this job’s schedule, the files you share, invoices to pay, selections and messages.</p>
              : <p className="text-warn">Add an email to the client (or one of its contacts) so they can sign in to the portal.</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline" onClick={() => { void navigator.clipboard.writeText(c.portalUrl); toast.success("Portal link copied"); }}><Copy size={14} /> Copy the portal link</button>
              <a className="btn-ghost" href={c.portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open the portal</a>
            </div>
            <p className="text-[11px] text-ink-faint">Share files from the Files tab (the share icon). Invoices show up once they’re sent.</p>
          </div>
        </Card>
        <Card eyebrow="Selections" title="Choices for the client" action={<button className="btn-primary" onClick={() => setEditing("new")}><Plus size={14} /> Selection</button>}>
          {!c.selections.length ? <Empty>Offer the client choices after the sale (a speaker finish, a screen size, an upgrade). They pick in the portal and the pick joins the budget.</Empty> : (
            <ul className="divide-y divide-line">
              {c.selections.map((s) => {
                const chosen = s.options.find((o) => o.id === s.chosenOptionId);
                return (
                  <li key={s.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{s.title} {s.status === "LOCKED" ? <Pill tone="muted">Final</Pill> : s.status === "CHOSEN" ? <Pill tone="ok">Picked</Pill> : <Pill tone="warn">Waiting for the client</Pill>}</div>
                        <div className="text-[11px] text-ink-faint">{s.dueDate ? `Due ${dayText(s.dueDate)}` : "No deadline"}{chosen ? ` · ${chosen.name} picked by ${s.chosenBy}${s.chosenAt ? `, ${fmtDateTime(s.chosenAt)}` : ""}` : ""}</div>
                      </div>
                      <div className="flex gap-1">
                        {s.status !== "LOCKED" && <button className="btn-ghost p-1.5" title="Edit" onClick={() => setEditing(s)}><Pencil size={14} /></button>}
                        {s.chosenOptionId && <button className="btn-ghost p-1.5" title={s.status === "LOCKED" ? "Unlock (the client can change it)" : "Make it final"} onClick={() => void act(`/selections/${s.id}/lock`, { locked: s.status !== "LOCKED" })}>{s.status === "LOCKED" ? <LockOpen size={14} /> : <Lock size={14} />}</button>}
                        <button className="btn-ghost p-1.5 text-ink-faint hover:text-bad" title="Delete" onClick={() => { if (window.confirm(`Delete “${s.title}”${s.chosenOptionId ? " and its line in the budget" : ""}?`)) void act(`/selections/${s.id}`, undefined, "DELETE"); }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.options.map((o) => (
                        <button key={o.id} disabled={s.status === "LOCKED"} title={s.status === "LOCKED" ? undefined : "Pick this for the client"} onClick={() => o.id !== s.chosenOptionId && void act(`/selections/${s.id}/pick`, { optionId: o.id })}
                          className={clsx("rounded-lg border px-3 py-1.5 text-left text-sm transition", o.id === s.chosenOptionId ? "border-accent bg-accent-soft" : "border-line hover:bg-hover/40")}>
                          <div className="font-medium">{o.name}</div>
                          <div className="text-[11px] text-ink-muted">{o.priceCents ? `${o.priceCents > 0 ? "+" : "−"}${fmtMoney(Math.abs(o.priceCents))}` : "Included"}{o.costCents ? ` · cost ${fmtMoney(o.costCents)}` : ""}</div>
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <Messages jobId={page.job.id} messages={c.messages} client={c.client} onSent={() => void d.refetch()} />
      {editing && <SelectionModal jobId={page.job.id} sel={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void d.refetch(); }} />}
    </div>
  );
}

function Messages({ jobId, messages, client, onSent }: { jobId: string; messages: PortalMessage[]; client: ClientSide["client"]; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!text.trim()) return; setBusy(true);
    try {
      const r = await ops<{ emailError: string | null }>(`/jobs/${jobId}/messages`, { json: { body: text } });
      setText(""); onSent();
      if (r.emailError) toast.warning(`Saved in the portal, but the email nudge didn’t go: ${r.emailError}`);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card eyebrow="Messages" title={client ? `With ${client.name}` : "Messages"} className="flex flex-col">
      <div className="max-h-[52vh] min-h-[160px] space-y-2 overflow-y-auto p-4">
        {!messages.length && <p className="py-8 text-center text-sm text-ink-faint">No messages yet. What you write here shows in the client’s portal, and they get an email.</p>}
        {messages.map((m) => (
          <div key={m.id} className={clsx("max-w-[88%] rounded-xl px-3 py-2 text-sm", m.fromClient ? "bg-hover" : "ml-auto bg-accent-soft")}>
            <div className="whitespace-pre-wrap">{m.body}</div>
            <div className="mt-1 text-[10px] text-ink-faint">{m.author ?? (m.fromClient ? "Client" : "You")} · {fmtDateTime(m.at)}{!m.fromClient && m.readAt ? " · seen" : ""}</div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
        <textarea rows={2} className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={client ? `Write to ${client.name}…` : "Write a message…"} disabled={!client} />
        <button className="btn-primary self-end" disabled={busy || !text.trim() || !client}>{busy ? <Spinner /> : <Send size={14} />}</button>
      </form>
    </Card>
  );
}

type OptDraft = Omit<SelectionOption, "id"> & { id: string | null; key: string };
const key = () => Math.random().toString(36).slice(2, 10);

function SelectionModal({ jobId, sel, onClose, onSaved }: { jobId: string; sel: Selection | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: sel?.title ?? "", description: sel?.description ?? "", dueDate: sel?.dueDate ?? "" });
  const [opts, setOpts] = useState<OptDraft[]>(sel ? sel.options.map((o) => ({ ...o, key: o.id })) : [
    { id: null, key: key(), name: "", description: null, priceCents: 0, costCents: 0 },
    { id: null, key: key(), name: "", description: null, priceCents: 0, costCents: 0 },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOpt = (k: string, x: Partial<OptDraft>) => setOpts(opts.map((o) => (o.key === k ? { ...o, ...x } : o)));
  return (
    <Modal open onClose={onClose} title={sel ? "Edit selection" : "New selection"} width={640}>
      <form className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        const json = { ...f, description: f.description || null, dueDate: f.dueDate || null, options: opts.map(({ key: _k, ...o }) => o) };
        try { await ops(sel ? `/selections/${sel.id}` : `/jobs/${jobId}/selections`, { method: sel ? "PUT" : "POST", json }); onSaved(); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="What to choose" className="sm:col-span-2"><input required className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Speaker finish" /></Field>
          <Field label="Pick by"><input type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Details for the client" className="sm:col-span-3"><textarea rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted"><span>Option</span><span className="text-right">Adds to price</span><span className="text-right">Your cost</span><span /></div>
          {opts.map((o) => (
            <div key={o.key} className="grid grid-cols-[1fr_120px_120px_32px] items-center gap-2">
              <input required className="input" value={o.name} onChange={(e) => setOpt(o.key, { name: e.target.value })} placeholder="e.g. White" />
              <SignedMoney cents={o.priceCents} onChange={(v) => setOpt(o.key, { priceCents: v })} />
              <MoneyInput cents={o.costCents} onChange={(v) => setOpt(o.key, { costCents: v ?? 0 })} />
              <button type="button" className="btn-ghost p-1.5 text-ink-faint" disabled={opts.length <= 2} onClick={() => setOpts(opts.filter((x) => x.key !== o.key))}><X size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn-ghost text-xs" onClick={() => setOpts([...opts, { id: null, key: key(), name: "", description: null, priceCents: 0, costCents: 0 }])}><Plus size={13} /> Option</button>
          <p className="text-[11px] text-ink-faint">$0 means it’s included. The pick goes into the budget under “Selections” at that price and cost.</p>
        </div>
        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Save</button></div>
      </form>
    </Modal>
  );
}

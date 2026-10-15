"use client";
/**
 * Pages opened from a link, no sign-in (the link is the key):
 *   /vendor-po?t=…     the vendor's copy of a purchase order (Print saves a PDF)
 *   /work-order?t=…    the installer's work order, with Accept
 *   /change-order?t=…  the client's change order, to sign or decline
 */
import { CheckCircle2, PenLine, Printer, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ClientChangeOrderPage, PublicWorkOrderPage, VendorPoPage } from "@shared/ops/purchasing";
import { fmtMoney, OpsError, opsPublic } from "@/lib/ops";
import { Banner, input, label, Sheet, Shell, SignForm, when } from "@/components/avl/Signing";

const day = (d: string | null) => (d ? new Date(d + "T12:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);

export function useLoad<T>(path: string | null) {
  const [state, setState] = useState<{ data: T } | { error: string; draft?: boolean } | null>(null);
  const load = useCallback(async () => {
    if (!path) return setState({ error: "This link is missing part of its address. Open it again from the email." });
    try { setState({ data: await opsPublic<T>(path) }); }
    catch (e) { setState({ error: (e as Error).message, draft: e instanceof OpsError && e.body.status === "draft" }); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { state, setState, reload: load };
}

export function Bar({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="no-print sticky top-0 z-20 border-b border-[#e2e8f0] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#0f172a]">{title}</div><div className="truncate text-xs text-[#64748b]">{sub}</div></div>
        <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9]" onClick={() => window.print()}><Printer size={14} /> <span className="hidden sm:inline">Print or save PDF</span><span className="sm:hidden">PDF</span></button>
      </div>
    </div>
  );
}

export function Oops({ title, text }: { title: string; text: string }) {
  return <Shell><div className="mx-auto max-w-md px-4 py-24 text-center"><div className="text-lg font-semibold text-[#0f172a]">{title}</div><p className="mt-2 text-[#475569]">{text}</p></div></Shell>;
}

export function Letterhead({ business, logo, kind, number, right }: { business: { name: string; address?: string | null; phone: string | null; email: string | null }; logo: string | null; kind: string; number: string; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e2e8f0] pb-6">
      <div className="flex items-start gap-3">
        {logo && <img src={logo} alt="" className="h-14 w-auto max-w-[160px] object-contain" />}
        <div className="text-sm leading-relaxed text-[#475569]"><div className="text-base font-semibold text-[#0f172a]">{business.name}</div>{business.address && <div>{business.address}</div>}<div>{[business.phone, business.email].filter(Boolean).join(" · ")}</div></div>
      </div>
      <div className="text-right"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0f766e]">{kind}</div><div className="font-mono text-xl font-semibold">{number}</div>{right}</div>
    </header>
  );
}

export const Doc = ({ children }: { children: React.ReactNode }) => <div className="mx-auto max-w-[8.5in] px-3 pb-32 pt-4 sm:px-4 print:p-0"><div className="rounded-xl bg-white p-5 text-[#111] shadow-sm ring-1 ring-[#e2e8f0] sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">{children}</div></div>;
export const th = "border-b border-[#e2e8f0] py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]";

/* ───────────── Vendor's purchase order ───────────── */

export function VendorPo({ token }: { token: string }) {
  const { state } = useLoad<VendorPoPage>(token ? `/public/vendor-po/${encodeURIComponent(token)}` : null);
  if (!state) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the purchase order…</div></Shell>;
  if ("error" in state) return <Oops title="We can’t open this purchase order" text={state.error} />;
  const { po, business, logo } = state.data;
  return (
    <Shell>
      <Bar title={business.name} sub={`Purchase order ${po.number} · ${fmtMoney(po.totalCents)}`} />
      {po.status === "CANCELLED" && <div className="mx-auto max-w-[8.5in] px-4 pt-4"><Banner tone="warn" icon={<XCircle size={18} />} title="Cancelled">{business.name} cancelled this order. Please don’t ship it.</Banner></div>}
      <Doc>
        <Letterhead business={business} logo={logo} kind="Purchase order" number={po.number} right={po.sentAt && <div className="text-sm text-[#64748b]">{new Date(po.sentAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>} />
        <div className="grid gap-6 py-6 text-sm sm:grid-cols-3">
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Vendor</div><div className="mt-1 font-medium">{po.vendor?.name}</div>{po.vendor?.accountNo && <div className="text-[#475569]">Account {po.vendor.accountNo}</div>}</div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Ship to</div><div className="mt-1 whitespace-pre-line">{po.shipTo ?? business.address ?? business.name}</div></div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Needed by</div><div className="mt-1">{day(po.expectedDate) ?? "As soon as possible"}</div>{po.jobRef && <div className="mt-1 text-[#475569]">Ref: {po.jobRef}</div>}</div>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Item</th><th className={`${th} w-20 text-right`}>Qty</th><th className={`${th} w-28 text-right`}>Unit</th><th className={`${th} w-28 text-right`}>Amount</th></tr></thead>
          <tbody>{po.lines.map((l, i) => (
            <tr key={i} className="border-b border-[#f1f5f9] align-top">
              <td className="py-2.5"><div className="font-medium">{l.name}</div>{l.sku && <div className="font-mono text-xs text-[#64748b]">{l.sku}</div>}{l.description && <div className="text-xs text-[#64748b]">{l.description}</div>}</td>
              <td className="py-2.5 text-right tabular-nums">{l.quantity}{l.unit && l.unit !== "ea" ? ` ${l.unit}` : ""}</td>
              <td className="py-2.5 text-right tabular-nums">{fmtMoney(l.unitCostCents)}</td>
              <td className="py-2.5 text-right tabular-nums">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-[#64748b]">Subtotal</span><span className="tabular-nums">{fmtMoney(po.subtotalCents)}</span></div>
          {po.shippingCents > 0 && <div className="flex justify-between"><span className="text-[#64748b]">Shipping</span><span className="tabular-nums">{fmtMoney(po.shippingCents)}</span></div>}
          {po.taxCents > 0 && <div className="flex justify-between"><span className="text-[#64748b]">Tax</span><span className="tabular-nums">{fmtMoney(po.taxCents)}</span></div>}
          <div className="flex justify-between border-t border-[#e2e8f0] pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(po.totalCents)}</span></div>
        </div>
        {po.notes && <div className="mt-8 rounded-lg bg-[#f8fafc] px-4 py-3 text-sm"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Notes</div><div className="mt-1 whitespace-pre-wrap">{po.notes}</div></div>}
        <p className="mt-8 text-xs text-[#94a3b8]">Please put the PO number on the packing slip and invoice. Questions: {business.email ?? business.phone ?? business.name}.</p>
      </Doc>
    </Shell>
  );
}

/* ───────────── Installer's work order ───────────── */

export function PublicWorkOrder({ token }: { token: string }) {
  const { state, setState } = useLoad<PublicWorkOrderPage>(token ? `/public/work-orders/${encodeURIComponent(token)}` : null);
  const [accepting, setAccepting] = useState(false);
  if (!state) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the work order…</div></Shell>;
  if ("error" in state) return <Oops title="We can’t open this work order" text={state.error} />;
  const p = state.data;
  const { wo, business } = p;
  return (
    <Shell>
      <Bar title={business.name} sub={`Work order ${wo.number} · ${wo.title}`} />
      <div className="mx-auto max-w-[8.5in] px-3 pt-4 sm:px-4">
        {wo.acceptedAt && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Accepted">{wo.acceptedBy} accepted this work order on {when(wo.acceptedAt)}.</Banner>}
        {wo.status === "CANCELLED" && <Banner tone="warn" icon={<XCircle size={18} />} title="Cancelled">{business.name} cancelled this work order.</Banner>}
      </div>
      <Doc>
        <Letterhead business={business} logo={p.logo} kind="Work order" number={wo.number} />
        <h1 className="mt-6 text-2xl font-semibold">{wo.title}</h1>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">For</div><div className="mt-1">{[wo.assigneeName, wo.vendor].filter(Boolean).join(", ") || "—"}</div></div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Where</div><div className="mt-1">{wo.jobName}{wo.site ? <><br /><span className="text-[#475569]">{wo.site}</span></> : null}</div></div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">When</div><div className="mt-1">{[day(wo.startDate) && `Starts ${day(wo.startDate)}`, day(wo.dueDate) && `Due ${day(wo.dueDate)}`].filter(Boolean).join(" · ") || "To be scheduled"}</div></div>
        </div>
        {wo.scope && <div className="mt-6"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Scope</div><div className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{wo.scope}</div></div>}
        {wo.lines.length > 0 && <>
          <table className="mt-6 w-full text-sm">
            <thead><tr><th className={th}>Work</th><th className={`${th} w-20 text-right`}>Qty</th><th className={`${th} w-28 text-right`}>Rate</th><th className={`${th} w-28 text-right`}>Amount</th></tr></thead>
            <tbody>{wo.lines.map((l, i) => <tr key={i} className="border-b border-[#f1f5f9]"><td className="py-2.5">{l.description}</td><td className="py-2.5 text-right tabular-nums">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td><td className="py-2.5 text-right tabular-nums">{fmtMoney(l.unitCostCents)}</td><td className="py-2.5 text-right tabular-nums">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td></tr>)}</tbody>
          </table>
          <div className="mt-3 flex justify-end gap-6 text-base font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(wo.totalCents)}</span></div>
        </>}
      </Doc>
      {p.canAccept && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 py-3">
            <div className="hidden flex-1 text-sm text-[#475569] sm:block">Good to go? Accept it so {business.name} knows you’ve got it.</div>
            <button className="flex-1 rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115e59] sm:flex-none" onClick={() => setAccepting(true)}><CheckCircle2 size={15} className="mr-1.5 inline" />Accept work order</button>
          </div>
        </div>
      )}
      {accepting && <AcceptSheet token={token} p={p} onClose={() => setAccepting(false)} onDone={(d) => { setState({ data: d }); setAccepting(false); }} />}
    </Shell>
  );
}

function AcceptSheet({ token, p, onClose, onDone }: { token: string; p: PublicWorkOrderPage; onClose: () => void; onDone: (d: PublicWorkOrderPage) => void }) {
  const [name, setName] = useState(p.wo.assigneeName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Accept the work order" onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { onDone(await opsPublic<PublicWorkOrderPage>(`/public/work-orders/${encodeURIComponent(token)}/accept`, { name })); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <p className="text-sm text-[#475569]">You’re accepting {p.wo.number} ({p.wo.title}) from {p.business.name}{p.wo.totalCents ? ` for ${fmtMoney(p.wo.totalCents)}` : ""}.</p>
        <div><label className={label} htmlFor="wo-name">Your name</label><input id="wo-name" required minLength={2} className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
        <button className="w-full rounded-lg bg-[#0f766e] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#115e59] disabled:opacity-60" disabled={busy}>{busy ? "Accepting…" : "Accept"}</button>
      </form>
    </Sheet>
  );
}

/* ───────────── Client's change order ───────────── */

export function ClientChangeOrder({ token }: { token: string }) {
  const { state, setState, reload } = useLoad<ClientChangeOrderPage>(token ? `/public/change-orders/${encodeURIComponent(token)}` : null);
  const [sheet, setSheet] = useState<"sign" | "decline" | null>(null);
  if (!state) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the change order…</div></Shell>;
  if ("error" in state) return <Oops title={state.draft ? "This change order is being updated" : "We can’t open this change order"} text={state.error} />;
  const p = state.data;
  const { co, business } = p;
  const t = co.totals;
  const groups = [...new Set(co.lines.map((l) => l.groupName))];
  const newTotal = p.job.contractCents + p.job.approvedChangesCents + t.totalCents;
  const done = (d: ClientChangeOrderPage) => { setState({ data: d }); setSheet(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <Shell>
      <Bar title={business.name} sub={`Change order ${co.number} · ${fmtMoney(t.totalCents)}`} />
      <div className="mx-auto max-w-[8.5in] px-3 pt-4 sm:px-4">
        {p.signature && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Signed. Thank you!">{p.signature.signerName}{p.signature.signerTitle ? `, ${p.signature.signerTitle}` : ""} signed this change order on {when(p.signature.signedAt)} for {fmtMoney(p.signature.totalCents)}.</Banner>}
        {co.status === "APPROVED" && !p.signature && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Approved">This change order has been approved.</Banner>}
        {p.declined && <Banner tone="muted" icon={<XCircle size={18} />} title="Declined">You declined this change order on {when(p.declined.at)}.{p.declined.note ? ` “${p.declined.note}”` : ""}</Banner>}
      </div>
      <Doc>
        <Letterhead business={business} logo={p.logo} kind="Change order" number={co.number} right={co.sentAt && <div className="text-sm text-[#64748b]">{new Date(co.sentAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>} />
        <div className="mt-6 text-sm text-[#475569]">{p.customer?.name ? `For ${p.customer.name} · ` : ""}{p.job.name}</div>
        <h1 className="mt-1 text-2xl font-semibold">{co.title}</h1>
        {co.description && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-[#334155]">{co.description}</p>}
        <table className="mt-6 w-full text-sm">
          <thead><tr><th className={th}>Item</th><th className={`${th} w-20 text-right`}>Qty</th><th className={`${th} w-28 text-right`}>Price</th><th className={`${th} w-28 text-right`}>Amount</th></tr></thead>
          <tbody>{groups.map((g) => (
            <Group key={g} name={g} lines={co.lines.filter((l) => l.groupName === g)} show={groups.length > 1} />
          ))}</tbody>
        </table>
        <div className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-[#64748b]">Subtotal</span><span className="tabular-nums">{fmtMoney(t.subtotalCents)}</span></div>
          {t.taxCents !== 0 && <div className="flex justify-between"><span className="text-[#64748b]">Tax</span><span className="tabular-nums">{fmtMoney(t.taxCents)}</span></div>}
          <div className="flex justify-between border-t border-[#e2e8f0] pt-2 text-base font-semibold"><span>{t.totalCents < 0 ? "Credit" : "This change"}</span><span className="tabular-nums">{fmtMoney(t.totalCents)}</span></div>
          {p.job.contractCents > 0 && <div className="mt-3 space-y-1 rounded-lg bg-[#f8fafc] px-3 py-2 text-xs text-[#475569]">
            <div className="flex justify-between"><span>Original contract</span><span className="tabular-nums">{fmtMoney(p.job.contractCents)}</span></div>
            {p.job.approvedChangesCents !== 0 && <div className="flex justify-between"><span>Changes already approved</span><span className="tabular-nums">{fmtMoney(p.job.approvedChangesCents)}</span></div>}
            <div className="flex justify-between font-semibold text-[#0f172a]"><span>New contract total</span><span className="tabular-nums">{fmtMoney(newTotal)}</span></div>
          </div>}
        </div>
        {p.signature && <section className="mt-10 border-t border-[#e2e8f0] pt-4 text-sm"><div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Approved</div><div className="mt-1">Signed electronically by <b>{p.signature.signerName}</b>{p.signature.signerTitle ? `, ${p.signature.signerTitle}` : ""} on {when(p.signature.signedAt)} for {fmtMoney(p.signature.totalCents)}.</div></section>}
      </Doc>
      {p.canAnswer && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
            <div className="hidden flex-1 text-sm text-[#475569] sm:block">Sign to approve this change of {fmtMoney(t.totalCents)}.</div>
            <button className="rounded-lg px-3 py-2.5 text-sm text-[#64748b] hover:bg-[#f1f5f9]" onClick={() => setSheet("decline")}>Decline</button>
            <button className="flex-1 whitespace-nowrap rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#115e59] sm:flex-none" onClick={() => setSheet("sign")}><PenLine size={15} className="mr-1.5 hidden sm:inline" />Sign and approve</button>
          </div>
        </div>
      )}
      {sheet === "sign" && (
        <Sheet title="Sign and approve" onClose={() => setSheet(null)}>
          <SignForm defaultName={p.customer?.contactName ?? ""} defaultEmail={p.customer?.email ?? ""}
            summary={<><div className="flex justify-between"><span className="text-[#64748b]">{t.totalCents < 0 ? "Credit" : "This change"}</span><b className="tabular-nums">{fmtMoney(t.totalCents)}</b></div>{p.job.contractCents > 0 && <div className="mt-0.5 flex justify-between"><span className="text-[#64748b]">New contract total</span><span className="tabular-nums">{fmtMoney(newTotal)}</span></div>}</>}
            agreeText={`I approve this change order for ${fmtMoney(t.totalCents)}, and I agree that my electronic signature is as valid as signing on paper.`}
            button={`Sign and approve ${fmtMoney(t.totalCents)}`}
            onSign={async ({ name, title, email, signature }) => {
              try { done(await opsPublic<ClientChangeOrderPage>(`/public/change-orders/${encodeURIComponent(token)}/sign`, { name, title, email, signature, totalCents: t.totalCents, agree: true })); }
              catch (err) { if (err instanceof OpsError && err.body.status === "changed") { setSheet(null); void reload(); return; } throw err; }
            }} />
        </Sheet>
      )}
      {sheet === "decline" && <DeclineSheet token={token} p={p} onClose={() => setSheet(null)} onDone={done} />}
    </Shell>
  );
}

function Group({ name, lines, show }: { name: string; lines: ClientChangeOrderPage["co"]["lines"]; show: boolean }) {
  return <>
    {show && <tr><td colSpan={4} className="pt-4 text-xs font-semibold uppercase tracking-[0.08em] text-[#0f766e]">{name}</td></tr>}
    {lines.map((l, i) => (
      <tr key={i} className="border-b border-[#f1f5f9] align-top">
        <td className="py-2.5"><div className="font-medium">{l.name}</div>{l.description && <div className="text-xs text-[#64748b]">{l.description}</div>}</td>
        <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
        <td className="py-2.5 text-right tabular-nums">{fmtMoney(l.unitPriceCents)}</td>
        <td className={`py-2.5 text-right tabular-nums ${l.quantity < 0 ? "text-[#b91c1c]" : ""}`}>{fmtMoney(Math.round(l.quantity * l.unitPriceCents))}</td>
      </tr>
    ))}
  </>;
}

function DeclineSheet({ token, p, onClose, onDone }: { token: string; p: ClientChangeOrderPage; onClose: () => void; onDone: (d: ClientChangeOrderPage) => void }) {
  const [name, setName] = useState(p.customer?.contactName ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Decline the change order" onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { onDone(await opsPublic<ClientChangeOrderPage>(`/public/change-orders/${encodeURIComponent(token)}/decline`, { name, note })); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <p className="text-sm text-[#475569]">Let {p.business.name} know you won’t go ahead with this change. A reason helps, but it’s up to you.</p>
        <div><label className={label} htmlFor="d-name">Your name</label><input id="d-name" className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={label} htmlFor="d-note">Reason (optional)</label><textarea id="d-note" rows={4} className={input} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
        <button className="w-full rounded-lg bg-[#475569] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#334155] disabled:opacity-60" disabled={busy}>{busy ? "Sending…" : "Decline"}</button>
      </form>
    </Sheet>
  );
}

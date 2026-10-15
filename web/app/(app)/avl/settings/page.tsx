"use client";
/** AVL's own business: the letterhead on proposals and the quoting defaults (AVL Managers edit). */
import clsx from "clsx";
import { useState } from "react";
import { toast } from "sonner";
import type { AvlBusiness } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Field, Loading, MoneyInput, PageHeader, PercentInput } from "@/components/ops/OpsUi";
import { LogoPicker } from "@/components/ops/LogoPicker";
import { useModule } from "@/components/ops/context";
import { Spinner } from "@/components/ui";

type Data = { business: AvlBusiness; logo: string | null; canEdit: boolean };
const TEXT: [keyof AvlBusiness, string][] = [
  ["name", "Business name"], ["legalName", "Legal name"], ["addressLine1", "Address"], ["addressLine2", "Address line 2"], ["city", "City"], ["state", "State"],
  ["postalCode", "ZIP"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["ein", "EIN (Federal Tax ID)"], ["salesTaxId", "Sales tax #"],
];

export default function Business() {
  const d = useOps<Data>("/avl/business");
  if (!d.data) return <><PageHeader crumb="AVL / Settings" title="Business" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Form key={JSON.stringify(d.data.business)} data={d.data} />;
}

type Conn = { stripe: { accountId: string | null; accountName: string | null; livemode: boolean; connectedAt: string; connectedBy: string | null } | null; canEdit: boolean };

/** The business's own Stripe account: clients pay invoices by card, and the money goes straight there. */
function Connections() {
  const d = useOps<Conn>("/avl/connections");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = d.data?.stripe;
  return (
    <div id="connections">
      <Card eyebrow="Connections" title="Card payments (Stripe)">
        <div className="space-y-3 p-4 text-sm">
          {!d.data ? <Spinner /> : s ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Connected to {s.accountName ?? s.accountId ?? "your Stripe account"} {s.livemode ? <span className="text-ok">· live</span> : <span className="text-warn">· test mode (no real charges)</span>}</div>
                <div className="text-xs text-ink-muted">Clients see “Pay by card” on invoices. Since {new Date(s.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{s.connectedBy ? ` · ${s.connectedBy}` : ""}.</div>
              </div>
              {d.data.canEdit && <button className="btn-ghost text-bad" onClick={async () => { if (!window.confirm("Disconnect Stripe? Clients won’t be able to pay invoices by card.")) return; try { await ops("/avl/connections/stripe", { method: "DELETE" }); await d.refetch(); } catch (e) { toast.error((e as Error).message); } }}>Disconnect</button>}
            </div>
          ) : (
            <p className="text-ink-soft">Let clients pay invoices by card. Payments go straight to your own Stripe account; Sundays never holds the money.</p>
          )}
          {d.data?.canEdit && (
            <form className="space-y-2" onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setError(null);
              try { await ops("/avl/connections/stripe", { method: "PUT", json: { key } }); setKey(""); await d.refetch(); toast.success("Stripe connected"); }
              catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}>
              <Field label={s ? "Replace the key" : "Your Stripe secret key"} hint={<>In Stripe: Developers → API keys → Secret key (starts with sk_live_). A restricted key works too if it can create Checkout Sessions and read them. It’s stored encrypted and never shown again.</>}>
                <input type="password" autoComplete="off" className="input font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_live_…" />
              </Field>
              {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}
              <button className="btn-primary" disabled={busy || !key.trim()}>{busy && <Spinner />} {s ? "Replace key" : "Connect Stripe"}</button>
            </form>
          )}
          {!d.data?.canEdit && !s && <p className="text-xs text-ink-faint">An AVL Manager can connect it.</p>}
        </div>
      </Card>
    </div>
  );
}

function Form({ data }: { data: Data }) {
  const branded = useModule("branding");
  const refresh = useOpsRefresh();
  const [b, setB] = useState<AvlBusiness>(data.business);
  const [busy, setBusy] = useState(false);
  const ro = !data.canEdit;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await ops("/avl/business", { method: "PUT", json: b }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader crumb="AVL / Settings" title="Business"
        description={ro ? "What clients see on proposals. An AVL Manager can change these." : "Your AVL business as clients see it on proposals, and the defaults for new quotes."} />
      <div className="space-y-5">
        <Card eyebrow="Proposals" title="Logo">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <LogoPicker current={data.logo} disabled={ro || !branded} label="On printed proposals (until you add one, the church's logo is used)"
              upload={(mime, dataB64) => ops("/avl/business/logo", { json: { mime, dataB64 } })} remove={() => ops("/avl/business/logo", { method: "DELETE" })} />
          </div>
        </Card>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={ro} className="space-y-5">
            <Card eyebrow="AVL" title="How you use AVL">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {([
                  ["INTEGRATOR", "AV integrator", "You sell to clients: proposals they sign online, jobs from signed proposals, prices and margins."],
                  ["CHURCH", "Church production team", "You run your own projects: jobs and budgets, no clients, proposals or prices to sell."],
                ] as const).map(([v, title, hint]) => (
                  <label key={v} className={clsx("flex cursor-pointer gap-3 rounded-xl border p-3.5 transition", b.businessType === v ? "border-accent bg-accent-soft" : "border-line hover:bg-hover/40")}>
                    <input type="radio" name="businessType" className="mt-1" checked={b.businessType === v} onChange={() => setB({ ...b, businessType: v })} />
                    <span><span className="block font-semibold">{title}</span><span className="text-sm text-ink-muted">{hint}</span></span>
                  </label>
                ))}
              </div>
              <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Job number prefix" hint={`Jobs are numbered ${(b.jobPrefix || "J").toUpperCase()}-0001…`}><input className="input font-mono uppercase" maxLength={10} value={b.jobPrefix} onChange={(e) => setB({ ...b, jobPrefix: e.target.value })} /></Field>
              </div>
            </Card>
            <Card eyebrow="Business" title="Details">
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {TEXT.map(([k, label]) => <Field key={k} label={label}><input className="input" value={(b[k] as string | null) ?? ""} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></Field>)}
              </div>
            </Card>
            <Card eyebrow="New quotes" title="Quoting defaults">
              <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Quote prefix"><input className="input font-mono uppercase" maxLength={10} value={b.quotePrefix} onChange={(e) => setB({ ...b, quotePrefix: e.target.value })} /></Field>
                <Field label="Default tax %"><PercentInput bps={b.defaultTaxBps} disabled={ro} onChange={(v) => setB({ ...b, defaultTaxBps: v })} /></Field>
                <Field label="Deposit %"><PercentInput bps={b.defaultDepositBps} disabled={ro} onChange={(v) => setB({ ...b, defaultDepositBps: v })} /></Field>
                <Field label="Target margin %"><PercentInput bps={b.defaultMarginBps} disabled={ro} onChange={(v) => setB({ ...b, defaultMarginBps: v })} /></Field>
                <Field label="Labor $/hr"><MoneyInput cents={b.laborRateCents} disabled={ro} onChange={(v) => setB({ ...b, laborRateCents: v ?? 0 })} /></Field>
                <Field label="Quote valid (days)"><input type="number" className="input" value={b.quoteValidDays} onChange={(e) => setB({ ...b, quoteValidDays: parseInt(e.target.value) || 30 })} /></Field>
              </div>
              <div className="border-t border-line p-4">
                <Field label="Default terms & conditions"><textarea rows={6} className="input" value={b.quoteTerms ?? ""} onChange={(e) => setB({ ...b, quoteTerms: e.target.value })} /></Field>
              </div>
            </Card>
            {b.businessType !== "CHURCH" && (
              <Card eyebrow="Billing" title="Invoices">
                <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label="Due in (days)" hint="0 = due on receipt"><input type="number" min={0} max={365} className="input" value={b.invoiceDueDays ?? 30} onChange={(e) => setB({ ...b, invoiceDueDays: Math.max(0, Math.min(365, parseInt(e.target.value) || 0)) })} /></Field>
                </div>
                <div className="border-t border-line p-4">
                  <Field label="Notes on every invoice" hint="How to pay by check or transfer, late fees, thank you."><textarea rows={3} className="input" value={b.invoiceNotes ?? ""} onChange={(e) => setB({ ...b, invoiceNotes: e.target.value })} placeholder="Make checks payable to… / ACH: routing… account…" /></Field>
                </div>
              </Card>
            )}
          </fieldset>
          {!ro && <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save settings</button>}
        </form>
        {b.businessType !== "CHURCH" && <Connections />}
      </div>
    </>
  );
}

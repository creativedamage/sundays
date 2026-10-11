"use client";
/** Labor rates and markup rules: what labor costs and sells for, and the margin each kind of product gets. */
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { marginFor, type LaborRate, type MarkupRule, type PricingSetup } from "@shared/ops/estimating";
import { priceForMargin } from "@shared/ops/math";
import { fmtMoney, fmtPct, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Card, ErrorBox, Loading, MoneyInput, PageHeader, PercentInput, Stack } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

export default function Pricing() {
  const me = useOpsUser();
  const d = useOps<PricingSetup>("/avl/pricing");
  const canEdit = me.nav.avlManager;
  return (
    <>
      <PageHeader crumb="AVL / Pricing" title="Labor & markup"
        description={<>Labor rates and the margin products get when you add them from a price list. Anything without a rule gets your default margin{d.data ? ` (${fmtPct(d.data.defaultMarginBps)}, set in ` : " (set in "}<Link href="/avl/settings" className="text-accent hover:underline">Business settings</Link>).</>} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <Rates key={JSON.stringify(d.data.laborRates)} initial={d.data.laborRates} canEdit={canEdit} />
          <Rules key={JSON.stringify(d.data.markupRules)} initial={d.data.markupRules} setup={d.data} canEdit={canEdit} />
          {!canEdit && <p className="text-xs text-ink-faint">An AVL Manager can change these.</p>}
        </div>
      )}
    </>
  );
}

let n = 0;
const tmp = () => `new${++n}`;

function Rates({ initial, canEdit }: { initial: LaborRate[]; canEdit: boolean }) {
  const refresh = useOpsRefresh();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const set = (id: string, p: Partial<LaborRate>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const save = async () => {
    setBusy(true);
    try { await ops("/avl/labor-rates", { method: "PUT", json: { rates: rows.filter((r) => r.active || !r.id.startsWith("new")) } }); toast.success("Labor rates saved"); await refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card eyebrow="Labor" title="Labor rates" action={canEdit && <button className="btn-ghost text-xs" onClick={() => setRows([...rows, { id: tmp(), name: "", description: null, unit: "hr", costCents: 0, priceCents: 0, taxable: false, active: true }])}><Plus size={13} /> Add rate</button>}>
      <Stack>
        <table className="rtable w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
            <tr><th>Rate</th><th className="w-20">Per</th><th className="w-32 text-right">Costs you</th><th className="w-32 text-right">Sells for</th><th className="w-20 text-right">Margin</th><th className="w-16">Taxed</th><th className="w-16">In use</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
            {rows.map((r) => {
              const m = r.priceCents > 0 ? Math.round(((r.priceCents - r.costCents) / r.priceCents) * 10_000) : 0;
              return (
                <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                  <td><input className="input py-1" disabled={!canEdit} value={r.name} placeholder="e.g. Installation" onChange={(e) => set(r.id, { name: e.target.value })} /></td>
                  <td><input className="input py-1" disabled={!canEdit} value={r.unit} onChange={(e) => set(r.id, { unit: e.target.value })} /></td>
                  <td><MoneyInput cents={r.costCents} disabled={!canEdit} onChange={(c) => set(r.id, { costCents: c ?? 0 })} /></td>
                  <td><MoneyInput cents={r.priceCents} disabled={!canEdit} onChange={(c) => set(r.id, { priceCents: c ?? 0 })} /></td>
                  <td className="text-right tabular-nums text-ink-soft">{r.priceCents ? fmtPct(m) : "—"}</td>
                  <td><input type="checkbox" disabled={!canEdit} checked={r.taxable} onChange={(e) => set(r.id, { taxable: e.target.checked })} /></td>
                  <td><input type="checkbox" disabled={!canEdit} checked={r.active} onChange={(e) => set(r.id, { active: e.target.checked })} /></td>
                  <td>{canEdit && r.id.startsWith("new") && <button className="p-1 text-bad/80 hover:text-bad" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} aria-label="Remove"><Trash2 size={13} /></button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="py-10 text-center text-ink-faint">No labor rates yet. Add install, programming, travel… with what each costs you and what you charge.</td></tr>}
          </tbody>
        </table>
      </Stack>
      {canEdit && (
        <div className="flex items-center gap-3 border-t border-line p-3">
          <button className="btn-primary" disabled={!dirty || busy} onClick={save}>{busy && <Spinner />}Save labor rates</button>
          <span className="text-xs text-ink-faint">A rate kits still use is switched off (In use) rather than deleted.</span>
        </div>
      )}
    </Card>
  );
}

type RuleDraft = Omit<MarkupRule, "id"> & { key: string };
function Rules({ initial, setup, canEdit }: { initial: MarkupRule[]; setup: PricingSetup; canEdit: boolean }) {
  const refresh = useOpsRefresh();
  const start = () => initial.map((r) => ({ key: r.id, manufacturer: r.manufacturer, category: r.category, vendorId: r.vendorId, marginBps: r.marginBps }));
  const [rows, setRows] = useState<RuleDraft[]>(start);
  useEffect(() => setRows(start()), [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState({ manufacturer: "", category: "", vendorId: "", cost: 100_000 });
  const set = (k: string, p: Partial<RuleDraft>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const dirty = JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== JSON.stringify(start().map(({ key: _k, ...r }) => r));
  const probe = marginFor({ manufacturer: test.manufacturer || null, category: test.category || null, vendorId: test.vendorId || null }, rows.map((r) => ({ ...r, id: r.key })), setup.defaultMarginBps);
  const save = async () => {
    setBusy(true);
    try { await ops("/avl/markup-rules", { method: "PUT", json: { rules: rows.map(({ key: _k, ...r }) => r) } }); toast.success("Markup rules saved"); await refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card eyebrow="Products" title="Markup rules" action={canEdit && <button className="btn-ghost text-xs" onClick={() => setRows([...rows, { key: tmp(), manufacturer: null, category: null, vendorId: null, marginBps: setup.defaultMarginBps }])}><Plus size={13} /> Add rule</button>}>
      <p className="px-4 pt-3 text-xs text-ink-muted">A product added from a price list gets the margin of the rule that fits it best: a rule naming a manufacturer <i>and</i> a category beats one naming just one. Blank means “any”.</p>
      <Stack>
        <table className="rtable w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
            <tr><th>Manufacturer</th><th>Category</th><th>Vendor</th><th className="w-32">Margin</th><th className="w-32 text-right">$1,000 cost sells for</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
            {rows.map((r) => (
              <tr key={r.key}>
                <td><input className="input py-1" disabled={!canEdit} value={r.manufacturer ?? ""} placeholder="Any" onChange={(e) => set(r.key, { manufacturer: e.target.value || null })} /></td>
                <td><input className="input py-1" disabled={!canEdit} value={r.category ?? ""} placeholder="Any" onChange={(e) => set(r.key, { category: e.target.value || null })} /></td>
                <td>
                  <select className="input py-1" disabled={!canEdit} value={r.vendorId ?? ""} onChange={(e) => set(r.key, { vendorId: e.target.value || null })}>
                    <option value="">Any</option>{setup.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </td>
                <td><PercentInput bps={r.marginBps} disabled={!canEdit} onChange={(m) => m < 10_000 && set(r.key, { marginBps: m })} /></td>
                <td className="text-right tabular-nums text-ink-soft">{fmtMoney(priceForMargin(100_000, Math.min(r.marginBps, 9900)))}</td>
                <td>{canEdit && <button className="p-1 text-bad/80 hover:text-bad" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Remove"><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-10 text-center text-ink-faint">No rules: every product gets your default margin.</td></tr>}
          </tbody>
        </table>
      </Stack>
      <div className="flex flex-wrap items-end gap-2 border-t border-line bg-hover/20 p-3 text-xs">
        <span className="label mb-2 mr-1">Try it</span>
        <input className="input w-36 py-1" placeholder="Manufacturer" value={test.manufacturer} onChange={(e) => setTest({ ...test, manufacturer: e.target.value })} />
        <input className="input w-36 py-1" placeholder="Category" value={test.category} onChange={(e) => setTest({ ...test, category: e.target.value })} />
        <select className="input w-40 py-1" value={test.vendorId} onChange={(e) => setTest({ ...test, vendorId: e.target.value })}><option value="">Any vendor</option>{setup.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <span className="mb-1.5 text-ink-soft">→ <b>{fmtPct(probe.marginBps)}</b> margin{probe.rule ? "" : " (default)"}: $1,000 cost sells for <b>{fmtMoney(priceForMargin(100_000, probe.marginBps))}</b></span>
      </div>
      {canEdit && <div className="border-t border-line p-3"><button className="btn-primary" disabled={!dirty || busy} onClick={save}>{busy && <Spinner />}Save markup rules</button></div>}
    </Card>
  );
}

"use client";
/** One kit: its products, labor and custom lines, and what it costs and sells for today. */
import clsx from "clsx";
import { ArrowDown, ArrowLeft, ArrowUp, Package, Trash2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { marginFor, type KitDetail, type KitItem, type LaborRate, type PricingSetup } from "@shared/ops/estimating";
import { priceForMargin } from "@shared/ops/math";
import type { CatalogProduct } from "@shared/ops/types";
import { fmtMoney, fmtPct, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { ErrorBox, Field, Loading, MoneyInput, Stack } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { CatalogPicker, guessSection } from "@/components/avl/CatalogPicker";

export default function Page() { return <Suspense><KitPage /></Suspense>; }

function KitPage() {
  const id = useSearchParams().get("id") ?? "new";
  const setup = useOps<PricingSetup>("/avl/pricing");
  const kit = useOps<{ kit: KitDetail; laborRates: LaborRate[] }>(id !== "new" ? `/kits/${id}` : null);
  if (!setup.data || (id !== "new" && !kit.data)) return <><ErrorBox error={setup.error ?? kit.error} />{!(setup.error ?? kit.error) && <Loading />}</>;
  return <Editor key={kit.data ? JSON.stringify(kit.data.kit) : "new"} id={id} setup={setup.data} initial={kit.data?.kit ?? null} />;
}

const uid = () => `k${Math.random().toString(36).slice(2, 9)}`;
const price = (i: KitItem) => ({ cost: i.live ? i.live.unitCostCents : i.unitCostCents, price: i.unitPriceCents ?? (i.live ? i.live.unitPriceCents : 0) });

function Editor({ id, setup, initial }: { id: string; setup: PricingSetup; initial: KitDetail | null }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const me = useOpsUser();
  const [f, setF] = useState({ name: initial?.name ?? "", section: initial?.section ?? "", description: initial?.description ?? "", active: initial?.active ?? true });
  const [items, setItems] = useState<KitItem[]>(initial?.items ?? []);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(!initial);
  const rates = setup.laborRates.filter((r) => r.active);
  const mark = () => setDirty(true);
  const patch = (key: string, p: Partial<KitItem>) => { setItems(items.map((i) => (i.id === key ? { ...i, ...p } : i))); mark(); };
  const move = (key: string, dir: -1 | 1) => {
    const a = items.findIndex((x) => x.id === key), b = a + dir;
    if (b < 0 || b >= items.length) return;
    const next = [...items]; [next[a], next[b]] = [next[b], next[a]]; setItems(next); mark();
  };
  const sellFor = (p: CatalogProduct) => priceForMargin(p.costCents, marginFor({ manufacturer: p.manufacturer, category: p.category, vendorId: p.vendor.id }, setup.markupRules, setup.defaultMarginBps).marginBps);
  const addProduct = (p: CatalogProduct, qty: number) => {
    setItems((prev) => {
      const have = prev.find((i) => i.kind === "PRODUCT" && i.productId === p.id);
      if (have) return prev.map((i) => (i === have ? { ...i, quantity: i.quantity + qty } : i));
      if (!f.section && prev.length === 0) setF((x) => ({ ...x, section: guessSection(p.category) ?? "" }));
      return [...prev, { id: uid(), kind: "PRODUCT", productId: p.id, laborRateId: null, name: [p.manufacturer, p.name].filter(Boolean).join(" "), description: p.model ? `Model ${p.model}` : p.description,
        quantity: qty, unitCostCents: p.costCents, unitPriceCents: null, taxable: true, live: { sku: p.sku, unitCostCents: p.costCents, unitPriceCents: sellFor(p), missing: false } }];
    });
    mark();
  };
  const addLabor = (r: LaborRate) => { setItems([...items, { id: uid(), kind: "LABOR", productId: null, laborRateId: r.id, name: r.name, description: null, quantity: 1, unitCostCents: r.costCents, unitPriceCents: null, taxable: r.taxable, live: { sku: null, unitCostCents: r.costCents, unitPriceCents: r.priceCents, missing: false } }]); mark(); };
  const addCustom = () => { setItems([...items, { id: uid(), kind: "CUSTOM", productId: null, laborRateId: null, name: "Custom line", description: null, quantity: 1, unitCostCents: 0, unitPriceCents: 0, taxable: true, live: null }]); mark(); };
  const totals = useMemo(() => {
    let cost = 0, sell = 0;
    for (const i of items) { const p = price(i); cost += p.cost * i.quantity; sell += p.price * i.quantity; }
    return { cost, sell, margin: sell > 0 ? Math.round(((sell - cost) / sell) * 10_000) : 0 };
  }, [items]);

  const save = async () => {
    setBusy(true);
    const json = { ...f, section: f.section || null, description: f.description || null, items: items.map((i) => ({
      kind: i.kind, productId: i.productId, laborRateId: i.laborRateId, name: i.name, description: i.description, quantity: i.quantity,
      unitCostCents: i.kind === "CUSTOM" ? i.unitCostCents : (i.live?.unitCostCents ?? i.unitCostCents), unitPriceCents: i.kind === "CUSTOM" ? (i.unitPriceCents ?? 0) : i.unitPriceCents, taxable: i.taxable,
    })) };
    try {
      if (id === "new") { const r = await ops<{ id: string }>("/kits", { json }); toast.success("Kit saved"); await refresh(); router.replace(`/avl/kits/view?id=${r.id}`); }
      else { await ops(`/kits/${id}`, { method: "PUT", json }); toast.success("Kit saved"); setDirty(false); await refresh(); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete the kit “${f.name}”? Proposals that already use it keep their lines.`)) return;
    try { await ops(`/kits/${id}`, { method: "DELETE" }); await refresh(); router.push("/avl/kits"); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-5">
      <Link href="/avl/kits" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> Kits</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-ink-muted"><Package size={14} /> Kit {dirty && <span className="text-warn">● Unsaved changes</span>}</div>
          <input className="mt-1 w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight focus:outline-none" placeholder="Name the kit, e.g. Stage left IEM rig" value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); mark(); }} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !dirty || !f.name.trim()} onClick={save}>{busy && <Spinner />}Save kit</button>
          {id !== "new" && me.nav.avlManager && <button className="btn-ghost text-bad" onClick={remove}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div><div className="label">What's in it</div><div className="text-[15px] font-semibold">Lines</div></div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => setPicker(true)}>+ From catalog</button>
                {rates.length > 0 ? (
                  <select className="input w-auto py-1.5 text-sm" value="" onChange={(e) => { const r = rates.find((x) => x.id === e.target.value); if (r) addLabor(r); }}>
                    <option value="">+ Labor…</option>{rates.map((r) => <option key={r.id} value={r.id}>{r.name} ({fmtMoney(r.priceCents)}/{r.unit})</option>)}
                  </select>
                ) : <Link href="/avl/pricing" className="btn-outline"><Wrench size={13} /> Set up labor rates</Link>}
                <button className="btn-outline" onClick={addCustom}>+ Custom line</button>
              </div>
            </header>
            <Stack>
              <table className="rtable w-full min-w-[860px] text-sm">
                <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
                  <tr><th>Line</th><th className="w-24">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-36 text-right">Unit price</th><th className="w-28 text-right">Ext. price</th><th className="w-12">Tax</th><th className="w-20" /></tr>
                </thead>
                <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2.5">
                  {items.map((it, idx) => {
                    const p = price(it);
                    return (
                      <tr key={it.id} className="align-top">
                        <td>
                          <input className="input py-1 font-medium" value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} />
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-faint">
                            <span className={clsx("rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide", it.kind === "PRODUCT" ? "bg-accent-soft text-accent" : it.kind === "LABOR" ? "bg-violet-soft text-violet" : "bg-hover text-ink-soft")}>{it.kind === "PRODUCT" ? "Product" : it.kind === "LABOR" ? "Labor" : "Custom"}</span>
                            {it.live?.sku && <span className="font-mono">{it.live.sku}</span>}
                            {it.live?.missing && <span className="text-warn">{it.kind === "PRODUCT" ? "No longer in the price list: using the saved cost" : "Labor rate removed: using the saved cost"}</span>}
                          </div>
                        </td>
                        <td><input type="number" min={1} className="input min-w-[5.5rem] py-1 tabular-nums" value={it.quantity} onChange={(e) => patch(it.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                        <td>{it.kind === "CUSTOM" ? <MoneyInput cents={it.unitCostCents} onChange={(c) => patch(it.id, { unitCostCents: c ?? 0 })} />
                          : <div className="pt-1.5 text-right tabular-nums text-ink-soft">{fmtMoney(p.cost)}</div>}</td>
                        <td>
                          <MoneyInput cents={it.unitPriceCents} nullable={it.kind !== "CUSTOM"} placeholder={it.live ? fmtMoney(it.live.unitPriceCents) : undefined} onChange={(c) => patch(it.id, { unitPriceCents: c })} />
                          {it.kind !== "CUSTOM" && <div className="mt-0.5 text-right text-[10px] text-ink-faint">{it.unitPriceCents == null ? (it.kind === "PRODUCT" ? "By markup rule" : "From the rate") : "Fixed price"}</div>}
                        </td>
                        <td className="pt-3.5 text-right font-medium tabular-nums">{fmtMoney(p.price * it.quantity)}</td>
                        <td className="pt-3.5"><input type="checkbox" checked={it.taxable} onChange={(e) => patch(it.id, { taxable: e.target.checked })} /></td>
                        <td className="whitespace-nowrap pt-3">
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx === 0} onClick={() => move(it.id, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx === items.length - 1} onClick={() => move(it.id, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                          <button className="p-1 text-bad/80 hover:text-bad" onClick={() => { setItems(items.filter((x) => x.id !== it.id)); mark(); }} aria-label="Remove"><X size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {!items.length && <tr><td colSpan={7} className="py-12 text-center text-ink-faint">Add the products, labor and anything else that goes in this kit.</td></tr>}
                </tbody>
              </table>
            </Stack>
          </section>
        </div>
        <aside className="space-y-5">
          <div className="panel space-y-3 p-4">
            <Field label="Section on a proposal" hint="Its lines go under this heading (Audio, Video…)."><input className="input" list="kit-sections" value={f.section} onChange={(e) => { setF({ ...f, section: e.target.value }); mark(); }} /></Field>
            <datalist id="kit-sections">{["Audio", "Video", "Lighting", "Rigging", "Cable & Connectivity", "Control", "Labor", "Misc"].map((s) => <option key={s} value={s} />)}</datalist>
            <Field label="Notes for the team"><textarea rows={3} className="input" value={f.description} onChange={(e) => { setF({ ...f, description: e.target.value }); mark(); }} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => { setF({ ...f, active: e.target.checked }); mark(); }} /> Offer this kit on proposals</label>
          </div>
          <div className="panel p-4">
            <div className="label mb-3">Today's price</div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Cost</dt><dd className="tabular-nums">{fmtMoney(totals.cost)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Sells for</dt><dd className="text-lg font-semibold tabular-nums text-accent">{fmtMoney(totals.sell)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Margin</dt><dd className="tabular-nums">{fmtPct(totals.margin)}</dd></div>
            </dl>
            <p className="mt-3 text-[11px] text-ink-faint">Products follow their price list and markup rule, and labor its rate, unless you fix a price on the line.</p>
          </div>
        </aside>
      </div>
      {picker && <CatalogPicker vendors={setup.vendors} priceOf={sellFor} title="Add products to the kit" onAdd={addProduct} onClose={() => setPicker(false)} />}
    </div>
  );
}

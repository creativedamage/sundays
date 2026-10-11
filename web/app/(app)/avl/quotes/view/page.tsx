"use client";
/** The quote builder: line items from vendor price lists, margins, totals, and the quote's life. */
import clsx from "clsx";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, ExternalLink, FileSignature, FolderPlus, Hammer, History, Mail, Package, Plus, Printer, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { computeTotals, lineTotals, priceForMargin } from "@shared/ops/math";
import { availableEvents, isDeletable, isEditable, type QuoteEventType } from "@shared/ops/state-machine";
import type { CatalogProduct, LineItemDraft, PublicQuote, QuoteDTO, QuotePage } from "@shared/ops/types";
import { isAlternate, isOption, isPackage, marginFor, normalizeOptions, optionGroups, PACKAGE_GROUP, PACKAGE_LETTERS, packageLabel, type KitLine, type KitRow, type LaborRate } from "@shared/ops/estimating";
import { fmtMoney, fmtPct, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { ErrorBox, Field, Loading, MoneyInput, PercentInput, QuoteStatusBadge, Stack } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { CatalogPicker, guessSection } from "@/components/avl/CatalogPicker";
import { KitPicker } from "@/components/avl/KitPicker";

const SECTIONS = ["Audio", "Video", "Lighting", "Rigging", "Cable & Connectivity", "Control", "Labor", "Misc"];
const uid = () => Math.random().toString(36).slice(2, 10);

export default function Page() { return <Suspense><QuoteView /></Suspense>; }

function QuoteView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<QuotePage>(id ? `/quotes/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Builder key={`${d.data.quote.status}:${d.data.quote.events[0]?.id ?? ""}`} page={d.data} />;
}

function Builder({ page }: { page: QuotePage }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const { customers, vendors, defaultMarginBps, laborRateCents, canApprove, laborRates, markupRules, kits } = page;
  const [q, setQ] = useState<QuoteDTO>(page.quote);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [askNote, setAskNote] = useState<QuoteEventType | null>(null);
  const [sending, setSending] = useState<"send" | "email" | null>(null);
  const editable = isEditable(q.status);
  const customer = customers.find((c) => c.id === q.customerId);
  const lines = useMemo(() => normalizeOptions(q.items), [q.items]);
  const totals = useMemo(() => computeTotals(lines, { taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, taxExempt: customer?.taxExempt }),
    [lines, q.taxBps, q.discountCents, q.depositBps, customer?.taxExempt]);
  const groups = useMemo(() => optionGroups(lines), [lines]);
  const notIncluded = lines.filter((i) => i.selected === false).reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
  const [kitPicker, setKitPicker] = useState(false);
  // Sections: lines are grouped under them. A new (still empty) section lives here until a line is in it.
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [focusSection, setFocusSection] = useState<string | null>(null);
  const secOf = (i: { section?: string | null }) => i.section?.trim() || "";
  const sections = [...new Set([...q.items.map(secOf), ...extraSections])];
  const [viewVersion, setViewVersion] = useState<number | null>(null);

  const patch = (p: Partial<QuoteDTO>) => { setQ((prev) => ({ ...prev, ...p })); setDirty(true); };
  const patchItem = (key: string, p: Partial<LineItemDraft>) => patch({ items: q.items.map((i) => (i.key === key ? { ...i, ...p } : i)) });
  /** Up or down within its section. */
  const move = (key: string, dir: -1 | 1) => {
    const i = q.items.findIndex((x) => x.key === key);
    const sec = secOf(q.items[i]);
    let j = i + dir;
    while (j >= 0 && j < q.items.length && secOf(q.items[j]) !== sec) j += dir;
    if (j < 0 || j >= q.items.length) return;
    const items = [...q.items]; [items[i], items[j]] = [items[j], items[i]]; patch({ items });
  };
  const addSection = () => {
    let n = 1, name = "New section";
    while (sections.includes(name)) name = `New section ${++n}`;
    setExtraSections([...extraSections, name]); setFocusSection(name);
  };
  const renameSection = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from) return;
    if (sections.includes(name) && !window.confirm(`There's already a “${name}” section. Put these lines in it?`)) return;
    setExtraSections(extraSections.map((x) => (x === from ? name : x)).filter((x, i, a) => a.indexOf(x) === i));
    if (q.items.some((i) => secOf(i) === from)) patch({ items: q.items.map((i) => (secOf(i) === from ? { ...i, section: name } : i)) });
  };
  const removeSection = (sec: string) => {
    const n = q.items.filter((i) => secOf(i) === sec).length;
    if (n && !window.confirm(`Remove “${sec || "Other"}” and its ${n} line${n === 1 ? "" : "s"}?`)) return;
    setExtraSections(extraSections.filter((x) => x !== sec));
    if (n) patch({ items: q.items.filter((i) => secOf(i) !== sec) });
  };
  const sellFor = (p: CatalogProduct) => priceForMargin(p.costCents, marginFor({ manufacturer: p.manufacturer, category: p.category, vendorId: p.vendor.id }, markupRules, defaultMarginBps).marginBps);
  const addFromCatalog = (p: CatalogProduct, qty: number) => {
    setQ((prev) => {
      const existing = prev.items.find((i) => i.productId === p.id);
      const items = existing ? prev.items.map((i) => (i === existing ? { ...i, quantity: i.quantity + qty } : i)) : [...prev.items, {
        key: uid(), productId: p.id, isCustom: false, section: target ?? guessSection(p.category), sku: p.sku, name: [p.manufacturer, p.name].filter(Boolean).join(" "),
        description: p.model ? `Model ${p.model}` : p.description, quantity: qty, unitCostCents: p.costCents, unitPriceCents: sellFor(p), taxable: true,
      }];
      return { ...prev, items };
    });
    setDirty(true);
  };
  const addCustom = (kind: "item" | "labor", section?: string) => patch({ items: [...q.items, kind === "labor"
    ? { key: uid(), productId: null, isCustom: true, section: section ?? "Labor", sku: null, name: "Installation labor (hours)", description: null, quantity: 1, unitCostCents: 0, unitPriceCents: laborRateCents, taxable: false }
    : { key: uid(), productId: null, isCustom: true, section: section ?? "Misc", sku: null, name: "Custom item", description: null, quantity: 1, unitCostCents: 0, unitPriceCents: 0, taxable: true }] });
  const addLabor = (r: LaborRate, section?: string) => patch({ items: [...q.items, { key: uid(), productId: null, isCustom: true, section: section ?? "Labor", sku: null, name: r.name, description: r.description, quantity: 1, unitCostCents: r.costCents, unitPriceCents: r.priceCents, taxable: r.taxable }] });
  /** A kit's lines, or the kit as one line (its lines summed). */
  const addKit = (kit: KitRow, kl: KitLine[], asOne: boolean) => {
    const section = target ?? (kit.section || kit.name);
    const add: LineItemDraft[] = asOne
      ? [{ key: uid(), productId: null, isCustom: true, section, sku: null, name: kit.name, description: kit.description, quantity: 1, kitName: kit.name,
          unitCostCents: kl.reduce((t, l) => t + l.quantity * l.unitCostCents, 0), unitPriceCents: kl.reduce((t, l) => t + l.quantity * l.unitPriceCents, 0), taxable: kl.some((l) => l.taxable) }]
      : kl.map((l) => ({ key: uid(), productId: l.productId, isCustom: l.isCustom, section: l.labor && !target ? "Labor" : section, sku: l.sku, name: l.name, description: l.description,
          quantity: l.quantity, unitCostCents: l.unitCostCents, unitPriceCents: l.unitPriceCents, taxable: l.taxable, kitName: kit.name }));
    patch({ items: [...q.items, ...add] });
    toast.success(`${kit.name} added`);
  };
  /** Options: standard, an optional add-on group, or an alternate (a choice in a group). */
  /** Options: standard (in every option), Option A–D, an optional add-on group, or an alternate in a group of your own. */
  const setOption = (it: LineItemDraft, kind: string) => patchItem(it.key, kind === "STD" ? { optionGroup: null, optionChoice: null, selected: true }
    : (PACKAGE_LETTERS as readonly string[]).includes(kind) ? { optionGroup: PACKAGE_GROUP, optionChoice: kind }
    : kind === "ADD_ON" ? { optionGroup: isPackage(it) ? "Optional add-on" : it.optionGroup || "Optional add-on", optionChoice: null, selected: it.selected ?? true }
    : { optionGroup: isPackage(it) || !it.optionGroup ? "Choose one" : it.optionGroup, optionChoice: isPackage(it) ? "Good" : it.optionChoice || "Good" });
  const includeAddOn = (group: string, on: boolean) => patch({ items: q.items.map((i) => (i.optionGroup?.trim() === group && !isAlternate(i) ? { ...i, selected: on } : i)) });
  const pickChoice = (group: string, choice: string) => patch({ items: q.items.map((i) => (i.optionGroup?.trim() === group && isAlternate(i) ? { ...i, selected: i.optionChoice?.trim() === choice } : i)) });
  const [marginAll, setMarginAll] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const saved = await ops<QuoteDTO>(`/quotes/${q.id}`, { method: "PUT", json: {
        title: q.title, customerId: q.customerId, campusId: q.campusId, introNotes: q.introNotes, internalNotes: q.internalNotes, terms: q.terms,
        taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, validUntil: q.validUntil, items: q.items.map(({ key: _k, ...rest }) => rest),
      } });
      setQ(saved); setDirty(false); toast.success("Saved");
      void refresh();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  // A converted proposal is a job: "Create job" (below) does that, so the bare event isn't offered.
  const events = availableEvents(q.status, "staff").filter((e) => e !== "CONVERT" && (e !== "MARK_ACCEPTED" || canApprove));
  async function fire(event: QuoteEventType, note?: string) {
    if (dirty) return setError("Save your changes first.");
    if (event === "SEND") return setSending("send");
    try {
      const next = await ops<QuoteDTO>(`/quotes/${q.id}/events`, { json: { event, note } });
      setQ(next); setAskNote(null);
      toast.success(LABELS[event] ?? "Updated");
      void refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function send(emailTo: string | null) {
    try {
      const next = await ops<QuoteDTO & { emailedTo: string | null; emailError?: string | null }>(`/quotes/${q.id}/events`, { json: { event: "SEND", emailTo } });
      setQ(next); setSending(null);
      if (emailTo && !next.emailedTo) toast.warning(`Locked, but the email didn’t go. ${next.emailError ?? ""} Copy the client link to share it for now.`, { duration: 15000 });
      else toast.success(next.emailedTo ? `Sent to ${next.emailedTo}` : "Locked. Copy the client link to share it.");
      void refresh();
    } catch (e) { setError((e as Error).message); setSending(null); }
  }
  async function emailAgain(to: string) {
    try { const r = await ops<{ emailedTo: string }>(`/quotes/${q.id}/email`, { json: { to } }); toast.success(`Sent to ${r.emailedTo}`); setSending(null); }
    catch (e) { toast.error((e as Error).message, { duration: 15000 }); }
  }
  async function makeJob() {
    if (dirty) return setError("Save your changes first.");
    try {
      const j = await ops<{ id: string; number: string; created: boolean }>(`/quotes/${q.id}/job`, { method: "POST" });
      if (j.created) toast.success(`Job ${j.number} created`);
      void refresh();
      router.push(`/avl/jobs/view?id=${j.id}`);
    } catch (e) { setError((e as Error).message); }
  }
  async function remove() {
    if (!window.confirm(`Delete quote ${q.number}? This can't be undone.`)) return;
    try { await ops(`/quotes/${q.id}`, { method: "DELETE" }); void refresh(); router.push("/avl/quotes"); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <Link href="/avl/quotes" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> Quotes</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 text-sm text-ink-muted"><span className="font-mono">{q.number}{q.version > 1 && <span className="ml-1 text-ink-faint">v{q.version}</span>}</span><QuoteStatusBadge status={q.status} />{dirty && <span className="text-warn">● Unsaved changes</span>}</div>
          <input className="mt-1 w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight focus:outline-none disabled:text-ink" value={q.title} disabled={!editable} onChange={(e) => patch({ title: e.target.value })} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {editable && <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving && <Spinner />}Save</button>}
          {q.status === "ACCEPTED" && canApprove && <button className="btn-primary" onClick={makeJob}><Hammer size={14} /> Create job</button>}
          {q.job && <Link className="btn-primary" href={`/avl/jobs/view?id=${q.job.id}`}><Hammer size={14} /> Open job {q.job.number}</Link>}
          {events.map((e) => (
            <button key={e} className={e === "SEND" || e === "MARK_ACCEPTED" ? "btn-primary" : e === "MARK_DECLINED" ? "btn-ghost text-bad" : "btn-outline"}
              onClick={() => (NEEDS_NOTE.includes(e) ? setAskNote(e) : void fire(e))}>{e === "SEND" && q.status === "CHANGES_REQUESTED" ? "Lock revision" : LABELS[e]}</button>
          ))}
          <Link className="btn-outline" href={`/ops-print?id=${q.id}`}><Printer size={14} /> Print / PDF</Link>
          {isDeletable(q.status) && <button className="btn-ghost text-bad" onClick={remove}>Delete</button>}
        </div>
      </div>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {!editable && (
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink-soft">
          This quote is <b>{q.status.replace("_", " ").toLowerCase()}</b> and locked. The customer's pricing is frozen at {q.sentTotalCents != null ? fmtMoney(q.sentTotalCents) : "send time"}.
          {q.status === "SENT" ? " The client can open it from the link, sign it, or ask for changes. If they answer another way, record it here."
            : q.status === "CHANGES_REQUESTED" ? " Revise it, then send the new version: the same link shows it."
            : q.status === "ACCEPTED" ? (canApprove ? " Create the job to start its budget from these lines." : " An AVL Manager can create the job from it.")
            : q.status === "CONVERTED" ? "" : " Use Revise / Reopen to make changes."}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="panel grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Client" hint={customer?.taxExempt ? "Tax exempt" : undefined}>
              <select className="input" disabled={!editable} value={q.customerId} onChange={(e) => patch({ customerId: e.target.value })}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.taxExempt ? " (tax exempt)" : ""}</option>)}
              </select>
            </Field>
            <Field label="Client record">
              <Link href={`/avl/clients/view?id=${q.customerId}`} className="btn-outline w-full justify-center">Open {customer?.name ?? "client"} →</Link>
            </Field>
            <Field label="Valid until"><input type="date" className="input" disabled={!editable} value={q.validUntil?.slice(0, 10) ?? ""} onChange={(e) => patch({ validUntil: e.target.value || null })} /></Field>
            <Field label="Deposit to approve"><PercentInput bps={q.depositBps} disabled={!editable} onChange={(depositBps) => patch({ depositBps })} /></Field>
          </div>

          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div><div className="label">Scope</div><div className="text-[15px] font-semibold">Line items</div></div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => setPicker(true)}>+ From catalog</button>
                  <button className="btn-outline" onClick={() => addCustom("item")}>+ Custom line</button>
                  {laborRates.length ? (
                    <select className="input w-auto py-1.5 text-sm" value="" onChange={(e) => { const r = laborRates.find((x) => x.id === e.target.value); if (r) addLabor(r); else if (e.target.value === "custom") addCustom("labor"); }}>
                      <option value="">+ Labor…</option>
                      {laborRates.map((r) => <option key={r.id} value={r.id}>{r.name} ({fmtMoney(r.priceCents)}/{r.unit})</option>)}
                      <option value="custom">Other labor</option>
                    </select>
                  ) : <button className="btn-outline" onClick={() => addCustom("labor")}>+ Labor</button>}
                  <button className="btn-outline" onClick={() => setKitPicker(true)}><Package size={13} /> Kit</button>
                  <button className="btn-outline" onClick={addSection}><FolderPlus size={13} /> Section</button>
                  <button className="btn-ghost" onClick={() => setMarginAll(String(defaultMarginBps / 100))}>Set margin…</button>
                </div>
              )}
            </header>
            <Stack>
              <table className="rtable w-full min-w-[1120px] text-sm">
                <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
                  <tr><th className="w-32">Section</th><th className="min-w-[320px]">Item</th><th className="w-24">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-32 text-right">Unit price</th><th className="w-24 text-right">Margin</th><th className="w-28 text-right">Ext. price</th><th className="w-12">Tax</th><th className="w-20" /></tr>
                </thead>
                <tbody className="[&_td]:px-3 [&_td]:py-2.5">
                  {sections.map((sec) => {
                    const rows = q.items.map((it, idx) => ({ it, idx })).filter(({ it }) => secOf(it) === sec);
                    const sub = rows.reduce((t, { idx }) => t + (lines[idx].selected === false ? 0 : lines[idx].quantity * lines[idx].unitPriceCents), 0);
                    return (
                      <SectionRows key={sec || "_none"}>
                        <tr className="border-t-2 border-line bg-hover/40">
                          <td colSpan={9} className="!py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {editable ? <SectionName name={sec} autoFocus={focusSection === sec} onRename={(to) => renameSection(sec, to)} />
                                : <span className="text-[13px] font-semibold uppercase tracking-[0.05em]">{sec || "Other"}</span>}
                              <span className="text-xs text-ink-faint">{rows.length} line{rows.length === 1 ? "" : "s"} · {fmtMoney(sub)}</span>
                              {editable && (
                                <span className="ml-3 flex flex-wrap gap-1">
                                  <button className="btn-ghost py-1 text-xs" onClick={() => { setTarget(sec); setPicker(true); }}><Search size={12} /> Catalog</button>
                                  <button className="btn-ghost py-1 text-xs" onClick={() => addCustom("item", sec)}><Plus size={12} /> Custom line</button>
                                  {laborRates.length > 0 && (
                                    <select className="rounded-md border border-line bg-canvas px-1.5 py-1 text-xs text-ink-soft" value="" onChange={(e) => { const r = laborRates.find((x) => x.id === e.target.value); if (r) addLabor(r, sec); }} aria-label="Add labor to this section">
                                      <option value="">+ Labor…</option>{laborRates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                  )}
                                  <button className="btn-ghost py-1 text-xs" onClick={() => { setTarget(sec); setKitPicker(true); }}><Package size={12} /> Kit</button>
                                  <button className="btn-ghost p-1 text-bad/70 hover:text-bad" onClick={() => removeSection(sec)} aria-label={`Remove section ${sec}`}><Trash2 size={13} /></button>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {rows.map(({ it, idx }, k) => {
                    const lt = lineTotals(it);
                    const low = it.unitCostCents > 0 && lt.marginBps < 1500;
                    const n = lines[idx];
                    const kind = isPackage(n) ? n.optionChoice!.trim() : isAlternate(n) ? "ALT" : isOption(n) ? "ADD_ON" : "STD";
                    const custom = kind === "ALT" || kind === "ADD_ON";
                    return (
                      <tr key={it.key} className={clsx("border-t border-line align-top", kind !== "STD" && "bg-violet-soft/30 [&>td:first-child]:border-l-2 [&>td:first-child]:border-violet", n.selected === false && "[&_td]:opacity-70")}>
                        <td>
                          {kind !== "STD" && kind !== "ALT" && kind !== "ADD_ON" && <span className="mb-1 inline-block rounded bg-violet px-1.5 py-0.5 text-[10px] font-bold text-white">{packageLabel(kind)}</span>}
                          <select className="input py-1 text-xs" disabled={!editable} value={sec} onChange={(e) => patchItem(it.key, { section: e.target.value || null })} aria-label="Section">
                            {sections.map((x) => <option key={x || "_none"} value={x}>{x || "Other"}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="input py-1 font-medium" disabled={!editable} value={it.name} onChange={(e) => patchItem(it.key, { name: e.target.value })} />
                          <input className="input mt-1 py-1 text-xs" placeholder="Description (the customer sees this)" disabled={!editable} value={it.description ?? ""} onChange={(e) => patchItem(it.key, { description: e.target.value || null })} />
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                            <span>{it.isCustom ? "Custom line" : `Catalog · ${it.sku}`}{it.kitName ? ` · from kit ${it.kitName}` : ""}</span>
                            {(editable || kind !== "STD") && <select className="rounded border border-line bg-canvas px-1 py-0.5 text-[11px] text-ink-soft" disabled={!editable} value={kind} onChange={(e) => setOption(it, e.target.value)} aria-label="Option">
                              <option value="STD">In every option</option>
                              {PACKAGE_LETTERS.map((l) => <option key={l} value={l}>Option {l}</option>)}
                              <option value="ADD_ON">Optional add-on</option><option value="ALT">Alternate (own group)</option>
                            </select>}
                            {custom && <>
                              <input list="ops-option-groups" className="w-36 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-ink" disabled={!editable} value={it.optionGroup ?? ""} placeholder="Group" title="Option group" onChange={(e) => patchItem(it.key, { optionGroup: e.target.value })} />
                              {kind === "ALT" && <input className="w-28 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-ink" disabled={!editable} value={it.optionChoice ?? ""} placeholder="Choice (Good…)" title="Choice" onChange={(e) => patchItem(it.key, { optionChoice: e.target.value })} />}
                            </>}
                            {kind === "ADD_ON"
                              ? <label className="flex items-center gap-1 text-ink-soft"><input type="checkbox" disabled={!editable} checked={n.selected !== false} onChange={(e) => includeAddOn(n.optionGroup!, e.target.checked)} /> Included</label>
                              : kind !== "STD" && <label className="flex items-center gap-1 text-ink-soft"><input type="radio" disabled={!editable} checked={n.selected !== false} onChange={() => pickChoice(n.optionGroup!, n.optionChoice!)} /> Default pick</label>}
                          </div>
                        </td>
                        <td><input type="number" min={1} className="input min-w-[5.5rem] py-1 tabular-nums" disabled={!editable} value={it.quantity} onChange={(e) => patchItem(it.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                        <td><MoneyInput cents={it.unitCostCents} disabled={!editable} onChange={(c) => patchItem(it.key, { unitCostCents: c ?? 0 })} /></td>
                        <td><MoneyInput cents={it.unitPriceCents} disabled={!editable} onChange={(c) => patchItem(it.key, { unitPriceCents: c ?? 0 })} /></td>
                        <td>{it.unitCostCents > 0 ? (
                          <div className={clsx(low && "[&_input]:border-warn [&_input]:bg-warn-soft")}>
                            <PercentInput bps={lt.marginBps} disabled={!editable} onChange={(m) => m < 10_000 && patchItem(it.key, { unitPriceCents: priceForMargin(it.unitCostCents, m) })} />
                          </div>
                        ) : <div className="pt-2 text-right text-xs text-ink-faint">—</div>}</td>
                        <td className="pt-4 text-right font-medium tabular-nums">{fmtMoney(lt.priceCents)}</td>
                        <td className="pt-4"><input type="checkbox" disabled={!editable} checked={it.taxable} onChange={(e) => patchItem(it.key, { taxable: e.target.checked })} /></td>
                        <td className="whitespace-nowrap pt-3">{editable && (<>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={k === 0} onClick={() => move(it.key, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={k === rows.length - 1} onClick={() => move(it.key, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                          <button className="p-1 text-bad/80 hover:text-bad" onClick={() => patch({ items: q.items.filter((x) => x.key !== it.key) })} aria-label="Remove"><X size={13} /></button>
                        </>)}</td>
                      </tr>
                    );
                        })}
                        {!rows.length && <tr className="border-t border-line"><td colSpan={9} className="py-5 text-center text-xs text-ink-faint">Nothing in this section yet. Add from the catalog, a custom line, labor or a kit.</td></tr>}
                      </SectionRows>
                    );
                  })}
                  {!q.items.length && !extraSections.length && <tr><td colSpan={9} className="py-12 text-center text-ink-faint">No line items yet. Add products from a vendor price list, a custom line, or start a section.</td></tr>}
                </tbody>
              </table>
              <datalist id="ops-sections">{SECTIONS.map((s) => <option key={s} value={s} />)}</datalist>
              <datalist id="ops-option-groups">{groups.map((g) => <option key={g.group} value={g.group} />)}</datalist>
              {groups.length > 0 && (
                <div className="border-t border-line bg-violet-soft/20 px-3 py-2.5 text-xs text-ink-soft">
                  <b className="text-ink">Client choices:</b>{" "}
                  {groups.map((g) => g.kind === "ADD_ON" ? `${g.group} (optional, ${g.choices[0].selected ? "included" : "not included"})` : g.group === PACKAGE_GROUP ? `${g.choices.map((c) => packageLabel(c.choice)).join(" / ")} (pick one)` : `${g.group} (${g.choices.map((c) => c.choice).join(" / ")})`).join(" · ")}.
                  {" "}The client can change these on the proposal link before signing; the total follows. When it&apos;s accepted, what wasn&apos;t picked comes off the proposal (the version sent keeps it).
                </div>
              )}
            </Stack>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="panel space-y-3 p-4">
              <Field label="Proposal intro (the customer sees this)"><textarea rows={5} className="input" disabled={!editable} value={q.introNotes ?? ""} onChange={(e) => patch({ introNotes: e.target.value })} /></Field>
              <Field label="Terms & conditions"><textarea rows={5} className="input" disabled={!editable} value={q.terms ?? ""} onChange={(e) => patch({ terms: e.target.value })} /></Field>
            </div>
            <div className="panel p-4">
              <Field label="Internal notes (AVL team only)"><textarea rows={12} className="input border-warn/30" disabled={!editable} value={q.internalNotes ?? ""} onChange={(e) => patch({ internalNotes: e.target.value })} /></Field>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          {q.status !== "DRAFT" && <ClientLink q={q} onEmail={() => setSending("email")} />}
          {q.signature && (
            <div className="panel p-4">
              <div className="label mb-2 flex items-center gap-1.5"><FileSignature size={13} className="text-ok" /> Signed online</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.signature.imageDataUrl} alt={`Signature of ${q.signature.signerName}`} className="h-20 w-full rounded-lg border border-line bg-white object-contain p-1" />
              <div className="mt-2 text-sm"><b>{q.signature.signerName}</b>{q.signature.signerTitle ? `, ${q.signature.signerTitle}` : ""}</div>
              <div className="text-xs text-ink-muted">{q.signature.signerEmail} · {new Date(q.signature.signedAt).toLocaleString()} · {fmtMoney(q.signature.totalCents)}</div>
            </div>
          )}
          <div className="panel p-4">
            <div className="label mb-3">Totals</div>
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={fmtMoney(totals.subtotalCents)} />
              {notIncluded > 0 && <Row label={<span className="text-xs">Options not included</span>} value={<span className="text-xs text-ink-faint">{fmtMoney(notIncluded)}</span>} />}
              <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt><dd className="w-32"><MoneyInput cents={q.discountCents} disabled={!editable} onChange={(c) => patch({ discountCents: c ?? 0 })} /></dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Tax rate {customer?.taxExempt && <span className="text-xs text-ok">(exempt)</span>}</dt><dd className="w-32"><PercentInput bps={q.taxBps} disabled={!editable} onChange={(taxBps) => patch({ taxBps })} /></dd></div>
              <Row label="Tax" value={fmtMoney(totals.taxCents)} />
              <div className="border-t border-line pt-2"><Row label={<b>Total</b>} value={<b className="text-xl text-accent">{fmtMoney(totals.totalCents)}</b>} /></div>
              <Row label={`Deposit (${fmtPct(q.depositBps)})`} value={fmtMoney(totals.depositCents)} />
              {q.paidCents > 0 && <Row label="Paid" value={<span className="text-ok">{fmtMoney(q.paidCents)}</span>} />}
            </dl>
          </div>
          <div className="panel p-4">
            <div className="label mb-3">Margin · internal only</div>
            <dl className="space-y-2 text-sm">
              <Row label="Revenue (pre-tax)" value={fmtMoney(totals.subtotalCents - totals.discountCents)} />
              <Row label="Cost" value={fmtMoney(totals.costCents)} />
              <Row label="Gross profit" value={<span className={totals.grossProfitCents < 0 ? "text-bad" : "text-ok"}>{fmtMoney(totals.grossProfitCents)}</span>} />
              <Row label="Margin" value={fmtPct(totals.marginBps)} />
              <Row label="Markup" value={fmtPct(totals.markupBps)} />
            </dl>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover" title="Aim for 25% or more">
              <div className={clsx("h-full rounded-full", totals.marginBps < 1500 ? "bg-bad" : totals.marginBps < 2500 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(0, Math.min(100, totals.marginBps / 100))}%` }} />
            </div>
          </div>
          {q.versions.length > 0 && (
            <div className="panel p-4">
              <div className="label mb-2 flex items-center gap-1.5"><History size={13} /> Versions sent</div>
              <ul className="space-y-1 text-sm">
                {q.versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-2">
                    <span className="w-8 font-mono text-xs text-ink-muted">v{v.version}</span>
                    <span className="flex-1 text-xs text-ink-soft">{new Date(v.sentAt).toLocaleDateString()}{v.sentBy ? ` · ${v.sentBy}` : ""}</span>
                    <span className="tabular-nums">{fmtMoney(v.totalCents)}</span>
                    <button className="text-xs text-accent hover:underline" onClick={() => setViewVersion(v.version)}>View</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.events.length > 0 && (
            <div className="panel p-4">
              <div className="label mb-3">Activity</div>
              <ol className="space-y-3 text-sm">
                {q.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-3">
                    <div className="font-medium">{(LABELS[e.type as QuoteEventType] ?? e.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()))}
                      {e.toStatus && e.fromStatus !== e.toStatus && <span className="text-ink-faint"> → {e.toStatus.replace("_", " ").toLowerCase()}</span>}</div>
                    {e.note && <div className="whitespace-pre-wrap text-ink-soft">{e.note}</div>}
                    <div className="text-xs text-ink-faint">{e.actorLabel ?? "Staff"} · {new Date(e.createdAt).toLocaleString()}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>

      {picker && <CatalogPicker vendors={vendors} priceOf={sellFor} onAdd={addFromCatalog} onClose={() => { setPicker(false); setTarget(null); }} />}
      {kitPicker && <KitPicker kits={kits} onAdd={addKit} onClose={() => { setKitPicker(false); setTarget(null); }} />}
      {viewVersion != null && <VersionModal quoteId={q.id} version={viewVersion} onClose={() => setViewVersion(null)} />}
      {askNote && <NoteModal event={askNote} onClose={() => setAskNote(null)} onSubmit={(n) => fire(askNote, n)} />}
      {sending && <SendModal again={sending === "email"} revision={q.status === "CHANGES_REQUESTED"} defaultTo={customer?.email ?? ""} onClose={() => setSending(null)}
        onSend={(to) => (sending === "email" ? emailAgain(to!) : send(to))} />}
      {marginAll !== null && (
        <Modal open onClose={() => setMarginAll(null)} title="Margin for every product line" width={380}>
          <form className="space-y-3 p-5" onSubmit={(e) => {
            e.preventDefault();
            const n = parseFloat(marginAll);
            if (Number.isFinite(n) && n < 100) patch({ items: q.items.map((i) => (i.unitCostCents > 0 ? { ...i, unitPriceCents: priceForMargin(i.unitCostCents, Math.round(n * 100)) } : i)) });
            setMarginAll(null);
          }}>
            <Field label="Target margin %"><input autoFocus className="input" inputMode="decimal" value={marginAll} onChange={(e) => setMarginAll(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setMarginAll(null)}>Cancel</button><button className="btn-primary">Apply</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const LABELS: Partial<Record<QuoteEventType | "CREATE" | "EDIT", string>> = {
  SEND: "Send to client", REVISE: "Revise (back to draft)", REOPEN: "Reopen as draft", CONVERT: "Mark converted",
  MARK_ACCEPTED: "Customer accepted", MARK_CHANGES: "Customer wants changes", MARK_DECLINED: "Customer declined", CREATE: "Created", EDIT: "Edited",
};
const NEEDS_NOTE: QuoteEventType[] = ["MARK_ACCEPTED", "MARK_CHANGES", "MARK_DECLINED"];

/** The link the client opens: copy it, open it, or email it. */
function ClientLink({ q, onEmail }: { q: QuoteDTO; onEmail: () => void }) {
  const copy = () => void navigator.clipboard.writeText(q.clientUrl).then(() => toast.success("Link copied"));
  return (
    <div className="panel p-4">
      <div className="label mb-2">Client link</div>
      <p className="text-xs text-ink-muted">The client opens this to read the proposal{q.status === "SENT" ? ", sign it, or ask for changes" : ""}. No account needed.</p>
      <div className="mt-2 truncate rounded-lg bg-hover px-2.5 py-1.5 font-mono text-[11px] text-ink-soft" title={q.clientUrl}>{q.clientUrl.replace(/^https?:\/\//, "")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button className="btn-outline py-1 text-xs" onClick={copy}><Copy size={12} /> Copy</button>
        <a className="btn-outline py-1 text-xs" href={q.clientUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open</a>
        <button className="btn-outline py-1 text-xs" onClick={onEmail}><Mail size={12} /> Email</button>
      </div>
      <div className="mt-2 text-[11px] text-ink-faint">{q.viewedAt ? `Opened by the client ${new Date(q.viewedAt).toLocaleString()}` : q.status === "SENT" ? "Not opened yet." : ""}</div>
    </div>
  );
}

function SendModal({ again, revision, defaultTo, onClose, onSend }: { again: boolean; revision: boolean; defaultTo: string; onClose: () => void; onSend: (to: string | null) => Promise<void> }) {
  const [email, setEmail] = useState(Boolean(defaultTo) || again);
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={again ? "Email the proposal" : revision ? "Send the revised proposal" : "Send to the client"} width={480}>
      <form className="space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSend(email ? to.trim() : null); setBusy(false); }}>
        {!again && <p className="text-sm text-ink-soft">This locks the pricing. The client opens the proposal from its link to sign it or ask for changes; you can still revise it if they do.</p>}
        {!again && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email the link</label>}
        {email && <Field label="To"><input type="email" required className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@church.org" /></Field>}
        {!email && <p className="text-xs text-ink-muted">You can copy the link from the proposal after sending.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}{again ? "Send email" : email ? "Lock and email" : "Lock"}</button></div>
      </form>
    </Modal>
  );
}

function NoteModal({ event, onClose, onSubmit }: { event: QuoteEventType; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const prompt = event === "MARK_ACCEPTED" ? "How did the customer accept? (e.g. signed the printed proposal on Oct 4)" : event === "MARK_CHANGES" ? "What changes did they ask for?" : "Anything to note? (optional)";
  return (
    <Modal open onClose={onClose} title={LABELS[event]} width={460}>
      <form className="space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(note); setBusy(false); }}>
        <Field label="Note"><textarea autoFocus rows={3} className="input" placeholder={prompt} value={note} onChange={(e) => setNote(e.target.value)} required={event !== "MARK_DECLINED"} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}{LABELS[event]}</button></div>
      </form>
    </Modal>
  );
}

const SectionRows = ({ children }: { children: React.ReactNode }) => <>{children}</>;

/** A section's name, renamed when you leave the box (so typing doesn't move lines around). */
function SectionName({ name, autoFocus, onRename }: { name: string; autoFocus?: boolean; onRename: (to: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return (
    <input className="w-56 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-semibold uppercase tracking-[0.05em] hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
      list="ops-sections" value={v} placeholder="Other" autoFocus={autoFocus} onFocus={(e) => autoFocus && e.target.select()} aria-label="Section name"
      onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== name) onRename(v); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}


/** What the client saw in an earlier version. */
function VersionModal({ quoteId, version, onClose }: { quoteId: string; version: number; onClose: () => void }) {
  const d = useOps<{ version: number; sentAt: string; sentBy: string | null; totalCents: number; quote: PublicQuote }>(`/quotes/${quoteId}/versions/${version}`);
  return (
    <Modal open onClose={onClose} title={`Version ${version}`} width={720}>
      {!d.data ? <div className="p-6"><ErrorBox error={d.error} />{!d.error && <Loading />}</div> : (
        <div className="max-h-[70vh] overflow-y-auto p-5 text-sm">
          <p className="mb-3 text-ink-muted">Sent {new Date(d.data.sentAt).toLocaleString()}{d.data.sentBy ? ` by ${d.data.sentBy}` : ""}: <b className="text-ink">{d.data.quote.title}</b></p>
          <table className="w-full">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted"><tr><th className="py-1.5">Item</th><th className="w-14 text-right">Qty</th><th className="w-28 text-right">Unit</th><th className="w-28 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.data.quote.items.map((i) => (
                <tr key={i.id} className={i.selected === false ? "text-ink-faint" : ""}>
                  <td className="py-1.5">{i.name}{i.optionGroup && <span className="ml-2 text-[11px] text-violet">{i.optionGroup}{i.optionChoice ? `: ${i.optionChoice}` : ""}{i.selected === false ? " (not chosen)" : ""}</span>}<div className="text-[11px] text-ink-faint">{i.section}</div></td>
                  <td className="text-right tabular-nums">{i.quantity}</td>
                  <td className="text-right tabular-nums">{fmtMoney(i.unitPriceCents)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(i.quantity * i.unitPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end gap-6 border-t border-line pt-2"><span className="text-ink-muted">Total</span><b className="tabular-nums">{fmtMoney(d.data.quote.totals.totalCents)}</b></div>
        </div>
      )}
    </Modal>
  );
}

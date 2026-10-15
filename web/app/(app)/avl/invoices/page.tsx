"use client";
/** Invoices across jobs: what's owed (and how late), drafts to send, what's paid, and aging by client. */
import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { AgingBuckets, InvoicesPage } from "@shared/ops/invoicing";
import { fmtMoney, money0, useOps } from "@/lib/ops";
import { Card, ErrorBox, KpiRow, Loading, PageHeader, Table, Tabs } from "@/components/ops/OpsUi";
import { InvoiceTable } from "@/components/avl/billing/bits";

type Show = "OPEN" | "OVERDUE" | "DRAFT" | "PAID" | "ALL";
export default function Page() { return <Suspense><Invoices /></Suspense>; }

function Invoices() {
  const sp = useSearchParams();
  const router = useRouter();
  const show = (["OPEN", "OVERDUE", "DRAFT", "PAID", "ALL"].includes(sp.get("show") ?? "") ? sp.get("show") : "OPEN") as Show;
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => setQ(sp.get("q") ?? ""), [sp]);
  const go = (p: { show?: Show; q?: string }) => {
    const u = new URLSearchParams(); const s = p.show ?? show; const qq = p.q ?? sp.get("q") ?? "";
    if (s !== "OPEN") u.set("show", s); if (qq) u.set("q", qq);
    router.replace(`/avl/invoices${u.size ? `?${u}` : ""}`);
  };
  const d = useOps<InvoicesPage>(`/invoices?show=${show}&q=${encodeURIComponent(sp.get("q") ?? "")}`);
  if (!d.data) return <><PageHeader crumb="AVL" title="Invoices" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { counts, aging } = d.data;
  return (
    <div className="space-y-5">
      <PageHeader crumb="AVL" title="Invoices" description="What clients owe and how late it is. Invoices are made from a job’s Invoicing tab." />
      <KpiRow items={[
        { value: money0(aging.totalCents), label: "Owed to you", tone: "accent" },
        { value: money0(aging.totalCents - aging.currentCents), label: `Past due · ${counts.OVERDUE} invoice${counts.OVERDUE === 1 ? "" : "s"}`, tone: aging.totalCents - aging.currentCents > 0 ? "bad" : "ok" },
        { value: money0(d.data.collectedThisMonthCents), label: "Collected this month", tone: "ok" },
        { value: String(counts.DRAFT), label: "Drafts to send", tone: counts.DRAFT ? "warn" : undefined },
      ]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={show} onChange={(s) => go({ show: s })} items={[
          { key: "OPEN", label: "Owed", count: counts.OPEN }, { key: "OVERDUE", label: "Overdue", count: counts.OVERDUE }, { key: "DRAFT", label: "Drafts", count: counts.DRAFT },
          { key: "PAID", label: "Paid", count: counts.PAID }, { key: "ALL", label: "All", count: counts.ALL },
        ]} />
        <form className="w-full sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input w-full sm:w-64" placeholder="Search number, job, client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <Card><InvoiceTable rows={d.data.invoices} empty={sp.get("q") ? "No invoices match." : show === "OPEN" ? "Nothing owed right now." : "Nothing here."} /></Card>
      {d.data.byClient.length > 0 && (
        <Card eyebrow="Aging" title="Owed by client">
          <Table min={760} head={<tr><th>Client</th><th className="text-right">Current</th><th className="text-right">1–30 days</th><th className="text-right">31–60</th><th className="text-right">61–90</th><th className="text-right">Over 90</th><th className="text-right">Total</th></tr>}>
            {d.data.byClient.map((c) => <AgingRow key={c.customer?.id ?? "none"} name={c.customer?.name ?? "No client"} a={c.aging} />)}
            <AgingRow name="All clients" a={aging} total />
          </Table>
        </Card>
      )}
    </div>
  );
}

function AgingRow({ name, a, total }: { name: string; a: AgingBuckets; total?: boolean }) {
  const cell = (v: number, late: boolean) => <td className={clsx("text-right font-mono", !v ? "text-ink-faint" : late ? "text-bad" : "")}>{v ? fmtMoney(v) : "—"}</td>;
  return (
    <tr className={clsx(total && "font-semibold")}>
      <td>{name}</td>{cell(a.currentCents, false)}{cell(a.d1to30Cents, true)}{cell(a.d31to60Cents, true)}{cell(a.d61to90Cents, true)}{cell(a.over90Cents, true)}<td className="text-right font-mono">{fmtMoney(a.totalCents)}</td>
    </tr>
  );
}

"use client";
/** AVL reports: pipeline and win rate, revenue by month, margin by job, unpaid invoices and hours by job. */
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import type { AvlReports } from "@shared/ops/invoicing";
import { fmtMoney, fmtPct, money0, useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, KpiRow, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { InvoiceTable } from "@/components/avl/billing/bits";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hours = (m: number) => `${(m / 60).toLocaleString("en-US", { maximumFractionDigits: 1 })}h`;

export default function Reports() {
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(now));
  const d = useOps<AvlReports>(`/avl/reports?from=${from}&to=${to}`);
  const r = d.data;
  const maxMonth = r ? Math.max(1, ...r.revenueByMonth.map((m) => Math.max(m.invoicedCents, m.collectedCents))) : 1;
  const maxStage = r ? Math.max(1, ...r.pipeline.map((p) => p.valueCents)) : 1;
  return (
    <div className="space-y-5">
      <PageHeader crumb="AVL" title="Reports" description="How sales, billing and jobs are going." actions={
        <div className="flex items-end gap-2">
          <Field label="From"><input type="date" className="input" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>} />
      <ErrorBox error={d.error} />
      {!r ? (!d.error && <Loading />) : <>
        <KpiRow items={[
          { value: money0(r.pipeline.reduce((s, p) => s + p.valueCents, 0)), label: `Open pipeline · ${r.pipeline.reduce((s, p) => s + p.count, 0)} leads`, tone: "accent" },
          { value: r.winRate.won + r.winRate.lost ? fmtPct(r.winRate.bps) : "—", label: `Win rate · ${r.winRate.won} won, ${r.winRate.lost} lost`, tone: "ok" },
          { value: money0(r.revenueByMonth.reduce((s, m) => s + m.collectedCents, 0)), label: "Collected, last 12 months" },
          { value: money0(r.aging.totalCents), label: `Unpaid · ${money0(r.aging.totalCents - r.aging.currentCents)} past due`, tone: r.aging.totalCents - r.aging.currentCents > 0 ? "bad" : undefined },
        ]} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card eyebrow="Sales" title="Pipeline">
            <div className="space-y-2.5 p-4">
              {r.pipeline.map((p) => (
                <div key={p.stage} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-ink-soft">{p.label}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-accent" style={{ width: `${(p.valueCents / maxStage) * 100}%` }} /></div>
                  <span className="w-28 text-right font-mono text-xs">{money0(p.valueCents)} <span className="text-ink-faint">· {p.count}</span></span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-ink-faint">Won {money0(r.winRate.wonValueCents)} between these dates. <Link href="/avl/leads/report" className="text-accent hover:underline">Where leads come from →</Link></p>
            </div>
          </Card>
          <Card eyebrow="Billing" title="Revenue by month">
            <div className="p-4">
              <div className="flex h-40 items-end gap-1.5">
                {r.revenueByMonth.map((m) => (
                  <div key={m.month} className="flex h-full flex-1 flex-col justify-end" title={`${m.month}: invoiced ${fmtMoney(m.invoicedCents)}, collected ${fmtMoney(m.collectedCents)}`}>
                    <div className="flex h-full items-end gap-[2px]">
                      <div className="flex-1 rounded-t bg-accent/40" style={{ height: `${(m.invoicedCents / maxMonth) * 100}%` }} />
                      <div className="flex-1 rounded-t bg-ok" style={{ height: `${(m.collectedCents / maxMonth) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5">{r.revenueByMonth.map((m) => <div key={m.month} className="flex-1 text-center text-[10px] text-ink-faint">{new Date(`${m.month}-15`).toLocaleDateString("en-US", { month: "narrow" })}</div>)}</div>
              <div className="mt-2 flex gap-4 text-[11px] text-ink-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent/50" />Invoiced (before tax)</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Collected</span></div>
            </div>
          </Card>
        </div>
        <Card eyebrow="Jobs" title="Margin by job">
          {!r.marginByJob.length ? <Empty>No jobs with a price yet.</Empty> : (
            <Table min={760} head={<tr><th>Job</th><th className="text-right">Price</th><th className="text-right">Cost so far</th><th className="text-right">Projected cost</th><th className="text-right">Projected margin</th></tr>}>
              {r.marginByJob.map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/avl/jobs/view?id=${j.id}&tab=costing`} className="font-medium hover:text-accent">{j.name}</Link><div className="font-mono text-[11px] text-ink-faint">{j.number}</div></td>
                  <td className="text-right font-mono">{money0(j.priceCents)}</td>
                  <td className="text-right font-mono text-ink-soft">{money0(j.actualCostCents)}</td>
                  <td className="text-right font-mono text-ink-soft">{money0(j.projectedCostCents)}</td>
                  <td className={clsx("text-right font-mono", j.marginBps < 1500 ? "text-bad" : j.marginBps < 2500 ? "text-warn" : "text-ok")}>{fmtPct(j.marginBps)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card eyebrow="Billing" title="Unpaid invoices">
          <InvoiceTable rows={r.unpaid} empty="Nothing unpaid." />
        </Card>
        <Card eyebrow="Time" title="Hours by job">
          {!r.hoursByJob.length ? <Empty>No time logged between these dates.</Empty> : (
            <Table min={640} head={<tr><th>Job</th><th className="text-right">Logged</th><th className="text-right">In the budget</th><th className="text-right">Labor cost</th></tr>}>
              {r.hoursByJob.map((h) => (
                <tr key={h.id}>
                  <td><Link href={`/avl/jobs/view?id=${h.id}&tab=time`} className="font-medium hover:text-accent">{h.name}</Link><div className="font-mono text-[11px] text-ink-faint">{h.number}</div></td>
                  <td className={clsx("text-right font-mono", h.budgetMinutes && h.minutes > h.budgetMinutes ? "text-bad" : "")}>{hours(h.minutes)}</td>
                  <td className="text-right font-mono text-ink-soft">{h.budgetMinutes ? hours(h.budgetMinutes) : "—"}</td>
                  <td className="text-right font-mono text-ink-soft">{money0(h.costCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </>}
    </div>
  );
}

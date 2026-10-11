"use client";
/** Timesheets: your hours by week (clock in, or type them in); AVL Managers see everyone's and approve them. */
import clsx from "clsx";
import { CheckCheck, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addDays, fmtHours, parseDay, toDay, type TimeEntry, type Timesheet } from "@shared/ops/projects";
import { fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Stack } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { ClockCard, TimeModal, TimeTable } from "@/components/avl/project/Time";

const monday = (d: string) => addDays(d, -((parseDay(d).getDay() + 6) % 7));

export default function TimePage() {
  const refresh = useOpsRefresh();
  const [from, setFrom] = useState(() => monday(toDay(new Date())));
  const [user, setUser] = useState("");
  const to = addDays(from, 6);
  const d = useOps<Timesheet>(`/time?from=${from}&to=${to}${user ? `&user=${user}` : ""}`);
  const [edit, setEdit] = useState<TimeEntry | "new" | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const approve = async (approved: boolean) => {
    setBusy(true);
    try { const r = await ops<{ changed: number }>("/time/approve", { json: { ids: [...sel], approved } }); toast.success(`${r.changed} entr${r.changed === 1 ? "y" : "ies"} ${approved ? "approved" : "unapproved"}`); setSel(new Set()); await d.refetch(); void refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const t = d.data;
  const people = t ? [...new Map(t.entries.map((e) => [e.user.id, e.user.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])) : [];
  const cell = (uid: string, day: string) => t!.entries.filter((e) => e.user.id === uid && e.workDate === day).reduce((s, e) => s + e.minutes, 0);
  const today = toDay(new Date());
  return (
    <>
      <PageHeader crumb="AVL" title="Time" description={t?.canApprove ? "Everyone's hours by week. Approved time is locked for the person who logged it." : "Your hours by week: clock in on site, or type them in after."}
        actions={<button className="btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Add time</button>} />
      <ErrorBox error={d.error} />
      {!t ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <ClockCard jobs={t.jobs} />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-outline p-2" onClick={() => { setFrom(addDays(from, -7)); setSel(new Set()); }} aria-label="Week before"><ChevronLeft size={15} /></button>
            <button className="btn-outline" onClick={() => { setFrom(monday(today)); setSel(new Set()); }}>This week</button>
            <button className="btn-outline p-2" onClick={() => { setFrom(addDays(from, 7)); setSel(new Set()); }} aria-label="Week after"><ChevronRight size={15} /></button>
            <span className="text-sm font-medium">Week of {parseDay(from).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
            {t.canApprove && (
              <select className="input ml-auto w-48 py-1.5" value={user} onChange={(e) => { setUser(e.target.value); setSel(new Set()); }}>
                <option value="">Everyone</option>{t.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
          <Card title="The week">
            <Stack>
              <table className="rtable w-full min-w-[720px] text-sm">
                <thead className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted [&_th]:px-3 [&_th]:py-2">
                  <tr><th className="text-left">Who</th>{days.map((x) => <th key={x} className={clsx("w-[11%] text-right", x === today && "text-accent")}>{parseDay(x).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}</th>)}<th className="w-24 text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
                  {people.map(([id, name]) => {
                    const total = days.reduce((s, x) => s + cell(id, x), 0);
                    return (
                      <tr key={id}>
                        <td className="font-medium">{name}</td>
                        {days.map((x) => { const m = cell(id, x); return <td key={x} className={clsx("text-right font-mono tabular-nums", !m && "text-ink-faint", m > 600 && "text-warn")}>{m ? fmtHours(m) : "·"}</td>; })}
                        <td className="text-right font-mono font-semibold tabular-nums">{fmtHours(total)}</td>
                      </tr>
                    );
                  })}
                  {!people.length && <tr><td colSpan={9} className="py-10 text-center text-ink-faint">No time this week.</td></tr>}
                </tbody>
              </table>
            </Stack>
          </Card>
          <Card title="Entries" action={t.canApprove && sel.size > 0 ? (
            <div className="flex gap-2">
              <button className="btn-ghost py-1.5 text-xs" disabled={busy} onClick={() => void approve(false)}>Unapprove</button>
              <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => void approve(true)}>{busy ? <Spinner /> : <CheckCheck size={13} />} Approve {sel.size}</button>
            </div>
          ) : undefined}>
            <TimeTable entries={t.entries} seesCost={t.seesCost} showPerson={t.canApprove} showJob onEdit={setEdit} onChanged={() => void d.refetch()}
              select={t.canApprove ? { ids: sel, set: setSel } : undefined} />
          </Card>
          {t.seesCost && t.entries.length > 0 && <p className="text-[11px] text-ink-faint">Labor cost this week: {fmtMoney(t.entries.reduce((s, e) => s + (e.costCents ?? 0), 0))}, at each person&apos;s hourly cost.</p>}
        </div>
      )}
      {edit && t && <TimeModal entry={edit === "new" ? null : edit} jobs={t.jobs} people={t.canApprove ? t.people : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void d.refetch(); }} />}
    </>
  );
}

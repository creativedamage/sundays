"use client";
/** Time: clocking in and out, typing hours in, the job's time and a timesheet. */
import clsx from "clsx";
import { Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import { fmtHours, parseHours, runningMinutes, toDay, type TimeEntry } from "@shared/ops/projects";
import { fmtMoney, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Card, Empty, ErrorBox, Field, KpiRow, Loading, Pill, Stack } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { fmtDay } from "./Gantt";
import type { P } from "./bits";

export interface JobChoice { id: string; number: string; name: string; phases: { id: string; name: string }[] }

/* ───────────── The job's Time tab ───────────── */

export function JobTime({ page }: { page: JobPage }) {
  const d = useOps<TimeEntry[]>(`/jobs/${page.job.id}/time`);
  const me = useOpsUser();
  const [edit, setEdit] = useState<TimeEntry | "new" | null>(null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const crew = page.crewView;
  const total = d.data.reduce((s, t) => s + t.minutes, 0);
  const cost = d.data.reduce((s, t) => s + (t.costCents ?? 0), 0);
  const budget = page.project.budgetedLaborMinutes;
  const byPerson = [...d.data.reduce((m, t) => m.set(t.user.id, { name: t.user.name, minutes: (m.get(t.user.id)?.minutes ?? 0) + t.minutes, cost: (m.get(t.user.id)?.cost ?? 0) + (t.costCents ?? 0) }), new Map<string, { name: string; minutes: number; cost: number }>()).values()].sort((a, b) => b.minutes - a.minutes);
  const job: JobChoice = { id: page.job.id, number: page.job.number, name: page.job.name, phases: page.project.phases.map((p) => ({ id: p.id, name: p.name })) };
  return (
    <div className="space-y-4">
      <ClockCard jobs={[job]} compact />
      {!crew && (
        <KpiRow items={[
          { value: fmtHours(total), label: "Logged on this job" },
          { value: budget != null ? fmtHours(budget) : "—", label: "Labor hours in the budget" },
          { value: budget != null ? fmtHours(Math.abs(budget - total)) : "—", label: budget != null && total > budget ? "Over the budgeted hours" : "Hours left in the budget", tone: budget != null && total > budget ? "bad" : undefined },
          { value: money0(cost), label: "Labor cost so far" },
        ]} />
      )}
      <Card title={crew ? "Your time on this job" : "Time"} action={<button className="btn-primary py-1.5 text-xs" onClick={() => setEdit("new")}><Plus size={13} /> Add time</button>}>
        <TimeTable entries={d.data} seesCost={!crew} showPerson={!crew} onEdit={setEdit} onChanged={() => void d.refetch()} />
      </Card>
      {!crew && byPerson.length > 1 && (
        <Card eyebrow="Time" title="By person">
          <ul className="divide-y divide-line">{byPerson.map((p) => (
            <li key={p.name} className="flex items-center gap-3 px-4 py-2 text-sm"><span className="flex-1">{p.name}</span><span className="font-mono tabular-nums">{fmtHours(p.minutes)}</span><span className="w-24 text-right font-mono tabular-nums text-ink-soft">{fmtMoney(p.cost)}</span></li>
          ))}</ul>
        </Card>
      )}
      {!crew && <p className="text-[11px] text-ink-faint">Cost uses each person&apos;s hourly cost (AVL → People). Labor hours in the budget are its labor lines priced by the hour.</p>}
      {edit && <TimeModal entry={edit === "new" ? null : edit} jobs={[job]} people={me.nav.avlManager ? page.assignable : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void d.refetch(); }} />}
    </div>
  );
}

export function TimeTable({ entries, seesCost, showPerson, showJob, onEdit, onChanged, select }: {
  entries: TimeEntry[]; seesCost: boolean; showPerson?: boolean; showJob?: boolean; onEdit: (t: TimeEntry) => void; onChanged: () => void;
  select?: { ids: Set<string>; set: (s: Set<string>) => void };
}) {
  const refresh = useOpsRefresh();
  const del = async (t: TimeEntry) => {
    if (!window.confirm(`Delete ${fmtHours(t.minutes)} on ${fmtDay(t.workDate)}?`)) return;
    try { await ops(`/time/${t.id}`, { method: "DELETE" }); onChanged(); void refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  if (!entries.length) return <Empty>No time logged yet.</Empty>;
  const pickable = entries.filter((t) => !t.running);
  return (
    <Stack>
      <table className="rtable w-full min-w-[640px] text-sm">
        <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2">
          <tr>
            {select && <th className="w-8"><input type="checkbox" checked={pickable.length > 0 && pickable.every((t) => select.ids.has(t.id))} onChange={(e) => select.set(new Set(e.target.checked ? pickable.map((t) => t.id) : []))} aria-label="Select all" /></th>}
            <th className="w-28">Day</th>{showPerson && <th>Who</th>}{showJob && <th>Job</th>}<th>Phase · note</th><th className="w-24 text-right">Hours</th>{seesCost && <th className="w-24 text-right">Cost</th>}<th className="w-24" /><th className="w-16" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
          {entries.map((t) => (
            <tr key={t.id} className={clsx(t.running && "bg-ok/[0.06]")}>
              {select && <td>{!t.running && <input type="checkbox" checked={select.ids.has(t.id)} onChange={(e) => { const n = new Set(select.ids); e.target.checked ? n.add(t.id) : n.delete(t.id); select.set(n); }} aria-label="Select" />}</td>}
              <td className="whitespace-nowrap text-ink-soft">{fmtDay(t.workDate)}</td>
              {showPerson && <td className="font-medium">{t.user.name}</td>}
              {showJob && <td className="max-w-[220px] truncate">{t.job ? <a href={`/avl/jobs/view?id=${t.job.id}&tab=time`} className="hover:text-accent">{t.job.number} · {t.job.name}</a> : "—"}</td>}
              <td className="max-w-[280px] truncate text-ink-soft">{[t.phaseName, t.note].filter(Boolean).join(" · ") || "—"}</td>
              <td className="text-right font-mono tabular-nums">{t.running ? <span className="text-ok">{fmtHours(runningMinutes(t.startedAt!))} ●</span> : fmtHours(t.minutes)}</td>
              {seesCost && <td className="text-right font-mono tabular-nums text-ink-soft">{t.costCents != null && !t.running ? fmtMoney(t.costCents) : "—"}</td>}
              <td>{t.running ? <Pill tone="ok">Clocked in</Pill> : t.approvedAt ? <span title={`Approved by ${t.approvedBy ?? "a manager"}`}><Pill tone="ok">Approved</Pill></span> : null}</td>
              <td className="text-right">{t.canEdit && !t.running && (
                <span className="flex justify-end">
                  <button className="p-1 text-ink-faint hover:text-ink" onClick={() => onEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                  <button className="p-1 text-bad/70 hover:text-bad" onClick={() => void del(t)} aria-label="Delete"><Trash2 size={13} /></button>
                </span>
              )}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold [&_td]:px-3 [&_td]:py-2">
            {select && <td />}<td colSpan={1 + (showPerson ? 1 : 0) + (showJob ? 1 : 0) + 1}>Total</td>
            <td className="text-right font-mono tabular-nums">{fmtHours(entries.reduce((s, t) => s + t.minutes, 0))}</td>
            {seesCost && <td className="text-right font-mono tabular-nums">{fmtMoney(entries.reduce((s, t) => s + (t.costCents ?? 0), 0))}</td>}
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </Stack>
  );
}

/** Add or change time. `people` (managers only) lets them log it for someone else. */
export function TimeModal({ entry, jobs, people, onClose, onSaved }: { entry: TimeEntry | null; jobs: JobChoice[]; people: P[] | null; onClose: () => void; onSaved: () => void }) {
  const refresh = useOpsRefresh();
  const me = useOpsUser();
  const [f, setF] = useState({
    jobId: entry?.jobId ?? (jobs.length === 1 ? jobs[0].id : ""), phaseId: entry?.phaseId ?? "", workDate: entry?.workDate ?? toDay(new Date()),
    hours: entry ? fmtHours(entry.minutes) : "", note: entry?.note ?? "", userId: entry?.user.id ?? me.user.id,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const job = jobs.find((j) => j.id === f.jobId);
  const minutes = parseHours(f.hours);
  return (
    <Modal open onClose={onClose} title={entry ? "Edit time" : "Add time"} width={520}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault();
        if (!minutes) { setError("Enter the hours, like 2.5 or 2:30."); return; }
        setBusy(true); setError(null);
        try {
          await ops(entry ? `/time/${entry.id}` : "/time", { method: entry ? "PUT" : "POST", json: { jobId: f.jobId, phaseId: f.phaseId || null, workDate: f.workDate, minutes, note: f.note || null, userId: people ? f.userId : null } });
          toast.success("Time saved"); void refresh(); onSaved();
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        {people && !entry && <Field label="Who"><select className="input" value={f.userId} onChange={(e) => set({ userId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me.user.id ? " (you)" : ""}</option>)}</select></Field>}
        {jobs.length > 1 && <Field label="Job"><select required className="input" value={f.jobId} onChange={(e) => set({ jobId: e.target.value, phaseId: "" })}><option value="">Pick a job</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}</select></Field>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Day"><input type="date" required className="input" value={f.workDate} onChange={(e) => set({ workDate: e.target.value })} /></Field>
          <Field label="Hours" hint={minutes ? fmtHours(minutes) : "2.5, 2:30 or 2h 30m"}><input required autoFocus className="input" value={f.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="8" /></Field>
          <Field label="Phase"><select className="input" value={f.phaseId} onChange={(e) => set({ phaseId: e.target.value })}><option value="">—</option>{job?.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <Field label="Note"><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="What you worked on" /></Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Clock in / out ───────────── */

/** Clock in on a job (and phase) and out again; shows the running time. */
export function ClockCard({ jobs, compact }: { jobs: JobChoice[]; compact?: boolean }) {
  const refresh = useOpsRefresh();
  const d = useOps<{ clock: TimeEntry | null }>("/time/clock", { refetchInterval: 60_000 });
  const [pick, setPick] = useState({ jobId: jobs.length === 1 ? jobs[0].id : "", phaseId: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const clock = d.data?.clock ?? null;
  const go = async (path: string, json: unknown, msg: string) => {
    setBusy(true);
    try { await ops(path, { json }); toast.success(msg); setNote(""); await d.refetch(); void refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const job = jobs.find((j) => j.id === pick.jobId);
  if (!d.data) return null;
  if (clock) {
    const elsewhere = compact && jobs.length === 1 && clock.jobId !== jobs[0].id;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/40 bg-ok-soft px-4 py-3">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Clocked in · {fmtHours(runningMinutes(clock.startedAt!))}</div>
          <div className="truncate text-xs text-ink-muted">{clock.job?.number} · {clock.job?.name}{clock.phaseName ? ` · ${clock.phaseName}` : ""}{elsewhere ? " (another job)" : ""}</div>
        </div>
        <input className="input w-full py-1.5 text-sm sm:w-56" placeholder="What did you do? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary bg-bad hover:bg-bad/90" disabled={busy} onClick={() => void go("/time/clock-out", { note: note || null }, "Clocked out")}>{busy ? <Spinner /> : <Square size={13} />} Clock out</button>
      </div>
    );
  }
  return (
    <div className={clsx("flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3", compact && "py-2.5")}>
      <span className="mr-1 text-sm font-medium">{compact ? "On site now?" : "Clock in"}</span>
      {jobs.length > 1 && (
        <select className="input w-56 py-1.5 text-sm" value={pick.jobId} onChange={(e) => setPick({ jobId: e.target.value, phaseId: "" })}>
          <option value="">Pick a job…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}
        </select>
      )}
      {job && job.phases.length > 0 && (
        <select className="input w-40 py-1.5 text-sm" value={pick.phaseId} onChange={(e) => setPick({ ...pick, phaseId: e.target.value })}>
          <option value="">Any phase</option>{job.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <button className="btn-primary ml-auto" disabled={busy || !pick.jobId} onClick={() => void go("/time/clock-in", { jobId: pick.jobId, phaseId: pick.phaseId || null, workDate: toDay(new Date()) }, "Clocked in")}>{busy ? <Spinner /> : <Play size={13} />} Clock in</button>
      {!jobs.length && <span className="text-xs text-ink-faint">No open jobs to clock in on.</span>}
    </div>
  );
}


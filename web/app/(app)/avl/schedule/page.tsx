"use client";
/** Every job's phases on one calendar: by job (what's happening where) or by person (who is where, which day). */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { addDays, parseDay, toDay, type SchedulePage } from "@shared/ops/projects";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Tabs } from "@/components/ops/OpsUi";
import { Gantt, type GanttBar, type GanttRow } from "@/components/avl/project/Gantt";
import { TaskList } from "@/components/avl/project/JobTasks";
import { Initials } from "@/components/avl/project/bits";

type Span = "2w" | "month" | "quarter";
const SPAN: Record<Span, { days: number; width: number; step: number }> = { "2w": { days: 14, width: 40, step: 7 }, month: { days: 35, width: 24, step: 28 }, quarter: { days: 91, width: 11, step: 28 } };
const monday = (d: string) => addDays(d, -((parseDay(d).getDay() + 6) % 7));

export default function Schedule() {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [span, setSpan] = useState<Span>("month");
  // Two weeks fit across a phone without scrolling.
  useEffect(() => { if (window.matchMedia("(max-width: 639.98px)").matches) setSpan("2w"); }, []);
  const [from, setFrom] = useState(() => monday(toDay(new Date())));
  const [by, setBy] = useState<"job" | "person">("job");
  const to = addDays(from, SPAN[span].days - 1);
  const d = useOps<SchedulePage>(`/schedule?from=${from}&to=${to}`);
  const move = async (phaseId: string, s: string, e: string) => {
    try { await ops(`/phases/${phaseId}/dates`, { method: "PUT", json: { startDate: s, endDate: e } }); toast.success("Phase moved"); await d.refetch(); void refresh(); }
    catch (err) { toast.error((err as Error).message); }
  };

  let rows: GanttRow[] = [], bars: GanttBar[] = [];
  if (d.data) {
    const items = d.data.items;
    if (by === "job") {
      const jobs = [...new Map(items.map((i) => [i.job.id, i.job])).values()];
      rows = jobs.map((j) => ({ id: j.id, label: j.name, sub: [j.number, j.city].filter(Boolean).join(" · ") }));
      bars = items.map((i) => ({ id: i.phase.id, rowId: i.job.id, start: i.phase.startDate!, end: i.phase.endDate ?? i.phase.startDate!, label: i.phase.name, color: i.phase.color, done: i.phase.status === "DONE" }));
    } else {
      const names = new Map(d.data.people.map((p) => [p.id, p.name]));
      const ids = [...new Set(items.flatMap((i) => i.phase.people))].filter((id) => names.has(id)).sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
      rows = ids.map((id) => ({ id, label: <span className="flex items-center gap-2"><Initials p={{ id, name: names.get(id)! }} size={20} />{names.get(id)}</span> }));
      bars = items.flatMap((i) => i.phase.people.filter((id) => names.has(id)).map((id) => ({
        id: `${i.phase.id}:${id}`, rowId: id, start: i.phase.startDate!, end: i.phase.endDate ?? i.phase.startDate!, label: `${i.job.number} · ${i.phase.name}`, color: i.phase.color,
        done: i.phase.status === "DONE", title: `${i.job.name}: ${i.phase.name}`, editable: false,
      })));
      const nobody = items.filter((i) => !i.phase.people.some((id) => names.has(id)));
      if (nobody.length) {
        rows.push({ id: "_nobody", label: <span className="text-ink-muted">Nobody assigned</span> });
        bars.push(...nobody.map((i) => ({ id: `${i.phase.id}:_`, rowId: "_nobody", start: i.phase.startDate!, end: i.phase.endDate ?? i.phase.startDate!, label: `${i.job.number} · ${i.phase.name}`, color: i.phase.color, done: i.phase.status === "DONE", editable: false })));
      }
    }
  }
  const jobOf = (barId: string) => d.data?.items.find((i) => i.phase.id === barId.split(":")[0])?.job.id;
  const title = `${parseDay(from).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${parseDay(to).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <>
      <PageHeader crumb="AVL" title="Schedule" description="Every job's phases on one calendar. Drag a bar to move it; open a job to plan its phases and people." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-outline p-2" onClick={() => setFrom(addDays(from, -SPAN[span].step))} aria-label="Earlier"><ChevronLeft size={15} /></button>
          <button className="btn-outline" onClick={() => setFrom(monday(toDay(new Date())))}>Today</button>
          <button className="btn-outline p-2" onClick={() => setFrom(addDays(from, SPAN[span].step))} aria-label="Later"><ChevronRight size={15} /></button>
        </div>
        <span className="text-sm font-medium">{title}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Tabs value={by} onChange={setBy} items={[{ key: "job", label: "By job" }, { key: "person", label: "By person" }]} />
          <Tabs value={span} onChange={setSpan} items={[{ key: "2w", label: "2 weeks" }, { key: "month", label: "5 weeks" }, { key: "quarter", label: "Quarter" }]} />
        </div>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <Card>
            <Gantt from={from} to={to} rows={rows} bars={bars} dayWidth={SPAN[span].width} labelWidth={by === "job" ? 230 : 190}
              onChange={d.data.canEdit && by === "job" ? (id, s, e) => void move(id, s, e) : undefined}
              onBarClick={(id) => { const j = jobOf(id); if (j) router.push(`/avl/jobs/view?id=${j}&tab=schedule`); }}
              empty={by === "job" ? "Nothing scheduled in these dates. Plan a job's phases on its Schedule tab." : "Nobody is on a phase in these dates."} />
          </Card>
          {d.data.tasks.length > 0 && (
            <Card eyebrow="Tasks" title="Due in these dates">
              <TaskList tasks={d.data.tasks} showJob onChanged={() => void d.refetch()} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}

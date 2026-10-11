"use client";
/**
 * One job: its dashboard (what it's worth and where it stands), its budget (cost groups and cost
 * items, edited like a spreadsheet), its schedule, tasks, daily logs, files and time, and its
 * documents (the signed proposal it came from). AVL Crew see the job without any money.
 */
import { ActivityFeed } from "@/components/avl/ActivityFeed";
import { KitPicker } from "@/components/avl/KitPicker";
import type { KitLine, KitRow } from "@shared/ops/estimating";
import clsx from "clsx";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, FileSignature, FolderPlus, Package, Pencil, Plus, Printer, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { budgetRows, budgetTotals, COST_TYPES, itemMoney, JOB_STATUSES, type BudgetItem, type CostType, type JobDetail, type JobPage, type JobStatus } from "@shared/ops/jobs";
import { priceForMargin } from "@shared/ops/math";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, money0, ops, useOps, useOpsMe, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, JobStatusBadge, KpiRow, Loading, MoneyInput, PercentInput, QuoteStatusBadge, Stack, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import type { QuoteStatus } from "@shared/ops/state-machine";
import { fmtHours, phaseOn, PHASE_STATUSES, toDay } from "@shared/ops/projects";
import { JobSchedule } from "@/components/avl/project/JobSchedule";
import { JobTasks } from "@/components/avl/project/JobTasks";
import { JobLogs } from "@/components/avl/project/JobLogs";
import { JobFiles } from "@/components/avl/project/JobFiles";
import { JobTime } from "@/components/avl/project/Time";
import { fmtRange, phaseHex } from "@/components/avl/project/Gantt";
import { Faces } from "@/components/avl/project/bits";
import { JobChangesTab, JobCostingTab, JobPurchasingTab } from "@/components/avl/purchasing/JobTabs";

export default function Page() { return <Suspense><JobView /></Suspense>; }

type Tab = "dashboard" | "budget" | "costing" | "profit" | "purchasing" | "changes" | "schedule" | "tasks" | "logs" | "files" | "time" | "documents";
const TABS: Tab[] = ["dashboard", "budget", "costing", "profit", "purchasing", "changes", "schedule", "tasks", "logs", "files", "time", "documents"];

function JobView() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id") ?? "";
  const want = (TABS.includes(sp.get("tab") as Tab) ? sp.get("tab") : "dashboard") as Tab;
  const d = useOps<JobPage>(id ? `/jobs/${id}` : null);
  const [editing, setEditing] = useState(false);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { job, businessType, crewView } = d.data;
  const church = businessType === "CHURCH";
  const tabs: [Tab, string][] = [
    ["dashboard", crewView ? "Overview" : "Dashboard"],
    ...(crewView ? [] : [["budget", "Budget"], ["costing", "Job costing"]] as [Tab, string][]),
    ...(crewView || church ? [] : [["profit", "Profit"]] as [Tab, string][]),
    ...(crewView ? [] : [["purchasing", "Purchasing"]] as [Tab, string][]),
    ...(crewView || church ? [] : [["changes", "Change orders"]] as [Tab, string][]),
    ["schedule", "Schedule"], ["tasks", "Tasks"], ["logs", "Daily logs"], ["files", "Files"], ["time", "Time"],
    ...(crewView ? [] : [["documents", "Documents"]] as [Tab, string][]),
  ];
  const tab = tabs.some(([k]) => k === want) ? want : "dashboard";
  const where = [job.customer?.name, job.siteLine1].filter(Boolean).join(" / ");
  const setTab = (t: Tab) => router.replace(`/avl/jobs/view?id=${id}${t === "dashboard" ? "" : `&tab=${t}`}`);

  return (
    <div className="space-y-4">
      <Link href="/avl/jobs" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> {crewView ? "My jobs" : "Jobs"}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {where && <div className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{where}</div>}
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{job.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="font-mono">{job.number}</span><JobStatusBadge status={job.status} />
            {job.quote && !crewView && <Link href={`/avl/quotes/view?id=${job.quote.id}`} className="hover:text-accent">from {job.quote.number}</Link>}
          </div>
        </div>
        {!crewView && <button className="btn-outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit job</button>}
      </div>
      <select className="input w-full sm:hidden" value={tab} onChange={(e) => setTab(e.target.value as typeof tab)} aria-label="Section">
        {tabs.map(([k, label]) => <option key={k} value={k}>{label}{k === "tasks" && d.data!.project.openTasks > 0 ? ` (${d.data!.project.openTasks} open)` : ""}</option>)}
      </select>
      <div className="-mx-1 hidden gap-1 overflow-x-auto border-b border-line px-1 sm:flex">
        {tabs.map(([k, label]) => (
          <button key={k} ref={k === tab ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined} onClick={() => setTab(k)} className={clsx("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition", tab === k ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink")}>
            {label}{k === "tasks" && d.data!.project.openTasks > 0 && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[10px] tabular-nums text-accent">{d.data!.project.openTasks}</span>}
          </button>
        ))}
      </div>
      {tab === "dashboard" && (crewView ? <CrewOverview page={d.data} onTab={setTab} /> : <Dashboard page={d.data} church={church} onTab={setTab} />)}
      {tab === "schedule" && <JobSchedule page={d.data} onSaved={() => void d.refetch()} />}
      {tab === "tasks" && <JobTasks page={d.data} />}
      {tab === "logs" && <JobLogs page={d.data} />}
      {tab === "files" && <JobFiles page={d.data} church={church} />}
      {tab === "time" && <JobTime page={d.data} />}
      {tab === "budget" && <Budget key={job.id} page={d.data} church={church} onSaved={() => void d.refetch()} />}
      {tab === "profit" && <Profit page={d.data} />}
      {tab === "costing" && <JobCostingTab page={d.data} church={church} />}
      {tab === "purchasing" && <JobPurchasingTab page={d.data} />}
      {tab === "changes" && <JobChangesTab page={d.data} />}
      {tab === "documents" && <Documents page={d.data} />}
      {editing && <EditJob page={d.data} church={church} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void d.refetch(); }} />}
    </div>
  );
}

/* ───────────── Dashboard ───────────── */

function Dashboard({ page, church, onTab }: { page: JobPage; church: boolean; onTab: (t: Tab) => void }) {
  const { job, documents } = page;
  const totals = budgetTotals(page.budget).total;
  const proposal = documents.find((x) => x.kind === "PROPOSAL");
  const money: [string, string, string?][] = church
    ? [["Budget", fmtMoney(totals.costCents)], ["Cost groups", String(page.budget.filter((b) => b.kind === "GROUP").length)], ["Cost items", String(page.budget.filter((b) => b.kind === "ITEM").length)]]
    : [
        ["Approved price", fmtMoney(totals.priceCents)],
        ["Budgeted cost", fmtMoney(totals.costCents)],
        ["Projected profit", fmtMoney(totals.profitCents), totals.profitCents < 0 ? "text-[#ff8a8a]" : undefined],
        ["Projected margin", fmtPct(totals.marginBps), totals.marginBps < 1500 ? "text-[#ffb35c]" : undefined],
      ];
  const facts: [string, React.ReactNode][] = [
    ["Status", <JobStatusBadge key="s" status={job.status} />],
    ...(!church ? [["Client", job.customer ? <Link key="c" href={`/avl/clients/view?id=${job.customer.id}`} className="hover:text-accent">{job.customer.name}</Link> : "—"] as [string, React.ReactNode]] : []),
    ["Project manager", job.manager?.name ?? "—"],
    ["Starts", job.startDate ? fmtDate(job.startDate + "T12:00") : "—"],
    ["Ends", job.endDate ? fmtDate(job.endDate + "T12:00") : "—"],
    [church ? "Where" : "Site", [job.siteLine1, job.siteLine2, [job.siteCity, job.siteState, job.sitePostalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ") || "—"],
    ["Created", `${fmtDate(job.createdAt)}${job.createdBy ? ` by ${job.createdBy}` : ""}`],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl bg-[#1f2533] text-white shadow-sm">
          {money.map(([k, v, cls]) => (
            <div key={k} className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 last:border-0">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{k}</span>
              <span className={clsx("font-mono text-[15px] font-semibold tabular-nums", cls)}>{v}</span>
            </div>
          ))}
        </div>
        <div className="panel divide-y divide-line">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-ink-muted">{k}</span><span className="text-right">{v}</span></div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {proposal && (
          <div className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="label">Proposal</div>
                <Link href={`/avl/quotes/view?id=${proposal.id}`} className="text-[15px] font-semibold hover:text-accent">{proposal.number} · {proposal.title}</Link>
              </div>
              <QuoteStatusBadge status={proposal.status as QuoteStatus} />
            </div>
            {proposal.signature ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-ink-soft"><FileSignature size={15} className="mt-0.5 shrink-0 text-ok" />
                <span>Signed by <b>{proposal.signature.signerName}</b>{proposal.signature.signerTitle ? `, ${proposal.signature.signerTitle}` : ""} on {fmtDateTime(proposal.signature.signedAt)} for {fmtMoney(proposal.signature.totalCents)}</span>
              </p>
            ) : <p className="mt-2 text-sm text-ink-muted">Accepted without an online signature.</p>}
          </div>
        )}
        <ScheduleSummary page={page} onTab={onTab} />
        <div className="panel p-4">
          <div className="flex items-center justify-between"><div className="label">Budget by group</div><button className="text-xs text-accent hover:underline" onClick={() => onTab("budget")}>Open the budget →</button></div>
          <GroupBars items={page.budget} church={church} />
        </div>
        {job.notes && <div className="panel whitespace-pre-wrap p-4 text-sm text-ink-soft"><div className="label mb-1">Notes</div>{job.notes}</div>}
        <ActivityFeed target={{ jobId: job.id }} people={page.people} title="Notes & follow-ups" eyebrow="Activity" compact />
      </div>
    </div>
  );
}

/** Where the job stands on its schedule: the phase it's in, what's next, the crew, tasks and hours. */
function ScheduleSummary({ page, onTab }: { page: JobPage; onTab: (t: Tab) => void }) {
  const { phases, crew, openTasks, loggedMinutes } = page.project;
  const today = toDay(new Date());
  const now = phases.filter((p) => phaseOn(p, today));
  const next = phases.filter((p) => p.startDate && p.startDate > today).sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0];
  const done = phases.filter((p) => p.status === "DONE").length;
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between"><div className="label">Schedule</div><button className="text-xs text-accent hover:underline" onClick={() => onTab("schedule")}>{phases.length ? "Open the schedule →" : "Plan the schedule →"}</button></div>
      {phases.length ? (
        <>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-hover">
            {phases.map((p) => <div key={p.id} title={`${p.name}: ${PHASE_STATUSES.find((s) => s.id === p.status)?.label}`} className="h-full border-r border-surface last:border-0" style={{ flex: 1, background: p.status === "NOT_STARTED" ? "transparent" : phaseHex(p.color), opacity: p.status === "IN_PROGRESS" ? 0.55 : 1 }} />)}
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">{done} of {phases.length} phase{phases.length === 1 ? "" : "s"} done</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {now.map((p) => <li key={p.id} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: phaseHex(p.color) }} /><b>{p.name}</b><span className="text-ink-muted">now · {fmtRange(p.startDate, p.endDate)}</span></li>)}
            {next && <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: phaseHex(next.color) }} /><span>{next.name}</span><span className="text-ink-muted">next · {fmtRange(next.startDate, next.endDate)}</span></li>}
            {!now.length && !next && <li className="text-ink-muted">{done === phases.length ? "Every phase is done." : "No phase on today."}</li>}
          </ul>
        </>
      ) : <p className="mt-2 text-sm text-ink-faint">No phases yet.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-sm">
        <span className="flex items-center gap-2"><Faces people={crew} max={5} /></span>
        <button className="text-ink-soft hover:text-accent" onClick={() => onTab("tasks")}>{openTasks} open task{openTasks === 1 ? "" : "s"}</button>
        <button className="text-ink-soft hover:text-accent" onClick={() => onTab("time")}>{fmtHours(loggedMinutes)} logged</button>
      </div>
    </div>
  );
}

/** What crew see first: where and when, what's on now, and the job's notes (no money). */
function CrewOverview({ page, onTab }: { page: JobPage; onTab: (t: Tab) => void }) {
  const { job } = page;
  const facts: [string, React.ReactNode][] = [
    ["Status", <JobStatusBadge key="s" status={job.status} />],
    ...(job.customer ? [["Client", job.customer.name] as [string, React.ReactNode]] : []),
    ["Project manager", job.manager?.name ?? "—"],
    ["Dates", job.startDate ? fmtRange(job.startDate, job.endDate) : "—"],
    ["Site", [job.siteLine1, job.siteLine2, [job.siteCity, job.siteState, job.sitePostalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ") || "—"],
  ];
  const address = [job.siteLine1, job.siteCity, job.siteState, job.sitePostalCode].filter(Boolean).join(", ");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="panel divide-y divide-line">
          {facts.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-ink-muted">{k}</span><span className="text-right">{v}</span></div>)}
        </div>
        {address && <a className="btn-outline w-full justify-center" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}>Directions to the site</a>}
      </div>
      <div className="space-y-4">
        <ScheduleSummary page={page} onTab={onTab} />
        {job.notes && <div className="panel whitespace-pre-wrap p-4 text-sm text-ink-soft"><div className="label mb-1">Notes</div>{job.notes}</div>}
      </div>
    </div>
  );
}

/** Each top-level cost group's share of the job. */
function GroupBars({ items, church }: { items: BudgetItem[]; church: boolean }) {
  const { byId, total } = budgetTotals(items);
  const groups = items.filter((i) => i.kind === "GROUP" && !i.parentId).map((g) => ({ g, m: byId.get(g.id)! })).filter((x) => (church ? x.m.costCents : x.m.priceCents) !== 0);
  const whole = church ? total.costCents : total.priceCents;
  if (!groups.length) return <p className="mt-3 text-sm text-ink-faint">Nothing in the budget yet.</p>;
  return (
    <div className="mt-3 space-y-2.5">
      {groups.map(({ g, m }) => {
        const v = church ? m.costCents : m.priceCents;
        return (
          <div key={g.id}>
            <div className="flex justify-between text-sm"><span>{g.name}</span><span className="font-mono tabular-nums text-ink-soft">{fmtMoney(v)}{!church && <span className="ml-2 text-xs text-ink-faint">{fmtPct(m.marginBps)}</span>}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-accent" style={{ width: `${whole > 0 ? Math.max(1, (v / whole) * 100) : 0}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Budget ───────────── */

const uid = () => `new-${Math.random().toString(36).slice(2, 10)}`;
const blankItem = (parentId: string | null, i: number): BudgetItem => ({
  id: uid(), parentId, kind: "ITEM", name: "New cost item", description: null, costType: "MATERIAL", quantity: 1, unit: "ea",
  unitCostCents: 0, unitPriceCents: 0, taxable: true, productId: null, quoteItemId: null, sortOrder: i,
});

function Budget({ page, church, onSaved }: { page: JobPage; church: boolean; onSaved: () => void }) {
  const refresh = useOpsRefresh();
  const [items, setItems] = useState<BudgetItem[]>(page.budget);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const kits = useOps<KitRow[]>(kitOpen ? "/kits" : null);
  /** A kit as a cost group of its own: its products as materials, its labor as labor. */
  const addKit = (kit: KitRow, kl: KitLine[]) => {
    const gid = uid();
    const group: BudgetItem = { ...blankItem(null, items.length), id: gid, kind: "GROUP", name: kit.name, costType: "OTHER", quantity: 0, unit: null };
    const lines: BudgetItem[] = kl.map((l, i) => ({ ...blankItem(gid, items.length + i + 1), name: l.name, description: l.description, costType: l.labor ? "LABOR" : "MATERIAL", quantity: l.quantity,
      unit: l.labor ? "hr" : "ea", unitCostCents: l.unitCostCents, unitPriceCents: l.unitPriceCents, taxable: l.taxable, productId: l.productId }));
    change([...items, group, ...lines]);
    toast.success(`${kit.name} added to the budget`);
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: BudgetItem[]) => { setItems(next.map((x, i) => ({ ...x, sortOrder: i }))); setDirty(true); };
  const patch = (id: string, p: Partial<BudgetItem>) => change(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const rows = budgetRows(items);
  const { byId, total } = budgetTotals(items);
  const hidden = (it: BudgetItem): boolean => {
    for (let p = it.parentId; p; p = items.find((x) => x.id === p)?.parentId ?? null) if (closed.has(p)) return true;
    return false;
  };
  /** Insert after the last row that's inside `parentId` (or at the end). */
  const insertInto = (parentId: string | null, item: BudgetItem) => {
    const inside = (x: BudgetItem): boolean => { for (let p: string | null = x.parentId; p; p = items.find((y) => y.id === p)?.parentId ?? null) if (p === parentId) return true; return false; };
    let at = items.length;
    if (parentId) { const idx = items.map((x, i) => (x.id === parentId || inside(x) ? i : -1)).filter((i) => i >= 0); at = Math.max(...idx) + 1; }
    const next = [...items]; next.splice(at, 0, item); change(next);
    setClosed((c) => { const n = new Set(c); if (parentId) n.delete(parentId); return n; });
    setFocus(item.id);
  };
  const addItem = (parentId: string | null) => insertInto(parentId, blankItem(parentId, items.length));
  const addGroup = () => insertInto(null, { ...blankItem(null, items.length), kind: "GROUP", name: "New cost group", costType: "OTHER", quantity: 0, unit: null });
  const remove = (id: string) => {
    const gone = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const x of items) if (x.parentId && gone.has(x.parentId) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
    const it = items.find((x) => x.id === id);
    if (it?.kind === "GROUP" && gone.size > 1 && !window.confirm(`Remove “${it.name}” and the ${gone.size - 1} lines in it?`)) return;
    change(items.filter((x) => !gone.has(x.id)));
  };
  const move = (id: string, dir: -1 | 1) => {
    const it = items.find((x) => x.id === id)!;
    const sibs = items.filter((x) => x.parentId === it.parentId);
    const j = sibs.findIndex((x) => x.id === id) + dir;
    if (j < 0 || j >= sibs.length) return;
    const other = sibs[j];
    // Swap the two blocks (a group moves with everything in it).
    const block = (root: BudgetItem) => rows.filter((r) => r.item.id === root.id || (() => { for (let p = r.item.parentId; p; p = items.find((y) => y.id === p)?.parentId ?? null) if (p === root.id) return true; return false; })()).map((r) => r.item);
    const a = block(dir < 0 ? other : it), b = block(dir < 0 ? it : other);
    const order = rows.map((r) => r.item);
    const start = order.indexOf(a[0]);
    const next = [...order.slice(0, start), ...b, ...a, ...order.slice(start + a.length + b.length)];
    change(next);
  };

  async function save() {
    setSaving(true); setError(null);
    try {
      const out = await ops<{ budget: BudgetItem[] }>(`/jobs/${page.job.id}/budget`, { method: "PUT", json: {
        items: rows.map(({ item: { quoteItemId: _q, sortOrder: _s, ...rest } }) => rest),
      } });
      setItems(out.budget); setDirty(false); toast.success("Budget saved");
      void refresh(); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const cols = church ? 6 : 9;
  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <section className="panel overflow-hidden">
        <Stack>
          <table className={clsx("rtable w-full text-sm", church ? "min-w-[860px]" : "min-w-[1100px]")}>
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                <th className="px-3 pt-2.5 text-left text-ink-faint" colSpan={church ? 2 : 1} />
                <th className="border-b-2 border-accent px-3 pt-2.5 text-left text-accent" colSpan={church ? 4 : 8}>{church ? "Budget" : "Estimating"}</th>
              </tr>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted [&_th]:px-3 [&_th]:py-2">
                <th className="min-w-[300px]">Name</th>{church && <th className="w-36">Type</th>}<th className="w-[92px] text-right">Qty</th><th className="w-[72px]">Unit</th><th className="w-[130px] text-right">Unit cost</th><th className="w-[104px] text-right">{church ? "Budget" : "Ext. cost"}</th>
                {!church && <><th className="w-[130px] text-right">Unit price</th><th className="w-[104px] text-right">Ext. price</th><th className="w-[100px] text-right">Profit</th><th className="w-[92px] text-right">Margin</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.filter((r) => !hidden(r.item)).map(({ item: it, depth }) => {
                const m = it.kind === "GROUP" ? byId.get(it.id)! : itemMoney(it);
                const group = it.kind === "GROUP";
                const sibs = items.filter((x) => x.parentId === it.parentId);
                const idx = sibs.findIndex((x) => x.id === it.id);
                return (
                  <tr key={it.id} className={clsx("group/row align-middle", group ? "bg-hover/50 font-semibold" : "hover:bg-hover/25")}>
                    <td className="py-1.5 pr-3" style={{ paddingLeft: 12 + depth * 22 }}>
                      <div className="flex items-center gap-1">
                        {group ? (
                          <button className="p-0.5 text-ink-muted hover:text-ink" onClick={() => setClosed((c) => { const n = new Set(c); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })} aria-label={closed.has(it.id) ? "Open" : "Close"}>
                            {closed.has(it.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                          </button>
                        ) : <span className="w-[19px] shrink-0 border-l border-line" style={{ height: 22 }} />}
                        <input autoFocus={focus === it.id} onFocus={(e) => { if (focus === it.id) { e.target.select(); setFocus(null); } }}
                          className={clsx("w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-line focus:border-accent focus:bg-surface focus:outline-none", group && "font-semibold")}
                          title={it.name} value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} />
                        <span className="flex shrink-0 opacity-0 transition group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                          {group && <button className="p-1 text-ink-faint hover:text-accent" title="Add a cost item to this group" onClick={() => addItem(it.id)}><Plus size={14} /></button>}
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx <= 0} onClick={() => move(it.id, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx >= sibs.length - 1} onClick={() => move(it.id, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                          <button className="p-1 text-bad/70 hover:text-bad" onClick={() => remove(it.id)} aria-label="Remove"><X size={14} /></button>
                        </span>
                      </div>
                    </td>
                    {church && <td className="px-3">{!group && (
                      <select className="input py-1 text-xs" value={it.costType} onChange={(e) => patch(it.id, { costType: e.target.value as CostType })}>{COST_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                    )}</td>}
                    {group ? <><td /><td /><td /></> : (
                      <>
                        <td className="px-3"><input type="number" step="any" className="input py-1 text-right" value={it.quantity} onChange={(e) => patch(it.id, { quantity: Number(e.target.value) || 0 })} /></td>
                        <td className="px-3"><input className="input py-1" value={it.unit ?? ""} placeholder="ea" onChange={(e) => patch(it.id, { unit: e.target.value || null })} /></td>
                        <td className="px-3"><MoneyInput cents={it.unitCostCents} onChange={(c) => patch(it.id, { unitCostCents: c ?? 0 })} /></td>
                      </>
                    )}
                    <td className="px-3 text-right font-mono tabular-nums">{money0(m.costCents)}</td>
                    {!church && (
                      <>
                        <td className="px-3">{!group && <MoneyInput cents={it.unitPriceCents} onChange={(c) => patch(it.id, { unitPriceCents: c ?? 0 })} />}</td>
                        <td className="px-3 text-right font-mono tabular-nums">{money0(m.priceCents)}</td>
                        <td className={clsx("px-3 text-right font-mono tabular-nums", m.profitCents < 0 && "text-bad")}>{money0(m.profitCents)}</td>
                        <td className="px-3 text-right">
                          {group || it.unitCostCents <= 0 ? <span className={clsx("font-mono tabular-nums", m.priceCents > 0 && m.marginBps < 1500 && "text-bad")}>{m.priceCents ? fmtPct(m.marginBps) : "—"}</span>
                            : <div className={clsx(m.marginBps < 1500 && "[&_input]:border-warn")}><PercentInput bps={m.marginBps} onChange={(b) => b < 10_000 && patch(it.id, { unitPriceCents: priceForMargin(it.unitCostCents, b) })} /></div>}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={cols} className="py-12 text-center text-ink-faint">The budget is empty. Add a cost group (Audio, Labor…), then cost items in it.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-hover/40 font-semibold">
                <td className="px-3 py-2.5" colSpan={church ? 2 : 1}>
                  <div className="flex gap-2">
                    <button className="btn-primary py-1.5 text-xs" onClick={() => addItem(items.find((x) => x.id === focus && x.kind === "GROUP")?.id ?? [...items].reverse().find((x) => x.kind === "GROUP" && !x.parentId)?.id ?? null)}><Plus size={13} /> Add cost item</button>
                    <button className="btn-outline py-1.5 text-xs" onClick={addGroup}><FolderPlus size={13} /> Add cost group</button>
                    <button className="btn-outline py-1.5 text-xs" onClick={() => setKitOpen(true)}><Package size={13} /> Add kit</button>
                  </div>
                </td>
                <td colSpan={3} />
                <td className="px-3 text-right font-mono tabular-nums">{money0(total.costCents)}</td>
                {!church && <><td /><td className="px-3 text-right font-mono tabular-nums">{money0(total.priceCents)}</td><td className="px-3 text-right font-mono tabular-nums">{money0(total.profitCents)}</td><td className="px-3 text-right font-mono tabular-nums">{total.priceCents ? fmtPct(total.marginBps) : "—"}</td></>}
              </tr>
            </tfoot>
          </table>
        </Stack>
      </section>
      <div className={clsx("sticky bottom-3 z-10 flex justify-center transition", dirty ? "opacity-100" : "pointer-events-none opacity-0")}>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-lg">
          <span className="mr-1 text-sm text-warn">● Unsaved changes</span>
          <button className="btn-ghost" onClick={() => { setItems(page.budget); setDirty(false); setError(null); }}>Discard changes</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving && <Spinner />}Save changes</button>
        </div>
      </div>
      {kitOpen && kits.data && <KitPicker kits={kits.data.filter((k) => k.active)} allowOne={false} onAdd={(k, l) => addKit(k, l)} onClose={() => setKitOpen(false)} />}
      {!church && <p className="text-[11px] text-ink-faint">Prices here are what was sold (a proposal's prices before tax). Purchase orders, bills and invoices will add committed, actual and invoiced columns to this budget in later updates.</p>}
    </div>
  );
}

/* ───────────── Documents ───────────── */

function Documents({ page }: { page: JobPage }) {
  if (!page.documents.length) return <div className="panel px-4 py-12 text-center text-sm text-ink-faint">No documents yet. Proposals, change orders, purchase orders and invoices for this job will show here.</div>;
  return (
    <div className="panel divide-y divide-line">
      {page.documents.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <FileSignature size={18} className="text-accent" />
          <div className="min-w-0 flex-1">
            <Link href={`/avl/quotes/view?id=${x.id}`} className="font-medium hover:text-accent">Proposal {x.number}</Link>
            <div className="text-xs text-ink-muted">{x.title}{x.date ? ` · sent ${fmtDate(x.date)}` : ""}{x.signature ? ` · signed by ${x.signature.signerName} ${fmtDate(x.signature.signedAt)}` : ""}</div>
          </div>
          <QuoteStatusBadge status={x.status as QuoteStatus} />
          <span className="w-28 text-right font-mono tabular-nums">{fmtMoney(x.totalCents)}</span>
          <Link className="btn-ghost py-1 text-xs" href={`/ops-print?id=${x.id}`}><Printer size={13} /> PDF</Link>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Edit job ───────────── */

function EditJob({ page, church, onClose, onSaved }: { page: JobPage; church: boolean; onClose: () => void; onSaved: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const me = useOpsMe();
  const j: JobDetail = page.job;
  const [f, setF] = useState({
    name: j.name, status: j.status as JobStatus, customerId: j.customerId ?? "", managerId: j.managerId ?? "", siteLine1: j.siteLine1 ?? "", siteLine2: j.siteLine2 ?? "",
    siteCity: j.siteCity ?? "", siteState: j.siteState ?? "", sitePostalCode: j.sitePostalCode ?? "", startDate: j.startDate ?? "", endDate: j.endDate ?? "", notes: j.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const canDelete = Boolean(me.data && me.data.status === "ok" && me.data.nav.avlManager);
  async function del() {
    if (!window.confirm(`Delete ${j.number} and its budget? This can't be undone.${j.quote ? " Its proposal stays; you can make a job from it again." : ""}`)) return;
    try { await ops(`/jobs/${j.id}`, { method: "DELETE" }); void refresh(); router.push("/avl/jobs"); } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal open onClose={onClose} title="Edit job" width={620}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await ops(`/jobs/${j.id}`, { method: "PUT", json: { ...f, campusId: j.campusId } }); toast.success("Job saved"); void refresh(); onSaved(); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Job name"><input required className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as JobStatus })}>{JOB_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {!church && (
            <Field label="Client"><select className="input" value={f.customerId} onChange={(e) => set({ customerId: e.target.value })}><option value="">No client</option>{page.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          )}
          <Field label="Project manager"><select className="input" value={f.managerId} onChange={(e) => set({ managerId: e.target.value })}><option value="">Nobody yet</option>{page.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts"><input type="date" className="input" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Ends"><input type="date" className="input" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
        </div>
        <Field label={church ? "Where" : "Site address"}><input className="input" value={f.siteLine1} onChange={(e) => set({ siteLine1: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-[1.6fr_0.6fr_0.8fr]">
          <input className="input" placeholder="City" value={f.siteCity} onChange={(e) => set({ siteCity: e.target.value })} />
          <input className="input" placeholder="State" value={f.siteState} onChange={(e) => set({ siteState: e.target.value })} />
          <input className="input" placeholder="ZIP" value={f.sitePostalCode} onChange={(e) => set({ sitePostalCode: e.target.value })} />
        </div>
        <Field label="Notes"><textarea rows={4} className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex items-center gap-2">
          {canDelete && <button type="button" className="btn-ghost text-bad" onClick={del}>Delete job</button>}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Profit ───────────── */

/** Where the job makes its money: by cost group and by kind of cost. */
function Profit({ page }: { page: JobPage }) {
  const { byId, total } = budgetTotals(page.budget);
  const groups = page.budget.filter((i) => !i.parentId).map((g) => ({ name: g.kind === "GROUP" ? g.name : g.name, m: byId.get(g.id)! })).filter((x) => x.m.priceCents || x.m.costCents);
  const types = COST_TYPES.map((t) => {
    let cost = 0, price = 0;
    for (const i of page.budget) if (i.kind === "ITEM" && i.costType === t.id) { const m = itemMoney(i); cost += m.costCents; price += m.priceCents; }
    return { name: t.label, m: { costCents: cost, priceCents: price, profitCents: price - cost, marginBps: price > 0 ? Math.round(((price - cost) / price) * 10_000) : 0 } };
  }).filter((x) => x.m.priceCents || x.m.costCents);
  const table = (title: string, rows: { name: string; m: { costCents: number; priceCents: number; profitCents: number; marginBps: number } }[], best = Math.max(1, ...rows.map((g) => Math.abs(g.m.profitCents)))) => (
    <Card eyebrow="Profit" title={title}>
      <Table min={680} head={<tr><th>{title === "By cost group" ? "Group" : "Kind"}</th><th className="text-right">Price</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Margin</th><th className="w-40" /></tr>}>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="font-medium">{r.name}</td>
            <td className="text-right font-mono">{fmtMoney(r.m.priceCents)}</td>
            <td className="text-right font-mono text-ink-soft">{fmtMoney(r.m.costCents)}</td>
            <td className={clsx("text-right font-mono", r.m.profitCents < 0 ? "text-bad" : "text-ok")}>{fmtMoney(r.m.profitCents)}</td>
            <td className={clsx("text-right tabular-nums", r.m.priceCents > 0 && (r.m.marginBps < 1500 ? "text-bad" : r.m.marginBps < 2500 ? "text-warn" : ""))}>{r.m.priceCents ? fmtPct(r.m.marginBps) : "—"}</td>
            <td><div className="h-1.5 rounded-full bg-hover"><div className={clsx("h-1.5 rounded-full", r.m.profitCents < 0 ? "bg-bad" : "bg-ok")} style={{ width: `${Math.round((Math.abs(r.m.profitCents) / best) * 100)}%` }} /></div></td>
          </tr>
        ))}
        <tr className="border-t-2 border-line font-semibold">
          <td>Whole job</td><td className="text-right font-mono">{fmtMoney(total.priceCents)}</td><td className="text-right font-mono">{fmtMoney(total.costCents)}</td>
          <td className={clsx("text-right font-mono", total.profitCents < 0 ? "text-bad" : "text-ok")}>{fmtMoney(total.profitCents)}</td><td className="text-right">{total.priceCents ? fmtPct(total.marginBps) : "—"}</td><td />
        </tr>
      </Table>
    </Card>
  );
  if (!groups.length) return <Card><Empty>Nothing in the budget yet.</Empty></Card>;
  return (
    <div className="space-y-5">
      <KpiRow items={[
        { value: money0(total.priceCents), label: "Approved price" },
        { value: money0(total.costCents), label: "Budgeted cost" },
        { value: money0(total.profitCents), label: "Projected profit", tone: total.profitCents < 0 ? "bad" : "ok" },
        { value: total.priceCents ? fmtPct(total.marginBps) : "—", label: "Projected margin", tone: total.marginBps < 1500 ? "bad" : total.marginBps < 2500 ? "warn" : "ok" },
      ]} />
      {table("By cost group", groups)}
      {table("By kind of cost", types)}
      <p className="text-[11px] text-ink-faint">Budgeted figures. For what’s committed and spent so far, and the projected margin, see Job costing.</p>
    </div>
  );
}

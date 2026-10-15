"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Clock, Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Api, planQuery, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { clock } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { RosterPanel, type RosterFilter } from "./RosterPanel";
import { ServiceOrder } from "./ServiceOrder";
import { TimesModal, ViewModal } from "./ServiceEditors";
import { SongKeys } from "./SongKeys";
import { MicPanel } from "./MicPanel";
import { hidesTime, useServiceView, visiblePlan } from "@/lib/serviceView";
import type { PlanSummary } from "@shared/types";
import { routes } from "@/lib/routes";
import { ResiBadge } from "@/components/resi/Resi";

export function ServiceView({ serviceTypeId, planId }: { serviceTypeId: string; planId: string }) {
  const qc = useQueryClient();
  const plan = useQuery({
    ...planQuery(serviceTypeId, planId),
    refetchInterval: 20_000, // pick up accepts/declines coming in from volunteers
  });
  const plans = usePlans();
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<"times" | "view" | null>(null);
  const view = useServiceView(serviceTypeId);

  const siblings = (plans.data ?? []).filter((x) => x.serviceTypeId === serviceTypeId);
  const idx = siblings.findIndex((x) => x.id === planId);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Once this plan is on screen, quietly load the next/previous ones so ◀ ▶ feel instant.
  const loaded = Boolean(plan.data);
  useEffect(() => {
    if (!loaded) return;
    for (const s of [next, prev]) if (s) void qc.prefetchQuery(planQuery(s.serviceTypeId, s.id));
  }, [loaded, next?.id, prev?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.data) {
    // Show what we already know (date + title from the list) while the details arrive.
    const known = plans.data?.find((x) => x.id === planId);
    return (
      <div className="h-full overflow-y-auto">
        <section className="border-b border-line px-8 pb-6 pt-12">
          {known ? (
            <>
              <div className="text-sm font-medium text-accent">
                {new Date(known.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{known.title}</h1>
              <div className="mt-2 text-sm text-ink-muted">{known.serviceTypeName} · loading the team and order of service…</div>
            </>
          ) : (
            <Skeleton className="h-24 max-w-xl" />
          )}
        </section>
        {plan.error ? (
          <div className="p-8 text-sm text-bad">Couldn’t load this service. <button className="underline" onClick={() => plan.refetch()}>Retry</button></div>
        ) : (
          <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_440px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
        )}
      </div>
    );
  }
  const full = plan.data;
  const p = visiblePlan(full, view.prefs);
  const hiddenTimes = full.times.filter((t) => hidesTime(view.prefs, t)).length;

  const filled = p.confirmedCount + p.unconfirmedCount;
  const total = filled + p.neededCount;
  const pct = total ? Math.round((p.confirmedCount / total) * 100) : 0;
  const d = new Date(p.sortDate);

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_280px_at_10%_-20%,rgba(79,156,255,0.18),transparent),radial-gradient(600px_240px_at_90%_0%,rgba(167,139,250,0.12),transparent)]" />
        <div className="relative px-8 pb-6 pt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Link href="/services" className="hover:text-ink-soft">Services</Link>
            <span>/</span>
            <span>{p.serviceTypeName}</span>
            <Link href={routes.matrix(serviceTypeId)} className="ml-2 rounded-md border border-line px-2 py-0.5 hover:border-line-strong hover:text-ink-soft">Matrix</Link>
            <button onClick={() => setModal("view")} title="Choose which teams and times show for this service type"
              className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:border-line-strong hover:text-ink-soft", view.prefs.teams.length || view.prefs.times.length ? "border-accent/40 text-accent" : "border-line")}>
              <Eye size={12} /> View{view.prefs.teams.length || hiddenTimes ? ` · ${view.prefs.teams.length + hiddenTimes} hidden` : ""}
            </button>
            <ResiBadge className="ml-2" />
            <div className="ml-auto mr-28 flex items-center gap-2">
              <NavBtn dir="prev" plan={prev} href={prev && routes.plan(serviceTypeId, prev.id)} />
              <NavBtn dir="next" plan={next} href={next && routes.plan(serviceTypeId, next.id)} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-8">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-accent">
                {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </div>
              {editing ? (
                <div className="mt-1 max-w-2xl space-y-1">
                  <TitleField value={full.title === full.dates ? "" : full.title} placeholder={full.dates} className="text-3xl font-semibold tracking-tight"
                    onSave={async (v) => { await savePlan({ title: v || null }); }} />
                  <TitleField value={full.seriesTitle ?? ""} placeholder="Series (optional)" className="text-sm text-ink-muted"
                    onSave={async (v) => { await savePlan({ seriesTitle: v || null }); }} />
                </div>
              ) : <>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight">{p.title}</h1>
                {p.seriesTitle && p.seriesTitle !== p.title && <div className="mt-1 text-sm text-ink-muted">Series · {p.seriesTitle}</div>}
              </>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.times.map((t) => (
                  <span key={t.id} className={clsx("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                    t.kind === "service" ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-surface text-ink-soft")}>
                    <Clock size={12} /> {t.kind === "service" ? clock(t.startsAt) : `${t.name || t.kind} · ${clock(t.startsAt)}`}
                  </span>
                ))}
                <button className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink-soft" onClick={() => setModal("times")}>
                  <Pencil size={11} /> Edit times
                </button>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <Ring pct={pct} />
              <div className="flex gap-1">
                <Kpi n={p.confirmedCount} label="Confirmed" cls="text-ok" onClick={() => setFilter("all")} />
                <Kpi n={p.unconfirmedCount} label="Pending" cls="text-warn" onClick={() => setFilter("U")} />
                <Kpi n={p.declinedCount} label="Declined" cls="text-bad" onClick={() => setFilter("D")} />
                <Kpi n={p.neededCount} label="Open" cls="text-ink" onClick={() => setFilter("open")} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Song keys (Tuning) ── */}
      <SongKeys plan={p} />

      {/* ── Mics & packs ── */}
      <MicPanel plan={p} />

      {/* ── Body ── */}
      {editing ? (
        <div className="space-y-5 p-6">
          <ServiceOrder plan={full} editing onEdit={setEditing} />
          <RosterPanel plan={p} filter={filter} setFilter={setFilter} />
        </div>
      ) : (
        <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <RosterPanel plan={p} filter={filter} setFilter={setFilter} />
          <ServiceOrder plan={full} editing={false} onEdit={setEditing} />
        </div>
      )}
      {modal === "times" && <TimesModal plan={full} onClose={() => setModal(null)} />}
      {modal === "view" && <ViewModal plan={full} prefs={view.prefs} onSave={view.save} onClose={() => setModal(null)} />}
    </div>
  );

  async function savePlan(input: { title?: string | null; seriesTitle?: string | null }) {
    try {
      qc.setQueryData(qk.plan(serviceTypeId, planId), await Api.editPlan(serviceTypeId, planId, input));
      void qc.invalidateQueries({ queryKey: qk.plans });
    } catch (e) { toast.error("Planning Center didn’t accept that", { description: (e as Error).message }); throw e; }
  }
}

/** The service's title (or series) while editing: saves when you leave it. */
function TitleField({ value, placeholder, className, onSave }: { value: string; placeholder: string; className?: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!busy && document.activeElement !== ref.current) setDraft(value); }, [value, busy]);
  const commit = async () => {
    if (draft.trim() === value) return;
    setBusy(true);
    try { await onSave(draft.trim()); } catch { ref.current?.focus(); } finally { setBusy(false); }
  };
  return (
    <input ref={ref} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === "Enter") ref.current?.blur(); if (e.key === "Escape") { setDraft(value); setTimeout(() => ref.current?.blur()); } }}
      className={clsx("-mx-1 block w-full rounded border border-line bg-transparent px-1 outline-none transition placeholder:text-ink-faint/60 hover:border-line-strong focus:border-accent/60 focus:bg-surface", busy && "opacity-60", className)} />
  );
}

/** Previous / next service of this type: big enough to find, with the date it goes to. */
function NavBtn({ dir, plan, href }: { dir: "prev" | "next"; plan: PlanSummary | null; href: string | null }) {
  const when = plan ? new Date(plan.sortDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const body = dir === "prev"
    ? <><ChevronLeft size={18} /><span className="flex flex-col items-start leading-tight"><span className="text-[10px] font-medium uppercase tracking-wider opacity-70">Previous</span><span className="text-sm font-semibold">{when ?? "None"}</span></span></>
    : <><span className="flex flex-col items-end leading-tight"><span className="text-[10px] font-medium uppercase tracking-wider opacity-70">Next</span><span className="text-sm font-semibold">{when ?? "None"}</span></span><ChevronRight size={18} /></>;
  const cls = "flex min-w-[118px] items-center justify-between gap-2 rounded-xl border px-3 py-1.5 shadow-sm transition";
  return href ? (
    <Link href={href} title={plan ? `${dir === "prev" ? "Previous" : "Next"} service: ${plan.title}` : undefined}
      className={clsx(cls, "border-accent/50 bg-accent-soft text-accent hover:border-accent hover:bg-accent hover:text-on-accent")}>{body}</Link>
  ) : (
    <span className={clsx(cls, "pointer-events-none border-line text-ink-faint opacity-50")}>{body}</span>
  );
}

function Kpi({ n, label, cls, onClick }: { n: number; label: string; cls: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-w-[64px] flex-col items-center rounded-lg px-2 py-1 text-center transition hover:bg-hover/60">
      <span className={clsx("text-xl font-semibold leading-tight tabular-nums", cls)}>{n}</span>
      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[76px] w-[76px] place-items-center">
      <svg width="76" height="76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} stroke="rgb(var(--c-line))" strokeWidth="7" fill="none" />
        <circle cx="38" cy="38" r={r} stroke="rgb(var(--c-ok))" strokeWidth="7" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} className="transition-all duration-500" />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="text-base font-semibold tabular-nums">{pct}%</div>
        <div className="mt-0.5 text-[9px] uppercase tracking-wider text-ink-muted">ready</div>
      </div>
    </div>
  );
}

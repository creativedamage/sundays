"use client";
/**
 * Matrix: several weeks of one service type side by side. Rows are teams and positions (plus the
 * songs), columns are services, cells show who's scheduled and their status, and open slots.
 *
 *  - Hover a person: every week they're on lights up, and a menu offers Profile, Target, Change…
 *    and Remove.
 *  - Click a person: their profile (contact details, schedule, email through Planning Center).
 *  - Drag a person onto another position or week to move them there (hold ⌥ Option to copy).
 *  - Target: keeps one person highlighted everywhere until you clear it.
 * Changes are made in Planning Center straight away.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRightLeft, BellRing, ChevronLeft, Crosshair, Grid3x3, Music2, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { PlanDetail, TeamMember } from "@shared/types";
import { useServiceView, visiblePlan } from "@/lib/serviceView";
import { Api, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { tuningSongs } from "@/lib/waves";
import { Avatar, Modal, Skeleton, Spinner } from "@/components/ui";
import { PersonPanel } from "@/components/people/PersonPanel";

const DOT = { C: "bg-ok", U: "bg-warn", D: "bg-bad" } as const;
const STATUS = { C: "Confirmed", U: "Pending", D: "Declined" } as const;
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Drag = { member: TeamMember; plan: PlanDetail };
type Target = { plan: PlanDetail; teamId: string; teamName: string; pos: string };

export function MatrixView({ serviceTypeId }: { serviceTypeId: string }) {
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(() => { try { return Number(localStorage.getItem("coolservices.matrix.weeks")) || 6; } catch { return 6; } });
  const [past, setPast] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [target, setTarget] = useState<{ personId: string; name: string } | null>(null);
  const [profile, setProfile] = useState<{ personId: string; name: string } | null>(null);
  const [change, setChange] = useState<{ member: TeamMember; plan: PlanDetail } | null>(null);
  const [notify, setNotify] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const key = qk.matrix(serviceTypeId, weeks, past);
  const m = useQuery({ queryKey: key, queryFn: () => Api.matrix(serviceTypeId, weeks, past), placeholderData: (prev) => prev, refetchInterval: 60_000 });
  const setW = (n: number) => { setWeeks(n); try { localStorage.setItem("coolservices.matrix.weeks", String(n)); } catch { /* ignore */ } };

  // Teams and times hidden for this service type (View on a service) stay out of the Matrix too.
  const view = useServiceView(serviceTypeId);
  const plans = (m.data?.plans ?? []).map((p) => visiblePlan(p, view.prefs));
  const now = Date.now();
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 60_000 });
  const refresh = (planIds: string[]) => {
    void qc.invalidateQueries({ queryKey: ["matrix"] });
    for (const id of planIds) { const p = plans.find((x) => x.id === id); if (p) void qc.invalidateQueries({ queryKey: qk.plan(p.serviceTypeId, p.id) }); }
    void qc.invalidateQueries({ queryKey: qk.plans });
  };

  /** Put someone in a position (and take them out of where they were, for a move). */
  const place = useMutation({
    mutationFn: async ({ personId, name, to, from, copy }: { personId: string; name: string; to: Target; from?: { plan: PlanDetail; member: TeamMember }; copy?: boolean }) => {
      await Api.schedule(to.plan.serviceTypeId, to.plan.id, { personId, teamId: to.teamId, positionName: to.pos, notify });
      if (from && !copy) await Api.removeMember(from.plan.serviceTypeId, from.plan.id, from.member.id);
      return { name, to, moved: Boolean(from && !copy) };
    },
    onMutate: ({ to }) => setBusyCell(`${to.plan.id}|${to.teamId}|${to.pos}`),
    onSuccess: ({ name, to, moved }, v) => {
      toast.success(`${name} ${moved ? "moved to" : "scheduled for"} ${to.pos}`, { description: `${shortDay(to.plan.sortDate)}${notify ? " · request queued" : ""}` });
      refresh([to.plan.id, ...(v.from ? [v.from.plan.id] : [])]);
    },
    onError: (e) => { toast.error("Planning Center didn’t make that change", { description: (e as Error).message }); refresh([]); },
    onSettled: () => setBusyCell(null),
  });
  const remove = useMutation({
    mutationFn: ({ member, plan }: { member: TeamMember; plan: PlanDetail }) => Api.removeMember(plan.serviceTypeId, plan.id, member.id),
    onSuccess: (_r, { member, plan }) => { toast.success(`${member.name} removed from ${member.positionName}`, { description: shortDay(plan.sortDate) }); refresh([plan.id]); },
    onError: (e) => toast.error("Couldn’t remove", { description: (e as Error).message }),
  });

  /** Teams → positions that appear in any of these weeks, in Planning Center's team order. */
  const rows = useMemo(() => {
    const teams = new Map<string, { id: string; name: string; order: string[]; positions: Set<string> }>();
    for (const p of plans) {
      for (const t of p.teams) if (!teams.has(t.id)) teams.set(t.id, { id: t.id, name: t.name, order: t.positions.map((x) => x.name), positions: new Set() });
      const add = (teamId: string, teamName: string, pos: string) => {
        if (!teams.has(teamId)) teams.set(teamId, { id: teamId, name: teamName, order: [], positions: new Set() });
        teams.get(teamId)!.positions.add(pos);
      };
      for (const r of p.roster) add(r.teamId, r.teamName, r.positionName);
      for (const n of p.needed) add(n.teamId, n.teamName, n.positionName);
    }
    return [...teams.values()].filter((t) => t.positions.size).map((t) => ({
      ...t,
      positions: [...t.positions].sort((a, b) => (idx(t.order, a) - idx(t.order, b)) || a.localeCompare(b)),
    }));
  }, [plans]);

  const cell = (p: PlanDetail, teamId: string, pos: string) => ({
    people: p.roster.filter((r) => r.teamId === teamId && r.positionName === pos),
    open: p.needed.filter((n) => n.teamId === teamId && n.positionName === pos).reduce((s, n) => s + n.quantity, 0),
  });

  const drop = (to: Target, copy: boolean) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const same = d.plan.id === to.plan.id && d.member.teamId === to.teamId && d.member.positionName === to.pos;
    if (same) return;
    if (to.plan.roster.some((r) => r.personId === d.member.personId && r.teamId === to.teamId && r.positionName === to.pos)) {
      return void toast(`${d.member.name} is already on ${to.pos} that week`);
    }
    place.mutate({ personId: d.member.personId, name: d.member.name, to, from: { plan: d.plan, member: d.member }, copy });
  };

  const lit = target?.personId ?? hover;
  const ctx: Ctx = {
    plans, cell, lit, targeting: Boolean(target), drag, busyCell,
    setHover, startDrag: setDrag, drop,
    openProfile: (r) => setProfile({ personId: r.personId, name: r.name }),
    targetPerson: (r) => setTarget({ personId: r.personId, name: r.name }),
    change: (member, plan) => setChange({ member, plan }),
    remove: (member, plan) => { if (confirm(`Remove ${member.name} from ${member.positionName} on ${shortDay(plan.sortDate)}?`)) remove.mutate({ member, plan }); },
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <Link href="/services" className="btn-ghost p-1.5"><ChevronLeft size={16} /></Link>
        <div>
          <div className="text-[11px] text-ink-muted">{m.data?.serviceType.name ?? "…"}</div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Grid3x3 size={18} className="text-accent" /> Matrix</h1>
        </div>
        <div className="ml-6 flex rounded-lg border border-line p-0.5 text-xs">
          {[4, 6, 8, 12].map((n) => (
            <button key={n} onClick={() => setW(n)} className={clsx("rounded-md px-2.5 py-1", weeks === n ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink-soft")}>{n} weeks</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={past > 0} onChange={(e) => setPast(e.target.checked ? 2 : 0)} /> Include last 2 weeks
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="When you add or move someone, Planning Center sends them a scheduling request">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> <BellRing size={12} /> Send requests
        </label>
        {target && (
          <span className="flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs text-accent">
            <Crosshair size={12} /> {target.name}
            <button className="rounded-full p-0.5 hover:bg-accent/20" onClick={() => setTarget(null)} title="Stop targeting"><X size={12} /></button>
          </span>
        )}
        <div className="ml-auto mr-24 flex items-center gap-3 text-[11px] text-ink-muted">
          {(["C", "U", "D"] as const).map((s) => <span key={s} className="flex items-center gap-1"><span className={clsx("h-2 w-2 rounded-full", DOT[s])} />{STATUS[s]}</span>)}
          <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded border border-dashed border-line-strong" />Open</span>
        </div>
      </header>

      {rows.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2.5">
          {rows.map((t) => (
            <button key={t.id} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
              className={clsx("rounded-full border px-3 py-1 text-xs transition", hidden.has(t.id) ? "border-line text-ink-faint line-through" : "border-accent/40 bg-accent-soft text-accent")}>
              {t.name}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-ink-faint">Drag someone to move them · hold ⌥ to copy · click for their profile</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {m.isLoading ? (
          <div className="space-y-2 p-6"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
        ) : m.error ? (
          <div className="p-6 text-sm text-bad">Couldn’t load the matrix: {(m.error as Error).message}</div>
        ) : !plans.length ? (
          <div className="p-6 text-sm text-ink-muted">No upcoming services for this service type.</div>
        ) : (
          <table className={clsx("border-separate border-spacing-0 text-[12px] transition-opacity", m.isFetching && m.isPlaceholderData && "opacity-60")}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-52 min-w-52 border-b border-r border-line bg-surface px-3 py-2 text-left align-bottom text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Position</th>
                {plans.map((p) => {
                  const d = new Date(p.sortDate);
                  const past_ = Date.parse(p.sortDate) < now - 864e5 / 2;
                  return (
                    <th key={p.id} className={clsx("sticky top-0 z-20 min-w-48 border-b border-r border-line bg-surface px-3 py-2 text-left align-bottom font-normal", past_ && "opacity-60")}>
                      <Link href={routes.plan(p.serviceTypeId, p.id)} className="group block">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">{d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                        <div className="truncate text-[13px] font-semibold text-ink group-hover:text-accent">{p.title}</div>
                        <div className="mt-1 flex gap-2 text-[10px] tabular-nums">
                          <span className="text-ok">{p.confirmedCount} ✓</span>
                          <span className="text-warn">{p.unconfirmedCount} ?</span>
                          {p.declinedCount > 0 && <span className="text-bad">{p.declinedCount} ✗</span>}
                          <span className={p.neededCount ? "text-ink-soft" : "text-ink-faint"}>{p.neededCount} open</span>
                        </div>
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 font-semibold"><span className="flex items-center gap-1.5"><Music2 size={12} className="text-violet" /> Songs</span></td>
                {plans.map((p) => (
                  <td key={p.id} className="border-b border-r border-line/70 px-3 py-2 align-top">
                    {tuningSongs(p.items, settings.data?.waves).map((i) => (
                      <div key={i.id} className="flex items-baseline gap-1.5 leading-5">
                        {i.songKey && <span className="w-7 shrink-0 font-mono text-[11px] font-semibold text-violet">{i.songKey}</span>}
                        <span className="truncate text-ink-soft">{i.title}</span>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
              {rows.filter((t) => !hidden.has(t.id)).map((t) => <TeamRows key={t.id} team={t} ctx={ctx} />)}
            </tbody>
          </table>
        )}
      </div>

      {profile && <PersonPanel personId={profile.personId} name={profile.name} onClose={() => setProfile(null)} onTarget={() => setTarget(profile)} />}
      {change && (
        <ChangeModal member={change.member} plan={change.plan} notify={notify} onClose={() => setChange(null)}
          onPlace={(personId, name, to, fromMember) => { place.mutate({ personId, name, to, from: { plan: change.plan, member: fromMember } }); setChange(null); }} />
      )}
    </div>
  );
}

const idx = (order: string[], name: string) => { const i = order.indexOf(name); return i === -1 ? 999 : i; };

interface Ctx {
  plans: PlanDetail[];
  cell: (p: PlanDetail, teamId: string, pos: string) => { people: TeamMember[]; open: number };
  lit: string | null; targeting: boolean; drag: Drag | null; busyCell: string | null;
  setHover: (id: string | null) => void;
  startDrag: (d: Drag | null) => void;
  drop: (to: Target, copy: boolean) => void;
  openProfile: (r: TeamMember) => void;
  targetPerson: (r: TeamMember) => void;
  change: (r: TeamMember, p: PlanDetail) => void;
  remove: (r: TeamMember, p: PlanDetail) => void;
}

function TeamRows({ team, ctx }: { team: { id: string; name: string; positions: string[] }; ctx: Ctx }) {
  return (
    <>
      <tr>
        <td colSpan={ctx.plans.length + 1} className="sticky left-0 border-b border-line bg-canvas px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{team.name}</td>
      </tr>
      {team.positions.map((pos) => (
        <tr key={pos} className="group">
          <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-1.5 text-ink-soft group-hover:bg-raised">{pos}</td>
          {ctx.plans.map((p) => <Cell key={p.id} plan={p} team={team} pos={pos} ctx={ctx} />)}
        </tr>
      ))}
    </>
  );
}

function Cell({ plan, team, pos, ctx }: { plan: PlanDetail; team: { id: string; name: string }; pos: string; ctx: Ctx }) {
  const c = ctx.cell(plan, team.id, pos);
  const [over, setOver] = useState(false);
  const busy = ctx.busyCell === `${plan.id}|${team.id}|${pos}`;
  const isSource = ctx.drag && ctx.drag.plan.id === plan.id && ctx.drag.member.teamId === team.id && ctx.drag.member.positionName === pos;
  return (
    <td
      onDragOver={(e) => { if (ctx.drag && !isSource) { e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? "copy" : "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); ctx.drop({ plan, teamId: team.id, teamName: team.name, pos }, e.altKey); }}
      className={clsx("border-b border-r border-line/70 px-2 py-1 align-top transition-colors group-hover:bg-raised/50",
        over && "bg-accent-soft outline outline-2 -outline-offset-2 outline-accent/60")}>
      <div className="flex flex-col gap-0.5">
        {c.people.map((r) => (
          <Chip key={r.id} r={r} plan={plan} ctx={ctx} />
        ))}
        {busy && <span className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] text-accent"><Spinner size={10} /> Saving…</span>}
        {c.open > 0 && (
          <Link href={routes.plan(plan.serviceTypeId, plan.id)}
            className="rounded border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-ink-faint hover:border-accent/60 hover:text-accent">
            Open{c.open > 1 ? ` ×${c.open}` : ""}
          </Link>
        )}
      </div>
    </td>
  );
}

/** A person in a cell: hover for actions, click for their profile, drag to move. */
function Chip({ r, plan, ctx }: { r: TeamMember; plan: PlanDetail; ctx: Ctx }) {
  const lit = ctx.lit === r.personId;
  return (
    <div className="group/chip relative"
      onMouseEnter={() => ctx.setHover(r.personId)} onMouseLeave={() => ctx.setHover(null)}>
      <button draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", r.name); ctx.startDrag({ member: r, plan }); }}
        onDragEnd={() => ctx.startDrag(null)}
        onClick={() => ctx.openProfile(r)}
        title={`${r.name} · ${STATUS[r.status]}${r.declineReason ? ` (${r.declineReason})` : ""}`}
        className={clsx("flex w-full cursor-grab items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left transition active:cursor-grabbing",
          lit ? "bg-accent-soft text-accent" : ctx.targeting ? "text-ink-faint" : "text-ink",
          r.status === "D" && "line-through opacity-70")}>
        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[r.status])} />
        <span className="truncate">{r.name}</span>
      </button>
      {!ctx.drag && (
        <div className="pointer-events-none absolute left-0 top-full z-40 hidden pt-1 group-hover/chip:block">
          <div className="pointer-events-auto flex items-center gap-0.5 whitespace-nowrap rounded-lg border border-line bg-surface p-1 shadow-xl">
            <MenuBtn icon={UserRound} label="Profile" onClick={() => ctx.openProfile(r)} />
            <MenuBtn icon={Crosshair} label="Target" onClick={() => ctx.targetPerson(r)} />
            <MenuBtn icon={ArrowRightLeft} label="Change…" onClick={() => ctx.change(r, plan)} />
            <MenuBtn icon={Trash2} label="Remove" danger onClick={() => ctx.remove(r, plan)} />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuBtn({ icon: Icon, label, onClick, danger }: { icon: typeof UserRound; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={clsx("flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition", danger ? "text-bad hover:bg-bad-soft" : "text-ink-soft hover:bg-hover")}>
      <Icon size={12} /> {label}
    </button>
  );
}

/** Change an assignment: someone else in this spot, or this person in another position that week. */
function ChangeModal({ member, plan, notify, onClose, onPlace }: {
  member: TeamMember; plan: PlanDetail; notify: boolean; onClose: () => void;
  onPlace: (personId: string, name: string, to: Target, from: TeamMember) => void;
}) {
  const [tab, setTab] = useState<"person" | "position">("person");
  const [q, setQ] = useState("");
  const cands = useQuery({
    queryKey: qk.candidates(plan.id, member.teamId, member.positionName),
    queryFn: () => Api.candidates(plan.serviceTypeId, plan.id, member.teamId, member.positionName),
    enabled: tab === "person",
  });
  const list = (cands.data ?? []).filter((c) => c.personId !== member.personId && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const here: Target = { plan, teamId: member.teamId, teamName: member.teamName, pos: member.positionName };
  return (
    <Modal open onClose={onClose} width={520}
      title={<span className="flex items-center gap-2"><Avatar name={member.name} src={member.avatarUrl} size={24} /> {member.name} · {member.positionName} · {shortDay(plan.sortDate)}</span>}>
      <div className="flex gap-1 border-b border-line px-5 pt-3">
        {([["person", "Someone else"], ["position", "Another position"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-accent text-accent" : "border-transparent text-ink-muted hover:text-ink-soft")}>{l}</button>
        ))}
      </div>
      <div className="max-h-[55vh] overflow-y-auto p-4">
        {tab === "person" ? (
          <>
            <input className="input mb-2 py-1.5 text-sm" placeholder={`Who else plays ${member.positionName}?`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {cands.isLoading ? <Spinner /> : !list.length ? <p className="text-sm text-ink-muted">Nobody else is on {member.positionName} in Planning Center.</p> : (
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.personId}>
                    <button onClick={() => onPlace(c.personId, c.name, here, member)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
                      <Avatar name={c.name} src={c.avatarUrl} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.name}</span>
                        <span className="block truncate text-[11px] text-ink-muted">{c.conflicts.length ? c.conflicts.map((x) => x.label).join(" · ") : c.lastServed ? `Last served ${shortDay(c.lastServed)}` : "Available"}</span>
                      </span>
                      {c.conflicts.length > 0 && <span className="rounded bg-warn-soft px-1.5 text-[10px] text-warn">conflict</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {plan.teams.map((t) => (
              <div key={t.id}>
                <div className="label mb-1">{t.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {t.positions.filter((p) => !(t.id === member.teamId && p.name === member.positionName)).map((p) => (
                    <button key={p.id} onClick={() => onPlace(member.personId, member.name, { plan, teamId: t.id, teamName: t.name, pos: p.name }, member)}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent/50 hover:text-accent">{p.name}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="border-t border-line px-5 py-2.5 text-[11px] text-ink-faint">
        {member.name} comes off {member.positionName}{tab === "person" ? " and the person you pick goes on it" : " and goes on the position you pick"}.{notify ? " Planning Center sends a scheduling request." : ""}
      </footer>
    </Modal>
  );
}

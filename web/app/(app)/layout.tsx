"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { BellRing, CalendarDays, LayoutDashboard, MessageCircle, MonitorUp, KanbanSquare, Lock, LockOpen, LogOut, Settings, Timer, MicVocal } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useOpsMe, useOpsSession } from "@/lib/ops";
import { Api, planQuery, qk } from "@/lib/api";
import { prefetchPlans, usePlans } from "@/lib/plans";
import { useUpdates } from "@/components/settings/UpdatesSettings";
import { Avatar, Badge } from "@/components/ui";
import { WorkflowWatcher } from "@/components/workflows/WorkflowAccess";
import { ScheduleModal } from "@/components/scheduling/ScheduleModal";
import { Logo } from "@/components/Logo";
import { routes } from "@/lib/routes";
import { PrefsLink } from "@/components/settings/PrefsLink";
import { bringCheckinSettingsOnce } from "@/components/settings/CheckinsMoved";
import { PageRequestsBar } from "@/components/paging/PageRequests";
import { useCampus } from "@/lib/campus";
import { WeekendPicker, useWeekend } from "@/lib/weekend";
import { AdminBrand, AdminNav, AvlBrand, AvlNav, OpsBrand, OpsNav } from "@/components/ops/OpsNav";
import { OrgSwitcher } from "@/components/ops/OrgSwitcher";
import { AppSwitcher, sideOf, useRememberApp } from "@/components/AppSwitcher";
import { APP_MODE_KEY, PinDialog, serviceLocked, serviceModeAllows, useAppMode, useUnlock } from "@/lib/appMode";
import { ElsewherePage, OtherApps, isSingle, useCurrentApp } from "@/components/AppLinks";
import { APPS, appFor, appHas } from "@shared/apps";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><Shell>{children}</Shell></Suspense>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const activeWf = search.get("id");
  const qc = useQueryClient();
  // Warm up the upcoming-services list right away, so "Schedule in Services" opens instantly.
  useEffect(() => { void prefetchPlans(qc); }, [qc]);
  // Team check-ins moved to the website: bring this Mac's ministries there once (merged, quietly).
  useEffect(() => { const t = setTimeout(() => void bringCheckinSettingsOnce(), 8000); return () => clearTimeout(t); }, []);
  const me = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity });
  // Service Mode (a shared computer): only Services, ProPresenter, Clock, Mic board and Parent paging.
  const mode = useAppMode().data;
  const locked = serviceLocked(mode);
  const closed = locked && !serviceModeAllows(path);
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows, refetchInterval: 60_000, enabled: Boolean(mode) && !locked });
  const updates = useUpdates();
  const version = useQuery({ queryKey: ["version"], queryFn: Api.version, staleTime: Infinity }).data;

  // Services opens back where you left it (the service and tab you were on), and the mic board
  // follows the service you have open.
  const LAST = "cool:lastServices";
  const [servicesHref, setServicesHref] = useState("/services");
  useEffect(() => { try { const v = localStorage.getItem(LAST); if (v?.startsWith("/services")) setServicesHref(v); } catch { /* private window */ } }, []);
  const qs = search.toString();
  const st = search.get("st"), openPlan = search.get("plan");
  useEffect(() => {
    if (!path.startsWith("/services")) return;
    const href = qs ? `${path}?${qs}` : path;
    setServicesHref(href);
    try { localStorage.setItem(LAST, href); } catch { /* private window */ }
  }, [path, qs]);
  useEffect(() => {
    if (path.startsWith("/services") && st && openPlan) void Api.boardOpenPlan(st, openPlan).catch(() => undefined);
  }, [path, st, openPlan]);

  // A single-purpose app (Sundays Services, Workflows and Paging before 1.33) shows only its own
  // screens; a link to another app's screen offers to open it there.
  const appId = useCurrentApp();
  const single = isSingle(appId) ? appId : null;
  const elsewhere = Boolean(single && !appHas(single, path));
  // Sundays, Sundays | Operations and Sundays | AVL are separate apps in one window (switcher at the top of the sidebar).
  const side = elsewhere ? "sundays" : sideOf(path);
  const inOps = side !== "sundays";
  useRememberApp(side, qs ? `${path}?${qs}` : path);
  useAppSettingsShortcut(side);

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/workflows", label: "Workflows", icon: KanbanSquare },
    { href: "/services", to: servicesHref, label: "Services", icon: CalendarDays },
    { href: "/propresenter", label: "ProPresenter", icon: MonitorUp },
    { href: "/clock", label: "Clock", icon: Timer },
    { href: "/micboard", label: "Mic board", icon: MicVocal },
    { href: "/chat", label: "Chat", icon: MessageCircle },
    { href: "/paging", label: "Parent paging", icon: BellRing },
  ];

  return (
    <div className={clsx("flex h-screen overflow-hidden", side === "ops" && "app-ops", side === "avl" && "app-avl", side === "admin" && "app-admin")}>
      <aside className={clsx("flex w-[240px] shrink-0 flex-col border-r border-line", inOps ? "bg-gradient-to-b from-accent/10 to-surface/60" : "bg-surface/60")}>
        {side === "admin" ? <AdminBrand /> : side === "avl" ? <AvlBrand /> : side === "ops" ? <OpsBrand fallback={me.data?.orgName ?? null} /> : (
          <div className="flex items-center gap-2.5 px-4 py-4">
            <Logo size={30} />
            <div className="leading-tight">
              <div className="text-sm font-semibold">{single ? APPS[single].name : "Sundays"}</div>
              <div className="truncate text-[11px] text-ink-muted">{me.data?.orgName ?? "\u00a0"}</div>
            </div>
          </div>
        )}
        {mode?.mode === "full" && !single && <AppSwitcher side={side} />}
        {inOps && side !== "admin" && <OrgSwitcher />}
        {!inOps && <CampusSwitcher />}
        {!inOps && (!single || single === "services") && <WeekendPicker />}

        {!inOps && <nav className="space-y-0.5 px-2">
          {(locked ? nav.filter((n) => serviceModeAllows(n.href)) : nav).filter((n) => !single || appHas(single, n.href)).map(({ href, to, label, icon: Icon }: { href: string; to?: string; label: string; icon: typeof CalendarDays }) => (
            <Link key={href} href={to ?? href}
              className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                path.startsWith(href) ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover/60 hover:text-ink-soft")}>
              <Icon size={16} /> {label}
            </Link>
          ))}
        </nav>}

        {mode?.mode === "service" && <ServiceModeBox locked={locked} unlockedUntil={mode.unlockedUntil} />}

        {closed || elsewhere ? (
          <div className="flex-1" />
        ) : path.startsWith("/services") ? (
          <ServicesNav activeSt={search.get("st")} activePlan={search.get("plan")} tab={path} />
        ) : side === "admin" ? (
          <AdminNav />
        ) : side === "avl" ? (
          <AvlNav />
        ) : side === "ops" ? (
          <OpsNav />
        ) : path.startsWith("/paging") ? (
          <PagingNav />
        ) : path.startsWith("/chat") || path.startsWith("/propresenter") || path.startsWith("/dashboard") || path.startsWith("/team-checkins") || path.startsWith("/clock") || path.startsWith("/micboard") ? (
          <div className="flex-1" />
        ) : path.startsWith("/settings") ? (
          <div className="flex-1" />
        ) : (
          <>
            <div className="label mt-6 px-4 pb-2">Workflows</div>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
              {workflows.data?.filter((w) => w.canOpen).sort((a, b) => Number(b.mine) - Number(a.mine)).map((w) => (
                <Link key={w.id} href={routes.board(w.id)}
                  className={clsx("flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition",
                    path === "/workflows/board" && activeWf === w.id ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
                  <span className="truncate">{w.name}</span>
                  <span className="flex items-center gap-1">
                    {w.overdueCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" title={`${w.overdueCount} overdue`} />}
                    <span className="text-[11px] tabular-nums text-ink-muted">{w.readyCount}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {single && <OtherApps current={single} />}
        {/* Operations and AVL have their own account and settings; Sundays' Planning Center sign-in and
            Preferences aren't part of them. Updates are the Mac app's, so they stay. */}
        {inOps ? (version || updates.data?.state === "available") && (
          <div className="flex items-center gap-2 px-4 pb-3 text-[11px] text-ink-faint">
            {version && <span>Sundays v{version}</span>}
            {updates.data?.state === "available" && (
              <PrefsLink section="updates" className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20">
                Update to {updates.data.latest?.version}
              </PrefsLink>
            )}
          </div>
        ) : me.data && (
          <div className="flex items-center gap-2.5 border-t border-line p-3">
            <Avatar name={me.data.name} src={me.data.avatarUrl} size={30} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium">{me.data.name}</div>
              <div className="truncate text-[11px] text-ink-muted">{me.data.orgName}{version ? ` · v${version}` : ""}</div>
              {updates.data?.state === "available" && (
                <PrefsLink section="updates" className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20">
                  Update to {updates.data.latest?.version}
                </PrefsLink>
              )}
            </div>
            <PrefsLink section="about" className="btn-ghost p-1.5" title="Preferences (⌘,)"><Settings size={15} /></PrefsLink>
            <button className="btn-ghost p-1.5" title="Sign out"
              onClick={async () => { await Api.logout(); window.location.href = "/"; }}>
              <LogOut size={15} />
            </button>
          </div>
        )}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {me.data?.demo && (
          <div className="pointer-events-none absolute bottom-3 right-4 z-10"><Badge tone="violet">Demo data</Badge></div>
        )}
        <PageRequestsBar />
        {!locked && mode && (!single || single === "workflows") && <WorkflowWatcher />}
        <div className="relative flex min-h-0 flex-1 flex-col">{elsewhere && single ? <ElsewherePage current={single} target={appFor(path) ?? (sideOf(path) === "admin" ? "ops" : null)} page={qs ? `${path}?${qs}` : path} /> : closed ? <ClosedInServiceMode /> : children}</div>
      </main>

      <ScheduleModal />
    </div>
  );
}

/**
 * Sidebar while in Services: the upcoming services for the service type you're looking at
 * (or every service type, grouped, on the Services overview).
 */
function ServicesNav({ activeSt, activePlan, tab }: { activeSt: string | null; activePlan: string | null; tab: string }) {
  // Stay on the same tab (Plan / Check-ins) when switching services.
  const link = tab === "/services/checkins" ? routes.checkins : routes.plan;
  const qc = useQueryClient();
  const plans = usePlans();
  const list = plans.data ?? [];
  const { shows } = useCampus();
  const inWeekend = new Set(useWeekend().data?.plans.map((p) => p.id) ?? []);
  // In Planning Center's service type order; each type appears as soon as its plans arrive.
  // On the overview, only the campus you're looking at.
  const types = (plans.types ?? []).map((t) => [t.id, t.name] as [string, string])
    .filter(([id]) => (activeSt ? id === activeSt : shows(id)) && list.some((p) => p.serviceTypeId === id));
  const waiting = plans.pending.filter((t) => (activeSt ? t.id === activeSt : shows(t.id)));

  return (
    <div className="mt-6 flex-1 overflow-y-auto px-2">
      {plans.types === undefined && <div className="px-2 text-xs text-ink-faint">Loading services…</div>}
      {types.map(([stId, stName]) => (
        <div key={stId} className="mb-4">
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="label truncate">{stName}</span>
            <Link href={routes.matrix(stId)} title="Several weeks side by side"
              className={clsx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition", tab === "/services/matrix" && activeSt === stId ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
              Matrix
            </Link>
          </div>
          <div className="space-y-0.5">
            {list.filter((p) => p.serviceTypeId === stId).map((p) => {
              const d = new Date(p.sortDate);
              const active = p.id === activePlan;
              return (
                <Link key={p.id} href={link(p.serviceTypeId, p.id)}
                  onMouseEnter={() => void qc.prefetchQuery(planQuery(p.serviceTypeId, p.id))}
                  className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition",
                    active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
                  <span className={clsx("w-9 shrink-0 text-center leading-tight", active ? "text-accent" : "text-ink-muted")}>
                    <span className="block text-[9px] font-semibold uppercase tracking-wider">{d.toLocaleDateString("en-US", { month: "short" })}</span>
                    <span className="block text-sm font-semibold tabular-nums">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{p.title}</span>
                    <span className="block text-[10px] text-ink-faint">
                      {inWeekend.has(p.id) && <span className="mr-1 font-semibold text-accent" title="In the weekend picked above">●</span>}
                      {d.toLocaleDateString("en-US", { weekday: "short" })}{p.neededCount ? ` · ${p.neededCount} open` : ""}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="mb-4 px-2 text-[11px] text-ink-faint">Loading {waiting.map((t) => t.name).join(", ")}…</div>
      )}
      {activeSt && (
        <Link href="/services" className="block px-2 text-[11px] text-ink-muted hover:text-accent">All service types →</Link>
      )}
    </div>
  );
}


/** Sidebar on Parent paging: what's on screen, and today's pages. */
function PagingNav() {
  const status = useQuery({ queryKey: qk.pagingStatus, queryFn: Api.pagingStatus, refetchInterval: (q) => (q.state.data?.onScreenUntil ? 1000 : 4000) });
  const s = status.data;
  return (
    <>
      <div className="label mt-6 px-4 pb-2">Paged today</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {s?.current && s.onScreenUntil && (
          <div className="mb-2 rounded-lg border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
            On screen: <b className="font-mono">{s.current.code}</b>
          </div>
        )}
        {s && s.recent.length === 0 && <div className="px-2 text-xs text-ink-faint">Nothing paged yet today.</div>}
        {s?.recent.map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft">
            <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", e.ok ? "bg-ok" : "bg-bad")} />
            <span className="font-mono">{e.code}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{e.childName ?? e.by}</span>
            <span className="text-[10px] tabular-nums text-ink-faint">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
        ))}
        <PrefsLink section="paging" className="block px-2.5 pt-2 text-[11px] text-ink-muted hover:text-accent">Paging settings →</PrefsLink>
      </div>
    </>
  );
}

/** Sidebar on Settings: jump to a section. */

/** Which campus you're looking at (starts at your default from Preferences → Campuses). */
function CampusSwitcher() {
  const { campuses, campus, myDefault, setCampus } = useCampus();
  if (!campuses.length) return null;
  return (
    <div className="px-3 pb-2">
      <select className="input w-full py-1 text-xs" value={campus?.id ?? ""} onChange={(e) => setCampus(e.target.value || null)} title="Campus">
        <option value="">All campuses</option>
        {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.id === myDefault ? " (default)" : ""}</option>)}
      </select>
    </div>
  );
}

/** Service Mode in the sidebar: locked or unlocked, and the way out (with the PIN). */
function ServiceModeBox({ locked, unlockedUntil }: { locked: boolean; unlockedUntil: string | null }) {
  const qc = useQueryClient();
  const unlock = useUnlock();
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="mx-2 mt-3 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-accent">
        {locked ? <Lock size={12} /> : <LockOpen size={12} />} Service Mode
        <span className="ml-auto font-normal text-ink-muted">{locked ? "Locked" : `Unlocked until ${new Date(unlockedUntil!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}</span>
      </div>
      <div className="mt-1.5 flex gap-2">
        {locked
          ? <button className="text-ink hover:text-accent" onClick={unlock.ask}>Unlock…</button>
          : <button className="text-ink-soft hover:text-accent" onClick={async () => qc.setQueryData(APP_MODE_KEY, await Api.lockServiceMode())}>Lock now</button>}
        <button className="ml-auto text-ink hover:text-accent" onClick={() => (locked ? setLeaving(true) : void Api.setAppMode("full").then((v) => { qc.setQueryData(APP_MODE_KEY, v); void qc.invalidateQueries(); }))}>Switch to Full Mode…</button>
      </div>
      {unlock.dialog}
      {leaving && (
        <PinDialog title="Leave Service Mode" sub="Enter the Service Mode PIN to switch this computer to Full Mode." action="Switch to Full Mode"
          onClose={() => setLeaving(false)}
          onPin={async (pin) => { qc.setQueryData(APP_MODE_KEY, await Api.setAppMode("full", { pin })); setLeaving(false); void qc.invalidateQueries(); }} />
      )}
    </div>
  );
}

/** A page Service Mode closes (Workflows, Check-Ins, Dashboard, Chat). */
function ClosedInServiceMode() {
  const unlock = useUnlock();
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Lock size={26} /></span>
        <h1 className="mt-4 text-xl font-semibold">Not in Service Mode</h1>
        <p className="mt-1 text-sm text-ink-muted">This computer is in Service Mode: Services, ProPresenter, Clock, Mic board and Parent paging. Workflows and Check-Ins need the Service Mode PIN.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/services" className="btn-primary">Go to Services</Link>
          <button className="btn-outline" onClick={unlock.ask}><LockOpen size={14} /> Unlock with the PIN</button>
        </div>
      </div>
      {unlock.dialog}
    </div>
  );
}

/**
 * Sundays → Preferences… (⌘,) in Operations or AVL opens that app's own settings (the Mac app asks
 * with a "sundays:app-settings" event): Operations' for its managers, AVL's business settings.
 */
function useAppSettingsShortcut(side: string) {
  const router = useRouter();
  const { session } = useOpsSession();
  const ops = useOpsMe(Boolean(session) && side !== "sundays").data;
  useEffect(() => {
    const go = () => {
      const nav = ops?.status === "ok" ? ops.nav : null;
      if (side === "avl") router.push("/avl/settings");
      else if (side === "ops") {
        if (nav?.admin) router.push("/ops/settings/organization");
        else if (nav?.manager) router.push("/ops/settings/users");
        else toast("Operations settings are for managers.");
      } else if (side === "admin") router.push("/admin");
    };
    window.addEventListener("sundays:app-settings", go);
    return () => window.removeEventListener("sundays:app-settings", go);
  }, [side, ops, router]);
}

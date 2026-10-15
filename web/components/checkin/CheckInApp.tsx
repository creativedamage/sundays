"use client";
/**
 * Team check-ins on the website (sundays-checkin.vercel.app): made for phones, and saved to the
 * home screen like an app.
 *
 * Everyone signs in with their own Planning Center account, so they see what Planning Center lets
 * them see; Sundays decides whether they may view, check people in, or manage check-ins
 * (Operations → Settings → People). Each check-in records who made it.
 */
import clsx from "clsx";
import { CalendarDays, Check, ChevronDown, LogOut, MapPin, Printer, RefreshCw, Search, Settings2, ShieldCheck, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckinMe, CheckinPerson, CheckinPlanData, CheckinService } from "@shared/ops/checkin";
import { checkinAtLeast } from "@shared/ops/checkin";
import { CheckinApi, CheckinError, claimSignIn, clearPending, pending, startSignIn, token } from "@/lib/checkin";
import { PCO_LOGO_SRC } from "@/components/PlanningCenterButton";
import { CheckinSettings } from "./CheckinSettings";
import { CheckinReport } from "./Report";
import { groupTeams, tally } from "./sections";
import { AppMark, Centered, Face, Sheet, Shell } from "./ui";

const LS = "sundays.checkin";
const load = (k: string) => { try { return localStorage.getItem(`${LS}.${k}`); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(`${LS}.${k}`, v); } catch { /* private mode */ } };
export const SIGNIN_ERROR = `${LS}.signinError`;

function useSystemTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = mq.matches ? "light" : "dark"; };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}


type Phase = { kind: "boot" } | { kind: "signed-out"; error?: string } | { kind: "waiting" } | { kind: "in"; me: CheckinMe };

export default function CheckInApp() {
  useSystemTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });

  const boot = useCallback(async () => {
    const err = (() => { try { const e = sessionStorage.getItem(SIGNIN_ERROR); sessionStorage.removeItem(SIGNIN_ERROR); return e; } catch { return null; } })();
    if (!token()) {
      // A sign-in this app started in another browser view (iPhone home-screen apps): pick it up.
      if (err) clearPending(); // a sign-in that was refused: say why, don't wait
      else if (pending()) { setPhase({ kind: "waiting" }); return; }
      return setPhase({ kind: "signed-out", error: err ?? undefined });
    }
    try { setPhase({ kind: "in", me: await CheckinApi.me() }); }
    catch (e) { setPhase({ kind: "signed-out", error: e instanceof CheckinError && e.status !== 401 ? e.message : undefined }); }
  }, []);
  useEffect(() => { void boot(); }, [boot]);

  if (phase.kind === "boot") return <Shell />;
  if (phase.kind === "waiting") return <Waiting onDone={boot} />;
  if (phase.kind === "signed-out") return <SignIn error={phase.error} />;
  return <Teams me={phase.me} onSignedOut={(error) => setPhase({ kind: "signed-out", error })} />;
}

/* ───────────── Signing in ───────────── */

function SignIn({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(error ?? null);
  const [logoOk, setLogoOk] = useState(true);
  return (
    <Shell>
      <Centered>
        <AppMark size={84} />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Team check-ins</h1>
        <p className="mt-2 text-[15px] text-ink-muted">See who’s here on each team and check people in.</p>
        {msg && <p className="mt-6 w-full rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-left text-sm text-warn">{msg}</p>}
        <button disabled={busy}
          onClick={async () => { setBusy(true); setMsg(null); try { await startSignIn(); } catch (e) { setMsg((e as Error).message); setBusy(false); } }}
          className="mt-8 flex h-14 w-full items-center justify-center gap-4 rounded-2xl border border-[#dadce0] bg-white px-5 text-[17px] font-semibold text-[#1f2328] shadow-sm transition active:scale-[0.98] disabled:opacity-60">
          {logoOk && (
            // Planning Center's official logo, unmodified (see web/public/brand/README.md).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={PCO_LOGO_SRC} alt="" aria-hidden height={24} width={24} className="h-6 w-auto" onError={() => setLogoOk(false)} />
          )}
          <span>{busy ? "Opening Planning Center…" : "Sign in with Planning Center"}</span>
        </button>
        <p className="mt-4 text-xs text-ink-faint">You’ll see the teams your Planning Center account can see.</p>
        <p className="mt-10 text-[11px] text-ink-faint">Tip: Share → Add to Home Screen keeps this one tap away.</p>
      </Centered>
    </Shell>
  );
}

/** Waiting for a sign-in finished in another browser view (iPhone home-screen apps). */
function Waiting({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try { if (await claimSignIn()) { if (alive) onDone(); } else if (!pending() && alive) onDone(); }
      catch (e) { if (alive) setMsg((e as Error).message); }
    };
    void tick();
    const x = setInterval(tick, 2000);
    document.addEventListener("visibilitychange", tick);
    return () => { alive = false; clearInterval(x); document.removeEventListener("visibilitychange", tick); };
  }, [onDone]);
  return (
    <Shell>
      <Centered>
        <AppMark />
        <h1 className="mt-5 text-xl font-semibold">Finishing sign-in…</h1>
        <p className="mt-2 text-sm text-ink-muted">Sign in to Planning Center in the window that opened, then come back here.</p>
        {msg && <p className="mt-4 w-full rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-left text-sm text-warn">{msg}</p>}
        <button className="btn-ghost mt-8" onClick={() => { clearPending(); onDone(); }}>Start over</button>
      </Centered>
    </Shell>
  );
}

/* ───────────── Teams ───────────── */

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const count = tally;

function Teams({ me, onSignedOut }: { me: CheckinMe; onSignedOut: (error?: string) => void }) {
  const canCheck = checkinAtLeast(me.level, "CHECKIN");
  const [services, setServices] = useState<CheckinService[] | null>(null);
  const [plan, setPlan] = useState<string | null>(() => load("plan"));
  const [d, setD] = useState<CheckinPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ministry, setMinistry] = useState<string>(() => load("ministry") ?? "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [report, setReport] = useState(false);
  /** A day picked with the date filter ("YYYY-MM-DD"); null = last week's and upcoming services. */
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof CheckinError && (e.status === 401 || e.code === "no-access" || e.code === "suspended")) return onSignedOut(e.status === 401 ? undefined : e.message);
    setError((e as Error).message);
  }, [onSignedOut]);

  // Last week's and upcoming services, or a picked day's (refreshed every few minutes). Keeps the
  // chosen service while it's in the list; otherwise the one happening now or next, else the latest.
  const loadServices = useCallback(async () => {
    try {
      const r = await CheckinApi.services(date ?? undefined);
      setServices(r.services);
      setToday(r.today);
      setPlan((p) => {
        if (p && r.services.some((s) => s.id === p)) return p;
        const soon = r.services.find((s) => Date.parse(s.sortDate) > Date.now() - 8 * 3600e3);
        return (date ? r.services[0] : soon ?? r.services[r.services.length - 1])?.id ?? null;
      });
    } catch (e) { fail(e); }
  }, [fail, date]);
  useEffect(() => { setServices(null); void loadServices(); const x = setInterval(loadServices, 5 * 60_000); return () => clearInterval(x); }, [loadServices]);
  const service = services?.find((s) => s.id === plan) ?? null;

  const fetchData = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    try { setD(await CheckinApi.plan(service.serviceTypeId, service.id)); setError(null); }
    catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [service, fail]);
  useEffect(() => { setD(null); void fetchData(); }, [service?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const x = setInterval(() => { if (document.visibilityState === "visible") void fetchData(); }, 15_000);
    const v = () => { if (document.visibilityState === "visible") void fetchData(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(x); document.removeEventListener("visibilitychange", v); };
  }, [fetchData]);
  useEffect(() => keep("ministry", ministry), [ministry]);
  useEffect(() => { if (plan) keep("plan", plan); }, [plan]);

  const say = (text: string, tone: "ok" | "bad" = "ok") => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3500);
  };

  const teams = useMemo(() => d?.teams ?? [], [d?.teams]);
  const sections = useMemo(() => groupTeams(teams, d?.groups ?? []), [teams, d?.groups]);
  const shown = ministry === "all" ? sections : sections.filter((s) => s.id === ministry);
  const total = count(shown.flatMap((s) => s.teams));

  const search = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!search) return [];
    const seen = new Map<string, { p: CheckinPerson; teams: string[] }>();
    for (const s of shown) for (const x of s.teams) for (const p of x.people) {
      if (!p.name.toLowerCase().includes(search)) continue;
      const hit = seen.get(p.personId) ?? { p, teams: [] };
      hit.teams.push(x.teamName);
      seen.set(p.personId, hit);
    }
    return [...seen.values()].sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [search, shown]);

  /** Mark someone in (or out) everywhere they appear, right away; the server answer follows. */
  const patch = (personId: string, at: string | null) => setD((cur) => cur && {
    ...cur, teams: cur.teams.map((x) => ({ ...x, people: x.people.map((p) => p.personId === personId ? { ...p, checkedInAt: at, checkedInVia: at ? "staff" as const : undefined, checkedInBy: at ? me.name : undefined } : p) })),
  });

  const checkIn = async (p: CheckinPerson, undo = false) => {
    if (!service || busy.has(p.personId)) return;
    setBusy((b) => new Set(b).add(p.personId));
    const before = { at: p.checkedInAt, via: p.checkedInVia, by: p.checkedInBy };
    patch(p.personId, undo ? null : new Date().toISOString());
    try {
      const r = await CheckinApi.check(service.serviceTypeId, service.id, p.personId, undo);
      say(undo ? `${p.name} checked out` : `${p.name} checked in${r.services && r.services > 1 ? ` to ${r.services} services` : ""}${r.teams && r.teams > 1 ? ` (${r.teams} teams)` : ""}`);
      void fetchData();
    } catch (e) {
      setD((cur) => cur && { ...cur, teams: cur.teams.map((x) => ({ ...x, people: x.people.map((y) => y.personId === p.personId ? { ...y, checkedInAt: before.at, checkedInVia: before.via, checkedInBy: before.by } : y) })) });
      if (e instanceof CheckinError && e.status === 401) return onSignedOut();
      say((e as Error).message, "bad");
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(p.personId); return n; });
    }
  };

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: me.timeZone });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: me.timeZone });
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: me.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  if (settings) return <CheckinSettings onClose={(changed) => { setSettings(false); if (changed) void fetchData(); }} />;
  if (report && service) return <CheckinReport me={me} service={service} data={d} onClose={() => setReport(false)} />;

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 pb-3 backdrop-blur" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {me.logo ? <img src={me.logo} alt="" className="h-6 w-6 shrink-0 rounded-md object-contain" /> : <AppMark size={22} />}
            <span className="truncate">{me.church}</span>
          </div>
          <button className="btn-ghost ml-auto shrink-0 p-1.5" aria-label="Print a report" title="Print a report" disabled={!service} onClick={() => setReport(true)}><Printer size={17} /></button>
          <button className="btn-ghost shrink-0 p-1.5" aria-label="Refresh" onClick={() => { void loadServices(); void fetchData(); }}><RefreshCw size={17} className={clsx(loading && "animate-spin")} /></button>
          <button className="shrink-0 rounded-full" aria-label="You" onClick={() => setMenu(true)}><Face name={me.name} src={me.avatarUrl} size={30} /></button>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <h1 className="text-xl font-semibold">Team check-ins</h1>
          {d && <span className="font-mono text-lg tabular-nums"><b className="text-ok">{total.inn}</b><span className="text-ink-muted">/{total.all}</span></span>}
        </div>
        <div className="mt-2 flex gap-2">
          <label className={clsx("relative flex shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm", date ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft")} title="Pick a date">
            <CalendarDays size={16} />
            <span className="hidden sm:inline">{date ? day(`${date}T12:00:00Z`) : "Any date"}</span>
            <input type="date" aria-label="Service date" className="absolute inset-0 cursor-pointer opacity-0" value={date ?? ""}
              onChange={(e) => { const v = e.target.value; setDate(v && v !== "" ? v : null); }} />
          </label>
          {services && services.length > 0 ? (
            <select className="input min-w-0 flex-1 py-2 text-[16px]" value={plan ?? ""} onChange={(e) => setPlan(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{day(s.sortDate)} · {clock(s.sortDate)} · {s.serviceTypeName}{today && dayOf(s.sortDate) < today ? " (past)" : ""}</option>
              ))}
            </select>
          ) : (
            <div className="input flex min-w-0 flex-1 items-center py-2 text-[16px] text-ink-muted">{services ? (date ? "No services that day" : "No services") : "Loading services…"}</div>
          )}
          {date && <button className="btn-ghost shrink-0 px-2 text-sm" onClick={() => setDate(null)}>This week</button>}
        </div>
        {sections.length > 1 && (
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {[{ id: "all", name: "All" }, ...sections].map((s) => (
              <button key={s.id} onClick={() => setMinistry(s.id)}
                className={clsx("shrink-0 rounded-full border px-3 py-1.5 text-sm transition", ministry === s.id ? "border-accent bg-accent text-white" : "border-line text-ink-soft")}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input w-full py-2 pl-9 pr-9 text-[16px]" placeholder={canCheck ? "Find someone to check in…" : "Find someone…"} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-faint" aria-label="Clear" onClick={() => setQ("")}><X size={16} /></button>}
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4">
        {error && <p className="rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
        {d?.checkInsError && <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{d.checkInsError}</p>}
        {d && !d.event && checkinAtLeast(me.level, "MANAGER") && (
          <button onClick={() => setSettings(true)} className="flex w-full items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-left text-sm">
            <MapPin size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1">Choose which Check-Ins event volunteers check in to for {service?.serviceTypeName ?? "this service"}, so only volunteer check-ins count.</span>
            <span className="shrink-0 font-semibold text-accent">Set up</span>
          </button>
        )}
        {services && !services.length && <p className="py-10 text-center text-ink-muted">{date ? "No services you can see in Planning Center that day. Pick another date." : "No services you can see in Planning Center this week."}</p>}
        {!services && !error && <Skeletons />}
        {service && !d && !error && <Skeletons />}
        {d && !teams.length && <p className="py-10 text-center text-ink-muted">Nobody you can see is scheduled on this service yet.</p>}

        {search ? (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{hits.length} match{hits.length === 1 ? "" : "es"}</h2>
            <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
              {hits.map(({ p, teams: tn }) => <PersonRow key={p.personId} p={p} sub={tn.join(", ")} canCheck={canCheck} busy={busy.has(p.personId)} onCheckIn={checkIn} />)}
              {!hits.length && <li className="px-4 py-6 text-center text-sm text-ink-muted">Nobody by that name on this service.</li>}
            </ul>
          </section>
        ) : shown.map((s) => {
          const c = count(s.teams);
          return (
            <section key={s.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{s.name}</h2>
                <span className="font-mono text-sm tabular-nums text-ink-soft">{c.inn}/{c.all}</span>
              </div>
              <div className="grid items-start gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {s.teams.map((x) => {
                  const inn = x.people.filter((p) => p.checkedInAt).length;
                  const all = x.people.length;
                  const done = all > 0 && inn === all;
                  const isOpen = open.has(x.teamId);
                  return (
                    <div key={x.teamId} className={clsx("overflow-hidden rounded-2xl border bg-surface", done ? "border-ok/50" : "border-line")}>
                      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => toggle(x.teamId)} aria-expanded={isOpen}>
                        {done ? <ShieldCheck size={20} className="shrink-0 text-ok" /> : <UsersRound size={20} className="shrink-0 text-ink-muted" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{x.teamName}</span>
                          {x.people[0]?.expectedLocation && <span className="flex items-center gap-1 truncate text-xs text-ink-muted"><MapPin size={11} />{x.people[0].expectedLocation}</span>}
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-hover">
                            <span className={clsx("block h-full rounded-full transition-all", done ? "bg-ok" : "bg-warn")} style={{ width: `${all ? (inn / all) * 100 : 0}%` }} />
                          </span>
                        </span>
                        <span className={clsx("font-mono text-3xl font-semibold tabular-nums", done ? "text-ok" : inn ? "text-ink" : "text-ink-faint")}>{inn}<span className="text-lg text-ink-muted">/{all}</span></span>
                        <ChevronDown size={18} className={clsx("shrink-0 text-ink-faint transition", isOpen && "rotate-180")} />
                      </button>
                      {isOpen && (
                        <ul className="divide-y divide-line/60 border-t border-line">
                          {[...x.people].sort((a, b) => Number(Boolean(a.checkedInAt)) - Number(Boolean(b.checkedInAt)) || a.name.localeCompare(b.name))
                            .map((p) => <PersonRow key={p.personId} p={p} sub={p.positions.join(", ")} canCheck={canCheck} busy={busy.has(p.personId)} onCheckIn={checkIn} />)}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="flex items-center gap-3 border-t border-line px-4 py-3 text-xs text-ink-muted">
        <span className="truncate">{canCheck ? `Checking in as ${me.name}` : `Signed in as ${me.name} · view only`}</span>
        {d && <span className="ml-auto shrink-0">Updated {time(d.fetchedAt)}</span>}
      </footer>

      {flash && (
        <div className="pointer-events-none fixed inset-x-4 z-30 flex justify-center" style={{ bottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}>
          <div className={clsx("rounded-xl px-4 py-2.5 text-sm font-medium shadow-xl", flash.tone === "ok" ? "bg-ok text-white" : "bg-bad text-white")}>{flash.text}</div>
        </div>
      )}
      {menu && (
        <Sheet onClose={() => setMenu(false)}>
          <div className="flex items-center gap-3">
            <Face name={me.name} src={me.avatarUrl} size={44} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{me.name}</div>
              <div className="truncate text-sm text-ink-muted">{me.church} · {{ NONE: "", VIEW: "View", CHECKIN: "Check in", MANAGER: "Manage" }[me.level]}</div>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            <button className="btn-outline justify-center py-3" disabled={!service} onClick={() => { setMenu(false); setReport(true); }}><Printer size={16} /> Print a report</button>
            {checkinAtLeast(me.level, "MANAGER") && (
              <button className="btn-outline justify-center py-3" onClick={() => { setMenu(false); setSettings(true); }}><Settings2 size={16} /> Check-in settings</button>
            )}
            <button className="btn-ghost justify-center py-3 text-bad" onClick={async () => { await CheckinApi.signOut(); onSignedOut(); }}><LogOut size={16} /> Sign out</button>
          </div>
          <p className="mt-4 text-center text-[11px] text-ink-faint">You see what your Planning Center account can see.</p>
        </Sheet>
      )}
    </Shell>
  );
}

function Skeletons() {
  return <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-line bg-surface" />)}</div>;
}

function PersonRow({ p, sub, canCheck, busy, onCheckIn }: { p: CheckinPerson; sub: string; canCheck: boolean; busy: boolean; onCheckIn: (p: CheckinPerson, undo?: boolean) => void }) {
  const [confirmUndo, setConfirmUndo] = useState(false);
  useEffect(() => { if (!confirmUndo) return; const x = setTimeout(() => setConfirmUndo(false), 3000); return () => clearTimeout(x); }, [confirmUndo]);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Face name={p.name} src={p.avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{p.name}</span>
        <span className="block truncate text-xs text-ink-muted">{sub}{p.status === "U" ? " · unconfirmed" : ""}</span>
        {p.checkedInAt && p.location && p.expectedLocation && p.location !== p.expectedLocation && <span className="block truncate text-xs text-warn">checked in at {p.location}</span>}
      </span>
      {p.checkedInAt ? (
        <span className="flex shrink-0 flex-col items-end">
          <span className="flex items-center gap-1 text-sm font-medium text-ok"><Check size={15} /> {time(p.checkedInAt)}</span>
          {p.checkedInVia === "staff" && (
            canCheck
              ? <button className={clsx("text-[11px]", confirmUndo ? "font-semibold text-bad" : "text-ink-faint")} disabled={busy}
                  onClick={() => (confirmUndo ? (setConfirmUndo(false), onCheckIn(p, true)) : setConfirmUndo(true))}>{confirmUndo ? "Tap to undo" : `by ${p.checkedInBy ?? "staff"} · undo`}</button>
              : <span className="text-[11px] text-ink-faint">by {p.checkedInBy ?? "staff"}</span>
          )}
        </span>
      ) : canCheck ? (
        <button className="btn-primary shrink-0 px-4 py-2.5 text-[15px] active:scale-95" disabled={busy} onClick={() => onCheckIn(p)}>
          {busy ? "…" : "Check in"}
        </button>
      ) : (
        <span className="shrink-0 text-sm text-ink-faint">not yet</span>
      )}
    </li>
  );
}



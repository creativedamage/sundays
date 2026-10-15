"use client";
/** Dashboard widgets for running a service. Each one takes its options from the dashboard layout. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AudioLines, ChevronLeft, ChevronRight, Clock3, Gauge, MonitorUp, Radio, Tv, Wifi } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DashboardWidget, PlanSummary } from "@shared/types";
import { Api, planQuery, qk } from "@/lib/api";
import { clock, mmss } from "@/lib/format";
import { pickWeekendService, useWeekend } from "@/lib/weekend";
import { routes } from "@/lib/routes";
import { parseKey, sendKey, tuningSongs } from "@/lib/waves";
import { TuningExtras } from "@/components/services/SongKeys";
import { LiveStatus } from "@/components/services/MicPanel";
import { useProAction, useProState } from "@/components/pro/ProControl";
import { PrefsLink } from "@/components/settings/PrefsLink";

type O = DashboardWidget["options"];

export const useHome = () => useQuery({ queryKey: qk.home, queryFn: Api.home, staleTime: 60_000 });

/**
 * The service a widget follows, always in the weekend picked in the sidebar (it never moves on to
 * the next weekend by itself):
 *  - a widget can name its own service type;
 *  - otherwise the dashboard's service type (Your service);
 *  - with neither, the weekend's service of any type.
 */
export function useWeekendService(serviceTypeId?: string | null): PlanSummary | undefined {
  const w = useWeekend().data;
  const home = useHome().data;
  return pickWeekendService(w, serviceTypeId || home?.serviceTypeId || null);
}

export function Frame({ title, icon: Icon, right, children, className }: { title: React.ReactNode; icon: typeof Clock3; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("panel flex h-full min-h-[160px] flex-col overflow-hidden", className)}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-semibold text-ink-soft">
        <Icon size={13} className="text-accent" /> <span className="min-w-0 flex-1 truncate">{title}</span>{right}
      </header>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </section>
  );
}

/* ── Clock ── */
export function ClockWidget() {
  const next = useWeekendService();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const plan = useQuery({ ...planQuery(next?.serviceTypeId ?? "", next?.id ?? ""), enabled: Boolean(next) });
  const svc = plan.data?.times.filter((t) => t.kind === "service").find((t) => Date.parse(t.endsAt || t.startsAt) > now);
  const to = svc ? Math.round((Date.parse(svc.startsAt) - now) / 1000) : null;
  return (
    <Frame title="Clock" icon={Clock3}>
      <div className="flex h-full flex-col items-center justify-center">
        <div className="whitespace-nowrap font-mono text-4xl font-semibold tabular-nums">{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
        {svc && to !== null && (
          <div className={clsx("mt-2 text-sm", to <= 0 ? "text-ok" : to < 600 ? "text-warn" : "text-ink-muted")}>
            {to > 0 ? `${clock(svc.startsAt)} service in ${hms(to)}` : `${clock(svc.startsAt)} service running · ${hms(-to)}`}
          </div>
        )}
      </div>
    </Frame>
  );
}

/* ── Planning Center Live ── */
export function LiveWidget({ o }: { o: O }) {
  const next = useWeekendService((o.serviceTypeId as string) || null);
  const data = useQuery({ ...planQuery(next?.serviceTypeId ?? "", next?.id ?? ""), enabled: Boolean(next), refetchInterval: 30_000 });
  const live = useQuery({ queryKey: qk.live(next?.id ?? ""), queryFn: () => Api.live(next!.serviceTypeId, next!.id), enabled: Boolean(next), refetchInterval: 3000, retry: false });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const items = data.data?.items ?? [];
  const cur = items.find((i) => i.id === live.data?.currentItemId);
  const nxt = items.find((i) => i.id === live.data?.nextItemId);
  const el = live.data?.currentStartedAt ? Math.max(0, Math.round((now - Date.parse(live.data.currentStartedAt)) / 1000)) : null;
  const over = el != null && cur?.lengthSec ? el > cur.lengthSec : false;
  return (
    <Frame title={next ? `Live · ${next.title}` : "Live"} icon={Radio} right={next && <Link className="text-[11px] font-normal text-accent hover:underline" href={routes.plan(next.serviceTypeId, next.id)}>Service</Link>}>
      {!cur ? <div className="grid h-full place-items-center text-sm text-ink-faint">Planning Center Live hasn’t started</div> : (
        <div className="flex h-full flex-col justify-center">
          <div className="text-[11px] uppercase tracking-wider text-accent">Now</div>
          <div className="truncate text-2xl font-semibold">{cur.title}</div>
          {el != null && (
            <div className={clsx("mt-1 font-mono text-xl tabular-nums", over ? "text-bad" : "text-ink-soft")}>
              {mmss(el)}{cur.lengthSec ? ` / ${mmss(cur.lengthSec)}` : ""}{cur.lengthSec ? (over ? ` · ${mmss(el - cur.lengthSec)} over` : ` · ${mmss(cur.lengthSec - el)} left`) : ""}
            </div>
          )}
          {nxt && <div className="mt-3 truncate text-sm text-ink-muted">Next: {nxt.title}{nxt.lengthSec ? ` · ${mmss(nxt.lengthSec)}` : ""}</div>}
        </div>
      )}
    </Frame>
  );
}

/* ── Tuning keys ── */
export function TuningWidget({ o }: { o: O }) {
  const next = useWeekendService((o.serviceTypeId as string) || null);
  const plan = useQuery({ ...planQuery(next?.serviceTypeId ?? "", next?.id ?? ""), enabled: Boolean(next), refetchInterval: 60_000 });
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 30_000 });
  const waves = settings.data?.waves;
  const [sent, setSent] = useState<string | null>(null);
  const songs = tuningSongs(plan.data?.items ?? [], waves);
  const press = async (id: string, keyId?: string) => {
    if (!waves?.enabled || !keyId) return;
    try { await sendKey(waves, keyId); setSent(id); } catch (e) { toast.error("Couldn’t send to Waves", { description: (e as Error).message }); }
  };
  return (
    <Frame title={next ? `Tuning · ${next.title}` : "Tuning"} icon={AudioLines} right={waves?.enabled ? <span className="text-[10px] font-normal text-ok">Waves ready</span> : null}>
      {!songs.length && !waves?.enabled ? <div className="grid h-full place-items-center text-sm text-ink-faint">No songs on the weekend’s service</div> : (
        <div className="flex h-full gap-2 overflow-x-auto">
          {waves?.enabled && <TuningExtras big waves={waves} sent={sent} onPress={(id) => void press(id, id)} />}
          {!songs.length && <div className="grid flex-1 place-items-center text-sm text-ink-faint">No songs on the weekend’s service</div>}
          {songs.map((s, i) => {
            const k = parseKey(s.songKey);
            return (
              <button key={s.id} onClick={() => press(s.id, k?.id)} disabled={!waves?.enabled}
                className={clsx("flex min-w-[110px] flex-1 flex-col items-center justify-center rounded-xl border px-2 py-2 transition", sent === s.id ? "border-ok/60 bg-ok-soft" : "border-line bg-raised", waves?.enabled && "hover:border-violet/60 active:scale-[0.97]")}>
                <span className={clsx("font-mono text-4xl font-semibold", k ? "text-violet" : "text-ink-faint")}>{k?.label ?? (s.songKey || "—")}</span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Song {i + 1}</span>
                <span className="line-clamp-2 text-center text-xs text-ink-soft">{s.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

/* ── SPL (Smaart) ── */
export function SplWidget({ o }: { o: O }) {
  const st = useQuery({ queryKey: qk.smaartStatus, queryFn: Api.smaartStatus, refetchInterval: 1000 });
  const cfg = useQuery({ queryKey: qk.smaartConfig, queryFn: Api.smaartConfig, staleTime: 60_000 });
  const key = (o.reading as string) || "";
  const readings = st.data?.readings ?? [];
  const r = readings.find((x) => x.key === key) ?? readings.find((x) => !x.approx && /laeq|leq/i.test(x.label)) ?? readings.find((x) => !x.approx)
    ?? readings.find((x) => /dBA/.test(x.label) && !/^(ref|reference|generator)\b/i.test(x.label)) ?? readings.find((x) => /dBA/.test(x.label)) ?? readings[0];
  const hist = useRef<number[]>([]);
  useEffect(() => { if (r) { hist.current = [...hist.current, r.value].slice(-120); } }, [r?.value, st.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const limit = cfg.data?.limit ?? 95;
  const tone = !r ? "text-ink-faint" : r.value >= limit ? "text-bad" : r.value >= limit - 3 ? "text-warn" : "text-ok";
  const h = hist.current, lo = Math.min(...h, limit - 15), hi = Math.max(...h, limit + 3);
  return (
    <Frame title={(o.label as string) || (r ? r.label : "SPL")} icon={Gauge} right={<PrefsLink section="smaart" className="text-[10px] font-normal text-ink-faint hover:text-accent">Smaart</PrefsLink>}>
      {!st.data || st.data.state === "off" ? <div className="grid h-full place-items-center text-center text-sm text-ink-faint">Connect Smaart in Preferences → Audio.</div>
        : st.data.state !== "connected" || !r ? <div className="grid h-full place-items-center text-center text-xs text-ink-faint">{st.data.error ?? (st.data.measurements.length ? `Connected to Smaart (${st.data.measurements.map((m) => m.name).join(", ")}). Waiting for level data…` : "Waiting for SPL from Smaart…")}</div> : (
          <div className="flex h-full flex-col justify-center">
            <div className={clsx("font-mono text-6xl font-semibold tabular-nums", tone)}>{r.value.toFixed(1)}<span className="ml-1 text-lg text-ink-muted">dB</span></div>
            <div className="mt-1 text-[11px] text-ink-muted">Limit {limit} dB{r.approx ? " · from the spectrum (approx.)" : ""}</div>
            {h.length > 2 && (
              <svg viewBox={`0 0 ${h.length - 1} 40`} preserveAspectRatio="none" className="mt-2 h-10 w-full">
                <line x1="0" x2={h.length - 1} y1={40 - ((limit - lo) / (hi - lo)) * 40} y2={40 - ((limit - lo) / (hi - lo)) * 40} stroke="rgb(var(--c-bad))" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                <polyline fill="none" stroke="currentColor" className={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                  points={h.map((v, i) => `${i},${40 - ((v - lo) / (hi - lo)) * 40}`).join(" ")} />
              </svg>
            )}
          </div>
        )}
    </Frame>
  );
}

/* ── Shure wireless ── */
export function WirelessWidget() {
  const next = useWeekendService();
  const setup = useQuery({ queryKey: qk.micSetup, queryFn: Api.micSetup, staleTime: 60_000 });
  const mics = useQuery({ queryKey: qk.planMics(next?.id ?? ""), queryFn: () => Api.planMics(next!.id), enabled: Boolean(next) });
  const plan = useQuery({ ...planQuery(next?.serviceTypeId ?? "", next?.id ?? ""), enabled: Boolean(next) });
  const hasIps = (setup.data?.receivers ?? []).some((r) => r.ip);
  const status = useQuery({ queryKey: qk.micStatus, queryFn: Api.micStatus, enabled: hasIps, refetchInterval: 4000 });
  const people = new Map((plan.data?.roster ?? []).map((r) => [r.personId, r.name]));
  const byCh = new Map((mics.data?.assignments ?? []).map((a) => [a.channelId, a.personId]));
  const rx = new Map((status.data ?? []).map((r) => [r.receiverId, r]));
  return (
    <Frame title="Wireless" icon={Wifi} right={hasIps ? <span className="text-[10px] font-normal text-ink-faint">Shure · read-only</span> : null}>
      {!setup.data?.channels.length ? <div className="grid h-full place-items-center text-sm text-ink-faint">Set up mics on a service first.</div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
          {setup.data.channels.map((c) => {
            const r = c.receiverId ? rx.get(c.receiverId) : undefined;
            const live = r?.ok ? r.channels.find((x) => x.channel === c.channel) : undefined;
            const who = byCh.get(c.id);
            return (
              <div key={c.id} className={clsx("rounded-lg border bg-raised p-2", live?.batteryBars != null && live.batteryBars <= 1 ? "border-bad/50" : "border-line")}>
                <div className="flex items-center justify-between text-[11px]"><span className="font-semibold">{c.label}</span><span className="truncate text-ink-muted">{who ? people.get(who) ?? "—" : "Unassigned"}</span></div>
                <div className="mt-1.5 min-h-[16px]">{live ? <LiveStatus s={live} /> : <span className="text-[10px] text-ink-faint">{c.receiverId && hasIps ? (r && !r.ok ? "Receiver not answering" : "Reading…") : "Not linked to a receiver"}</span>}</div>
              </div>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

/* ── ProPresenter (a machine's slides + timers) ── */
export function ProWidget({ o }: { o: O }) {
  const machines = useQuery({ queryKey: qk.proMachines, queryFn: Api.proMachines });
  const id = (o.machine as string) || machines.data?.[0]?.id || null;
  const st = useProState(id);
  const act = useProAction(id ?? "");
  const s = st.data;
  const name = machines.data?.find((m) => m.id === id)?.name ?? "ProPresenter";
  return (
    <Frame title={name} icon={MonitorUp} right={id && <Link href={`/propresenter?m=${id}`} className="text-[11px] font-normal text-accent hover:underline">Open</Link>}>
      {!id ? <div className="grid h-full place-items-center text-sm text-ink-faint">Add a ProPresenter computer in Preferences → Video.</div>
        : !s ? null : !s.ok ? <div className="text-xs text-bad">{s.error}</div> : (
          <div className="flex h-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <button className="btn-outline px-2 py-1" onClick={() => act.mutate({ type: "previous" })}><ChevronLeft size={16} /></button>
              <div className="min-w-0 flex-1 text-center"><div className="truncate text-[11px] text-ink-muted">{s.presentation?.name ?? "Nothing live"}</div></div>
              <button className="btn-primary px-2 py-1" onClick={() => act.mutate({ type: "next" })}><ChevronRight size={16} /></button>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm font-medium">{s.current?.text || <span className="text-ink-faint">—</span>}</p>
            <p className="line-clamp-2 whitespace-pre-wrap text-xs text-ink-muted">Next: {s.next?.text || "—"}</p>
            <div className="mt-auto flex flex-wrap gap-2">
              {s.timers.slice(0, 3).map((t) => (
                <span key={t.id.uuid} className={clsx("rounded-md bg-hover px-2 py-0.5 font-mono text-sm tabular-nums", t.time.startsWith("-") ? "text-bad" : t.state === "running" ? "text-ok" : "text-ink-soft")} title={t.id.name}>{t.time}</span>
              ))}
            </div>
          </div>
        )}
    </Frame>
  );
}

const hms = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

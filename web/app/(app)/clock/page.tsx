"use client";
/**
 * Production clock: run the clock, cue saved timers, send messages. The same clock shows on the
 * network (/clock), as an NDI source and on a second display (Preferences → Video → Clock outputs).
 *
 * ProPresenter: the clock can follow a ProPresenter computer's timers (main + aux); any saved timer
 * takes over, and Follow ProPresenter goes back.
 *
 * Keys: Space start/pause · R reset · ← → previous/next timer · 1–9 start that timer · B blank · P follow ProPresenter.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  CalendarClock, ChevronLeft, ChevronRight, EyeOff, MessageSquare, MonitorUp, Pause, Pencil, Play, Plus, Radio, RotateCcw, Timer, Wifi, X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CLOCK_MODES, TIMER_COLORS, newPreset, readClock, type ClockMode, type ClockPreset, type ClockTimerSpec, type ClockView } from "@shared/clock";
import { Api } from "@/lib/api";
import { ClockFace } from "@/components/clock/ClockFace";
import { PresetEditor, SpecFields, describeSpec } from "@/components/clock/PresetEditor";
import { ProPanel } from "@/components/clock/ProPanel";
import { useClockStream } from "@/components/clock/useClock";
import { PrefsLink } from "@/components/settings/PrefsLink";
import { Spinner } from "@/components/ui";

const KEY = ["clock"];
const QUICK_MSGS = ["Wrap it up", "5 minutes", "Speak up", "Look at the camera", "Stretch"];

export default function ClockPage() {
  const qc = useQueryClient();
  // Every second while following ProPresenter (its timers list), else every five.
  const view = useQuery({ queryKey: KEY, queryFn: Api.clock, refetchInterval: (q) => (q.state.data?.settings.pro?.machineId ? 1000 : 5000) });
  const { out, now } = useClockStream("/api/clock-out", 10);
  const act = useMutation({
    mutationFn: Api.clockAction,
    onError: (e) => toast.error("The clock didn’t take that", { description: (e as Error).message }),
  });
  const saveSettings = useMutation({
    mutationFn: Api.saveClockSettings,
    onSuccess: (settings) => { qc.setQueryData<ClockView>(KEY, (v) => v && { ...v, settings }); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error("Couldn’t save that", { description: (e as Error).message }),
  });
  const savePresets = useMutation({
    mutationFn: Api.saveClockPresets,
    onSuccess: (presets) => qc.setQueryData<ClockView>(KEY, (v) => v && { ...v, presets }),
    onError: (e) => toast.error("Couldn’t save the timers", { description: (e as Error).message }),
  });
  const [editing, setEditing] = useState<ClockPreset | null>(null);
  const [msg, setMsg] = useState("");
  const state = out?.state ?? view.data?.state;
  const presets = view.data?.presets ?? [];
  const run = useCallback((a: Record<string, unknown> & { type: string }) => act.mutate(a), [act]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || editing) return;
      if (e.key === " ") { e.preventDefault(); run({ type: "toggle" }); }
      else if (e.key === "r" || e.key === "R") run({ type: "reset" });
      else if (e.key === "ArrowRight") run({ type: "next" });
      else if (e.key === "ArrowLeft") run({ type: "prev" });
      else if (e.key === "b" || e.key === "B") run({ type: "blank", on: !state?.blank });
      else if ((e.key === "p" || e.key === "P") && view.data?.settings.pro.machineId) run({ type: "follow", on: state?.source !== "propresenter" });
      else if (/^[1-9]$/.test(e.key) && presets[Number(e.key) - 1]) run({ type: "load", presetId: presets[Number(e.key) - 1].id, start: true });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [run, presets, state?.blank, state?.source, view.data?.settings.pro.machineId, editing]);

  if (!view.data || !state) return <div className="p-8"><Spinner /></div>;
  const v = view.data;
  const main = readClock(state.main, now, state.warnSec, state.dangerSec);
  const running = state.main.running && (state.main.mode === "countdown" || state.main.mode === "countup") ? Boolean(state.main.startedAt) : false;
  const stoppable = state.main.mode === "countdown" || state.main.mode === "countup";

  const savePreset = (p: ClockPreset) => {
    const list = presets.some((x) => x.id === p.id) ? presets.map((x) => (x.id === p.id ? p : x)) : [...presets, p];
    savePresets.mutate(list, { onSuccess: () => { setEditing(null); toast.success(`“${p.name}” saved`); } });
  };
  const deletePreset = (id: string) => savePresets.mutate(presets.filter((x) => x.id !== id).map((x) => (x.nextPresetId === id ? { ...x, nextPresetId: null } : x)), { onSuccess: () => setEditing(null) });
  const move = (id: string, d: -1 | 1) => {
    const i = presets.findIndex((x) => x.id === id);
    const j = i + d;
    if (j < 0 || j >= presets.length) return;
    const list = [...presets];
    [list[i], list[j]] = [list[j], list[i]];
    savePresets.mutate(list);
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4 pr-28">
        <Timer size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Clock</h1>
        {state.presetName && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{state.presetName}</span>}
        {v.settings.pro.machineId && state.source !== "propresenter" && v.pro.connected && (
          <button className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-soft hover:border-accent hover:text-accent" onClick={() => run({ type: "follow", on: true })} title="P">Back to ProPresenter</button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <OutputChip on={v.settings.ndi.enabled && v.status.ndi.running} icon={Radio}
            label={v.settings.ndi.enabled ? (v.status.ndi.running ? `NDI · ${v.status.ndi.connections} watching` : v.status.ndi.error ? "NDI · problem" : "NDI · starting") : "NDI off"}
            title={v.status.ndi.error ?? v.status.ndi.sourceName ?? undefined} warn={v.settings.ndi.enabled && Boolean(v.status.ndi.error)} />
          <OutputChip on={v.settings.lan && v.urls.length > 0} icon={Wifi} label={v.settings.lan ? "Network" : "Network off"} title={v.urls[0]} />
          <OutputChip on={v.settings.screen.enabled} icon={MonitorUp} label={v.settings.screen.enabled ? "Second screen" : "Screen off"} />
          <PrefsLink section="clock" className="btn-outline py-1 text-xs">Outputs…</PrefsLink>
        </div>
      </header>

      <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Preview: exactly what the outputs show. */}
          <div className="overflow-hidden rounded-2xl border border-line shadow-lg" style={{ aspectRatio: "16 / 9" }}>
            <ClockFace state={state} now={now} showTimeOfDay={v.settings.showTimeOfDay} title={out?.title ?? v.settings.title} infoHeading={out?.infoHeading ?? v.settings.infoHeading} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className={clsx("btn-primary px-5 py-2.5 text-base", running && "bg-warn hover:bg-warn/90")} disabled={!stoppable} onClick={() => run({ type: "toggle" })} title="Space">
              {running ? <Pause size={18} /> : <Play size={18} />} {running ? "Pause" : main.done ? "Start" : state.main.elapsedMs ? "Resume" : "Start"}
            </button>
            <button className="btn-outline py-2.5" onClick={() => run({ type: "reset" })} title="R"><RotateCcw size={16} /> Reset</button>
            <div className="flex items-center rounded-lg border border-line">
              {[-60, -10, 10, 60, 300].map((s) => (
                <button key={s} className="px-2.5 py-2 text-xs font-medium tabular-nums text-ink-soft hover:bg-hover" onClick={() => run({ type: "add", sec: s })}>
                  {s > 0 ? "+" : "−"}{Math.abs(s) >= 60 ? `${Math.abs(s) / 60}m` : `${Math.abs(s)}s`}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button className="btn-ghost p-2" title="Previous timer (←)" onClick={() => run({ type: "prev" })}><ChevronLeft size={18} /></button>
              <button className="btn-ghost p-2" title="Next timer (→)" onClick={() => run({ type: "next" })}><ChevronRight size={18} /></button>
              <button className={clsx("btn-outline py-2", state.blank && "border-warn/60 bg-warn-soft text-warn")} title="Hide the timers on the outputs (B)" onClick={() => run({ type: "blank", on: !state.blank })}>
                <EyeOff size={15} /> {state.blank ? "Blanked" : "Blank"}
              </button>
            </div>
          </div>

          <ProPanel view={v} onSettings={(pro) => saveSettings.mutate({ pro })} onFollow={(on) => run({ type: "follow", on })} />

          <section className="panel p-4">
            <h2 className="label mb-2 flex items-center gap-1.5"><MessageSquare size={12} /> Message</h2>
            <div className="flex gap-2">
              <input className="input text-sm" placeholder="Shows under the clock" value={msg} maxLength={200} onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") run({ type: "message", text: msg }); }} />
              <button className="btn-primary text-sm" onClick={() => run({ type: "message", text: msg })}>Show</button>
              <button className="btn-ghost text-sm" disabled={!state.message} onClick={() => { run({ type: "message", text: "" }); }}>Clear</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_MSGS.map((m) => <button key={m} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-soft hover:border-line-strong" onClick={() => { setMsg(m); run({ type: "message", text: m }); }}>{m}</button>)}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              Position
              {(["bottom", "top", "full"] as const).map((pos) => (
                <button key={pos} onClick={() => run({ type: "style", messagePosition: pos })}
                  className={clsx("rounded-md px-2 py-0.5", (state.messagePosition ?? "bottom") === pos ? "bg-accent-soft text-accent" : "hover:bg-hover")}>
                  {pos === "bottom" ? "Bottom" : pos === "top" ? "Top" : "Full cover"}
                </button>
              ))}
              {state.message && <span className="ml-auto text-ok">On screen: “{state.message}”</span>}
            </div>
          </section>

          <InfoPanel title={state.info?.title ?? ""} subtitle={state.info?.subtitle ?? ""} hidden={Boolean(state.info?.hidden)} placeholder={state.main.label}
            onUpdate={(title, subtitle) => run({ type: "info", title, subtitle })} onHide={(hidden) => run({ type: "info", hidden })} />

          <section className="panel flex flex-wrap items-center gap-3 p-4">
            <h2 className="label">Timer color</h2>
            <div className="flex gap-1.5">
              {TIMER_COLORS.map((c) => (
                <button key={c.color} title={c.name} aria-label={c.name} onClick={() => run({ type: "style", timerColor: c.color })}
                  className={clsx("h-7 w-7 rounded-md border border-line ring-offset-2 ring-offset-surface", state.timerColor?.toUpperCase() === c.color && "ring-2 ring-accent")} style={{ background: c.color }} />
              ))}
            </div>
            <span className="text-xs text-ink-muted">Turns yellow at {Math.floor(state.warnSec / 60)}:{String(state.warnSec % 60).padStart(2, "0")} and red at {Math.floor(state.dangerSec / 60)}:{String(state.dangerSec % 60).padStart(2, "0")} left (set per timer).</span>
          </section>

          <QuickTimer onSet={(which, spec, start) => run({ type: "set", which, spec, start })} />

          <section className="panel p-4">
            <div className="flex items-center gap-2">
              <h2 className="label">Second timer</h2>
              {state.secondary && <span className="text-xs text-ink-muted">{state.secondary.label} · {readClock(state.secondary, now).text}</span>}
              {state.secondary && (
                <div className="ml-auto flex items-center gap-1">
                  {(state.secondary.mode === "countdown" || state.secondary.mode === "countup") && (
                    <>
                      <button className="btn-ghost p-1.5" onClick={() => run({ type: "toggle", which: "secondary" })}>{state.secondary.running && state.secondary.startedAt ? <Pause size={14} /> : <Play size={14} />}</button>
                      <button className="btn-ghost p-1.5" onClick={() => run({ type: "reset", which: "secondary" })}><RotateCcw size={14} /></button>
                    </>
                  )}
                  <button className="btn-ghost p-1.5 hover:text-bad" title="Remove" onClick={() => run({ type: "set", which: "secondary", spec: null })}><X size={14} /></button>
                </div>
              )}
            </div>
            {!state.secondary && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="btn-outline py-1 text-xs" onClick={() => run({ type: "set", which: "secondary", spec: { mode: "timeofday" } })}>Time of day</button>
                <button className="btn-outline py-1 text-xs" onClick={() => run({ type: "set", which: "secondary", spec: { mode: "countup", label: "Elapsed" }, start: true })}>Stopwatch</button>
                <button className="btn-outline py-1 text-xs" onClick={() => run({ type: "set", which: "secondary", spec: { mode: "countup", label: "Over", startWhenMainEnds: true } })}>Overtime (starts at zero)</button>
                <button className="btn-outline py-1 text-xs" onClick={() => run({ type: "set", which: "secondary", spec: { mode: "service" } })}>Until service</button>
                <button className="btn-outline py-1 text-xs" onClick={() => run({ type: "set", which: "secondary", spec: { mode: "liveitem" } })}>Live item</button>
              </div>
            )}
          </section>
        </div>

        {/* Saved timers */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="label">Timers</h2>
            <button className="btn-outline py-1 text-xs" onClick={() => setEditing(newPreset(`p${Date.now().toString(36)}`))}><Plus size={13} /> New timer</button>
          </div>
          {!presets.length && <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">Save timers you use every week (Walk-in, Announcements, Message, Response) and start each with one click, a number key, or on a schedule.</p>}
          {state.source === "propresenter" && presets.length > 0 && <p className="text-xs text-ink-muted">Showing ProPresenter’s timers. Click a timer below to take over the clock.</p>}
          <ul className="space-y-2">
            {presets.map((p, i) => {
              const active = state.presetId === p.id;
              return (
                <li key={p.id} className={clsx("group flex items-stretch overflow-hidden rounded-xl border transition", active ? "border-accent bg-accent-soft/50" : "border-line bg-surface hover:border-line-strong")}>
                  <span className="w-1.5 shrink-0" style={{ background: p.color }} />
                  <button className="min-w-0 flex-1 px-3 py-2.5 text-left" onClick={() => run({ type: "load", presetId: p.id, start: true })} title={`Start (${i < 9 ? i + 1 : ""})`}>
                    <div className="flex items-center gap-2">
                      {i < 9 && <kbd className="rounded border border-line px-1 text-[10px] text-ink-faint">{i + 1}</kbd>}
                      <span className="truncate font-medium">{p.name}</span>
                      {p.schedule?.enabled && <CalendarClock size={12} className="shrink-0 text-accent" />}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-muted">
                      {describeSpec(p.main)}{p.secondary ? ` · + ${describeSpec(p.secondary)}` : ""}{p.nextPresetId ? ` → ${presets.find((x) => x.id === p.nextPresetId)?.name ?? ""}` : ""}
                    </div>
                  </button>
                  <div className="flex flex-col justify-center pr-1 opacity-0 transition group-hover:opacity-100">
                    <button className="btn-ghost p-1" title="Edit" onClick={() => setEditing(p)}><Pencil size={13} /></button>
                    <div className="flex">
                      <button className="btn-ghost p-0.5 text-[10px]" disabled={i === 0} onClick={() => move(p.id, -1)}>▲</button>
                      <button className="btn-ghost p-0.5 text-[10px]" disabled={i === presets.length - 1} onClick={() => move(p.id, 1)}>▼</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ink-faint">Click a timer to start it. Keys: Space start/pause · R reset · ← → previous/next · 1–9 start a timer · B blank · P follow ProPresenter.</p>
        </aside>
      </div>

      {editing && (
        <PresetEditor preset={editing} presets={presets} isNew={!presets.some((x) => x.id === editing.id)} busy={savePresets.isPending}
          onSave={savePreset} onDelete={() => deletePreset(editing.id)} onClose={() => setEditing(null)}
          onTry={(p) => { run({ type: "set", which: "main", spec: p.main }); }} />
      )}
    </div>
  );
}

function OutputChip({ on, icon: Icon, label, title, warn }: { on: boolean; icon: typeof Radio; label: string; title?: string; warn?: boolean }) {
  return (
    <span title={title} className={clsx("flex items-center gap-1 rounded-full px-2 py-0.5",
      warn ? "bg-warn-soft text-warn" : on ? "bg-ok-soft text-ok" : "bg-hover text-ink-muted")}>
      <Icon size={12} /> {label}
    </span>
  );
}

/** The Information box: a big yellow title and an orange line under it. */
function InfoPanel({ title, subtitle, hidden, placeholder, onUpdate, onHide }: {
  title: string; subtitle: string; hidden: boolean; placeholder: string; onUpdate: (t: string, s: string) => void; onHide: (h: boolean) => void;
}) {
  const [t, setT] = useState(title);
  const [s, setS] = useState(subtitle);
  useEffect(() => { setT(title); setS(subtitle); }, [title, subtitle]);
  return (
    <section className="panel p-4">
      <h2 className="label mb-2">Information</h2>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-[10rem] flex-1 text-sm" placeholder={placeholder || "Title"} value={t} maxLength={60} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onUpdate(t, s)} />
        <input className="input min-w-[10rem] flex-1 text-sm" placeholder="Subtitle (e.g. Session 1)" value={s} maxLength={80} onChange={(e) => setS(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onUpdate(t, s)} />
        <button className="btn-primary text-sm" onClick={() => onUpdate(t, s)}>Update</button>
        <button className="btn-ghost text-sm" onClick={() => onHide(!hidden)}>{hidden ? "Show" : "Hide"}</button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">Left empty, the title is the timer’s label and the subtitle is the saved timer’s name.</p>
    </section>
  );
}

/** Set the main (or second) timer right now without saving a preset. */
function QuickTimer({ onSet }: { onSet: (which: "main" | "secondary", spec: ClockTimerSpec, start: boolean) => void }) {
  const [spec, setSpec] = useState<ClockTimerSpec>({ mode: "countdown", durationSec: 300, overtime: true });
  return (
    <section className="panel p-4">
      <h2 className="label mb-2">Quick timer</h2>
      <div className="mb-3 flex flex-wrap gap-1">
        {CLOCK_MODES.map((m) => (
          <button key={m.mode} title={m.hint} onClick={() => setSpec({ ...spec, mode: m.mode as ClockMode })}
            className={clsx("rounded-md px-2.5 py-1 text-xs", spec.mode === m.mode ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover")}>{m.label}</button>
        ))}
      </div>
      <SpecFields spec={spec} onChange={setSpec} />
      <div className="mt-3 flex gap-2">
        <button className="btn-primary text-sm" onClick={() => onSet("main", spec, true)}><Play size={14} /> Start now</button>
        <button className="btn-outline text-sm" onClick={() => onSet("main", spec, false)}>Set</button>
        <button className="btn-ghost text-sm" onClick={() => onSet("secondary", spec, true)}>Use as second timer</button>
      </div>
    </section>
  );
}


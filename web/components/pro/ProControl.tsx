"use client";
/**
 * Watch and take over a ProPresenter computer: the current presentation's slides (click to show),
 * previous/next, clear layers, timers (start/stop/reset, change the time, ±1 min), stage message and
 * stage layouts. Keys: → / Space next, ← previous.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Eraser, MessageSquareText, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProAction, ProControlState, ProTimer } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { parseLength } from "@/lib/itemTime";
import { Spinner } from "@/components/ui";

export function useProState(id: string | null, fast = true) {
  return useQuery({ queryKey: qk.proState(id ?? ""), queryFn: () => Api.proState(id!), enabled: Boolean(id), refetchInterval: fast ? 1500 : 5000, retry: false });
}

export function useProAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ProAction) => Api.proAction(id, a),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.proState(id) }),
    onError: (e) => toast.error("ProPresenter didn’t do that", { description: (e as Error).message }),
  });
}

export function ProControl({ id }: { id: string }) {
  const st = useProState(id);
  const act = useProAction(id);
  const s = st.data;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); act.mutate({ type: "next" }); }
      if (e.key === "ArrowLeft") { e.preventDefault(); act.mutate({ type: "previous" }); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [act]);

  if (!s) return <div className="p-8"><Spinner /></div>;
  if (!s.ok) return <div className="m-6 rounded-xl border border-bad/30 bg-bad-soft p-4 text-sm text-bad">Can’t reach this ProPresenter: {s.error}</div>;

  return (
    <div className="grid gap-4 p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="panel min-w-0 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">Now showing</div>
            <div className="truncate text-lg font-semibold">{s.presentation?.name ?? "No presentation"}</div>
          </div>
          <button className="btn-outline px-4 py-2" onClick={() => act.mutate({ type: "previous" })} title="Previous (←)"><ChevronLeft size={18} /> Prev</button>
          <button className="btn-primary px-5 py-2" onClick={() => act.mutate({ type: "next" })} title="Next (→ or Space)">Next <ChevronRight size={18} /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["slide", "media", "props", "messages", "audio", "all"] as const).map((l) => (
            <button key={l} className={clsx("btn-ghost border border-line py-1 text-xs capitalize", l === "all" && "border-bad/40 text-bad")} onClick={() => act.mutate({ type: "clear", layer: l })}>
              <Eraser size={12} /> {l === "all" ? "Clear all" : `Clear ${l}`}
            </button>
          ))}
          {s.clearGroups.map((g) => <button key={g.uuid} className="btn-ghost border border-line py-1 text-xs" onClick={() => act.mutate({ type: "clearGroup", id: g.uuid })}>{g.name}</button>)}
          {s.looks.length > 0 && (
            <select className="input ml-auto w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && act.mutate({ type: "look", id: e.target.value })}>
              <option value="">Looks…</option>
              {s.looks.map((l) => <option key={l.uuid} value={l.uuid}>{l.name}</option>)}
            </select>
          )}
        </div>
        {s.presentation ? (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
            {s.presentation.slides.map((sl) => {
              const on = s.slideIndex === sl.index;
              return (
                <button key={sl.index} disabled={!sl.enabled} onClick={() => act.mutate({ type: "trigger", uuid: s.presentation!.uuid, index: sl.index })}
                  className={clsx("group overflow-hidden rounded-lg border text-left transition disabled:opacity-40",
                    on ? "border-accent ring-2 ring-accent/60" : "border-line hover:border-line-strong")}>
                  <div className="relative aspect-video bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/pro/${id}/thumb?uuid=${s.presentation!.uuid}&index=${sl.index}&q=320`} alt="" loading="lazy" className="h-full w-full object-contain" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">{sl.index + 1}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px]" style={{ borderTop: `3px solid ${sl.groupColor ?? "transparent"}` }}>
                    <span className="truncate font-medium">{sl.label || sl.group || "Slide"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : <p className="mt-6 text-sm text-ink-muted">Nothing is live in ProPresenter right now.</p>}
      </section>

      <div className="space-y-4">
        <section className="panel p-4">
          <div className="label">Current slide</div>
          <p className="mt-1 min-h-[2.5em] whitespace-pre-wrap text-lg font-medium leading-snug">{s.current?.text || <span className="text-ink-faint">—</span>}</p>
          <div className="label mt-3">Next</div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-ink-muted">{s.next?.text || "—"}</p>
          {s.current?.notes && <p className="mt-3 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">{s.current.notes}</p>}
        </section>

        <section className="panel p-4">
          <div className="label flex items-center gap-1.5"><Timer size={11} /> Timers</div>
          <div className="mt-2 space-y-2">
            {s.timers.length === 0 && <p className="text-xs text-ink-muted">No timers in ProPresenter.</p>}
            {s.timers.map((t) => <TimerRow key={t.id.uuid} t={t} act={act.mutate} />)}
          </div>
        </section>

        <StageCard s={s} act={act.mutate} />
      </div>
    </div>
  );
}

function TimerRow({ t, act }: { t: ProTimer; act: (a: ProAction) => void }) {
  const running = t.state === "running" || t.state === "overrunning";
  const over = t.time.startsWith("-") || t.state === "overrunning" || t.state === "overran";
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-ink-muted">{t.id.name}</div>
          <div className={clsx("font-mono text-2xl font-semibold tabular-nums", over ? "text-bad" : running ? "text-ok" : "text-ink")}>{t.time}</div>
        </div>
        <button className="btn-ghost p-1.5" title={running ? "Stop" : "Start"} onClick={() => act({ type: "timer", id: t.id.uuid, op: running ? "stop" : "start" })}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="btn-ghost p-1.5" title="Reset" onClick={() => act({ type: "timer", id: t.id.uuid, op: "reset" })}><RotateCcw size={15} /></button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {[-60, -30, 30, 60].map((d) => (
          <button key={d} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:border-line-strong" disabled={!running}
            title={running ? undefined : "Start the timer to add or take away time"} onClick={() => act({ type: "timerAdd", id: t.id.uuid, seconds: d })}>
            {d > 0 ? "+" : "−"}{Math.abs(d) >= 60 ? `${Math.abs(d) / 60}m` : `${Math.abs(d)}s`}
          </button>
        ))}
        {t.kind === "countdown" && (edit ? (
          <form className="ml-auto flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const n = parseLength(val); if (n == null) return toast.error("Use minutes:seconds, e.g. 5:00"); act({ type: "timerSet", id: t.id.uuid, duration: n }); setEdit(false); }}>
            <input autoFocus className="input w-20 py-0.5 font-mono text-xs" placeholder="5:00" value={val} onChange={(e) => setVal(e.target.value)} />
            <button className="btn-primary py-0.5 text-[11px]">Set</button>
          </form>
        ) : (
          <button className="ml-auto text-[11px] text-accent hover:underline" onClick={() => { setVal(t.duration != null ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}` : ""); setEdit(true); }}>
            Change time{t.duration != null ? ` (${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function StageCard({ s, act }: { s: ProControlState; act: (a: ProAction) => void }) {
  const [msg, setMsg] = useState("");
  return (
    <section className="panel p-4">
      <div className="label flex items-center gap-1.5"><MessageSquareText size={11} /> Stage</div>
      <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) act({ type: "stageMessage", text: msg.trim() }); }}>
        <input className="input py-1 text-sm" placeholder="Message to the stage screens" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn-primary py-1 text-xs">Show</button>
      </form>
      {s.stageMessage && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1 text-xs text-accent">
          <span className="min-w-0 flex-1 truncate">Showing: {s.stageMessage}</span>
          <button className="underline" onClick={() => act({ type: "stageMessage", text: null })}>Hide</button>
        </div>
      )}
      {s.stageScreens.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {s.stageScreens.map((sc) => (
            <label key={sc.id.uuid} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-ink-muted">{sc.id.name}</span>
              <select className="input py-1 text-xs" value={sc.layout?.uuid ?? ""} onChange={(e) => act({ type: "stageLayout", screen: sc.id.uuid, layout: e.target.value })}>
                {s.stageLayouts.map((l) => <option key={l.uuid} value={l.uuid}>{l.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

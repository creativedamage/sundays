"use client";
/**
 * Clock → ProPresenter: follow ProPresenter's timers on the clock. The main timer is the one picked
 * (or whichever is running), and a second one running shows as the aux timer. Any saved timer takes
 * over; Follow ProPresenter goes back.
 */
import clsx from "clsx";
import { MonitorUp, Play, Undo2 } from "lucide-react";
import type { ClockProSettings, ClockView } from "@shared/clock";
import { PrefsLink } from "@/components/settings/PrefsLink";

export function ProPanel({ view, onSettings, onFollow }: {
  view: ClockView;
  onSettings: (p: Partial<ClockProSettings>) => void;
  onFollow: (on: boolean) => void;
}) {
  const cfg = view.settings.pro;
  const st = view.pro;
  const following = view.state.source === "propresenter";
  const machines = view.proMachines;
  const timerOptions = st.timers.map((t) => ({ value: t.uuid, label: t.name || "Untitled timer" }));
  // A picked timer that ProPresenter doesn't list right now (offline): keep it in the list.
  const withPicked = (v: string) => (v === "auto" || v === "none" || timerOptions.some((o) => o.value === v) ? timerOptions : [...timerOptions, { value: v, label: "(not in ProPresenter now)" }]);

  return (
    <section className={clsx("panel p-4", following && "border-accent/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="label flex items-center gap-1.5"><MonitorUp size={12} /> ProPresenter timers</h2>
        {cfg.machineId && (
          <span className={clsx("rounded-full px-2 py-0.5 text-[11px]", st.connected ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
            {st.connected ? `Connected · ${st.machineName}` : st.error ? "Can’t reach it" : "Connecting…"}
          </span>
        )}
        <div className="ml-auto">
          {cfg.machineId && (following
            ? <button className="btn-outline py-1 text-xs" onClick={() => onFollow(false)} title="Stop following (P)"><Undo2 size={13} /> Stop following</button>
            : <button className="btn-primary py-1 text-xs" disabled={!st.connected} onClick={() => onFollow(true)} title="P"><Play size={13} /> Follow ProPresenter</button>)}
        </div>
      </div>

      {!machines.length ? (
        <p className="mt-2 text-sm text-ink-muted">
          Add your ProPresenter computer in <PrefsLink section="video" className="text-accent hover:underline">Preferences → Video</PrefsLink> (ProPresenter → Settings → Network → Enable Network), then pick it here to show its timers on the clock.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-ink-muted">Computer
              <select className="input mt-1 w-full py-1.5 text-sm" value={cfg.machineId ?? ""} onChange={(e) => onSettings({ machineId: e.target.value || null })}>
                <option value="">Don’t follow ProPresenter</option>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-muted">Main timer
              <select className="input mt-1 w-full py-1.5 text-sm" disabled={!cfg.machineId} value={cfg.main} onChange={(e) => onSettings({ main: e.target.value })}>
                <option value="auto">Whichever is running</option>
                {withPicked(cfg.main).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-muted">Aux timer (left box)
              <select className="input mt-1 w-full py-1.5 text-sm" disabled={!cfg.machineId} value={cfg.aux} onChange={(e) => onSettings({ aux: e.target.value })}>
                <option value="auto">A second one running</option>
                <option value="none">None (time of day)</option>
                {withPicked(cfg.aux).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {cfg.machineId && st.error && <p className="mt-2 text-xs text-warn">{st.error}</p>}

          {cfg.machineId && st.timers.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {st.timers.map((t) => {
                const role = following && t.uuid === st.mainUuid ? "Main" : following && t.uuid === st.auxUuid ? "Aux" : null;
                return (
                  <li key={t.uuid} className={clsx("flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", role ? "border-accent bg-accent-soft" : "border-line")}>
                    <span className={clsx("h-2 w-2 rounded-full", t.running ? "bg-ok" : "bg-ink-faint")} />
                    <span className="font-medium">{t.name || "Untitled"}</span>
                    <span className="font-mono tabular-nums text-ink-soft">{t.time.replace(/^(-?)00:/, "$1")}</span>
                    {role && <span className="rounded bg-accent px-1 text-[10px] font-semibold text-white">{role}</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {cfg.machineId && (
            <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
              <input type="checkbox" checked={cfg.resumeOnStart} onChange={(e) => onSettings({ resumeOnStart: e.target.checked })} />
              After a saved timer takes over, go back to ProPresenter when one of its timers starts
            </label>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            {following
              ? "Start, Pause, Reset and ± run ProPresenter’s own timer. Click any saved timer to take over the clock."
              : cfg.machineId ? "A saved timer is on the clock. Follow ProPresenter to show its timers again." : "Pick a computer to show its timers on the clock."}
          </p>
        </>
      )}
    </section>
  );
}

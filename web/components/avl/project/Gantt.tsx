"use client";
/**
 * A Gantt chart: rows down the side, days across the top, bars you can drag to move and pull at
 * either end to resize (when `onChange` is given). Bars that overlap in a row stack into lanes.
 */
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween, parseDay, toDay, type PhaseColor } from "@shared/ops/projects";

export const PHASE_HEX: Record<PhaseColor, string> = {
  blue: "#3b82f6", violet: "#8b5cf6", teal: "#0d9488", amber: "#d97706", rose: "#e11d48", green: "#16a34a", slate: "#64748b",
};
export const phaseHex = (c: PhaseColor | null | undefined) => PHASE_HEX[c ?? "blue"] ?? PHASE_HEX.blue;

export interface GanttRow { id: string; label: React.ReactNode; sub?: React.ReactNode }
export interface GanttBar {
  id: string; rowId: string; start: string; end: string; label: string; color: PhaseColor | null;
  done?: boolean; title?: string; editable?: boolean;
}
interface Drag { id: string; mode: "move" | "start" | "end"; x0: number; start: string; end: string; moved: boolean }

export function Gantt({ from, to, rows, bars, onChange, onBarClick, dayWidth: wantDay = 30, labelWidth: wantLabel = 210, empty }: {
  from: string; to: string; rows: GanttRow[]; bars: GanttBar[]; labelWidth?: number; empty?: React.ReactNode;
  /** The narrowest a day gets; days widen to fill the space there is. */
  dayWidth?: number;
  onChange?: (id: string, start: string, end: string) => void;
  onBarClick?: (id: string) => void;
}) {
  const days = useMemo(() => { const n = Math.max(1, daysBetween(from, to) + 1); return Array.from({ length: n }, (_, i) => addDays(from, i)); }, [from, to]);
  const today = toDay(new Date());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Fill the width there is (scrolling sideways only when the days can't fit at their narrowest).
  const box = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSpace(el.clientWidth));
    ro.observe(el); setSpace(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // On a phone: a narrower name column and days, so more of the timeline fits before it scrolls.
  const phone = space > 0 && space < 640;
  const labelWidth = phone ? Math.min(wantLabel, 124) : wantLabel;
  const minDay = phone ? Math.min(wantDay, 16) : wantDay;
  const dayWidth = Math.max(minDay, Math.floor((space - labelWidth - 1) / days.length) || 0);
  const width = days.length * dayWidth;

  // Bars as drawn (with the one being dragged in its new place), stacked into lanes per row.
  const shown = bars.map((b) => (drag && drag.id === b.id ? { ...b, start: drag.start, end: drag.end } : b));
  const lanes = useMemo(() => {
    const out = new Map<string, number>(); const count = new Map<string, number>();
    for (const r of rows) {
      const mine = shown.filter((b) => b.rowId === r.id).sort((a, b) => a.start.localeCompare(b.start));
      const ends: string[] = [];
      for (const b of mine) {
        let lane = ends.findIndex((e) => e < b.start);
        if (lane < 0) { lane = ends.length; ends.push(b.end); } else ends[lane] = b.end;
        out.set(b.id, lane);
      }
      count.set(r.id, Math.max(1, ends.length));
    }
    return { of: out, count };
  }, [rows, shown]);

  const begin = (e: React.PointerEvent, b: GanttBar, mode: Drag["mode"]) => {
    if (!onChange || b.editable === false) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d = { id: b.id, mode, x0: e.clientX, start: b.start, end: b.end, moved: false };
    dragRef.current = d; setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const bar = bars.find((x) => x.id === d.id)!;
    const n = Math.round((e.clientX - d.x0) / dayWidth);
    let start = bar.start, end = bar.end;
    if (d.mode === "move") { start = addDays(bar.start, n); end = addDays(bar.end, n); }
    if (d.mode === "start") { start = addDays(bar.start, n); if (start > end) start = end; }
    if (d.mode === "end") { end = addDays(bar.end, n); if (end < start) end = start; }
    const next = { ...d, start, end, moved: d.moved || Math.abs(e.clientX - d.x0) > 3 };
    dragRef.current = next; setDrag(next);
  };
  const end = () => {
    const d = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!d) return;
    const bar = bars.find((x) => x.id === d.id)!;
    if (!d.moved) { onBarClick?.(d.id); return; }
    if (d.start !== bar.start || d.end !== bar.end) onChange?.(d.id, d.start, d.end);
  };

  const months: { label: string; span: number }[] = [];
  for (const d of days) {
    const label = parseDay(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (months.at(-1)?.label === label) months.at(-1)!.span++; else months.push({ label, span: 1 });
  }
  const LANE = 30;

  return (
    <div ref={box} className="overflow-x-auto" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div style={{ width: labelWidth + width }} className="select-none">
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
          <div style={{ width: labelWidth }} className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface" />
          <div>
            <div className="flex">
              {months.map((m, i) => <div key={i} style={{ width: m.span * dayWidth }} className="truncate border-r border-line px-2 py-1 text-[11px] font-semibold text-ink-soft">{m.span * dayWidth > 70 ? m.label : ""}</div>)}
            </div>
            <div className="flex">
              {days.map((d) => {
                const dt = parseDay(d), wk = [0, 6].includes(dt.getDay());
                return (
                  <div key={d} style={{ width: dayWidth }} className={clsx("border-r border-line/60 py-1 text-center text-[10px] leading-tight", wk ? "bg-hover/50 text-ink-faint" : "text-ink-muted", d === today && "bg-accent-soft font-bold text-accent")}>
                    {dayWidth >= 24 && <div>{dt.toLocaleDateString("en-US", { weekday: "narrow" })}</div>}
                    <div className="tabular-nums">{dt.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Rows */}
        {rows.map((r) => {
          const h = lanes.count.get(r.id)! * LANE + 10;
          return (
            <div key={r.id} className="flex border-b border-line last:border-b-0">
              <div style={{ width: labelWidth, minHeight: h }} className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3 py-1.5 text-sm">
                <div className="truncate font-medium">{r.label}</div>
                {r.sub && <div className="truncate text-[11px] text-ink-faint">{r.sub}</div>}
              </div>
              <div className="relative" style={{ width, height: h }}>
                {/* Weekends and today */}
                {days.map((d, i) => [0, 6].includes(parseDay(d).getDay()) ? <div key={d} className="absolute inset-y-0 bg-hover/40" style={{ left: i * dayWidth, width: dayWidth }} /> : null)}
                {today >= from && today <= to && <div className="absolute inset-y-0 z-[1] w-px bg-accent/70" style={{ left: (daysBetween(from, today) + 0.5) * dayWidth }} />}
                {shown.filter((b) => b.rowId === r.id).map((b) => {
                  const s = b.start < from ? from : b.start, e = b.end > to ? to : b.end;
                  if (b.end < from || b.start > to) return null;
                  const left = daysBetween(from, s) * dayWidth, w = (daysBetween(s, e) + 1) * dayWidth;
                  const can = !!onChange && b.editable !== false;
                  const active = drag?.id === b.id;
                  return (
                    <div key={b.id} title={b.title ?? `${b.label}: ${fmtRange(b.start, b.end)}`}
                      onPointerDown={(ev) => (can ? begin(ev, b, "move") : undefined)}
                      onClick={() => { if (!can) onBarClick?.(b.id); }}
                      className={clsx("group absolute z-[2] flex items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold text-white shadow-sm",
                        can ? "cursor-grab active:cursor-grabbing" : onBarClick ? "cursor-pointer" : "", active && "ring-2 ring-ink/40", b.done && "opacity-60")}
                      style={{ left: left + 1, width: Math.max(w - 2, 6), top: 5 + lanes.of.get(b.id)! * LANE, height: LANE - 6, background: phaseHex(b.color) }}>
                      {can && <span onPointerDown={(ev) => begin(ev, b, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize opacity-0 group-hover:bg-white/30 group-hover:opacity-100" />}
                      <span className="truncate">{b.done ? "✓ " : ""}{b.label}</span>
                      {can && <span onPointerDown={(ev) => begin(ev, b, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover:bg-white/30 group-hover:opacity-100" />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!rows.length && <div style={{ width: space || undefined }} className="sticky left-0 px-4 py-12 text-center text-sm text-ink-faint">{empty ?? "Nothing scheduled."}</div>}
      </div>
      {drag && <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-surface shadow-lg">{fmtRange(drag.start, drag.end)}</div>}
    </div>
  );
}

export const fmtDay = (d: string | null, withYear = false) => (d ? parseDay(d).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }) : "—");
export function fmtRange(a: string | null, b: string | null) {
  if (!a) return "No dates";
  if (!b || a === b) return `${parseDay(a).toLocaleDateString("en-US", { weekday: "short" })} ${fmtDay(a)}`;
  const n = daysBetween(a, b) + 1;
  return `${fmtDay(a)} – ${fmtDay(b)} · ${n} day${n === 1 ? "" : "s"}`;
}

"use client";
/**
 * Dashboard: widgets for running a service. Tuning keys, ProPresenter control, SPL from
 * Smaart, Shure wireless, Planning Center Live, a clock, ProPresenter control, and Resi. Arrange them with
 * Edit (drag a widget to move it); the layout is saved on this Mac.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, ArrowUpToLine, GripVertical, LayoutDashboard, Pencil, Plus, Trash2 } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DashboardWidget, WidgetType } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { Modal } from "@/components/ui";
import { ProdClockWidget } from "@/components/clock/ClockWidget";
import { ResiWidget } from "@/components/resi/Resi";
import { useWeekend } from "@/lib/weekend";
import { ClockWidget, LiveWidget, ProWidget, SplWidget, TuningWidget, WirelessWidget, useHome, useWeekendService } from "@/components/dashboard/Widgets";

const NAMES: Record<WidgetType, string> = {
  tuning: "Tuning keys", spl: "SPL (Smaart)", wireless: "Shure wireless",
  live: "Planning Center Live", clock: "Clock & countdown", pro: "ProPresenter control", prodclock: "Production clock",
  resi: "Resi live stream",
};
const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT: DashboardWidget[] = [
  { id: "clock", type: "clock", size: "s", options: {} },
  { id: "live", type: "live", size: "m", options: {} },
  { id: "spl", type: "spl", size: "s", options: {} },
  { id: "tuning", type: "tuning", size: "l", options: {} },
  { id: "pro", type: "pro", size: "l", options: {} },
  { id: "wireless", type: "wireless", size: "l", options: {} },
];

export default function DashboardPage() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: qk.dashboard, queryFn: Api.dashboard });
  const [widgets, setWidgets] = useState<DashboardWidget[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [opts, setOpts] = useState<DashboardWidget | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (saved.isSuccess && !widgets) setWidgets(saved.data ?? DEFAULT); }, [saved.isSuccess, saved.data, widgets]);
  const save = useMutation({
    mutationFn: Api.saveDashboard,
    onSuccess: (w) => qc.setQueryData(qk.dashboard, w),
    onError: (e) => toast.error("Couldn’t save the dashboard", { description: (e as Error).message }),
  });
  const update = (next: DashboardWidget[]) => { setWidgets(next); save.mutate(next); };
  const list = widgets ?? [];
  const move = (i: number, d: -1 | 1) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; update(n); };
  const toTop = (i: number) => { if (i > 0) update([list[i], ...list.filter((_, k) => k !== i)]); };

  // Drag and drop (while editing): the dragged widget moves into place as it passes over the
  // others, and the new order is saved when it's dropped. Escape / dropping outside puts it back.
  const [dragId, setDragId] = useState<string | null>(null);
  const before = useRef<DashboardWidget[] | null>(null);
  const dropped = useRef(false);
  const dragOver = (overId: string, e: DragEvent<HTMLElement>) => {
    if (!dragId || overId === dragId) return;
    // Over the later half of a widget (below/right of its diagonal) → go after it, else before it.
    // The pointer stays in the same half once things move, so widgets don't flip back and forth.
    const r = e.currentTarget.getBoundingClientRect();
    const after = (e.clientY - r.top) / r.height + (e.clientX - r.left) / r.width > 1;
    setWidgets((cur) => {
      if (!cur) return cur;
      const w = cur.find((x) => x.id === dragId);
      if (!w) return cur;
      const n = cur.filter((x) => x.id !== dragId);
      const at = n.findIndex((x) => x.id === overId);
      if (at < 0) return cur;
      n.splice(at + (after ? 1 : 0), 0, w);
      return n.every((x, i) => x.id === cur[i].id) ? cur : n;
    });
  };
  const dragEnd = () => {
    if (dropped.current) { if (widgets && before.current && widgets.some((w, i) => w.id !== before.current![i].id)) save.mutate(widgets); }
    else if (before.current) setWidgets(before.current);
    before.current = null; dropped.current = false; setDragId(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3 pr-28">
        <LayoutDashboard size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <HomePicker />
        <div className="ml-auto flex gap-1.5">
          {editing && <button className="btn-outline py-1 text-xs" onClick={() => setAdding(true)}><Plus size={13} /> Add widget</button>}
          <button className={clsx("btn-ghost py-1 text-xs", editing && "bg-accent-soft text-accent")} onClick={() => setEditing(!editing)}><Pencil size={13} /> {editing ? "Done" : "Edit"}</button>
        </div>
      </header>
      <div className="grid auto-rows-[minmax(190px,auto)] grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4"
        onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={(e) => { if (dragId) { e.preventDefault(); dropped.current = true; } }}>
        {list.map((w, i) => (
          <div key={w.id}
            draggable={editing}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", w.id); before.current = list; dropped.current = false; setDragId(w.id); }}
            onDragEnter={(e) => { if (dragId) e.preventDefault(); }}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; dragOver(w.id, e); } }}
            onDragEnd={dragEnd}
            className={clsx("relative", w.size === "m" && "md:col-span-2", w.size === "l" && "md:col-span-2 xl:col-span-4",
              editing && "cursor-grab rounded-xl ring-1 ring-accent/40 active:cursor-grabbing", dragId === w.id && "opacity-40 ring-2 ring-accent")}>
            {/* While editing, the widget itself doesn't take clicks, so grabbing anywhere on it drags it. */}
            <div className={clsx("h-full", editing && "pointer-events-none select-none")}><Widget w={w} /></div>
            {editing && (
              <div className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow">
                <span className="flex items-center gap-0.5 px-1 text-[11px] text-ink-muted" title="Drag the widget to move it"><GripVertical size={12} /> Drag</span>
                <button className="btn-ghost p-1" title="Move to the top" disabled={i === 0} onClick={() => toTop(i)}><ArrowUpToLine size={12} /></button>
                <button className="btn-ghost p-1" title="Move earlier" onClick={() => move(i, -1)}><ArrowLeft size={12} /></button>
                <button className="btn-ghost p-1" title="Move later" onClick={() => move(i, 1)}><ArrowRight size={12} /></button>
                <select className="rounded bg-transparent px-1 text-[11px] text-ink-muted" value={w.size} onChange={(e) => update(list.map((x) => (x.id === w.id ? { ...x, size: e.target.value as DashboardWidget["size"] } : x)))}>
                  <option value="s">Small</option><option value="m">Wide</option><option value="l">Full</option>
                </select>
                <button className="btn-ghost p-1" title="Options" onClick={() => setOpts(w)}><Pencil size={12} /></button>
                <button className="btn-ghost p-1 hover:text-bad" title="Remove" onClick={() => update(list.filter((x) => x.id !== w.id))}><Trash2 size={12} /></button>
              </div>
            )}
          </div>
        ))}
        {!list.length && widgets && <div className="col-span-full rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink-muted">No widgets. Click Edit → Add widget.</div>}
      </div>

      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add a widget" width={460}>
          <div className="grid gap-1.5 p-4">
            {(Object.keys(NAMES) as WidgetType[]).map((t) => (
              <button key={t} className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent/50"
                onClick={() => { const w: DashboardWidget = { id: uid(), type: t, size: t === "tuning" || t === "wireless" ? "l" : t === "live" || t === "pro" || t === "resi" ? "m" : "s", options: {} }; update([...list, w]); setAdding(false); }}>
                {NAMES[t]}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {opts && <OptionsModal w={opts} onClose={() => setOpts(null)} onSave={(w) => { update(list.map((x) => (x.id === w.id ? w : x))); setOpts(null); }} />}
    </div>
  );
}

function Widget({ w }: { w: DashboardWidget }) {
  switch (w.type) {
    case "clock": return <ClockWidget />;
    case "live": return <LiveWidget o={w.options} />;
    case "tuning": return <TuningWidget o={w.options} />;
    case "spl": return <SplWidget o={w.options} />;
    case "wireless": return <WirelessWidget />;
    case "pro": return <ProWidget o={w.options} />;
    case "prodclock": return <ProdClockWidget />;
    case "resi": return <ResiWidget />;
  }
}

function OptionsModal({ w, onClose, onSave }: { w: DashboardWidget; onClose: () => void; onSave: (w: DashboardWidget) => void }) {
  const [o, setO] = useState(w.options);
  const plans = usePlans();
  const spl = useQuery({ queryKey: qk.smaartStatus, queryFn: Api.smaartStatus, enabled: w.type === "spl" });
  const machines = useQuery({ queryKey: qk.proMachines, queryFn: Api.proMachines, enabled: w.type === "pro" });
  const types = [...new Map((plans.data ?? []).map((p) => [p.serviceTypeId, p.serviceTypeName])).entries()];
  const set = (k: string, v: string | null) => setO({ ...o, [k]: v });
  return (
    <Modal open onClose={onClose} title={NAMES[w.type]} width={480}>
      <div className="space-y-3 p-5">
        {w.type === "spl" && (
          <label className="block"><span className="label">Label</span>
            <input className="input mt-1" value={(o.label as string) ?? ""} onChange={(e) => set("label", e.target.value)} placeholder="Main floor" />
          </label>
        )}
        {w.type === "spl" && (
          <label className="block"><span className="label">Reading</span>
            <select className="input mt-1" value={(o.reading as string) ?? ""} onChange={(e) => set("reading", e.target.value || null)}>
              <option value="">Automatic (LAeq if there is one)</option>
              {spl.data?.readings.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
        )}
        {(w.type === "tuning" || w.type === "live") && (
          <label className="block"><span className="label">Service</span>
            <select className="input mt-1" value={(o.serviceTypeId as string) ?? ""} onChange={(e) => set("serviceTypeId", e.target.value || null)}>
              <option value="">The dashboard’s service</option>
              {types.map(([id, n]) => <option key={id} value={id}>Next {n}</option>)}
            </select>
          </label>
        )}
        {w.type === "pro" && (
          <label className="block"><span className="label">ProPresenter computer</span>
            <select className="input mt-1" value={(o.machine as string) ?? ""} onChange={(e) => set("machine", e.target.value || null)}>
              {machines.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        {(w.type === "clock" || w.type === "wireless" || w.type === "prodclock") && <p className="text-sm text-ink-muted">This widget has no options.</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave({ ...w, options: o })}>Save</button>
      </footer>
    </Modal>
  );
}

/**
 * Your service: which campus (service type) the dashboard follows, in the weekend picked in the
 * sidebar. Widgets, the clock and the Live widget's Service link all use it.
 */
function HomePicker() {
  const qc = useQueryClient();
  const home = useHome();
  const plans = usePlans();
  const w = useWeekend().data;
  const next = useWeekendService();
  const types = [...new Map((plans.data ?? []).map((p) => [p.serviceTypeId, p.serviceTypeName])).entries()];
  const st = home.data?.serviceTypeId ?? "";
  const save = useMutation({
    mutationFn: Api.saveHome,
    onMutate: (h) => qc.setQueryData(qk.home, h),
    onSuccess: (h) => qc.setQueryData(qk.home, h),
    onError: (e) => { toast.error("Couldn’t save", { description: (e as Error).message }); void home.refetch(); },
  });
  if (!home.data) return null;
  const day = (p: { sortDate: string }) => new Date(p.sortDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="ml-3 flex min-w-0 items-center gap-1.5 text-xs">
      <span className="text-ink-muted">Your service</span>
      <select className="input w-auto max-w-[14rem] py-1 text-xs" value={st}
        onChange={(e) => save.mutate({ serviceTypeId: e.target.value || null, planId: null })} title="Which campus / service type the dashboard follows">
        <option value="">Any service type</option>
        {types.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
      </select>
      <span className={clsx("truncate", next ? "text-ink-soft" : "text-warn")}>
        {!w?.sunday ? "Pick a weekend in the sidebar" : next ? `${day(next)} · ${next.title}` : "No service that weekend"}
      </span>
    </div>
  );
}

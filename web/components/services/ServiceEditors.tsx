"use client";
/**
 * Two windows from the service page:
 *  - Service times: add, change or remove a service's times (services, rehearsals, anything else)
 *    in Planning Center.
 *  - View: which teams and times this service type shows in Sundays (synced to all your Macs).
 */
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { PlanDetail, PlanTime, ServiceViewPrefs } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock } from "@/lib/format";
import { allOfKind, timeKey } from "@/lib/serviceView";
import { Modal, Spinner } from "@/components/ui";

const KINDS: { id: PlanTime["kind"]; label: string }[] = [{ id: "service", label: "Service" }, { id: "rehearsal", label: "Rehearsal" }, { id: "other", label: "Other" }];
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toIso = (day: string, time: string) => new Date(`${day}T${time || "00:00"}`).toISOString();

type Row = { key: string; id?: string; name: string; kind: PlanTime["kind"]; day: string; start: string; end: string; dirty: boolean };
const rowOf = (t: PlanTime): Row => ({ key: t.id, id: t.id, name: t.name, kind: t.kind, day: localDay(t.startsAt), start: localTime(t.startsAt), end: localTime(t.endsAt || t.startsAt), dirty: false });

export function TimesModal({ plan, onClose }: { plan: PlanDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => plan.times.map(rowOf));
  const [gone, setGone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: Partial<Row>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...x, dirty: true } : r)));
  const firstDay = plan.times[0] ? localDay(plan.times[0].startsAt) : localDay(plan.sortDate);
  const add = () => setRows([...rows, { key: Math.random().toString(36).slice(2), name: "", kind: "rehearsal", day: firstDay, start: "18:00", end: "20:00", dirty: true }]);

  async function save() {
    for (const r of rows) {
      if (!r.dirty) continue;
      if (!r.day || !r.start) return toast.error("Every time needs a date and a start time");
      if (r.end && r.end < r.start) return toast.error(`${r.name || "A time"} ends before it starts`);
    }
    setBusy(true);
    let latest: PlanDetail | null = null;
    try {
      for (const id of gone) latest = await Api.deletePlanTime(plan.serviceTypeId, plan.id, id);
      for (const r of rows.filter((x) => x.dirty)) {
        latest = await Api.savePlanTime(plan.serviceTypeId, plan.id, { name: r.name.trim(), kind: r.kind, startsAt: toIso(r.day, r.start), endsAt: toIso(r.day, r.end || r.start) }, r.id);
      }
      if (latest) qc.setQueryData(qk.plan(plan.serviceTypeId, plan.id), latest);
      void qc.invalidateQueries({ queryKey: qk.plans });
      toast.success("Times saved to Planning Center");
      onClose();
    } catch (e) {
      toast.error("Planning Center didn’t accept that", { description: (e as Error).message });
      if (latest) qc.setQueryData(qk.plan(plan.serviceTypeId, plan.id), latest);
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} width={820} title="Service times">
      <div className="max-h-[70vh] space-y-2 overflow-y-auto p-5">
        <div className="hidden grid-cols-[1fr_120px_140px_100px_100px_32px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:grid">
          <span>Name</span><span>Kind</span><span>Date</span><span>Starts</span><span>Ends</span><span />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_120px_150px_124px_124px_32px]">
            <input className="input col-span-2 sm:col-span-1" value={r.name} placeholder={r.kind === "service" ? "e.g. 9:00 (optional)" : "e.g. Band rehearsal"} onChange={(e) => set(r.key, { name: e.target.value })} />
            <select className="input" value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value as PlanTime["kind"] })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            <input type="date" className="input" value={r.day} onChange={(e) => set(r.key, { day: e.target.value })} />
            <input type="time" className="input" value={r.start} onChange={(e) => set(r.key, { start: e.target.value })} />
            <input type="time" className="input" value={r.end} onChange={(e) => set(r.key, { end: e.target.value })} />
            <button className="btn-ghost p-1.5 text-ink-faint hover:text-bad" title="Remove" onClick={() => { if (r.id) setGone([...gone, r.id]); setRows(rows.filter((x) => x.key !== r.key)); }}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn-ghost text-xs" onClick={add}><Plus size={13} /> Add a time</button>
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="text-[11px] text-ink-faint">Saves straight to Planning Center.</span>
        <button className="btn-ghost ml-auto" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || (!gone.length && !rows.some((r) => r.dirty))} onClick={() => void save()}>{busy && <Spinner />} Save</button>
      </footer>
    </Modal>
  );
}

/** Which teams and times this service type shows. Unticked = hidden on the service page and the Matrix. */
export function ViewModal({ plan, prefs, onSave, onClose }: { plan: PlanDetail; prefs: ServiceViewPrefs; onSave: (p: ServiceViewPrefs) => Promise<void>; onClose: () => void }) {
  const [teams, setTeams] = useState(new Set(prefs.teams));
  const [times, setTimes] = useState(new Set(prefs.times));
  const [busy, setBusy] = useState(false);
  const allTeams = [...new Map([...plan.teams.map((t) => [t.id, t.name] as const), ...plan.roster.map((m) => [m.teamId, m.teamName] as const), ...plan.needed.map((n) => [n.teamId, n.teamName] as const)]).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const flip = (s: Set<string>, k: string, set: (s: Set<string>) => void) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); set(n); };
  const kindHidden = (k: PlanTime["kind"]) => times.has(allOfKind(k));
  return (
    <Modal open onClose={onClose} width={620} title={`What ${plan.serviceTypeName} shows`}>
      <div className="grid max-h-[70vh] gap-6 overflow-y-auto p-5 sm:grid-cols-2">
        <div>
          <div className="label">Times</div>
          <p className="mt-0.5 text-[11px] text-ink-muted">Hidden times stay in Planning Center; they just don’t show here. A time is matched by its kind, name and time of day, so it stays hidden every week.</p>
          <div className="mt-2 space-y-1.5">
            {(["rehearsal", "other"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!kindHidden(k)} onChange={() => flip(times, allOfKind(k), setTimes)} /> Show {k === "rehearsal" ? "rehearsals" : "other times"}
              </label>
            ))}
            <div className="my-2 h-px bg-line" />
            {plan.times.map((t) => {
              const k = timeKey(t);
              const off = kindHidden(t.kind);
              return (
                <label key={t.id} className={clsx("flex items-center gap-2 text-sm", off && "opacity-40")}>
                  <input type="checkbox" disabled={off} checked={!off && !times.has(k)} onChange={() => flip(times, k, setTimes)} />
                  <span>{t.kind === "service" ? `Service · ${clock(t.startsAt)}` : `${t.name || (t.kind === "rehearsal" ? "Rehearsal" : "Other")} · ${clock(t.startsAt)}`}</span>
                </label>
              );
            })}
            {!plan.times.length && <p className="text-xs text-ink-faint">This service has no times.</p>}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between"><span className="label">Teams</span>
            <span className="flex gap-2 text-[11px]"><button className="text-accent hover:underline" onClick={() => setTeams(new Set())}>All</button><button className="text-accent hover:underline" onClick={() => setTeams(new Set(allTeams.map(([id]) => id)))}>None</button></span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-muted">Hidden teams don’t show in the roster, the counts or the Matrix.</p>
          <div className="mt-2 space-y-1.5">
            {allTeams.map(([id, name]) => (
              <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!teams.has(id)} onChange={() => flip(teams, id, setTeams)} /> {name}</label>
            ))}
          </div>
        </div>
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="text-[11px] text-ink-faint">For {plan.serviceTypeName}, on every Mac you sign in on.</span>
        <button className="btn-ghost ml-auto" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await onSave({ teams: [...teams], times: [...times] }); onClose(); }
          catch (e) { toast.error("Couldn’t save", { description: (e as Error).message }); setBusy(false); }
        }}>{busy && <Spinner />} Save</button>
      </footer>
    </Modal>
  );
}

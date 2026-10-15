"use client";
/**
 * Check-in settings on the website (people who manage check-ins): for each service type, the
 * Planning Center Check-Ins event volunteers check in to and each team's location in it (its area
 * of serving), and ministries that group teams. The same settings as the Mac's Preferences → Team
 * Check-ins, kept in Sundays' cloud for the church.
 */
import clsx from "clsx";
import { ArrowLeft, CalendarCheck, Layers, MapPin, Plus, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CheckinConfig, CheckinLocation, CheckinSetup } from "@shared/ops/checkin";
import { CheckinApi } from "@/lib/checkin";
import { Shell } from "./ui";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));
/** Best-guess location for a team: shared words in the team and location (or its folder) names. */
function guess(team: string, locs: CheckinLocation[]) {
  const tw = new Set(words(team));
  let best: { id: string; name: string } | null = null;
  let score = 0;
  for (const l of locs) {
    const n = words(l.name).filter((w) => tw.has(w)).length * 2 + words(l.folder ?? "").filter((w) => tw.has(w)).length;
    if (n > score) { score = n; best = { id: l.id, name: l.name }; }
  }
  return best;
}

export function CheckinSettings({ onClose }: { onClose: (changed: boolean) => void }) {
  const [setup, setSetup] = useState<CheckinSetup | null>(null);
  const [draft, setDraft] = useState<CheckinConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"events" | "ministries">("events");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { CheckinApi.setup().then((s) => { setSetup(s); setDraft(s.config); }).catch((e) => setError((e as Error).message)); }, []);

  // Each event's areas load on their own, only for events that are chosen (reading them all was slow).
  const [locs, setLocs] = useState<Record<string, CheckinLocation[] | "loading" | { error: string }>>({});
  const wanted = useMemo(() => [...new Set(Object.values(draft?.events ?? {}).map((e) => e.id))], [draft?.events]);
  useEffect(() => {
    if (!setup) return;
    for (const id of wanted) {
      if (locs[id] || !setup.events.some((e) => e.id === id)) continue;
      setLocs((m) => ({ ...m, [id]: "loading" }));
      CheckinApi.locations(id)
        .then((r) => setLocs((m) => ({ ...m, [id]: r.locations })))
        .catch((e) => setLocs((m) => ({ ...m, [id]: { error: (e as Error).message } })));
    }
  }, [setup, wanted, locs]);
  const dirty = Boolean(setup && draft && JSON.stringify(setup.config) !== JSON.stringify(draft));

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const c = await CheckinApi.saveSettings({ ...draft, groups: draft.groups.filter((g) => g.name.trim()) });
      setSetup((s) => s && { ...s, config: c }); setDraft(c); setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 pb-3 backdrop-blur" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <div className="flex items-center gap-2">
          <button className="btn-ghost -ml-2 p-1.5" aria-label="Back" onClick={() => (dirty && !confirm("Leave without saving?") ? null : onClose(saved))}><ArrowLeft size={20} /></button>
          <h1 className="text-lg font-semibold">Check-in settings</h1>
          <button className="btn-primary ml-auto px-4 py-1.5" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
        <div className="mt-3 flex rounded-xl border border-line p-0.5 text-sm">
          {([["events", "Events & areas", CalendarCheck], ["ministries", "Ministries", Layers]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition", tab === k ? "bg-accent text-white" : "text-ink-soft")}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </header>
      <main className="flex-1 space-y-4 px-4 py-4">
        {error && <p className="rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
        {!setup && !error && <p className="py-10 text-center text-ink-muted">Loading from Planning Center…</p>}
        {setup && draft && tab === "events" && <Events setup={setup} draft={draft} locs={locs} onChange={setDraft} />}
        {setup && draft && tab === "ministries" && <Ministries setup={setup} draft={draft} onChange={setDraft} />}
      </main>
    </Shell>
  );
}

type Locs = Record<string, CheckinLocation[] | "loading" | { error: string }>;

function Events({ setup, draft, locs, onChange }: { setup: CheckinSetup; draft: CheckinConfig; locs: Locs; onChange: (c: CheckinConfig) => void }) {
  return (
    <>
      <p className="text-sm text-ink-muted">
        Choose the Check-Ins <b className="text-ink-soft">event</b> volunteers check in to for each service, and each team’s <b className="text-ink-soft">area</b> in it.
        Only check-ins to that event count, and check-ins made here are recorded at the team’s area.
      </p>
      {setup.eventsError && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{setup.eventsError}</p>}
      {setup.serviceTypes.map((st) => <ServiceType key={st.id} st={st} events={setup.events} locs={locs} config={draft} onChange={onChange} />)}
      {!setup.serviceTypes.length && <p className="text-sm text-ink-muted">No service types you can see in Planning Center.</p>}
    </>
  );
}

function ServiceType({ st, events, locs, config, onChange }: { st: CheckinSetup["serviceTypes"][number]; events: CheckinSetup["events"]; locs: Locs; config: CheckinConfig; onChange: (c: CheckinConfig) => void }) {
  const ev = config.events[st.id] ?? null;
  const known = events.find((e) => e.id === ev?.id);
  const loaded = known ? locs[known.id] : undefined;
  const locations = Array.isArray(loaded) ? loaded : null;
  const event = known && locations ? { ...known, locations } : null;
  const [open, setOpen] = useState(false);
  const assigned = st.teams.filter((t) => config.teamLocations[t.id]).length;
  const folders = [...new Set((event?.locations ?? []).map((l) => l.folder ?? ""))];
  const setEvent = (id: string) => {
    const e = events.find((x) => x.id === id);
    const evs = { ...config.events };
    if (e) evs[st.id] = { id: e.id, name: e.name }; else delete evs[st.id];
    // A different event: its areas are different, so the teams' areas go.
    const tl = { ...config.teamLocations };
    if (e?.id !== ev?.id) for (const t of st.teams) delete tl[t.id];
    onChange({ ...config, events: evs, teamLocations: tl });
    setOpen(true);
  };
  const setLoc = (teamId: string, locId: string) => {
    const l = event?.locations.find((x) => x.id === locId);
    const tl = { ...config.teamLocations };
    if (l) tl[teamId] = { id: l.id, name: l.name }; else delete tl[teamId];
    onChange({ ...config, teamLocations: tl });
  };
  const autoFill = () => {
    if (!event) return;
    const tl = { ...config.teamLocations };
    for (const t of st.teams) { if (tl[t.id]) continue; const g = guess(t.name, event.locations); if (g) tl[t.id] = g; }
    onChange({ ...config, teamLocations: tl });
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-semibold">{st.name}</h2>
      <select className={clsx("input mt-2 w-full py-2 text-[16px]", !ev && "border-warn/60")} value={ev?.id ?? ""} onChange={(e) => setEvent(e.target.value)}>
        <option value="">Choose the volunteer event…</option>
        {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      {ev && !known && <p className="mt-2 text-xs text-warn">“{ev.name}” isn’t in Check-Ins any more. Choose another event.</p>}
      {known && loaded === "loading" && <p className="mt-3 text-sm text-ink-muted">Loading its areas…</p>}
      {known && loaded && typeof loaded === "object" && !Array.isArray(loaded) && <p className="mt-3 text-sm text-warn">{loaded.error}</p>}
      {event && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <button className="flex items-center gap-1.5 text-sm text-ink-muted" onClick={() => setOpen(!open)}>
              <MapPin size={13} /> {assigned} of {st.teams.length} teams have an area {open ? "· hide" : "· show"}
            </button>
            {open && <button className="btn-ghost py-1 text-xs" onClick={autoFill}><Wand2 size={13} /> Match by name</button>}
          </div>
          {open && (
            <ul className="mt-2 divide-y divide-line/60 rounded-xl border border-line">
              {st.teams.map((t) => (
                <li key={t.id} className="px-3 py-2">
                  <div className="text-sm">{t.name}</div>
                  <select className={clsx("input mt-1 w-full py-1.5 text-[16px]", !config.teamLocations[t.id] && "text-ink-muted")} value={config.teamLocations[t.id]?.id ?? ""} onChange={(e) => setLoc(t.id, e.target.value)}>
                    <option value="">No area (event only)</option>
                    {folders.map((f) => {
                      const opts = event.locations.filter((l) => (l.folder ?? "") === f).map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
                      return f ? <optgroup key={f} label={f}>{opts}</optgroup> : opts;
                    })}
                  </select>
                </li>
              ))}
              {!st.teams.length && <li className="px-3 py-3 text-sm text-ink-muted">No teams on this service type.</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Ministries({ setup, draft, onChange }: { setup: CheckinSetup; draft: CheckinConfig; onChange: (c: CheckinConfig) => void }) {
  const list = draft.groups;
  const set = (groups: CheckinConfig["groups"]) => onChange({ ...draft, groups });
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const st of setup.serviceTypes) for (const t of st.teams) m.set(t.id, setup.serviceTypes.length > 1 ? `${t.name} · ${st.name}` : t.name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [setup]);
  const groupOf = (teamId: string) => list.find((g) => g.teamIds.includes(teamId))?.id ?? "";
  const move = (teamId: string, gid: string) => set(list.map((g) => ({ ...g, teamIds: g.id === gid ? [...g.teamIds.filter((x) => x !== teamId), teamId] : g.teamIds.filter((x) => x !== teamId) })));
  return (
    <>
      <p className="text-sm text-ink-muted">Ministries group teams on the check-in page (First Responders → Safety, Medical), with a button for each at the top.</p>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Ministries</span>
          <button className="btn-ghost py-1 text-sm" onClick={() => set([...list, { id: `g${Math.random().toString(36).slice(2, 8)}`, name: "New ministry", teamIds: [] }])}><Plus size={14} /> Add</button>
        </div>
        <div className="space-y-2">
          {list.map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              <input className="input w-full py-2 text-[16px]" value={g.name} onChange={(e) => set(list.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))} />
              <button className="btn-ghost p-2 text-ink-muted" aria-label="Remove" onClick={() => set(list.filter((x) => x.id !== g.id))}><Trash2 size={16} /></button>
            </div>
          ))}
          {!list.length && <p className="text-sm text-ink-muted">Add ministries like “First Responders” or “Guest Services”, then put teams under them.</p>}
        </div>
      </section>
      {list.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface">
          <div className="px-4 pt-3 text-sm font-semibold">Teams</div>
          <ul className="mt-1 divide-y divide-line/60">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                <select className="input w-40 py-1.5 text-[16px]" value={groupOf(t.id)} onChange={(e) => move(t.id, e.target.value)}>
                  <option value="">None</option>
                  {list.map((g) => <option key={g.id} value={g.id}>{g.name || "Untitled"}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

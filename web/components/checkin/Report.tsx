"use client";
/**
 * A printable check-in report: teams grouped by ministry, with who checked in and who didn't.
 * For one service or every service that day. Always printed light (black on white), whatever the
 * phone's theme; the toolbar doesn't print.
 */
import clsx from "clsx";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CheckinMe, CheckinPerson, CheckinPlanData, CheckinService } from "@shared/ops/checkin";
import { CheckinApi } from "@/lib/checkin";
import { groupTeams, tally } from "./sections";

type Scope = "service" | "day";
interface Loaded { service: CheckinService; data: CheckinPlanData }

export function CheckinReport({ me, service, data, onClose }: {
  me: CheckinMe; service: CheckinService; data: CheckinPlanData | null; onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("service");
  const [names, setNames] = useState<"all" | "missing" | "none">("all");
  const [day, setDay] = useState<Loaded[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tz = me.timeZone;
  const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const dayLabel = new Date(service.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

  // Every service that day, read once when "Whole day" is picked.
  useEffect(() => {
    if (scope !== "day" || day) return;
    let alive = true;
    (async () => {
      try {
        const { services } = await CheckinApi.services(localDay(service.sortDate));
        const list = services.length ? services : [service];
        const loaded: Loaded[] = [];
        for (const s of list) loaded.push({ service: s, data: s.id === service.id && data ? data : await CheckinApi.plan(s.serviceTypeId, s.id) });
        if (alive) setDay(loaded);
      } catch (e) { if (alive) setError((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const runs: Loaded[] | null = scope === "service" ? (data ? [{ service, data }] : null) : day;
  const many = (runs?.length ?? 0) > 1;

  /** Ministries across the chosen services: each team once per service. */
  const report = useMemo(() => {
    if (!runs) return null;
    const groups = runs[0].data.groups;
    const rows = runs.flatMap((r) => groupTeams(r.data.teams, groups).map((sec) => ({ ...sec, service: r.service })));
    const order: string[] = [];
    const by = new Map<string, { id: string; name: string; teams: { service: CheckinService; team: (typeof rows)[number]["teams"][number] }[] }>();
    for (const r of rows) {
      if (!by.has(r.id)) { by.set(r.id, { id: r.id, name: r.name, teams: [] }); order.push(r.id); }
      for (const t of r.teams) by.get(r.id)!.teams.push({ service: r.service, team: t });
    }
    // "Other teams" last.
    order.sort((a, b) => Number(a === "other") - Number(b === "other"));
    return order.map((id) => by.get(id)!);
  }, [runs]);

  const totals = report ? tally(report.flatMap((m) => m.teams.map((t) => t.team))) : null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const status = (p: CheckinPerson) => p.checkedInAt
    ? `In ${clock(p.checkedInAt)}${p.checkedInVia === "staff" ? ` · by ${p.checkedInBy ?? "staff"}` : ""}${p.location && p.expectedLocation && p.location !== p.expectedLocation ? ` · at ${p.location}` : ""}`
    : p.status === "U" ? "Not checked in · unconfirmed" : "Not checked in";
  const svcLabel = (s: CheckinService) => `${clock(s.sortDate)} ${s.serviceTypeName}`;

  return (
    <div className="print-area checkin-report min-h-[100dvh] bg-white text-black print:min-h-0">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <button className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-100" aria-label="Back" onClick={onClose}><ArrowLeft size={20} /></button>
        <h1 className="text-lg font-semibold">Check-in report</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <Toggle value={scope} onChange={setScope} options={[["service", "This service"], ["day", "Whole day"]]} />
          <Toggle value={names} onChange={setNames} options={[["all", "Everyone"], ["missing", "Not in"], ["none", "Totals only"]]} />
          <button className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={!report} onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-6 print:max-w-none print:px-0 print:py-0">
        <header className="border-b-2 border-black pb-3">
          <div className="text-sm text-neutral-600">{me.church}</div>
          <h2 className="text-2xl font-bold">Team check-ins · {dayLabel}</h2>
          <div className="mt-1 text-sm text-neutral-700">
            {scope === "service" ? svcLabel(service) : runs ? runs.map((r) => svcLabel(r.service)).join(" · ") : "Every service that day"}
          </div>
          <div className="mt-1 text-xs text-neutral-500">Printed {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz })} by {me.name}</div>
        </header>

        {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {!report && !error && <p className="mt-6 text-neutral-500">Loading…</p>}

        {report && totals && (
          <>
            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-1.5 pr-2 font-semibold">Ministry</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Teams</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Checked in</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Scheduled</th>
                  <th className="py-1.5 text-right font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {report.map((m) => {
                  const c = tally(m.teams.map((t) => t.team));
                  return (
                    <tr key={m.id} className="border-b border-neutral-200">
                      <td className="py-1.5 pr-2">{m.name}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{new Set(m.teams.map((t) => t.team.teamId)).size}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{c.inn}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{c.all}</td>
                      <td className="py-1.5 text-right tabular-nums">{pct(c.inn, c.all)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-black font-semibold">
                  <td className="py-1.5 pr-2">Total</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{new Set(report.flatMap((m) => m.teams.map((t) => t.team.teamId))).size}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{totals.inn}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{totals.all}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(totals.inn, totals.all)}</td>
                </tr>
              </tbody>
            </table>

            {names !== "none" && report.map((m) => {
              const c = tally(m.teams.map((t) => t.team));
              return (
                <section key={m.id} className="mt-7">
                  <h3 className="flex break-after-avoid items-baseline justify-between border-b-2 border-black pb-1 text-lg font-bold">
                    <span>{m.name}</span><span className="text-sm font-semibold tabular-nums">{c.inn}/{c.all}</span>
                  </h3>
                  {m.teams.map(({ service: s, team }) => {
                    const people = [...team.people]
                      .filter((p) => names === "all" || !p.checkedInAt)
                      .sort((a, b) => Number(Boolean(a.checkedInAt)) - Number(Boolean(b.checkedInAt)) || a.name.localeCompare(b.name));
                    const t = tally([team]);
                    return (
                      <div key={`${s.id}:${team.teamId}`} className="mt-3 break-inside-avoid">
                        <div className="flex items-baseline justify-between text-sm font-semibold">
                          <span>{team.teamName}{many ? <span className="font-normal text-neutral-600"> · {svcLabel(s)}</span> : null}</span>
                          <span className="tabular-nums">{t.inn}/{t.all}</span>
                        </div>
                        {people.length ? (
                          <table className="mt-1 w-full table-fixed border-collapse text-[13px]">
                            <colgroup><col className="w-6" /><col className="w-[34%]" /><col className="w-[26%]" /><col /></colgroup>
                            <tbody>
                              {people.map((p) => (
                                <tr key={p.personId} className="border-b border-neutral-200 align-top">
                                  <td className="w-5 py-1 pr-1">{p.checkedInAt ? "✓" : "☐"}</td>
                                  <td className="truncate py-1 pr-2">{p.name}</td>
                                  <td className="truncate py-1 pr-2 text-neutral-600">{p.positions.join(", ")}</td>
                                  <td className={clsx("py-1 text-right", !p.checkedInAt && "font-semibold")}>{status(p)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="mt-1 text-[13px] text-neutral-500">{names === "missing" ? "Everyone checked in." : "Nobody scheduled."}</p>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-lg border border-neutral-300 p-0.5">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className={clsx("rounded-md px-2.5 py-1", value === k ? "bg-neutral-900 text-white" : "text-neutral-700")}>{label}</button>
      ))}
    </div>
  );
}

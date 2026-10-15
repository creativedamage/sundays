"use client";
/**
 * Teams and times hidden on the services pages, per service type (synced with your settings to
 * every Mac you sign in on). Times are matched by kind, name and time of day, so hiding the 7:00 PM
 * rehearsal hides it every week; "rehearsal|*" hides every rehearsal.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, PlanDetail, PlanTime, ServiceViewPrefs } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock } from "@/lib/format";

export const timeKey = (t: Pick<PlanTime, "kind" | "name" | "startsAt">) => `${t.kind}|${t.name.trim()}|${clock(t.startsAt)}`;
export const allOfKind = (kind: PlanTime["kind"]) => `${kind}|*`;
const EMPTY: ServiceViewPrefs = { teams: [], times: [] };

export function hidesTime(p: ServiceViewPrefs, t: PlanTime) {
  return p.times.includes(allOfKind(t.kind)) || p.times.includes(timeKey(t));
}

/** The plan as the services pages show it: without hidden teams (roster, open slots) and times. */
export function visiblePlan(plan: PlanDetail, p: ServiceViewPrefs): PlanDetail {
  if (!p.teams.length && !p.times.length) return plan;
  const hidden = new Set(p.teams);
  const roster = plan.roster.filter((m) => !hidden.has(m.teamId));
  return {
    ...plan,
    teams: plan.teams.filter((t) => !hidden.has(t.id)),
    roster,
    needed: plan.needed.filter((n) => !hidden.has(n.teamId)),
    times: plan.times.filter((t) => !hidesTime(p, t)),
    confirmedCount: roster.filter((m) => m.status === "C").length,
    unconfirmedCount: roster.filter((m) => m.status === "U").length,
    declinedCount: roster.filter((m) => m.status === "D").length,
    neededCount: plan.needed.filter((n) => !hidden.has(n.teamId)).reduce((s, n) => s + n.quantity, 0),
  };
}

export function useServiceView(serviceTypeId: string) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 60_000 });
  const all = settings.data?.serviceView ?? {};
  const prefs = all[serviceTypeId] ?? EMPTY;
  const save = async (next: ServiceViewPrefs) => {
    const map = { ...all, [serviceTypeId]: next };
    if (!next.teams.length && !next.times.length) delete map[serviceTypeId];
    qc.setQueryData<AppSettings>(qk.settings, (s) => s && { ...s, serviceView: map });
    const saved = await Api.saveSettings({ serviceView: map });
    qc.setQueryData(qk.settings, saved);
  };
  return { prefs, save, ready: Boolean(settings.data) };
}

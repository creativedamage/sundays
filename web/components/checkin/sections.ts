/** Teams grouped under the church's ministries (check-in page and report share this). */
import type { CheckinGroup, CheckinTeam } from "@shared/ops/checkin";

export interface Section { id: string; name: string; teams: CheckinTeam[] }

export function groupTeams(teams: CheckinTeam[], groups: CheckinGroup[]): Section[] {
  const byId = new Map(teams.map((x) => [x.teamId, x]));
  const used = new Set<string>();
  const out: Section[] = groups.map((g) => {
    const list = g.teamIds.map((id) => byId.get(id)).filter((x): x is CheckinTeam => Boolean(x));
    list.forEach((x) => used.add(x.teamId));
    return { id: g.id, name: g.name, teams: list };
  }).filter((s) => s.teams.length);
  const rest = teams.filter((x) => !used.has(x.teamId));
  if (rest.length) out.push({ id: "other", name: out.length ? "Other teams" : "Teams", teams: rest });
  return out;
}

export const tally = (list: CheckinTeam[]) => ({
  inn: list.reduce((n, x) => n + x.people.filter((p) => p.checkedInAt).length, 0),
  all: list.reduce((n, x) => n + x.people.length, 0),
});

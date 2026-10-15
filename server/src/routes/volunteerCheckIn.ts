/**
 * /api/volunteer-checkin: Preferences → Team Check-ins. Which Planning Center Check-Ins event
 * volunteers check in to for each service type, and each team's location (area of serving) in it.
 * Staff check-ins are recorded as volunteers there; Check-Ins scans to other events don't count.
 */
import { Router } from "express";
import { z } from "zod";
import type { CheckInLocation, VolunteerCheckInSetup } from "../../../shared/types.js";
import { saveVolunteerConfig, volunteerConfig } from "../lib/teamCheckins.js";

export const volunteerCheckInRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/** Just this Mac's saved settings (no Planning Center calls): for bringing them to the website. */
volunteerCheckInRouter.get("/config", (_req, res) => res.json(volunteerConfig()));

volunteerCheckInRouter.get("/", h(async (req, res) => {
  // ?st=1,2: only these service types (your campus), so nothing from other campuses is loaded.
  const only = new Set(String(req.query.st ?? "").split(",").filter(Boolean));
  const types = (await req.pco.listServiceTypes()).filter((t: { id: string }) => !only.size || only.has(t.id));
  const serviceTypes = await Promise.all(types.map(async (t: { id: string; name: string }) => ({ id: t.id, name: t.name, teams: await req.pco.listTeams(t.id).catch(() => []) })));
  let eventsError: string | null = null;
  const locs: CheckInLocation[] = await req.pco.listCheckInLocations().catch((e: any) => { eventsError = e?.status === 401 || e?.status === 403 ? "Your Planning Center account can’t read Check-Ins." : (e?.message ?? "Check-Ins couldn’t be read."); return []; });
  const events = new Map<string, VolunteerCheckInSetup["events"][number]>();
  for (const l of locs) {
    const id = l.eventId ?? l.event;
    const e = events.get(id) ?? { id, name: l.event, locations: [] };
    e.locations.push({ id: l.id, name: l.name, folder: l.folder });
    events.set(id, e);
  }
  // Volunteer-looking events first.
  const vol = (n: string) => (/volunteer|serve|team/i.test(n) ? 0 : 1);
  const out: VolunteerCheckInSetup = {
    config: volunteerConfig(), serviceTypes,
    events: [...events.values()].sort((a, b) => vol(a.name) - vol(b.name) || a.name.localeCompare(b.name)),
    eventsError,
  };
  res.json(out);
}));

const Ref = z.object({ id: z.string().min(1).max(100), name: z.string().max(300) });
/**
 * Save the service types you edited (and only those): each one's event and its teams' locations.
 * Anything not sent (another campus's setup) is left as it is.
 */
volunteerCheckInRouter.put("/", (req, res) => {
  const { serviceTypes } = z.object({
    serviceTypes: z.array(z.object({
      id: z.string().min(1).max(100),
      event: Ref.nullable(),
      teams: z.array(z.object({ id: z.string().min(1).max(100), location: Ref.nullable() })).max(500),
    })).max(200),
  }).parse(req.body);
  const c = volunteerConfig();
  const events = { ...c.events };
  const teamLocations = { ...c.teamLocations };
  for (const st of serviceTypes) {
    if (st.event) events[st.id] = { id: st.event.id, name: st.event.name.slice(0, 200) }; else delete events[st.id];
    for (const t of st.teams) {
      if (t.location) teamLocations[t.id] = { id: t.location.id, name: t.location.name.slice(0, 200) }; else delete teamLocations[t.id];
    }
  }
  res.json(saveVolunteerConfig({ events, teamLocations }));
});

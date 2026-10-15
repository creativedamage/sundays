/**
 * Team check-ins on the website (sundays-checkin.vercel.app): who may use it, and what the ops
 * Edge Function sends the check-in page. Pure module, shared by the function and the page.
 *
 * People sign in with their own Planning Center account, so what they see is what Planning Center
 * lets them see. Sundays adds one thing on top: whether they may use check-ins at all, set per
 * person in Operations → Settings → People.
 *
 *   None      no check-ins
 *   View      see teams and who's checked in
 *   Check in  + check people in (and undo it)
 *   Manage    + check-in settings: each service type's volunteer event, team areas, ministries
 *
 * System admins can always manage check-ins.
 */
export type CheckinLevel = "NONE" | "VIEW" | "CHECKIN" | "MANAGER";
export const CHECKIN_RANK: Record<CheckinLevel, number> = { NONE: 0, VIEW: 1, CHECKIN: 2, MANAGER: 3 };
export const CHECKIN_LEVELS: { key: CheckinLevel; label: string; help: string }[] = [
  { key: "NONE", label: "None", help: "No team check-ins" },
  { key: "VIEW", label: "View", help: "See teams and who’s checked in" },
  { key: "CHECKIN", label: "Check in", help: "See teams and check people in" },
  { key: "MANAGER", label: "Manage", help: "Check people in, plus each service’s volunteer event, team areas and ministries" },
];

export const checkinLabel = (l: CheckinLevel) => CHECKIN_LEVELS.find((x) => x.key === l)?.label ?? "None";

/** A membership's check-in level: System admins always manage; everyone else has what they were given. */
export function checkinLevelFor(u: { role: string; syncedRole?: string | null; checkinLevel?: string | null }): CheckinLevel {
  if (u.role === "ADMIN" || u.syncedRole === "ADMIN") return "MANAGER";
  const l = (u.checkinLevel ?? "NONE") as CheckinLevel;
  return l in CHECKIN_RANK ? l : "NONE";
}
export const checkinAtLeast = (l: CheckinLevel, want: CheckinLevel) => CHECKIN_RANK[l] >= CHECKIN_RANK[want];

/* ───────────── What the page gets ───────────── */

export interface CheckinMe {
  name: string;
  avatarUrl: string | null;
  level: CheckinLevel;
  church: string;
  logo: string | null;
  /** The church's time zone in Planning Center (dates and "today" follow it). */
  timeZone: string;
}

export interface CheckinService { id: string; serviceTypeId: string; serviceTypeName: string; title: string; sortDate: string }
/** GET /checkin/services: last week's and upcoming services (or one day's), and today in the church's time zone. */
export interface CheckinServices { services: CheckinService[]; today: string }

export interface CheckinPerson {
  personId: string; name: string; avatarUrl: string | null; positions: string[]; status: "C" | "U" | "D";
  checkedInAt: string | null;
  /** "checkins" = scanned in Planning Center Check-Ins; "staff" = checked in here by someone. */
  checkedInVia?: "checkins" | "staff";
  checkedInBy?: string;
  location?: string | null;
  expectedLocation?: string | null;
}
export interface CheckinTeam { teamId: string; teamName: string; people: CheckinPerson[] }
export interface CheckinGroup { id: string; name: string; teamIds: string[] }

export interface CheckinPlanData {
  teams: CheckinTeam[];
  groups: CheckinGroup[];
  /** Why Planning Center Check-Ins couldn't be read (then only check-ins made here show). */
  checkInsError: string | null;
  /** The Check-Ins event that counts for this service type (null = not chosen yet). */
  event: { id: string; name: string } | null;
  fetchedAt: string;
}

export interface CheckinConfig {
  events: Record<string, { id: string; name: string }>;
  teamLocations: Record<string, { id: string; name: string }>;
  groups: CheckinGroup[];
}
export interface CheckinLocation { id: string; name: string; folder: string | null }
export interface CheckinSetup {
  config: CheckinConfig;
  serviceTypes: { id: string; name: string; teams: { id: string; name: string }[] }[];
  /** Check-Ins events. `locations` is null until loaded (GET /checkin/setup/locations?event=). */
  events: { id: string; name: string; locations: CheckinLocation[] | null }[];
  eventsError: string | null;
}

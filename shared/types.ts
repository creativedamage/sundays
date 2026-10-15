/**
 * Domain DTOs shared by server and web (type-only imports).
 * The server flattens PCO's JSON:API into these shapes so the UI never deals with JSON:API.
 */

import type { BoardTile } from "./board.js";
export interface Person {
  id: string; // PCO person id — identical across People and Services
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  /** The number marked "Mobile" in Planning Center (for texting), if there is one. */
  mobile?: string | null;
}

/** Everything the person panel shows (Matrix → click a person). */
export interface PersonProfile {
  person: Person;
  emails: { address: string; location: string | null; primary: boolean }[];
  phones: { number: string; location: string | null; primary: boolean }[];
  address: string | null;
  birthdate: string | null;
  membership: string | null;
  /** Upcoming Services schedule (every service type). */
  schedule: { planId: string | null; serviceTypeId: string | null; serviceTypeName: string; date: string; teamName: string; position: string; status: "C" | "U" | "D" }[];
  /** Upcoming blockouts. */
  blockouts: { id: string; reason: string | null; startsAt: string; endsAt: string }[];
  /** Active workflow cards: Planning Center can send email through these. */
  cards: { id: string; workflowName: string }[];
  /** The person's page in Planning Center People. */
  url: string;
}

export interface StaffMe extends Person {
  orgName: string;
  demo: boolean;
}

/* ───────────── People / Workflows ───────────── */

export interface WorkflowSummary {
  id: string;
  name: string;
  readyCount: number;
  overdueCount: number;
  /** Ready cards assigned to you. */
  myReadyCount: number;
  myOverdueCount: number;
  /** How this workflow is shared with you in Planning Center (null = not shared with you by name). */
  myShare: WorkflowShareGroup | null;
  /** Assigned to you or shared with you: shows under My workflows. */
  mine: boolean;
  /** You can open it here: it's yours, or you're a People manager / site administrator. */
  canOpen: boolean;
  /** You can share it (approve access requests): you manage it, or you're a People manager / administrator. */
  canManage: boolean;
}

export type WorkflowShareGroup = "No Access" | "Viewer" | "Editor" | "Manager";
export interface WorkflowShare { id: string; personId: string; name: string; avatarUrl: string | null; group: WorkflowShareGroup }
/** Someone asking to be given a workflow (kept on this Mac until a manager answers). */
export interface WorkflowAccessRequest {
  id: string; workflowId: string; workflowName: string; personId: string; personName: string; avatarUrl: string | null;
  note: string | null; requestedAt: string; state: "pending" | "approved" | "denied"; decidedBy?: string; decidedAt?: string; group?: WorkflowShareGroup;
}

export interface WorkflowStep {
  id: string;
  name: string;
  sequence: number;
}

export type CardStage = "ready" | "snoozed" | "completed" | "removed";

export interface WorkflowCard {
  id: string;
  personId: string;
  person: Person;
  stepId: string | null; // null once completed
  stage: CardStage;
  assigneeName: string | null;
  overdue: boolean;
  movedToStepAt: string;
  createdAt: string;
  snoozeUntil: string | null;
  noteCount: number;
}

export interface Board {
  workflow: { id: string; name: string };
  steps: WorkflowStep[];
  cards: WorkflowCard[];
}

export type NoteSource = "card" | "profile" | "internal";

export interface Note {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  source: NoteSource;
  category: string | null;
}

/* ───────────── Services ───────────── */

export interface ServiceType {
  id: string;
  name: string;
}

export interface PlanSummary {
  id: string;
  serviceTypeId: string;
  serviceTypeName: string;
  title: string;
  seriesTitle: string | null;
  dates: string; // human string from PCO, e.g. "October 4, 2026"
  sortDate: string; // ISO
  neededCount: number;
  /** null in the fast upcoming-plans list; loaded separately (PlanCounts) when shown. */
  confirmedCount: number | null;
  unconfirmedCount: number | null;
  declinedCount: number | null;
}

export interface PlanCounts {
  confirmed: number;
  unconfirmed: number;
  declined: number;
}

export interface PlanTime {
  id: string;
  name: string;
  kind: "service" | "rehearsal" | "other";
  startsAt: string;
  endsAt: string;
}

export interface PlanItem {
  id: string;
  title: string;
  sequence: number;
  kind: "song" | "header" | "media" | "item";
  lengthSec: number;
  description: string | null;
  songKey: string | null;
  servicePosition: "pre" | "during" | "post";
  notes: { id?: string; categoryId?: string | null; category: string; body: string }[];
  /** Songs: the catalog song, arrangement and key chosen for this item. */
  songId?: string | null;
  arrangementId?: string | null;
  keyId?: string | null;
}

export type RosterStatus = "C" | "U" | "D";

export interface TeamMember {
  id: string; // PlanPerson id
  personId: string;
  name: string;
  avatarUrl: string | null;
  teamId: string;
  teamName: string;
  positionName: string;
  status: RosterStatus;
  declineReason: string | null;
  notifiedAt: string | null;
}

export interface NeededPosition {
  id: string;
  teamId: string;
  teamName: string;
  positionName: string;
  quantity: number;
}

export interface Team {
  id: string;
  name: string;
  positions: { id: string; name: string }[];
}

export interface PlanDetail extends PlanSummary {
  confirmedCount: number;
  unconfirmedCount: number;
  declinedCount: number;
  times: PlanTime[];
  items: PlanItem[];
  roster: TeamMember[];
  needed: NeededPosition[];
  teams: Team[];
}

export type ConflictKind = "blockout" | "double_booked" | "same_plan";

export interface Conflict {
  kind: ConflictKind;
  label: string;
}

export interface Candidate {
  personId: string;
  name: string;
  avatarUrl: string | null;
  conflicts: Conflict[];
  lastServed: string | null;
  /** false = only checked against this plan so far; blockouts/other services load separately. */
  checked: boolean;
}

export interface ScheduleRequest {
  personId: string;
  teamId: string;
  positionName: string;
  notify: boolean;
}

/* ───────────── Mics & packs (Shure) ───────────── */

export type ShureModel = "ULXD" | "QLXD" | "SLXD" | "AD" | "UHFR";

export interface Receiver {
  id: string;
  name: string; // e.g. "Rack A"
  model: ShureModel;
  ip: string; // blank = assign only, don't send names
  channels: number; // 1, 2 or 4
}

export type MicKind = "vocal" | "pack" | "other";

export interface MicChannel {
  id: string;
  label: string; // e.g. "Vox 1", "AG Pack"
  kind: MicKind;
  receiverId: string | null;
  channel: number; // 1-based channel on the receiver
  /** Positions this mic is for, used by Auto-assign (e.g. ["Worship Leader"], ["Vocals"]). */
  positions: string[];
  /**
   * Allen & Heath console inputs that get this mic's name (dLive / Avantis). Empty or missing: not
   * sent. Two inputs = a double patch (e.g. a second input for in-ears).
   */
  consoleInputs?: number[];
}

export interface MicSetup {
  receivers: Receiver[];
  channels: MicChannel[];
  /** Per service type (by Planning Center id): its own mic assignment filter. */
  serviceTypes?: Record<string, MicFilter>;
}

/** How one service type picks people for mics. Missing fields use the setup's own. */
export interface MicFilter {
  /** channelId → the positions that mic is for in this service type (replaces the channel's own). */
  positions?: Record<string, string[]>;
  /** Leave people who already have a mic of that kind out of each mic's list (default on). */
  hideAssigned?: boolean;
}

/** Live status of one receiver channel, read from the receiver (never written). */
export interface ChannelStatus {
  channel: number;
  name: string | null; // channel name currently on the receiver
  txOn: boolean; // a transmitter is linked and on
  txModel: string | null; // e.g. ULXD2, AD1
  batteryBars: number | null; // 0–5
  batteryMinutes: number | null; // runtime left (Shure rechargeables)
  batteryPercent: number | null;
  batteryType: string | null; // LION, ALKA, NIMH, LITH
  frequencyMHz: number | null;
  antennas: string | null; // one letter per antenna: A/B (or R/B on Axient) = active, X = off
  rfDbm: number | null; // strongest antenna, dBm
  interference: boolean;
  muted: boolean | null;
  /** Audio level at the moment it was read, 0 (silent) to 50 (full scale); ULX-D family only. */
  audioLevel?: number | null;
}

export interface ReceiverStatus {
  receiverId: string;
  ok: boolean;
  error?: string;
  channels: ChannelStatus[];
  at: string;
}

export interface MicAssignment {
  channelId: string;
  personId: string;
  name: string;
}

export interface PlanMics {
  planId: string;
  assignments: MicAssignment[];
  /** "<kind>:<personId>" → channelId they used last time (Auto-assign keeps people on "their" mic). */
  usual: Record<string, string>;
}


/** Team check-ins: who's scheduled on each team for a service, and who has checked in. */
export interface TeamCheckIns {
  teams: { teamId: string; teamName: string; people: TeamCheckInPerson[] }[];
  /** Planning Center Check-Ins couldn't be read (the counts then show 0 checked in). */
  checkInsError: string | null;
  fetchedAt: string;
  /** The Check-Ins event volunteers use for this service type (Preferences → Team Check-ins); null = not chosen yet. */
  event?: { id: string; name: string } | null;
}
export interface TeamCheckInPerson {
  personId: string; name: string; avatarUrl: string | null; positions: string[]; status: RosterStatus;
  /** First check-in: from Planning Center Check-Ins, or a staff check-in in Sundays. */
  checkedInAt: string | null;
  /** "checkins" = scanned in Planning Center Check-Ins; "staff" = checked in by staff in Sundays. */
  checkedInVia?: "checkins" | "staff";
  checkedInBy?: string;
  /** Where they checked in (Check-Ins location, or the team's location for a staff check-in). */
  location?: string | null;
  /** The team's area of serving (from Preferences → Team Check-ins). */
  expectedLocation?: string | null;
}

/** A check-in recorded in Sundays (Planning Center's Check-Ins API can't create check-ins). */
export interface StaffCheckIn {
  id: string; personId: string; name: string; planId: string; serviceTypeId: string; teamId: string; at: string; by: string;
  /** Always "Volunteer"; the event and location come from Preferences → Team Check-ins. */
  kind?: "Volunteer"; eventId?: string | null; eventName?: string | null; locationId?: string | null; locationName?: string | null;
}

export type TeamPhoneRole = "leads" | "staff";
/** Team check-ins on phones: leads (view) and staff (view + check in), each with a PIN. */
export interface TeamPhonesConfig {
  enabled: boolean;
  /** Friendly addresses, e.g. { staff: "staff.libertychurch.net", leads: "leads.libertychurch.net" }. */
  hostnames: Partial<Record<TeamPhoneRole, string>>;
  hasPin: Record<TeamPhoneRole, boolean>;
}
export interface TeamPhonesView extends TeamPhonesConfig {
  /** Where phones open it: http://<ip>:<port>/leads etc., plus the friendly ones. */
  urls: string[];
  friendly: Partial<Record<TeamPhoneRole, string>>;
  port: number; running: boolean; error?: string;
}
/** What a phone gets: never contact details, only names, photos, positions and check-in times. */
export interface TeamPhoneInfo { role: TeamPhoneRole; church: string; logo: string | null; unlocked: boolean; enabled: boolean }
export interface TeamPhoneData { services: { id: string; serviceTypeId: string; label: string; sortDate: string }[]; planId: string | null; groups: TeamGroup[]; data: TeamCheckIns | null }

/** A ministry grouping teams on the Team check-ins page (First Responders → Safety, Medical). */
export interface TeamGroup { id: string; name: string; teamIds: string[] }

/** A campus: a name and the service types that belong to it. */
export interface Campus { id: string; name: string; serviceTypeIds: string[] }
export interface CampusSettings { campuses: Campus[]; /** This person's default campus (null = all). */ myDefault: string | null }

/** Allen & Heath dLive / Avantis connection (Preferences → Audio). */
export interface ConsoleSettingsView { enabled: boolean; model: "dlive" | "avantis"; host: string; port: number; midiChannel: number }
/** What "Send names to console" writes: each mic's name to its input(s). */
export interface ConsolePreview {
  rows: { micId: string; micLabel: string; inputs: number[]; person: string | null; name: string }[];
  sent?: number;
}

/* ───────────── Settings ───────────── */

export type ThemePref = "dark" | "light" | "system";

export type StartView =
  | { kind: "dashboard" }
  | { kind: "propresenter" }
  | { kind: "paging" }
  | { kind: "next-runsheet"; serviceTypeId: string | null }
  | { kind: "workflows" }
  | { kind: "workflow"; workflowId: string }
  | { kind: "services" }
  | { kind: "next-service"; serviceTypeId: string | null }
  | { kind: "next-checkins"; serviceTypeId: string | null };


/**
 * The keys that get their own snapshot. F# and Gb are separate; C#, D#, G# and A# aren't used, so a
 * song in one of those uses its flat (C# → Db, D# → Eb, G# → Ab, A# → Bb).
 */
export const KEY_ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
export type KeyRoot = (typeof KEY_ROOTS)[number];

/** Extra Tuning buttons that recall a snapshot of their own. */
export const TUNING_EXTRAS = [
  { id: "CHROMATIC", label: "Chromatic Tune", short: "Chromatic" },
  { id: "OFF", label: "Tuning Off", short: "Off" },
] as const;
export type TuningExtraId = (typeof TUNING_EXTRAS)[number]["id"];

/**
 * Waves SuperRack over MIDI. SuperRack recalls snapshot N from Bank LSB (CC 32) = floor((N-1)/128)
 * followed by Program Change (N-1) % 128. Each key is mapped to the snapshot that sets it up.
 */
export interface WavesSettings {
  enabled: boolean;
  /** MIDI output name on this Mac, e.g. "IAC Driver Bus 1" or "Network Session 1". */
  output: string | null;
  channel: number; // 1–16
  /** Key ("C", "Db" … "B") or Tuning button ("CHROMATIC", "OFF") → SuperRack snapshot (its External ID, 0–999). */
  snapshots: Record<string, number | null>;
  /**
   * How a number turns into Bank LSB + Program Change:
   *  - "externalId" (default): SuperRack's External ID, 125 per bank: ID = bank × 125 + program.
   *  - "program": plain snapshot numbers from 1, 128 per bank: n = bank × 128 + program + 1.
   */
  numbering?: "externalId" | "program";
  /** Song items whose titles are here aren't on the Tuning bar (e.g. "Vocal Warm Ups"). */
  hideFromTuning?: string[];
}

export interface AppSettings {
  theme: ThemePref;
  /** Custom logo as a data: URL (PNG, JPG or SVG), shown in the sidebar and on the sign-in page. */
  logo: string | null;
  startView: StartView;
  waves: WavesSettings;
  /** Teams and times hidden on the services pages, per service type id. */
  serviceView: Record<string, ServiceViewPrefs>;
}

/* ───────────── Check-ins ───────────── */

export type CheckInKind = "Regular" | "Guest" | "Volunteer";

export interface CheckInRow {
  id: string;
  personId: string | null;
  name: string;
  avatarUrl: string | null;
  kind: CheckInKind;
  event: string;
  /** Check-Ins event id (for matching the volunteer event chosen in Preferences). */
  eventId?: string | null;
  locations: string[];
  /** Check-Ins location ids (rooms), for matching a ministry's rooms. */
  locationIds: string[];
  at: string; // checked in
  checkedOutAt: string | null;
  securityCode: string | null;
  /** Checked in by staff in Sundays (not in Planning Center Check-Ins). */
  byStaff?: string;
}

export interface CheckInsForPlan {
  from: string;
  to: string;
  rows: CheckInRow[];
  fetchedAt: string;
}


/* ───────────── Parent paging (ProPresenter messages) ───────────── */

export type Ministry = "nursery" | "kids";
export const MINISTRIES: Ministry[] = ["nursery", "kids"];

/** ProPresenter's way of naming things: any of uuid, name or index identifies it. */
export interface ProId { uuid: string; name: string; index: number }

export interface ProPresenterMachine {
  host: string;
  port: number;
  /** "Main sanctuary Pro7 machine" */
  name: string;
  /** "ProPresenter 7.14" */
  version: string;
  platform: string;
}

/** A theme slide that a message can use, e.g. "Nursery › Lower third". */
export interface ProThemeOption { id: ProId; theme: string; slide: string; label: string }

/** An existing ProPresenter message and its text tokens. */
export interface ProMessageOption { id: ProId; message: string; tokens: string[] }

export interface MinistryPaging {
  enabled: boolean;
  /** Shown on the iPad page, e.g. "Nursery". */
  title: string;
  /** Check-Ins rooms whose children appear on this ministry's iPad page. */
  locationIds: string[];
  /**
   * "managed": Sundays keeps its own ProPresenter message ("Sundays · Nursery") with
   * the text and theme below. "existing": trigger a message you already have in ProPresenter.
   */
  mode: "managed" | "existing";
  /** Managed: the message text; {code} becomes the child's security code. */
  text: string;
  /** Managed: the theme slide the message uses. */
  theme: ProId | null;
  /** Existing: which message, and which of its text tokens gets the code. */
  existing: { id: ProId; token: string } | null;
  /** A PIN is set (the PIN itself is never sent to the app). */
  hasPin: boolean;
}

export interface PagingConfig {
  propresenter: { host: string; port: number };
  /** How long a page stays on screen. Nobody can page again until it's gone (default 15s). */
  onScreenSeconds: number;
  /** iPad pages on the church network. */
  /**
   * hostnames: optional friendly addresses (e.g. kids.libertychurch.net) that point at this Mac in the
   * church's DNS. Opening one goes straight to that ministry's page.
   */
  ipads: { enabled: boolean; port: number; hostnames?: Partial<Record<Ministry, string>> };
  ministries: Record<Ministry, MinistryPaging>;
  /**
   * Hold iPad pages until someone sends them from Sundays (a banner shows each request).
   * Off: iPads put codes straight on the screens.
   */
  approval: boolean;
}

/** A page an iPad asked for, waiting for the production team to send it. */
export interface PageRequest {
  id: string;
  ministry: Ministry;
  code: string;
  childName: string | null;
  by: string;
  requestedAt: string;
  /** waiting → (sent | cancelled); "released" = sent from Sundays, goes up as soon as the screen is free. */
  state: "waiting" | "released" | "sent" | "cancelled" | "failed";
  doneAt?: string;
  error?: string;
  /** "Hold until clear" pressed (at FOH): still waiting, but don't take over the screen again. */
  heldAt?: string;
  /** Who sent or cancelled it ("FOH companion", a staff name). */
  decidedBy?: string;
}

/** What an FOH companion sees: no child names, ever. */
export interface CompanionRequest { id: string; ministry: string; code: string; requestedAt: string; state: PageRequest["state"]; heldAt?: string }
export interface CompanionState {
  linked: boolean;
  main: { name: string; host: string; port: number } | null;
  connected: boolean;
  error?: string;
  requests: CompanionRequest[];
  onScreenUntil: string | null;
  /** The main computer's wireless mics (as on its mic board) for the mic strip. */
  mics: BoardTile[];
  /** The Tuning row of the service the main computer's Mic board follows (null: Waves isn't set up there). */
  tuning: CompanionTuning | null;
  strip: CompanionStrip;
}
/**
 * The FOH companion's mic strip: a short always-on-top bar across the bottom of a display, with the
 * Tuning strip above it. displayLabel finds the same display again if macOS renumbers displays.
 */
export interface CompanionStrip { enabled: boolean; size: "s" | "m" | "l"; displayId: number | null; displayLabel: string | null; tuning: boolean }

/** A display on this Mac (bounds in macOS points, for drawing the arrangement). */
export interface DisplayInfo { id: number; label: string; primary: boolean; bounds?: { x: number; y: number; width: number; height: number } }

/**
 * The Tuning row for the FOH companion. Pressing a button goes to the main computer, which sends the
 * MIDI to Waves SuperRack from there (the companion never sends MIDI itself).
 */
export interface CompanionTuning {
  service: string | null;
  /** Waves is turned on with a MIDI output on the main computer. */
  live: boolean;
  /** Chromatic Tune, Tuning Off, then each song in service order. slot = "CHROMATIC" | "OFF" | the item id. */
  buttons: { slot: string; kind: "extra" | "song"; label: string; key: string | null; title: string; n: number | null; snapshot: number | null }[];
  /** The last one pressed (here or on the main computer's Tuning bar). */
  last: { slot: string; label: string; at: string } | null;
}
export interface CompanionInfo { id: string; name: string; pairedAt: string; lastSeen: string | null; online: boolean }
/**
 * How this Mac uses Sundays: Full Mode (everything), Service Mode (a shared computer: Services,
 * ProPresenter, Clock, Mic board and Parent paging only; a PIN to leave it or open Preferences), or
 * FOH Companion.
 */
export type AppMode = "full" | "service" | "companion";
export interface AppModeView {
  mode: AppMode | null;
  /** Service Mode: a PIN is set (leaving Service Mode and Preferences ask for it). */
  hasPin: boolean;
  /** Service Mode: unlocked with the PIN until then (Preferences, everything else). */
  unlockedUntil: string | null;
}
/** What Service Mode keeps (sidebar links); everything else is closed until the PIN is entered. */
export const SERVICE_MODE_PAGES = ["/services", "/propresenter", "/clock", "/micboard", "/paging"] as const;

/** Settings → iPad addresses for each ministry. */
export interface KioskAddresses {
  urls: string[]; port: number; running: boolean; error?: string;
  /** Friendly address per ministry, e.g. { kids: "http://kids.libertychurch.net" }. */
  friendly: Partial<Record<Ministry, string>>;
}

export interface PageEvent {
  id: string;
  ministry: Ministry;
  code: string;
  childName: string | null;
  by: string; // "Nursery iPad" or a staff name
  at: string;
  ok: boolean;
  error?: string;
}

export interface PagingStatus {
  configured: boolean;
  /** A page is on screen until this time; paging is locked until then. */
  onScreenUntil: string | null;
  current: PageEvent | null;
  recent: PageEvent[];
  /** Today's page requests from the iPads (when pages need approval). */
  requests: PageRequest[];
  approval: boolean;
  serverTime: string;
}

/** A child on a ministry's iPad page. */
export interface KioskChild {
  id: string; // check-in id
  name: string;
  avatarUrl: string | null;
  securityCode: string | null;
  room: string;
  at: string;
  guest: boolean;
}

export interface KioskInfo {
  ministry: Ministry;
  title: string;
  church: string;
  logo: string | null;
  unlocked: boolean;
  enabled: boolean;
  /** Pages go to the production team first (the iPad "requests" a page). */
  approval: boolean;
}

export interface KioskChildren { children: KioskChild[]; fetchedAt: string }

export interface CheckInLocation { id: string; name: string; event: string; eventId?: string; folder: string | null; childOrAdult: string | null }

/**
 * Volunteer check-in setup (Preferences → Team Check-ins): which Planning Center Check-Ins event
 * volunteers check in to for each service type, and the location (area of serving) for each team.
 */
export interface VolunteerCheckInConfig {
  /** serviceTypeId → Check-Ins event. */
  events: Record<string, { id: string; name: string }>;
  /** teamId → location in that event (Greeters → Main Lobby). */
  teamLocations: Record<string, { id: string; name: string }>;
}
export interface VolunteerCheckInSetup {
  config: VolunteerCheckInConfig;
  serviceTypes: { id: string; name: string; teams: { id: string; name: string }[] }[];
  events: { id: string; name: string; locations: { id: string; name: string; folder: string | null }[] }[];
  eventsError: string | null;
}

/* ───────────── Matrix (several weeks of one service type) ───────────── */

export interface Matrix {
  serviceType: ServiceType;
  /** Oldest first: any past weeks asked for, then the upcoming ones. */
  plans: PlanDetail[];
}

/* ───────────── Planning Center Live ───────────── */

/** Planning Center Live for a plan: where the service is right now. */
export interface RunSheetLive {
  currentItemId: string | null;
  nextItemId: string | null;
  /** When the current item started (live_start_at). */
  currentStartedAt: string | null;
  controller: string | null;
  /** You're the one driving Live. */
  youControl?: boolean;
  /** You're allowed to take over Live. */
  canTakeControl?: boolean;
}

export interface NoteCategory { id: string; name: string }

export interface SongHit { id: string; title: string; author: string | null; lastScheduledAt: string | null }
export interface SongArrangement { id: string; name: string; lengthSec: number; keys: { id: string; name: string; startingKey: string | null }[] }

/** Add or change an item in the order of service (Planning Center). */
export interface ItemInput {
  kind?: "song" | "header" | "media" | "item";
  title?: string;
  lengthSec?: number;
  description?: string | null;
  servicePosition?: "pre" | "during" | "post";
  songId?: string | null;
  arrangementId?: string | null;
  keyId?: string | null;
  /** New items: put right after this item (null = at the top; omitted = at the end). */
  afterItemId?: string | null;
}

/** Add or change a service time (a service, a rehearsal, anything else) in Planning Center. */
export interface PlanTimeInput {
  name: string;
  kind: "service" | "rehearsal" | "other";
  startsAt: string;
  endsAt: string;
}

/**
 * What the services pages leave out, per service type (Settings → Services, or View on a service):
 * teams by id, and service times by "kind|name|h:mm AM" (or "rehearsal|*" / "other|*" for every one).
 */
export interface ServiceViewPrefs { teams: string[]; times: string[] }

/* ───────────── ProPresenter control (side screens computer, etc.) ───────────── */

export interface ProMachine { id: string; name: string; host: string; port: number; /** "paging" is the Kids & Nursery one from Settings. */ builtIn?: boolean }

export interface ProSlide { index: number; group: string; groupColor: string | null; label: string; text: string; enabled: boolean }

export interface ProTimer {
  id: ProId;
  /** "00:04:32" as ProPresenter shows it (may start with "-" when over). */
  time: string;
  state: "stopped" | "running" | "complete" | "overrunning" | "overran" | string;
  kind: "countdown" | "count_down_to_time" | "elapsed" | "unknown";
  /** Countdown length in seconds. */
  duration: number | null;
  allowsOverrun: boolean;
}

export interface ProControlState {
  ok: boolean;
  error?: string;
  name?: string;
  version?: string;
  presentation: { uuid: string; name: string; slides: ProSlide[] } | null;
  slideIndex: number | null;
  current: { text: string; notes: string } | null;
  next: { text: string; notes: string } | null;
  timers: ProTimer[];
  stageMessage: string;
  stageScreens: { id: ProId; layout: ProId | null }[];
  stageLayouts: ProId[];
  clearGroups: ProId[];
  looks: ProId[];
  at: string;
}

export type ProAction =
  | { type: "next" } | { type: "previous" }
  | { type: "trigger"; uuid: string; index: number }
  | { type: "clear"; layer: "slide" | "media" | "props" | "messages" | "announcements" | "audio" | "video_input" | "all" }
  | { type: "clearGroup"; id: string }
  | { type: "look"; id: string }
  | { type: "timer"; id: string; op: "start" | "stop" | "reset" }
  | { type: "timerSet"; id: string; duration: number; allowsOverrun?: boolean }
  | { type: "timerAdd"; id: string; seconds: number }
  | { type: "stageMessage"; text: string | null }
  | { type: "stageLayout"; screen: string; layout: string };

/* ───────────── Smaart SPL + dashboard ───────────── */

export interface SmaartSettingsView { enabled: boolean; host: string; port: number; path: string; limit: number; hasPassword: boolean }
export interface SmaartStatusView {
  state: "off" | "connecting" | "connected" | "error";
  error: string | null;
  readings: { key: string; label: string; value: number; approx?: boolean }[];
  at: string | null;
  measurements: { name: string; endpoint: string; active: boolean; stream: "off" | "connecting" | "open" | "error"; messages: number }[];
  sample: string[];
}

/** The service the dashboard follows: a service type (your campus), optionally pinned to one plan. */
export interface HomeService { serviceTypeId: string | null; planId: string | null }

export type WidgetType = "tuning" | "spl" | "wireless" | "live" | "clock" | "pro" | "prodclock" | "resi";
export interface DashboardWidget {
  id: string;
  type: WidgetType;
  /** s = 1 column, m = 2, l = full width. */
  size: "s" | "m" | "l";
  options: Record<string, string | number | boolean | null>;
}

/* ───────────── Resi (resi.io) live status ───────────── */

export interface ResiSettingsView { enabled: boolean; clientId: string; hasSecret: boolean; encoderIds: string[] }
export interface ResiEncoder {
  id: string;
  name: string;
  live: boolean;
  /** "live", "starting", "setting-up" (destinations being set up), "error" or "off". */
  state: "live" | "starting" | "setting-up" | "error" | "off";
  liveSince: string | null;
  /** The title of what's streaming, when Resi has one. */
  title: string | null;
  /** Where it's going (Web/Embed, YouTube, Facebook, RTMP) and each one's state. */
  destinations: { name: string; type: string | null; status: string }[];
  error: string | null;
}
export interface ResiStatus {
  configured: boolean;
  connected: boolean;
  error: string | null;
  live: boolean;
  liveSince: string | null;
  lastLive: { from: string; to: string } | null;
  encoders: ResiEncoder[];
  checkedAt: string | null;
  /** Where "live" came from: Resi's live schedules, or the encoders' own status. */
  source: "schedules" | "encoders" | "none";
}

/**
 * The Weekend picker: the one weekend Sundays works on everywhere (Dashboard, Mic board, Clock,
 * Tuning strip, FOH companion, start view). Nothing moves on to the next weekend by itself.
 * A weekend is the week ending on its Sunday (Monday through Sunday), so a midweek service of
 * that week counts too.
 */
export interface WeekendOption {
  /** The Sunday, YYYY-MM-DD (the church's local date). */
  sunday: string;
  /** How many plans that week, and of which service types. */
  count: number;
  serviceTypeIds: string[];
}
export interface WeekendView {
  sunday: string | null;
  /** Monday 00:00 → the next Monday 00:00, local time (ISO), when one is picked. */
  from: string | null;
  to: string | null;
  /** The picked weekend is in the past. */
  over: boolean;
  /** Every plan in the picked weekend, all service types, in date order. */
  plans: PlanSummary[];
  /** This weekend and the ones after it (plus the picked one, if it's older). */
  options: WeekendOption[];
  /** Couldn't read Planning Center just now. */
  error: string | null;
}

/** Settings sync across your Macs (Preferences → About → Sync). */
export interface SyncStatus {
  enabled: boolean;
  state: "idle" | "syncing" | "ok" | "error" | "signed-out";
  /** Whose settings (the Planning Center person this Mac syncs as). */
  who: string | null;
  lastSync: string | null;
  error: string | null;
  /** How many kinds of settings sync. */
  keys: number;
}

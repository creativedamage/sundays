import type {
  WeekendView, SyncStatus,
  AppSettings, Board, Candidate, Conflict, MicAssignment, MicSetup, Note, PlanCounts, PlanDetail, PlanMics, ReceiverStatus, PlanSummary, RosterStatus, ScheduleRequest,
  ServiceType, StaffMe, TeamMember, WorkflowCard, WorkflowSummary, WorkflowShare, WorkflowShareGroup, WorkflowAccessRequest, Person,
  DashboardWidget, HomeService, TeamCheckIns, TeamPhonesView, TeamPhoneRole, VolunteerCheckInConfig, VolunteerCheckInSetup, TeamGroup, AppMode, AppModeView, ResiSettingsView, ResiStatus, CompanionState, CompanionStrip, CompanionTuning, DisplayInfo, CompanionInfo, Campus, CampusSettings, PersonProfile, ConsoleSettingsView, ConsolePreview, SmaartSettingsView, SmaartStatusView, ProAction, ProControlState, ProMachine, Matrix, RunSheetLive, ItemInput, PlanTimeInput, NoteCategory, PlanItem, SongArrangement, SongHit, CheckInLocation, KioskAddresses, KioskChild, Ministry, MinistryPaging, PageEvent, PagingConfig, PagingStatus, ProMessageOption, ProPresenterMachine, ProThemeOption,
} from "@shared/types";
import type { UpdateStatus } from "@shared/updates";
import type { AppId } from "@shared/apps";
import type { ClockOutputSettings, ClockPreset, ClockProSettings, ClockState, ClockView } from "@shared/clock";
import type { BoardBackground, BoardMic, BoardSettings, DisplayState, LogoRule } from "@shared/board";

export type SettingsPatch = Partial<Omit<AppSettings, "waves">> & {
  waves?: Partial<AppSettings["waves"]>;
};

export type PagingPatch = Partial<Omit<PagingConfig, "ministries" | "propresenter" | "ipads">> & {
  propresenter?: Partial<PagingConfig["propresenter"]>;
  ipads?: Partial<PagingConfig["ipads"]>;
  ministries?: Partial<Record<Ministry, Partial<Omit<MinistryPaging, "hasPin">>>>;
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  // Not signed in (or Planning Center signed you out): go to sign-in and say why. The sign-in page
  // doesn't bounce back on its own after this, so there's no loop.
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/" && !window.location.pathname.startsWith("/kiosk") && !window.location.pathname.startsWith("/companion") && !window.location.pathname.startsWith("/setup-mode")) {
    const back = window.location.pathname + window.location.search;
    window.location.href = `/?error=signed_out&return=${encodeURIComponent(back)}`;
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText, data);
  return data as T;
}

/**
 * At most 2 background requests at a time, so they never take all of the browser's connections
 * to the app (it allows 6) and a service you click opens right away.
 */
let lowRunning = 0;
const lowQueue: (() => void)[] = [];
async function lowLane<T>(fn: () => Promise<T>): Promise<T> {
  if (lowRunning >= 2) await new Promise<void>((r) => lowQueue.push(r));
  lowRunning++;
  try { return await fn(); } finally { lowRunning--; lowQueue.shift()?.(); }
}

/** Typed endpoint map — the only place the frontend knows URLs. */
export interface SundaysAppListing { id: AppId; name: string; short: string; blurb: string; installed: boolean; running: boolean; current: boolean }

export const Api = {
  /** The Sundays apps on this Mac (Mac apps only). */
  sundaysApps: () => api<{ current: AppId | null; apps: SundaysAppListing[] }>("/desktop/apps"),
  me: () => api<StaffMe>("/auth/me"),
  settings: () => api<AppSettings>("/settings"),
  saveSettings: (patch: SettingsPatch) =>
    api<AppSettings>("/settings", { method: "PUT", json: patch }),
  version: () => api<{ version: string }>("/health").then((h) => h.version),
  logout: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),

  workflows: () => api<WorkflowSummary[]>("/workflows"),
  board: (wf: string) => api<Board>(`/workflows/${wf}/board`),
  moveCard: (wf: string, card: string, toStepId: string | null, personId?: string) =>
    api<WorkflowCard>(`/workflows/${wf}/cards/${card}/move`, { method: "POST", json: { toStepId, personId } }),
  workflowShares: (wf: string) => api<WorkflowShare[]>(`/workflows/${wf}/shares`),
  shareWorkflow: (wf: string, personId: string, group: WorkflowShareGroup) => api<WorkflowShare[]>(`/workflows/${wf}/shares`, { method: "PUT", json: { personId, group } }),
  unshareWorkflow: (wf: string, shareId: string) => api<WorkflowShare[]>(`/workflows/${wf}/shares/${shareId}`, { method: "DELETE" }),
  searchPeople: (q: string) => api<Person[]>(`/people-search?q=${encodeURIComponent(q)}`),
  workflowRequests: () => api<{ mine: WorkflowAccessRequest[]; toReview: WorkflowAccessRequest[] }>("/workflow-requests"),
  requestWorkflow: (workflowId: string, note?: string) => api<WorkflowAccessRequest>("/workflow-requests", { method: "POST", json: { workflowId, note } }),
  decideWorkflowRequest: (id: string, decision: "approve" | "deny" | "withdraw", group?: WorkflowShareGroup) =>
    api<WorkflowAccessRequest>(`/workflow-requests/${id}/${decision}`, { method: "POST", json: { group } }),
  contacts: (ids: string[]) => api<Record<string, { email: string | null; phone: string | null; mobile: string | null }>>(`/contacts?ids=${ids.join(",")}`),
  notes: (person: string, card: string) => api<Note[]>(`/people/${person}/cards/${card}/notes`),
  addNote: (person: string, card: string, body: string, internal: boolean) =>
    api<Note>(`/people/${person}/cards/${card}/notes`, { method: "POST", json: { body, internal } }),
  email: (person: string, card: string, subject: string, body: string) =>
    api<{ ok: true }>(`/people/${person}/cards/${card}/email`, { method: "POST", json: { subject, body } }),

  serviceTypes: () => api<ServiceType[]>("/services/service-types"),
  stageDisplay: () => api<{ settings: BoardSettings; state: DisplayState; displays: DisplayInfo[]; urls: string[]; mics: BoardMic[] }>("/board"),
  boardOpenPlan: (serviceTypeId: string, planId: string) => api<{ ok: true }>("/board/open", { method: "POST", json: { serviceTypeId, planId } }),
  addBoardMic: (label: string, kind: BoardMic["kind"]) => api<{ id: string }>("/board/mics", { method: "POST", json: { label, kind } }),
  removeBoardMic: (id: string) => api<{ ok: true }>(`/board/mics/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveBoard: (p: Partial<Omit<BoardSettings, "screen" | "center" | "plot">> & { screen?: Partial<BoardSettings["screen"]>; center?: Partial<Omit<BoardSettings["center"], "logoId">>; plot?: { dark?: boolean } }) =>
    api<BoardSettings>("/board/settings", { method: "PUT", json: p }),
  /** Pick a background for "person:<id>" or "mic:<channel id>" (null: automatic). */
  pickBoardImage: (key: string, backgroundId: string | null) => api<BoardSettings>("/board/images", { method: "PUT", json: { key, backgroundId } }),
  addBoardBackground: (name: string, dataUrl: string) => api<{ background: BoardBackground; settings: BoardSettings }>("/board/backgrounds", { method: "POST", json: { name, dataUrl } }),
  renameBoardBackground: (id: string, name: string) => api<BoardSettings>(`/board/backgrounds/${encodeURIComponent(id)}`, { method: "PUT", json: { name } }),
  removeBoardBackground: (id: string) => api<BoardSettings>(`/board/backgrounds/${encodeURIComponent(id)}`, { method: "DELETE" }),
  boardPlot: (name: string | null, dataUrl: string | null) => (dataUrl ? api<BoardSettings>("/board/plot", { method: "POST", json: { name, dataUrl } }) : api<BoardSettings>("/board/plot", { method: "DELETE" })),
  addBoardLogo: (name: string, dataUrl: string) => api<BoardSettings>("/board/logos", { method: "POST", json: { name, dataUrl } }),
  renameBoardLogo: (id: string, name: string) => api<BoardSettings>(`/board/logos/${encodeURIComponent(id)}`, { method: "PUT", json: { name } }),
  removeBoardLogo: (id: string) => api<BoardSettings>(`/board/logos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  defaultBoardLogo: (logoId: string | null) => api<BoardSettings>("/board/logo-default", { method: "PUT", json: { logoId } }),
  saveLogoSchedule: (rules: LogoRule[]) => api<BoardSettings>("/board/logo-schedule", { method: "PUT", json: { rules } }),
  clock: () => api<ClockView>("/clock"),
  clockAction: (a: Record<string, unknown> & { type: string }) => api<ClockState>("/clock/action", { method: "POST", json: a }),
  saveClockPresets: (list: ClockPreset[]) => api<ClockPreset[]>("/clock/presets", { method: "PUT", json: list }),
  saveClockSettings: (p: { ndi?: Partial<ClockOutputSettings["ndi"]>; screen?: Partial<ClockOutputSettings["screen"]>; showTimeOfDay?: boolean; lan?: boolean; title?: string; infoHeading?: string; pro?: Partial<ClockProSettings> }) =>
    api<ClockOutputSettings>("/clock/settings", { method: "PUT", json: p }),
  newClockKey: () => api<ClockOutputSettings>("/clock/settings/new-key", { method: "POST" }),
  plans: (serviceTypeId?: string) =>
    api<PlanSummary[]>(`/services/plans${serviceTypeId ? `?serviceTypeId=${serviceTypeId}` : ""}`),
  plan: (st: string, plan: string) => api<PlanDetail>(`/services/plans/${st}/${plan}`),
  live: (st: string, plan: string) => api<{ live: RunSheetLive | null }>(`/services/plans/${st}/${plan}/live`).then((r) => r.live),
  editPlan: (st: string, plan: string, input: { title?: string | null; seriesTitle?: string | null }) => api<PlanDetail>(`/services/plans/${st}/${plan}`, { method: "PATCH", json: input }),
  savePlanTime: (st: string, plan: string, input: PlanTimeInput, id?: string) =>
    api<PlanDetail>(`/services/plans/${st}/${plan}/times${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: input }),
  deletePlanTime: (st: string, plan: string, id: string) => api<PlanDetail>(`/services/plans/${st}/${plan}/times/${id}`, { method: "DELETE" }),
  noteCategories: (st: string) => api<NoteCategory[]>(`/services/types/${st}/note-categories`),
  songs: (q: string) => api<SongHit[]>(`/services/songs?q=${encodeURIComponent(q)}`),
  arrangements: (songId: string) => api<SongArrangement[]>(`/services/songs/${songId}/arrangements`),
  addItem: (st: string, plan: string, input: ItemInput) => api<PlanItem[]>(`/services/plans/${st}/${plan}/items`, { method: "POST", json: input }),
  editItem: (st: string, plan: string, item: string, input: ItemInput) => api<PlanItem[]>(`/services/plans/${st}/${plan}/items/${item}`, { method: "PATCH", json: input }),
  deleteItem: (st: string, plan: string, item: string) => api<PlanItem[]>(`/services/plans/${st}/${plan}/items/${item}`, { method: "DELETE" }),
  reorderItems: (st: string, plan: string, ids: string[]) => api<PlanItem[]>(`/services/plans/${st}/${plan}/items-order`, { method: "POST", json: { ids } }),
  saveNote: (st: string, plan: string, item: string, note: { noteId?: string; categoryId: string; content: string }) =>
    api<PlanItem[]>(`/services/plans/${st}/${plan}/items/${item}/notes`, { method: "PUT", json: note }),
  deleteNote: (st: string, plan: string, item: string, noteId: string) => api<PlanItem[]>(`/services/plans/${st}/${plan}/items/${item}/notes/${noteId}`, { method: "DELETE" }),
  proMachines: () => api<ProMachine[]>("/pro/machines"),
  saveProMachines: (list: Omit<ProMachine, "builtIn">[]) => api<ProMachine[]>("/pro/machines", { method: "PUT", json: list }),
  proState: (id: string) => api<ProControlState>(`/pro/${id}/state`),
  proAction: (id: string, a: ProAction) => api<{ ok: true }>(`/pro/${id}/action`, { method: "POST", json: a }),
  smaartConfig: () => api<SmaartSettingsView>("/smaart/config"),
  saveSmaart: (p: Partial<SmaartSettingsView> & { password?: string }) => api<SmaartSettingsView>("/smaart/config", { method: "PUT", json: p }),
  smaartStatus: () => api<SmaartStatusView>("/smaart/status"),
  dashboard: () => api<DashboardWidget[] | null>("/dashboard"),
  home: () => api<HomeService>("/dashboard/home"),
  teamCheckIns: (st: string, plan: string) => api<TeamCheckIns>(`/services/plans/${st}/${plan}/team-checkins`),
  staffCheckIn: (st: string, plan: string, personId: string, undo?: boolean) =>
    api<TeamCheckIns>(`/services/plans/${st}/${plan}/team-checkins/${personId}`, { method: "POST", json: { undo } }),
  volunteerConfig: () => api<VolunteerCheckInSetup["config"]>("/volunteer-checkin/config"),
  volunteerSetup: (serviceTypeIds?: string[]) => api<VolunteerCheckInSetup>(`/volunteer-checkin${serviceTypeIds?.length ? `?st=${serviceTypeIds.join(",")}` : ""}`),
  saveVolunteerConfig: (serviceTypes: { id: string; event: { id: string; name: string } | null; teams: { id: string; location: { id: string; name: string } | null }[] }[]) =>
    api<VolunteerCheckInConfig>("/volunteer-checkin", { method: "PUT", json: { serviceTypes } }),
  teamPhones: () => api<TeamPhonesView>("/team-phones"),
  saveTeamPhones: (p: { enabled?: boolean; hostnames?: Partial<Record<TeamPhoneRole, string>> }) => api<TeamPhonesView>("/team-phones", { method: "PUT", json: p }),
  setTeamPhonePin: (role: TeamPhoneRole, pin: string | null) => api<TeamPhonesView>(`/team-phones/pin/${role}`, { method: "PUT", json: { pin } }),
  signOutTeamPhones: (role: TeamPhoneRole) => api<{ ok: true }>(`/team-phones/signout/${role}`, { method: "POST" }),
  teamGroups: () => api<TeamGroup[]>("/team-groups"),
  knownTeams: () => api<{ id: string; name: string }[]>("/team-groups/teams"),
  saveTeamGroups: (g: TeamGroup[]) => api<TeamGroup[]>("/team-groups", { method: "PUT", json: g }),
  appMode: () => api<AppModeView>("/app-mode"),
  setAppMode: (mode: AppMode | null, opts: { pin?: string; newPin?: string } = {}) => api<AppModeView>("/app-mode", { method: "PUT", json: { mode, ...opts } }),
  unlockServiceMode: (pin: string) => api<AppModeView>("/app-mode/unlock", { method: "POST", json: { pin } }),
  lockServiceMode: () => api<AppModeView>("/app-mode/lock", { method: "POST" }),
  companionState: () => api<CompanionState>("/companion-client/state"),
  companionFind: () => api<{ host: string; port: number; name: string }[]>("/companion-client/find"),
  companionLink: (host: string, port: number, code: string) => api<CompanionState>("/companion-client/link", { method: "POST", json: { host, port, code } }),
  companionUnlink: () => api<CompanionState>("/companion-client/unlink", { method: "POST" }),
  companionAct: (id: string, action: "accept" | "hold" | "deny") => api<CompanionState>("/companion-client/act", { method: "POST", json: { id, action } }),
  weekend: () => api<WeekendView>("/weekend"),
  syncStatus: () => api<SyncStatus>("/sync"),
  cloud: () => api<{ supabaseUrl: string; publishableKey: string; opsUrl: string; testToken: string | null }>("/cloud"),
  syncNow: () => api<SyncStatus>("/sync", { method: "POST" }),
  setWeekend: (sunday: string | null) => api<WeekendView>("/weekend", { method: "PUT", json: { sunday } }),
  resi: () => api<ResiStatus>("/resi"),
  resiSettings: () => api<ResiSettingsView>("/resi/settings"),
  saveResiSettings: (p: { enabled?: boolean; clientId?: string; clientSecret?: string; encoderIds?: string[] }) =>
    api<{ settings: ResiSettingsView; status: ResiStatus }>("/resi/settings", { method: "PUT", json: p }),
  testResi: () => api<{ status: ResiStatus; encoders: { id: string; name: string }[] }>("/resi/test", { method: "POST" }),
  companionStrip: () => api<{ settings: CompanionStrip; displays: DisplayInfo[] }>("/companion-client/strip"),
  saveCompanionStrip: (p: Partial<CompanionStrip>) => api<{ settings: CompanionStrip; displays: DisplayInfo[] }>("/companion-client/strip", { method: "PUT", json: p }),
  companionTuning: (slot: string) => api<{ ok: boolean; snapshot?: number; error?: string }>("/companion-client/tuning", { method: "POST", json: { slot } }),
  companionWindow: (view: "full" | "strip") => api<{ ok: true }>("/companion-client/window", { method: "POST", json: { view } }),
  companions: () => api<{ companions: CompanionInfo[]; addresses: string[] }>("/paging/companions"),
  pairCompanion: () => api<{ code: string; expiresAt: string }>("/paging/companions/pair", { method: "POST" }),
  removeCompanion: (id: string) => api<{ companions: CompanionInfo[] }>(`/paging/companions/${id}`, { method: "DELETE" }),
  campuses: () => api<CampusSettings>("/campuses"),
  saveCampuses: (c: Campus[]) => api<CampusSettings>("/campuses", { method: "PUT", json: c }),
  setDefaultCampus: (campusId: string | null) => api<CampusSettings>("/campuses/default", { method: "PUT", json: { campusId } }),
  profile: (personId: string) => api<PersonProfile>(`/people/${personId}/profile`),
  emailPerson: (personId: string, p: { subject: string; body: string; cardId?: string }) => api<{ ok: boolean; via: string }>(`/people/${personId}/email`, { method: "POST", json: p }),
  consoleConfig: () => api<ConsoleSettingsView>("/console/config"),
  saveConsole: (p: Partial<ConsoleSettingsView>) => api<ConsoleSettingsView>("/console/config", { method: "PUT", json: p }),
  testConsole: () => api<{ ok: boolean; input1?: string | null; note?: string; error?: string }>("/console/test", { method: "POST" }),
  consolePreview: (plan: string) => api<ConsolePreview>(`/console/plans/${plan}`),
  sendConsole: (plan: string) => api<ConsolePreview>(`/console/plans/${plan}/send`, { method: "POST" }),
  saveHome: (h: HomeService) => api<HomeService>("/dashboard/home", { method: "PUT", json: h }),
  saveDashboard: (w: DashboardWidget[]) => api<DashboardWidget[]>("/dashboard", { method: "PUT", json: w }),
  matrix: (st: string, weeks: number, past: number) => api<Matrix>(`/services/matrix/${st}?weeks=${weeks}&past=${past}`),
  // Background work: the server lets requests you're waiting on (opening a service) go first.
  planCounts: (st: string, plan: string) => lowLane(() => api<PlanCounts>(`/services/plans/${st}/${plan}/counts`, { headers: { "X-Priority": "low" } })),
  candidates: (st: string, plan: string, teamId: string, position: string) =>
    api<Candidate[]>(`/services/plans/${st}/${plan}/candidates?teamId=${teamId}&position=${encodeURIComponent(position)}`),
  conflicts: (st: string, plan: string, personId: string) =>
    api<Conflict[]>(`/services/plans/${st}/${plan}/conflicts?personId=${personId}`),
  schedule: (st: string, plan: string, req: ScheduleRequest) =>
    api<TeamMember>(`/services/plans/${st}/${plan}/team-members`, { method: "POST", json: req }),
  setStatus: (st: string, plan: string, tm: string, status: RosterStatus, reason?: string) =>
    api<TeamMember>(`/services/plans/${st}/${plan}/team-members/${tm}`, { method: "PATCH", json: { status, reason } }),
  micSetup: () => api<MicSetup>("/mics/setup"),
  saveMicSetup: (setup: MicSetup) => api<MicSetup>("/mics/setup", { method: "PUT", json: setup }),
  testReceiver: (ip: string) => api<{ ok: boolean; deviceId?: string; error?: string }>("/mics/test", { method: "POST", json: { ip } }),
  planMics: (plan: string) => api<PlanMics>(`/mics/plans/${plan}`),
  /** Saving a service's mics also points the mic board at that service (the one you last worked on). */
  savePlanMics: (plan: string, assignments: MicAssignment[], serviceTypeId?: string) =>
    api<PlanMics>(`/mics/plans/${plan}`, { method: "PUT", json: { assignments, serviceTypeId } }),
  micStatus: () => api<ReceiverStatus[]>("/mics/status"),
  pagingConfig: () => api<PagingConfig>("/paging/config"),
  savePaging: (patch: PagingPatch) => api<PagingConfig>("/paging/config", { method: "PUT", json: patch }),
  setPin: (m: Ministry, pin: string | null) => api<PagingConfig>(`/paging/pin/${m}`, { method: "PUT", json: { pin } }),
  signOutIpads: (m: Ministry) => api<{ ok: true }>(`/paging/signout/${m}`, { method: "POST" }),
  discoverPro: (port?: number) => api<ProPresenterMachine[]>(`/paging/discover${port ? `?port=${port}` : ""}`),
  testPro: (host: string, port: number) => api<ProPresenterMachine>("/paging/connect-test", { method: "POST", json: { host, port } }),
  proThemes: () => api<ProThemeOption[]>("/paging/themes"),
  proMessages: () => api<ProMessageOption[]>("/paging/messages"),
  checkInLocations: () => api<CheckInLocation[]>("/paging/locations"),
  pagingStatus: () => api<PagingStatus>("/paging/status"),
  sendPageRequest: (id: string) => api<PagingStatus>(`/paging/requests/${id}/send`, { method: "POST" }),
  cancelPageRequest: (id: string) => api<PagingStatus>(`/paging/requests/${id}/cancel`, { method: "POST" }),
  sendAllPageRequests: () => api<PagingStatus>("/paging/requests/send-all", { method: "POST" }),
  page: (ministry: Ministry, code: string, childName?: string | null) =>
    api<{ event: PageEvent; status: PagingStatus }>("/paging/page", { method: "POST", json: { ministry, code, childName } }),
  testPage: (m: Ministry) => api<{ event: PageEvent; status: PagingStatus }>(`/paging/test/${m}`, { method: "POST" }),
  ipads: () => api<KioskAddresses>("/paging/ipads"),
  updates: () => api<UpdateStatus>("/updates"),
  checkUpdates: () => api<UpdateStatus>("/updates/check", { method: "POST" }),
  installUpdate: () => api<UpdateStatus>("/updates/install", { method: "POST" }),
  pagingChildren: () => api<Record<Ministry, KioskChild[]>>("/paging/children"),
  removeMember: (st: string, plan: string, tm: string) =>
    api<void>(`/services/plans/${st}/${plan}/team-members/${tm}`, { method: "DELETE" }),
};

export const qk = {
  resi: ["resi"] as const,
  me: ["me"] as const,
  settings: ["settings"] as const,
  workflows: ["workflows"] as const,
  board: (wf: string) => ["board", wf] as const,
  contacts: (wf: string) => ["contacts", wf] as const,
  notes: (card: string) => ["notes", card] as const,
  plans: ["plans"] as const,
  serviceTypes: ["serviceTypes"] as const,
  typePlans: (st: string) => ["plans", st] as const,
  plan: (st: string, plan: string) => ["plan", st, plan] as const,
  counts: (plan: string) => ["counts", plan] as const,
  checkins: (plan: string) => ["checkins", plan] as const,
  micSetup: ["micSetup"] as const,
  micStatus: ["micStatus"] as const,
  plot: (id: string) => ["plot", id] as const,
  planPlot: (plan: string) => ["planPlot", plan] as const,
  planMics: (plan: string) => ["planMics", plan] as const,
  candidates: (plan: string, team: string, pos: string) => ["candidates", plan, team, pos] as const,
  conflicts: (plan: string, person: string) => ["conflicts", plan, person] as const,
  paging: ["paging"] as const,
  pagingStatus: ["pagingStatus"] as const,
  proThemes: ["proThemes"] as const,
  proMessages: ["proMessages"] as const,
  checkInLocations: ["checkInLocations"] as const,
  ipads: ["ipads"] as const,
  updates: ["updates"] as const,
  matrix: (st: string, weeks: number, past: number) => ["matrix", st, weeks, past] as const,
  live: (plan: string) => ["live", plan] as const,
  noteCategories: (st: string) => ["noteCategories", st] as const,
  proMachines: ["proMachines"] as const,
  smaartConfig: ["smaartConfig"] as const,
  smaartStatus: ["smaartStatus"] as const,
  dashboard: ["dashboard"] as const,
  home: ["home"] as const,
  weekend: ["weekend"] as const,
  sync: ["sync"] as const,
  campuses: ["campuses"] as const,
  profile: (personId: string) => ["profile", personId] as const,
  consoleConfig: ["consoleConfig"] as const,
  consolePreview: (plan: string) => ["consolePreview", plan] as const,
  proState: (id: string) => ["proState", id] as const,
  pagingChildren: ["pagingChildren"] as const,
};

/** Query options shared everywhere, so the list is fetched once and reused (and prefetched). */
export const plansQuery = { queryKey: qk.plans, queryFn: () => Api.plans(), staleTime: 60_000 };
export const planQuery = (st: string, plan: string) => ({
  queryKey: qk.plan(st, plan),
  queryFn: () => Api.plan(st, plan),
  staleTime: 15_000,
});


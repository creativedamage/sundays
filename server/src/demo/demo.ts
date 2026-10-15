/**
 * DemoPco — in-memory Planning Center stand-in with realistic Cool Church data.
 * Lets every screen run without PCO credentials (DEMO_MODE=true).
 */
import type { PersonProfile,
  Board, Candidate, CheckInLocation, ItemInput, Matrix, NoteCategory, PlanTimeInput, RunSheetLive, SongArrangement, SongHit, CheckInRow, CheckInsForPlan, Conflict, Note, PlanCounts, PlanDetail, PlanItem, PlanSummary, Person, RosterStatus,
  ScheduleRequest, ServiceType, StaffMe, Team, TeamMember, WorkflowCard, WorkflowShare, WorkflowShareGroup, WorkflowStep, WorkflowSummary,
} from "../../../shared/types.js";
import { computeConflicts, type PcoApi } from "../pco/api.js";

let seq = 1000;
const DEMO_ROOMS: [string, string, string][] = [["Kids", "Nursery", "loc-nursery"], ["Kids", "K–2nd", "loc-k2"], ["Kids", "3rd–5th", "loc-35"], ["Students", "Middle School", "loc-ms"], ["Serve", "Volunteers", "loc-vol"]];

function demoCheckIns(key: string, start: number, serving: string[] = []): CheckInRow[] {
  const kids = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Luna", "Leo", "Ivy", "Max", "Nora", "Kai", "Ruby", "Owen", "Isla", "Jude"];
  const lasts = ["Johnson", "Patel", "Reyes", "Nguyen", "Soto", "Kim", "Scott", "Díaz", "Pierre", "Brooks"];
  const shown = Math.min(48, 18 + Math.floor((Date.now() - demoBoot) / 4000));
  return Array.from({ length: shown }, (_, i): CheckInRow => {
    const [folder, room, roomId] = DEMO_ROOMS[i % 5];
    const vol = folder === "Serve";
    // Volunteers: people scheduled on this service first (all but the last two), so Team check-ins fills up.
    const k = Math.floor(i / 5);
    const person = vol ? (k < serving.length - 2 ? people.find((x) => x.id === serving[k]) : undefined) ?? people[(i * 3) % people.length] : null;
    return {
      id: `ci-${key}-${i}`, personId: person?.id ?? null,
      name: person ? person.name : `${kids[(i * 7) % kids.length]} ${lasts[(i * 3) % lasts.length]}`,
      avatarUrl: person?.avatarUrl ?? null,
      kind: vol ? "Volunteer" : i % 9 === 4 ? "Guest" : "Regular",
      event: vol ? "Sunday Volunteers" : `Sunday ${folder}`, eventId: vol ? "ev-vol" : `ev-${folder.toLowerCase()}`, locations: [room], locationIds: [roomId],
      at: new Date(start + i * 70e3).toISOString(),
      checkedOutAt: i < 4 ? new Date(start + 3 * 3600e3).toISOString() : null,
      securityCode: vol ? null : `${"ABCDEFGHJK"[i % 10]}${"XYZ"[i % 3]}${(i * 7) % 10}`,
    };
  }).reverse();
}

/** Demo Live after someone takes control: plan id → current item index and when it started. */
const demoLive = new Map<string, { idx: number; at: number }>();
const DEMO_SONGS: [string, string][] = [
  ["Firm Foundation (He Won't)", "Cody Carnes"], ["Gratitude", "Brandon Lake"], ["Holy Forever", "Chris Tomlin"], ["Praise", "Elevation Worship"],
  ["Build My Life", "Pat Barrett"], ["Goodness of God", "Bethel Music"], ["Way Maker", "Sinach"], ["Graves Into Gardens", "Elevation Worship"],
  ["King of Kings", "Hillsong Worship"], ["What A Beautiful Name", "Hillsong Worship"], ["Great Are You Lord", "All Sons & Daughters"],
  ["O Come to the Altar", "Elevation Worship"], ["Living Hope", "Phil Wickham"], ["Battle Belongs", "Phil Wickham"], ["This Is Amazing Grace", "Phil Wickham"],
];

const demoBoot = Date.now();
const nid = () => String(++seq);
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));

/* ───────────── People ───────────── */

const NAMES = [
  "Marcus Johnson", "Alicia Fernández", "Darnell Williams", "Priya Patel", "Jordan Reyes", "Tasha Brown",
  "Kevin Nguyen", "Gabriela Soto", "Andre Baptiste", "Hannah Kim", "Luis Morales", "Nia Thompson",
  "Caleb Edwards", "Sofia Castillo", "Isaiah Pierre", "Brianna Scott", "Mateo Díaz", "Chloe Anderson",
  "Jamal Carter", "Rachel Levine", "Victor Alvarez", "Imani Robinson", "Ethan Walker", "Camila Ortiz",
  "Samuel Joseph", "Grace Mitchell", "Derek Hall", "Yasmin Ali", "Tyler Brooks", "Naomi Charles",
];
const people: Person[] = NAMES.map((name, i) => {
  const [firstName, lastName] = name.split(" ");
  const handle = `${firstName}.${lastName}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return {
    id: String(200 + i),
    name,
    firstName,
    lastName,
    avatarUrl: i % 7 === 3 ? null : `https://i.pravatar.cc/160?u=coolchurch-${i}`,
    email: `${handle}@example.com`,
    phone: `(954) 555-${String(1100 + i * 37).slice(-4)}`,
  };
});
const personById = (id: string) => people.find((p) => p.id === id)!;

/* ───────────── Workflows ───────────── */

interface DemoWorkflow { id: string; name: string; steps: WorkflowStep[] }
const workflows: DemoWorkflow[] = [
  {
    id: "1", name: "New Guest Follow-Up",
    steps: ["Connection Card", "Welcome Text", "Pastor Call", "Coffee Invite", "Next Steps Class"]
      .map((name, i) => ({ id: `1${i}`, name, sequence: i })),
  },
  {
    id: "2", name: "Volunteer Onboarding",
    steps: ["Interest Form", "Background Check", "Team Leader Interview", "Shadow Sunday", "Ready to Schedule"]
      .map((name, i) => ({ id: `2${i}`, name, sequence: i })),
  },
  {
    id: "3", name: "Baptism",
    steps: ["Requested", "Class Scheduled", "Story Recorded", "Baptism Sunday"]
      .map((name, i) => ({ id: `3${i}`, name, sequence: i })),
  },
  {
    id: "4", name: "Membership",
    steps: ["Class Signup", "Class Attended", "Interview", "Welcomed"]
      .map((name, i) => ({ id: `4${i}`, name, sequence: i })),
  },
];

interface DemoCard extends Omit<WorkflowCard, "person"> { workflowId: string }
const cards: DemoCard[] = [];
const cardNotes = new Map<string, Note[]>();
const assignees = ["Pastor Mike", "Jessica (Connections)", "Ray (Volunteers)", null];

function addCard(workflowId: string, personIdx: number, stepIdx: number, ageDays: number) {
  const wf = workflows.find((w) => w.id === workflowId)!;
  const id = nid();
  cards.push({
    id, workflowId, personId: people[personIdx].id, stepId: wf.steps[stepIdx].id, stage: "ready",
    assigneeName: assignees[(personIdx + stepIdx) % assignees.length], overdue: ageDays > 6,
    movedToStepAt: daysAgo(ageDays), createdAt: daysAgo(ageDays + 5), snoozeUntil: null, noteCount: 0,
  });
  if (personIdx % 3 === 0) {
    cardNotes.set(id, [
      { id: `card-${nid()}`, body: "Left a voicemail — will try again Thursday evening.", authorName: "Jessica (Connections)", createdAt: daysAgo(ageDays), source: "card", category: null },
    ]);
  }
}
[[0, 0, 1], [1, 0, 0], [2, 1, 3], [3, 1, 8], [4, 2, 2], [5, 2, 4], [6, 3, 1], [7, 4, 9], [8, 0, 2], [9, 1, 0]]
  .forEach(([p, s, a]) => addCard("1", p, s, a));
[[10, 0, 1], [11, 1, 5], [12, 1, 12], [13, 2, 3], [14, 3, 2], [15, 4, 1], [16, 0, 0], [17, 2, 7]]
  .forEach(([p, s, a]) => addCard("2", p, s, a));
[[18, 0, 2], [19, 1, 4], [20, 2, 1], [21, 3, 0]].forEach(([p, s, a]) => addCard("3", p, s, a));
[[22, 0, 1], [23, 2, 3]].forEach(([p, s, a]) => addCard("4", p, s, a));

/** Demo sharing: the demo user manages New Guest Follow-Up, edits Volunteer Onboarding, and isn't on the others. */
const DEMO_ME = "205";
const shares = new Map<string, WorkflowShare[]>([
  ["1", [{ id: "s1", personId: DEMO_ME, name: "Wayne (Demo)", avatarUrl: null, group: "Manager" }, { id: "s2", personId: "203", name: "", avatarUrl: null, group: "Editor" }]],
  ["2", [{ id: "s3", personId: DEMO_ME, name: "Wayne (Demo)", avatarUrl: null, group: "Editor" }]],
  ["3", []], ["4", []],
]);
/** A new guest shows up a minute after the demo starts, so the new-card notification can be seen. */
let demoNewCard = false;
function demoArrivals() {
  if (demoNewCard || Date.now() - demoBoot < 60_000) return;
  demoNewCard = true;
  addCard("1", 24, 0, 0);
}

const profileNotes: Record<string, Note[]> = {
  "200": [{ id: "profile-1", body: "First visited with his wife and two kids (ages 6 & 9). Interested in the men's group.", authorName: "Pastor Mike", createdAt: daysAgo(20), source: "profile", category: "Pastoral Care" }],
  "203": [{ id: "profile-2", body: "Nurse at Memorial Regional — works rotating Sundays. Prefers texts over calls.", authorName: "Jessica (Connections)", createdAt: daysAgo(40), source: "profile", category: "Contact Preference" }],
  "210": [{ id: "profile-3", body: "Played bass at previous church for 6 years.", authorName: "Ray (Volunteers)", createdAt: daysAgo(15), source: "profile", category: "Gifts & Skills" }],
};

/* ───────────── Services ───────────── */

const serviceTypes: ServiceType[] = [
  { id: "10", name: "Sunday Gathering" },
  { id: "12", name: "Sunday · North Campus" },
  { id: "11", name: "Wednesday Night Youth" },
];

const teams: Team[] = [
  { id: "t1", name: "Worship", positions: ["Worship Leader", "Vocals", "Acoustic Guitar", "Electric Guitar", "Bass", "Keys", "Drums"].map((n, i) => ({ id: `tp1${i}`, name: n })) },
  { id: "t2", name: "Production", positions: ["FOH Audio", "ProPresenter", "Lighting", "Camera", "Stream Director"].map((n, i) => ({ id: `tp2${i}`, name: n })) },
  { id: "t3", name: "Hospitality", positions: ["Greeter", "Usher", "Coffee Bar"].map((n, i) => ({ id: `tp3${i}`, name: n })) },
  { id: "t4", name: "Kids", positions: ["Check-In", "Classroom Lead", "Classroom Helper"].map((n, i) => ({ id: `tp4${i}`, name: n })) },
];

/** Which people are qualified for which positions (person_team_position_assignments). */
const qualified = new Map<string, string[]>();
teams.forEach((t, ti) =>
  t.positions.forEach((p, pi) => {
    const pool = people.filter((_, i) => (i + pi + ti * 3) % 5 === 0 || (i * 7 + pi) % 11 === 0).map((x) => x.id);
    qualified.set(p.id, pool.slice(0, 8));
  }),
);

interface DemoPlan extends Omit<PlanDetail, "teams" | "confirmedCount" | "unconfirmedCount" | "declinedCount" | "neededCount"> {
  neededTemplate: { teamId: string; positionName: string; quantity: number }[];
}
const plans: DemoPlan[] = [];
const roster = new Map<string, TeamMember[]>();

function nextWeekday(dow: number, weeksAhead: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7) + weeksAhead * 7);
  return d;
}
const at = (d: Date, hh: number, mm = 0) => {
  const x = new Date(d);
  x.setHours(hh, mm, 0, 0);
  return iso(x);
};
const SERIES = ["Unshakeable", "Unshakeable", "Unshakeable", "Neighbors", "Neighbors", "Neighbors", "Advent", "Advent"];
const SONGS: [string, string, number][] = [
  ["Firm Foundation (He Won't)", "B", 330], ["Gratitude", "Db", 300], ["Holy Forever", "C", 360],
  ["Praise", "E", 280], ["Build My Life", "Bb", 340], ["Goodness of God", "A", 320],
];
const runSheet = (w: number): PlanItem[] => {
  const s = (i: number) => SONGS[(i + w) % SONGS.length];
  const rows: Omit<PlanItem, "id" | "sequence">[] = [
    { title: "VOCAL WARM UPS", kind: "song", lengthSec: 0, description: "Team only", songKey: null, servicePosition: "pre", notes: [] },
    { title: "Pre-Service Countdown", kind: "media", lengthSec: 300, description: "5:00 countdown on all screens", songKey: null, servicePosition: "pre", notes: [{ category: "Production", body: "House music fades at 0:30" }] },
    { title: "Worship", kind: "header", lengthSec: 0, description: null, songKey: null, servicePosition: "during", notes: [] },
    { title: s(0)[0], kind: "song", lengthSec: s(0)[2], description: null, songKey: s(0)[1], servicePosition: "during", notes: [{ category: "Lighting", body: "Full stage wash, haze on" }, { category: "Audio", body: "Band in from the count-in. Vox 1 lead." }, { category: "Video", body: "Wide on the band for the intro, then lyrics lower third on stream" }] },
    { title: s(1)[0], kind: "song", lengthSec: s(1)[2], description: null, songKey: s(1)[1], servicePosition: "during", notes: [{ category: "Lighting", body: "Slow blue, pull the haze" }, { category: "Stage", body: "Acoustic only for verse 1" }] },
    { title: "Welcome & Announcements", kind: "item", lengthSec: 360, description: "Next Steps lunch after second service in the café. Serve Day is Oct 17: sign-ups at the Connect table and in the app. Kids check-in opens 20 minutes early next week because of the baptism service.", songKey: null, servicePosition: "during", notes: [{ category: "ProPresenter", body: "3 announcement slides. Hold the Serve Day slide until the host says “sign up today”, then advance to the QR code slide and leave it up through the offering." }] },
    { title: "Message", kind: "header", lengthSec: 0, description: null, songKey: null, servicePosition: "during", notes: [] },
    { title: `${SERIES[w]} — Week ${w + 1}`, kind: "item", lengthSec: 2100, description: "Pastor Mike", songKey: null, servicePosition: "during", notes: [{ category: "Video", body: "Lower third at 0:30. Scripture slides from ProPresenter." }, { category: "Audio", body: "Handheld 2 for Pastor Mike; lav as backup" }] },
    { title: s(2)[0], kind: "song", lengthSec: s(2)[2], description: "Response", songKey: s(2)[1], servicePosition: "during", notes: [] },
    { title: "Closing & Blessing", kind: "item", lengthSec: 180, description: null, songKey: null, servicePosition: "during", notes: [] },
    { title: "Walk-out Playlist", kind: "media", lengthSec: 600, description: null, songKey: null, servicePosition: "post", notes: [] },
  ];
  return rows.map((r, i) => ({ ...r, id: nid(), sequence: i, notes: r.notes.map((n) => ({ ...n, id: nid() })) }));
};

const NEEDED = [
  { teamId: "t1", positionName: "Worship Leader", quantity: 1 }, { teamId: "t1", positionName: "Vocals", quantity: 2 },
  { teamId: "t1", positionName: "Acoustic Guitar", quantity: 1 }, { teamId: "t1", positionName: "Bass", quantity: 1 },
  { teamId: "t1", positionName: "Keys", quantity: 1 }, { teamId: "t1", positionName: "Drums", quantity: 1 },
  { teamId: "t2", positionName: "FOH Audio", quantity: 1 }, { teamId: "t2", positionName: "ProPresenter", quantity: 1 },
  { teamId: "t2", positionName: "Camera", quantity: 2 }, { teamId: "t3", positionName: "Greeter", quantity: 4 },
  { teamId: "t3", positionName: "Coffee Bar", quantity: 2 }, { teamId: "t4", positionName: "Check-In", quantity: 2 },
  { teamId: "t4", positionName: "Classroom Lead", quantity: 2 },
];

for (let w = 0; w < SERIES.length; w++) {
  const d = nextWeekday(0, w);
  const id = `p${w}`;
  plans.push({
    id, serviceTypeId: "10", serviceTypeName: "Sunday Gathering",
    title: `${SERIES[w]}${SERIES[w] === "Unshakeable" ? ` · Week ${w + 1}` : ""}`, seriesTitle: SERIES[w],
    dates: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), sortDate: at(d, 9),
    times: [
      { id: nid(), name: "Rehearsal", kind: "rehearsal", startsAt: at(d, 7, 30), endsAt: at(d, 8, 30) },
      { id: nid(), name: "9:00 AM", kind: "service", startsAt: at(d, 9), endsAt: at(d, 10, 15) },
      { id: nid(), name: "11:00 AM", kind: "service", startsAt: at(d, 11), endsAt: at(d, 12, 15) },
    ],
    items: runSheet(w), roster: [], needed: [], neededTemplate: NEEDED,
  });
  // Seed roster: fill roughly (70% - 15% per week) of slots, with a mix of statuses.
  const members: TeamMember[] = [];
  NEEDED.forEach((n, ni) => {
    const team = teams.find((t) => t.id === n.teamId)!;
    const pos = team.positions.find((p) => p.name === n.positionName)!;
    const pool = qualified.get(pos.id)!;
    for (let q = 0; q < n.quantity; q++) {
      if ((ni * 3 + q + w * 5) % 10 < 2 + Math.min(w, 4)) continue; // leave ~20–50% open, more further out
      const pid = [...pool.slice((q + w) % pool.length), ...pool].find((id) => !members.some((m) => m.personId === id));
      if (!pid) continue;
      const p = personById(pid);
      const status: RosterStatus = (ni + q + w) % 6 === 0 ? "D" : (ni + w) % 3 === 0 ? "U" : "C";
      members.push({
        id: nid(), personId: pid, name: p.name, avatarUrl: p.avatarUrl, teamId: team.id, teamName: team.name,
        positionName: n.positionName, status, declineReason: status === "D" ? "Out of town" : null, notifiedAt: daysAgo(3),
      });
    }
  });
  roster.set(id, members);
}
// A second campus on the same Sundays, so services can be watched and compared side by side.
for (const src of plans.filter((p) => p.serviceTypeId === "10").slice(0, 4)) {
  const id = `n${src.id.slice(1)}`;
  plans.push({
    ...src, id, serviceTypeId: "12", serviceTypeName: "Sunday · North Campus",
    times: src.times.map((t) => ({ ...t, id: nid() })),
    items: src.items.map((i) => ({ ...i, id: nid(), notes: i.notes.map((n) => ({ ...n, id: nid() })) })),
    roster: [], needed: [],
  });
  roster.set(id, (roster.get(src.id) ?? []).map((m) => ({ ...m, id: nid() })));
}
// Wednesday youth nights
for (let w = 0; w < 3; w++) {
  const d = nextWeekday(3, w);
  const id = `y${w}`;
  plans.push({
    id, serviceTypeId: "11", serviceTypeName: "Wednesday Night Youth", title: "Youth Night", seriesTitle: null,
    dates: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), sortDate: at(d, 19),
    times: [{ id: nid(), name: "7:00 PM", kind: "service", startsAt: at(d, 19), endsAt: at(d, 20, 30) }],
    items: runSheet(w).slice(1, 8), roster: [], needed: [],
    neededTemplate: [{ teamId: "t1", positionName: "Worship Leader", quantity: 1 }, { teamId: "t1", positionName: "Keys", quantity: 1 }, { teamId: "t2", positionName: "FOH Audio", quantity: 1 }, { teamId: "t3", positionName: "Greeter", quantity: 2 }],
  });
  roster.set(id, []);
}

const blockouts: Record<string, { start: string; end: string; reason: string | null }[]> = {};
[1, 4, 9, 13, 22].forEach((i, k) => {
  const d = nextWeekday(0, k % 3);
  blockouts[people[i].id] = [{ start: at(d, 0), end: at(d, 23, 59), reason: ["Family trip", "Work shift", "Out of town", "Wedding", "Vacation"][k] }];
});

/* ───────────── Implementation ───────────── */

export class DemoPco implements PcoApi {
  async me(): Promise<StaffMe> {
    return { ...personById("205"), name: "Wayne (Demo)", firstName: "Wayne", lastName: "", email: null, orgName: "Sample Church", demo: true };
  }

  async listWorkflows(): Promise<WorkflowSummary[]> {
    demoArrivals();
    return workflows.map((w) => {
      const ready = cards.filter((c) => c.workflowId === w.id && c.stage === "ready");
      const myShare = shares.get(w.id)?.find((x) => x.personId === DEMO_ME)?.group ?? null;
      const mine = myShare != null && myShare !== "No Access";
      return {
        id: w.id, name: w.name, readyCount: ready.length, overdueCount: ready.filter((c) => c.overdue).length,
        myReadyCount: mine ? Math.ceil(ready.length / 3) : 0, myOverdueCount: 0, myShare, mine, canOpen: mine, canManage: myShare === "Manager",
      };
    });
  }

  async listShares(workflowId: string): Promise<WorkflowShare[]> {
    return (shares.get(workflowId) ?? []).map((x) => {
      const p = people.find((q) => q.id === x.personId);
      return { ...x, name: x.personId === DEMO_ME ? "Wayne (Demo)" : p?.name ?? x.name, avatarUrl: p?.avatarUrl ?? null };
    });
  }

  async setShare(workflowId: string, personId: string, group: WorkflowShareGroup): Promise<WorkflowShare[]> {
    const list = shares.get(workflowId) ?? [];
    const hit = list.find((x) => x.personId === personId);
    if (hit) hit.group = group;
    else list.push({ id: `s${nid()}`, personId, name: "", avatarUrl: null, group });
    shares.set(workflowId, list);
    return this.listShares(workflowId);
  }

  async removeShare(workflowId: string, shareId: string): Promise<WorkflowShare[]> {
    shares.set(workflowId, (shares.get(workflowId) ?? []).filter((x) => x.id !== shareId));
    return this.listShares(workflowId);
  }

  async searchPeople(query: string): Promise<Person[]> {
    const q = query.trim().toLowerCase();
    return q.length < 2 ? [] : people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 15);
  }

  private hydrate(c: DemoCard): WorkflowCard {
    const { workflowId: _wf, ...rest } = c;
    return { ...rest, person: personById(c.personId), noteCount: cardNotes.get(c.id)?.length ?? 0 };
  }

  async getBoard(workflowId: string): Promise<Board> {
    demoArrivals();
    const wf = workflows.find((w) => w.id === workflowId);
    if (!wf) throw new Error("Workflow not found");
    return {
      workflow: { id: wf.id, name: wf.name },
      steps: wf.steps,
      cards: cards.filter((c) => c.workflowId === wf.id && (c.stage === "ready" || c.stage === "snoozed")).map((c) => this.hydrate(c)),
    };
  }

  async moveCard(workflowId: string, cardId: string, toStepId: string | null): Promise<WorkflowCard> {
    const c = cards.find((x) => x.id === cardId && x.workflowId === workflowId);
    if (!c) throw new Error("Card not found");
    await new Promise((r) => setTimeout(r, 250)); // feel the network
    c.stepId = toStepId;
    c.stage = toStepId === null ? "completed" : "ready";
    c.movedToStepAt = iso(new Date());
    c.overdue = false;
    return this.hydrate(c);
  }

  async getContacts(ids: string[]) {
    return Object.fromEntries(ids.map((id) => [id, { email: personById(id)?.email ?? null, phone: personById(id)?.phone ?? null, mobile: personById(id)?.phone ?? null }]));
  }

  async getPerson(personId: string) {
    return personById(personId);
  }

  async getProfile(personId: string): Promise<PersonProfile> {
    const person = personById(personId);
    const schedule = plans
      .filter((pl) => Date.parse(pl.sortDate) > Date.now() - 864e5)
      .flatMap((pl) => (roster.get(pl.id) ?? []).filter((m) => m.personId === personId).map((m) => ({
        planId: pl.id, serviceTypeId: pl.serviceTypeId, serviceTypeName: serviceTypes.find((t) => t.id === pl.serviceTypeId)?.name ?? "",
        date: pl.sortDate, teamName: m.teamName, position: m.positionName, status: m.status,
      })))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      person,
      emails: person.email ? [{ address: person.email, location: "Home", primary: true }] : [],
      phones: [person.mobile ? { number: person.mobile, location: "Mobile", primary: true } : null, person.phone && person.phone !== person.mobile ? { number: person.phone, location: "Home", primary: false } : null].filter(Boolean) as PersonProfile["phones"],
      address: "1200 Palm Ave · Miramar, FL · 33025",
      birthdate: null,
      membership: "Member",
      schedule,
      blockouts: Number(personId.replace(/\D/g, "")) % 4 === 0 ? [{ id: "b1", reason: "Out of town", startsAt: new Date(Date.now() + 9 * 864e5).toISOString(), endsAt: new Date(Date.now() + 12 * 864e5).toISOString() }] : [],
      cards: cards.filter((c) => c.personId === personId).map((c) => ({ id: c.id, workflowName: workflows.find((w) => w.id === c.workflowId)?.name ?? "Workflow" })),
      url: `https://people.planningcenteronline.com/people/AC${personId}`,
    };
  }

  async getNotes(personId: string, cardId: string): Promise<Note[]> {
    return [...(cardNotes.get(cardId) ?? []), ...(profileNotes[personId] ?? [])];
  }

  async addCardNote(_personId: string, cardId: string, body: string): Promise<Note> {
    const n: Note = { id: `card-${nid()}`, body, authorName: "Wayne (Demo)", createdAt: iso(new Date()), source: "card", category: null };
    cardNotes.set(cardId, [n, ...(cardNotes.get(cardId) ?? [])]);
    return n;
  }

  async sendCardEmail(personId: string, cardId: string, subject: string) {
    await this.addCardNote(personId, cardId, `✉️ Email sent: “${subject}”`);
  }

  async listServiceTypes() {
    return serviceTypes;
  }

  private summarize(p: DemoPlan): PlanSummary & Pick<PlanDetail, "confirmedCount" | "unconfirmedCount" | "declinedCount"> {
    const r = roster.get(p.id)!;
    const filled = (teamId: string, pos: string) => r.filter((m) => m.teamId === teamId && m.positionName === pos && m.status !== "D").length;
    const needed = p.neededTemplate.reduce((n, t) => n + Math.max(0, t.quantity - filled(t.teamId, t.positionName)), 0);
    return {
      id: p.id, serviceTypeId: p.serviceTypeId, serviceTypeName: p.serviceTypeName, title: p.title, seriesTitle: p.seriesTitle,
      dates: p.dates, sortDate: p.sortDate, neededCount: needed,
      confirmedCount: r.filter((m) => m.status === "C").length,
      unconfirmedCount: r.filter((m) => m.status === "U").length,
      declinedCount: r.filter((m) => m.status === "D").length,
    };
  }

  async listUpcomingPlans(serviceTypeId?: string) {
    return plans.filter((p) => !serviceTypeId || p.serviceTypeId === serviceTypeId).map((p) => this.summarize(p))
      .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }

  async listPlansFrom(from: string, count: number, serviceTypeId?: string) {
    const start = new Date(`${from}T00:00:00`).getTime();
    return (await this.listUpcomingPlans(serviceTypeId)).filter((p) => Date.parse(p.sortDate) >= start).slice(0, count * 4);
  }

  async getMatrix(st: string, weeks: number): Promise<Matrix> {
    const list = plans.filter((p) => p.serviceTypeId === st).sort((a, b) => a.sortDate.localeCompare(b.sortDate)).slice(0, weeks);
    return { serviceType: serviceTypes.find((t) => t.id === st) ?? { id: st, name: "Service" }, plans: await Promise.all(list.map((p) => this.getPlan(st, p.id))) };
  }

  /**
   * Sample Live: moves to the next item every 40 seconds, for the dashboard's Live widget.
   */
  async getLive(st: string, planId: string): Promise<RunSheetLive | null> {
    const items = this.plan(st, planId).items.filter((i) => i.kind !== "header");
    const manual = demoLive.get(planId);
    const n = manual ? Math.min(manual.idx, items.length - 1) : Math.floor((Date.now() - demoBoot) / 40_000) % items.length;
    const started = manual ? manual.at : demoBoot + Math.floor((Date.now() - demoBoot) / 40_000) * 40_000;
    return {
      currentItemId: items[n].id, nextItemId: items[n + 1]?.id ?? null,
      currentStartedAt: new Date(started).toISOString(),
      controller: manual ? "Wayne (Demo)" : "Jordan (Demo)",
      youControl: Boolean(manual), canTakeControl: true,
    };
  }

  async updatePlan(st: string, planId: string, input: { title?: string | null; seriesTitle?: string | null }) {
    const p = this.plan(st, planId);
    if (input.title !== undefined) p.title = input.title || p.dates;
    if (input.seriesTitle !== undefined) p.seriesTitle = input.seriesTitle || null;
    return this.getPlan(st, planId);
  }

  async savePlanTime(st: string, planId: string, input: PlanTimeInput & { id?: string }) {
    const p = this.plan(st, planId);
    const t = input.id ? p.times.find((x) => x.id === input.id) : undefined;
    if (t) Object.assign(t, { name: input.name, kind: input.kind, startsAt: input.startsAt, endsAt: input.endsAt });
    else p.times.push({ id: nid(), name: input.name, kind: input.kind, startsAt: input.startsAt, endsAt: input.endsAt });
    p.times.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return this.getPlan(st, planId);
  }

  async deletePlanTime(st: string, planId: string, timeId: string) {
    const p = this.plan(st, planId);
    p.times = p.times.filter((x) => x.id !== timeId);
    return this.getPlan(st, planId);
  }

  async listNoteCategories(): Promise<NoteCategory[]> {
    return ["Person", "Audio", "Lighting", "Video", "Stage", "ProPresenter", "Production", "Camera"].map((name, i) => ({ id: `nc${i}`, name }));
  }

  async searchSongs(query: string): Promise<SongHit[]> {
    const q = query.trim().toLowerCase();
    return DEMO_SONGS.map(([title, author], i) => ({ id: `song${i}`, title, author, lastScheduledAt: new Date(Date.now() - i * 6 * 864e5).toISOString() }))
      .filter((x) => !q || `${x.title} ${x.author}`.toLowerCase().includes(q)).slice(0, 25);
  }

  async songArrangements(songId: string): Promise<SongArrangement[]> {
    const i = Number(songId.replace("song", "")) || 0;
    const keys = ["A", "Bb", "C", "D", "E", "G"].map((k, j) => ({ id: `${songId}-k${j}`, name: k, startingKey: k }));
    return [
      { id: `${songId}-a0`, name: "Default", lengthSec: 270 + (i % 5) * 20, keys },
      { id: `${songId}-a1`, name: "Acoustic", lengthSec: 240 + (i % 4) * 15, keys: keys.slice(0, 3) },
    ];
  }

  private items(st: string, planId: string) { return this.plan(st, planId).items; }
  private renumber(items: PlanItem[]) { items.forEach((it, i) => { it.sequence = i; }); return items.map((x) => ({ ...x, notes: x.notes.map((n) => ({ ...n })) })); }

  async createItem(st: string, planId: string, input: ItemInput) {
    const items = this.items(st, planId);
    let title = input.title ?? "New item", lengthSec = input.lengthSec ?? 0, songKey: string | null = null;
    if (input.songId) {
      const song = (await this.searchSongs("")).find((x) => x.id === input.songId);
      const arr = (await this.songArrangements(input.songId)).find((a) => a.id === input.arrangementId);
      title = input.title ?? song?.title ?? title;
      lengthSec = input.lengthSec ?? arr?.lengthSec ?? 300;
      songKey = arr?.keys.find((k) => k.id === input.keyId)?.name ?? null;
    }
    const it: PlanItem = {
      id: nid(), title, sequence: 0, kind: input.kind ?? "item", lengthSec, description: input.description ?? null, songKey,
      servicePosition: input.servicePosition ?? "during", notes: [], songId: input.songId ?? null, arrangementId: input.arrangementId ?? null, keyId: input.keyId ?? null,
    };
    const at = input.afterItemId === undefined ? items.length : input.afterItemId === null ? 0 : items.findIndex((x) => x.id === input.afterItemId) + 1;
    items.splice(at, 0, it);
    return this.renumber(items);
  }

  async updateItem(st: string, planId: string, itemId: string, input: ItemInput) {
    const items = this.items(st, planId);
    const it = items.find((x) => x.id === itemId);
    if (it) {
      if (input.title !== undefined) it.title = input.title;
      if (input.lengthSec !== undefined) it.lengthSec = input.lengthSec;
      if (input.description !== undefined) it.description = input.description || null;
      if (input.servicePosition) it.servicePosition = input.servicePosition;
      if (input.keyId !== undefined && it.songId) {
        it.keyId = input.keyId;
        it.songKey = (await this.songArrangements(it.songId)).flatMap((a) => a.keys).find((k) => k.id === input.keyId)?.name ?? it.songKey;
      }
    }
    return this.renumber(items);
  }

  async deleteItem(st: string, planId: string, itemId: string) {
    const items = this.items(st, planId);
    const i = items.findIndex((x) => x.id === itemId);
    if (i >= 0) items.splice(i, 1);
    return this.renumber(items);
  }

  async reorderItems(st: string, planId: string, itemIds: string[]) {
    const items = this.items(st, planId);
    const byId = new Map(items.map((x) => [x.id, x]));
    const next = itemIds.map((id) => byId.get(id)).filter((x): x is PlanItem => Boolean(x));
    items.splice(0, items.length, ...next, ...items.filter((x) => !itemIds.includes(x.id)));
    return this.renumber(items);
  }

  async saveItemNote(st: string, planId: string, itemId: string, note: { noteId?: string; categoryId: string; content: string }) {
    const items = this.items(st, planId);
    const it = items.find((x) => x.id === itemId);
    if (it) {
      const existing = note.noteId ? it.notes.find((n) => n.id === note.noteId) : undefined;
      if (existing) existing.body = note.content;
      else {
        const cat = (await this.listNoteCategories()).find((c) => c.id === note.categoryId);
        it.notes.push({ id: nid(), categoryId: note.categoryId, category: cat?.name ?? "Note", body: note.content });
      }
    }
    return this.renumber(items);
  }

  async deleteItemNote(st: string, planId: string, itemId: string, noteId: string) {
    const items = this.items(st, planId);
    const it = items.find((x) => x.id === itemId);
    if (it) it.notes = it.notes.filter((n) => n.id !== noteId);
    return this.renumber(items);
  }

  private plan(st: string, id: string) {
    const p = plans.find((x) => x.id === id && x.serviceTypeId === st);
    if (!p) throw new Error("Plan not found");
    return p;
  }

  async getPlan(st: string, planId: string): Promise<PlanDetail> {
    const p = this.plan(st, planId);
    const r = roster.get(p.id)!;
    const needed = p.neededTemplate
      .map((t) => {
        const filled = r.filter((m) => m.teamId === t.teamId && m.positionName === t.positionName && m.status !== "D").length;
        return { id: `${p.id}-${t.teamId}-${t.positionName}`, teamId: t.teamId, teamName: teams.find((x) => x.id === t.teamId)!.name, positionName: t.positionName, quantity: t.quantity - filled };
      })
      .filter((n) => n.quantity > 0);
    const { neededTemplate: _t, ...rest } = p;
    return { ...rest, ...this.summarize(p), roster: r, needed, teams };
  }

  /** Sample check-ins that keep arriving (one every few seconds) so the live view can be seen. */
  async getCheckIns(st: string, planId: string): Promise<CheckInsForPlan> {
    const p = this.plan(st, planId);
    const start = Date.parse(p.times.find((t) => t.kind === "service")?.startsAt ?? p.sortDate) - 40 * 60e3;
    return { from: new Date(start).toISOString(), to: new Date(start + 5 * 3600e3).toISOString(), rows: demoCheckIns(planId, start, [...new Set((roster.get(planId) ?? []).filter((m) => m.status !== "D").map((m) => m.personId))]), fetchedAt: new Date().toISOString() };
  }

  async getTodayCheckIns(): Promise<CheckInRow[]> {
    // Started about 40 minutes ago, so the kids pages always have children to show.
    return demoCheckIns("today", Date.now() - 40 * 60e3);
  }

  async listCheckInLocations(): Promise<CheckInLocation[]> {
    const rooms = DEMO_ROOMS.map(([folder, name, id]) => ({ id, name, folder, event: folder === "Serve" ? "Sunday Volunteers" : `Sunday ${folder}`, eventId: folder === "Serve" ? "ev-vol" : `ev-${folder.toLowerCase()}`, childOrAdult: folder === "Kids" ? "child" : "adult" }));
    // Areas of serving in the volunteer event.
    const serve = [["Front Doors", "Guest Services"], ["Main Lobby", "Guest Services"], ["Auditorium", "Worship"], ["Production Booth", "Worship"], ["Kids Wing", "Kids"], ["Parking Lot", "Safety"]]
      .map(([name, folder], i) => ({ id: `loc-serve-${i}`, name, folder, event: "Sunday Volunteers", eventId: "ev-vol", childOrAdult: "adult" }));
    return [...rooms, ...serve];
  }

  async listTeams(_st: string): Promise<{ id: string; name: string }[]> {
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }

  async getPlanCounts(_st: string, planId: string): Promise<PlanCounts> {
    const r = roster.get(planId) ?? [];
    return { confirmed: r.filter((m) => m.status === "C").length, unconfirmed: r.filter((m) => m.status === "U").length, declined: r.filter((m) => m.status === "D").length };
  }

  async getConflicts(st: string, planId: string, personId: string): Promise<Conflict[]> {
    const p = this.plan(st, planId);
    const on = roster.get(planId)!.find((m) => m.personId === personId);
    const schedules = plans.flatMap((pl) =>
      roster.get(pl.id)!.filter((m) => m.personId === personId).map((m) => ({
        planId: pl.id, day: pl.sortDate.slice(0, 10), label: `${pl.serviceTypeName} · ${m.positionName}`, status: m.status,
      })),
    );
    return computeConflicts({
      planId, planDay: p.sortDate.slice(0, 10),
      serviceWindows: p.times.filter((t) => t.kind !== "other").map((t) => ({ start: Date.parse(t.startsAt), end: Date.parse(t.endsAt) })),
      alreadyOnPlan: on ? { positionName: on.positionName } : null,
      blockouts: blockouts[personId] ?? [], schedules,
    });
  }

  async getCandidates(st: string, planId: string, teamId: string, positionName: string): Promise<Candidate[]> {
    const pos = teams.find((t) => t.id === teamId)?.positions.find((p) => p.name === positionName);
    if (!pos) return [];
    const out = await Promise.all(
      (qualified.get(pos.id) ?? []).map(async (pid, i) => {
        const p = personById(pid);
        return { personId: pid, name: p.name, avatarUrl: p.avatarUrl, conflicts: await this.getConflicts(st, planId, pid), lastServed: daysAgo(7 * ((i % 5) + 1)), checked: true };
      }),
    );
    return out.sort((a, b) => a.conflicts.length - b.conflicts.length || (a.lastServed ?? "").localeCompare(b.lastServed ?? ""));
  }

  async schedule(st: string, planId: string, req: ScheduleRequest): Promise<TeamMember> {
    this.plan(st, planId);
    const team = teams.find((t) => t.id === req.teamId)!;
    const p = personById(req.personId);
    const tm: TeamMember = {
      id: nid(), personId: p.id, name: p.name, avatarUrl: p.avatarUrl, teamId: team.id, teamName: team.name,
      positionName: req.positionName, status: "U", declineReason: null, notifiedAt: req.notify ? iso(new Date()) : null,
    };
    roster.get(planId)!.push(tm);
    return tm;
  }

  async setStatus(_st: string, planId: string, tmId: string, status: RosterStatus, reason?: string): Promise<TeamMember> {
    const tm = roster.get(planId)?.find((m) => m.id === tmId);
    if (!tm) throw new Error("Team member not found");
    tm.status = status;
    tm.declineReason = status === "D" ? reason ?? null : null;
    return tm;
  }

  async removeMember(_st: string, planId: string, tmId: string) {
    roster.set(planId, roster.get(planId)!.filter((m) => m.id !== tmId));
  }
}

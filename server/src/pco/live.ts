/**
 * LivePco — PcoApi backed by the real Planning Center API.
 * Endpoint notes live in docs/ARCHITECTURE.md §3.
 */
import type { PersonProfile,
  Board, Candidate, CheckInLocation, ItemInput, Matrix, NoteCategory, PlanTimeInput, RunSheetLive, SongArrangement, SongHit, CheckInRow, CheckInsForPlan, Conflict, Note, PlanCounts, PlanDetail, PlanItem, PlanSummary, PlanTime, Person,
  RosterStatus, ScheduleRequest, ServiceType, StaffMe, Team, TeamMember, WorkflowCard, WorkflowSummary, WorkflowShare, WorkflowShareGroup, } from "../../../shared/types.js";
import { cache } from "../lib/db.js";
import { computeConflicts, mapLimit, type PcoApi } from "./api.js";
import { PcoClient, flatten, type Flat } from "./client.js";

const P = "/people/v2";
/** Check-ins are often children: kept in memory only, never written to the on-disk cache. */
const checkInMemory = new Map<string, { rows: CheckInRow[]; full: number }>();
/** Several iPads polling at once share one Planning Center request. */
const checkInFlight = new Map<string, Promise<CheckInRow[]>>();
function once(key: string, fn: () => Promise<CheckInRow[]>) {
  const running = checkInFlight.get(key);
  if (running) return running;
  const p = fn().finally(() => checkInFlight.delete(key));
  checkInFlight.set(key, p);
  return p;
}
const S = "/services/v2";
const day = (iso: string) => iso.slice(0, 10);

export class LivePco implements PcoApi {
  /**
   * @param actingPersonId In shared-token (PAT) mode, the signed-in staff member — so "me"
   *   is them, not the token's owner.
   */
  constructor(private c: PcoClient, private orgKey: string, private actingPersonId?: string, private viewerId?: string) {}

  /** Cache keys are scoped per org so multiple churches could share one deployment. */
  private k(key: string) {
    return `${this.orgKey}:${key}`;
  }

  /* ───────────── mapping ───────────── */

  private person(f: Flat, emails: Flat[] = [], phones: Flat[] = []): Person {
    const primary = <T extends Flat>(xs: T[]) => xs.find((x) => x.primary) ?? xs[0];
    return {
      id: f.id,
      name: f.name ?? `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim(),
      firstName: f.first_name ?? "",
      lastName: f.last_name ?? "",
      avatarUrl: f.avatar ?? null,
      email: primary(emails)?.address ?? null,
      phone: primary(phones)?.number ?? null,
      mobile: (phones.find((x) => /mobile|cell/i.test(x.location ?? "")) ?? null)?.number ?? null,
    };
  }

  private card(f: Flat, people: Map<string, Person>): WorkflowCard {
    const personId = f.rel.person?.id;
    return {
      id: f.id,
      personId,
      person: people.get(personId) ?? this.person(f.rel.person ?? { id: personId, rel: {} }),
      stepId: f.rel.current_step?.id ?? null,
      stage: f.stage ?? "ready",
      assigneeName: f.rel.assignee?.name ?? null,
      overdue: Boolean(f.overdue),
      movedToStepAt: f.moved_to_step_at ?? f.created_at,
      createdAt: f.created_at,
      snoozeUntil: f.snooze_until ?? null,
      noteCount: 0,
    };
  }

  private teamMember(f: Flat): TeamMember {
    return {
      id: f.id,
      personId: f.rel.person?.id,
      name: f.name ?? f.rel.person?.name ?? "",
      avatarUrl: f.photo_thumbnail ?? f.rel.person?.photo_thumbnail_url ?? null,
      teamId: f.rel.team?.id,
      teamName: f.rel.team?.name ?? "",
      positionName: f.team_position_name ?? "",
      status: (f.status ?? "U") as RosterStatus,
      declineReason: f.decline_reason ?? null,
      notifiedAt: f.notification_sent_at ?? null,
    };
  }

  /* ───────────── identity ───────────── */

  async me(): Promise<StaffMe> {
    const me = await this.c.get(this.actingPersonId ? `${P}/people/${this.actingPersonId}?include=emails` : `${P}/me?include=emails`);
    const org = await cache.wrap(this.k("org"), 3600, () => this.c.get(`${P}`));
    return { ...this.person(me, me.rel.emails ?? []), orgName: org.name ?? "Planning Center", demo: false };
  }

  /* ───────────── People / workflows ───────────── */

  /** Who's asking: their person id and whether they can see and share every workflow. */
  private async viewer(): Promise<{ id: string; admin: boolean }> {
    const who = this.actingPersonId ?? this.viewerId ?? "me";
    return cache.wrap(this.k(`viewer:${who}`), 600, async () => {
      const me = await this.c.get(this.actingPersonId ? `${P}/people/${this.actingPersonId}` : `${P}/me`);
      return { id: me.id, admin: Boolean(me.site_administrator) || /manager/i.test(String(me.people_permissions ?? "")) };
    });
  }

  async listWorkflows(): Promise<WorkflowSummary[]> {
    const v = await this.viewer();
    const who = this.actingPersonId ?? this.viewerId ?? v.id;
    // Shares come along with the list when Planning Center lets this person see them.
    const wfs = await cache.wrap(this.k(`workflows:${who}`), 600, () =>
      this.c.list(`${P}/workflows?order=name&include=shares`).catch(() => this.c.list(`${P}/workflows?order=name`)));
    // In shared-token mode the "my_" counts are the token owner's, not the signed-in person's.
    const ownCounts = !this.actingPersonId;
    return wfs.map((w) => {
      const share = ((w.rel.shares ?? []) as Flat[]).find((x) => String(x.person_id ?? x.rel?.person?.id) === v.id);
      const myShare = (share?.group ?? null) as WorkflowShareGroup | null;
      const myReady = ownCounts ? Number(w.my_ready_card_count ?? 0) : 0;
      const mine = myReady > 0 || (myShare != null && myShare !== "No Access");
      return {
        id: w.id,
        name: w.name,
        readyCount: w.total_ready_card_count ?? w.ready_card_count ?? 0,
        overdueCount: w.total_overdue_card_count ?? w.overdue_card_count ?? 0,
        myReadyCount: myReady,
        myOverdueCount: ownCounts ? Number(w.my_overdue_card_count ?? 0) : 0,
        myShare, mine,
        canOpen: mine || v.admin,
        canManage: v.admin || myShare === "Manager",
      };
    });
  }

  async listShares(workflowId: string): Promise<WorkflowShare[]> {
    const rows = await this.c.list(`${P}/workflows/${workflowId}/shares?include=person`);
    return rows.map((r) => ({
      id: r.id, personId: String(r.person_id ?? r.rel.person?.id ?? ""), group: (r.group ?? "Viewer") as WorkflowShareGroup,
      name: r.rel.person?.name ?? `${r.rel.person?.first_name ?? ""} ${r.rel.person?.last_name ?? ""}`.trim(),
      avatarUrl: r.rel.person?.avatar ?? null,
    })).filter((x) => x.personId);
  }

  private async bustWorkflows() {
    const v = await this.viewer();
    await cache.bust(this.k(`workflows:${this.actingPersonId ?? this.viewerId ?? v.id}`));
  }

  async setShare(workflowId: string, personId: string, group: WorkflowShareGroup): Promise<WorkflowShare[]> {
    const existing = (await this.listShares(workflowId)).find((x) => x.personId === personId);
    if (existing) {
      await this.c.patch(`${P}/workflows/${workflowId}/shares/${existing.id}`, { data: { type: "WorkflowShare", id: existing.id, attributes: { group } } });
    } else {
      await this.c.post(`${P}/workflows/${workflowId}/shares`, { data: { type: "WorkflowShare", attributes: { group, person_id: Number(personId) || personId } } });
    }
    await this.bustWorkflows();
    return this.listShares(workflowId);
  }

  async removeShare(workflowId: string, shareId: string): Promise<WorkflowShare[]> {
    await this.c.delete(`${P}/workflows/${workflowId}/shares/${shareId}`);
    await this.bustWorkflows();
    return this.listShares(workflowId);
  }

  async searchPeople(query: string): Promise<Person[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const rows = await this.c.list(`${P}/people?where[search_name]=${encodeURIComponent(q)}&per_page=15`, 1);
    return rows.slice(0, 15).map((r) => this.person(r));
  }

  /** Batch-load contact info (emails + phones), cached per person for 1h. */
  private async people(ids: string[]): Promise<Map<string, Person>> {
    const out = new Map<string, Person>();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = await cache.get<Person>(this.k(`person:${id}`));
      hit ? out.set(id, hit) : missing.push(id);
    }
    for (let i = 0; i < missing.length; i += 25) {
      const chunk = missing.slice(i, i + 25);
      let rows: Flat[];
      try {
        rows = await this.c.list(`${P}/people?where[id]=${chunk.join(",")}&include=emails,phone_numbers`, 2);
      } catch {
        rows = [];
      }
      // Fallback: fetch individually anything the batch query did not return.
      const got = new Set(rows.map((r) => r.id));
      rows.push(...(await Promise.all(
        chunk.filter((x) => !got.has(x)).map((id) => this.c.get(`${P}/people/${id}?include=emails,phone_numbers`)),
      )));
      for (const r of rows) {
        const p = this.person(r, r.rel.emails ?? [], r.rel.phone_numbers ?? []);
        out.set(p.id, p);
        await cache.set(this.k(`person:${p.id}`), p, 3600);
      }
    }
    return out;
  }

  async getPerson(personId: string) {
    return (await this.people([personId])).get(personId)!;
  }

  /** The person panel: contact details, upcoming schedule and blockouts, and active workflow cards. */
  async getProfile(personId: string): Promise<PersonProfile> {
    const today = new Date().toISOString().slice(0, 10);
    const [p, schedules, blockouts, cards] = await Promise.all([
      this.c.get(`${P}/people/${personId}?include=emails,phone_numbers,addresses`),
      this.c.list(`${S}/people/${personId}/schedules?order=sort_date&per_page=50`, 1).catch(() => [] as Flat[]),
      this.c.list(`${S}/people/${personId}/blockouts?order=starts_at&per_page=25`, 1).catch(() => [] as Flat[]),
      this.c.list(`${P}/people/${personId}/workflow_cards?include=workflow`, 1).catch(() => [] as Flat[]),
    ]);
    const person = this.person(p, p.rel.emails ?? [], p.rel.phone_numbers ?? []);
    const addr = (p.rel.addresses ?? []).find((a: Flat) => a.primary) ?? p.rel.addresses?.[0];
    const status = (s: string): "C" | "U" | "D" => (s === "C" || s === "D" ? s : "U");
    return {
      person,
      emails: (p.rel.emails ?? []).map((e: Flat) => ({ address: e.address, location: e.location ?? null, primary: Boolean(e.primary) })),
      phones: (p.rel.phone_numbers ?? []).map((n: Flat) => ({ number: n.number, location: n.location ?? null, primary: Boolean(n.primary) })),
      address: addr ? [addr.street ?? addr.street_line_1, addr.street_line_2, [addr.city, addr.state].filter(Boolean).join(", "), addr.zip].filter(Boolean).join(" · ") : null,
      birthdate: p.birthdate ?? null,
      membership: p.membership ?? null,
      schedule: schedules
        .filter((s) => String(s.sort_date ?? s.dates ?? "").slice(0, 10) >= today)
        .map((s) => ({
          planId: s.rel.plan?.id ?? s.plan_id ?? null, serviceTypeId: s.rel.service_type?.id ?? null,
          serviceTypeName: s.service_type_name ?? "", date: s.sort_date ?? s.dates, teamName: s.team_name ?? "",
          position: s.team_position_name ?? "", status: status(s.status),
        })),
      blockouts: blockouts
        .filter((b) => String(b.ends_at ?? "").slice(0, 10) >= today)
        .map((b) => ({ id: b.id, reason: b.reason ?? b.description ?? null, startsAt: b.starts_at, endsAt: b.ends_at })),
      cards: cards
        .filter((c) => !c.completed_at && !c.removed_at)
        .map((c) => ({ id: c.id, workflowName: c.rel.workflow?.name ?? "Workflow" })),
      url: `https://people.planningcenteronline.com/people/AC${personId}`,
    };
  }

  async getContacts(personIds: string[]): Promise<Record<string, { email: string | null; phone: string | null; mobile: string | null }>> {
    const people = await this.people(personIds.slice(0, 300));
    return Object.fromEntries([...people].map(([id, p]) => [id, { email: p.email, phone: p.phone, mobile: p.mobile ?? null }]));
  }

  private steps(workflowId: string) {
    return cache.swr(this.k(`wf:${workflowId}:steps`), 600, () => this.c.list(`${P}/workflows/${workflowId}/steps`));
  }

  /**
   * The board shows as soon as the cards arrive (3 requests in parallel). Email/phone for each
   * person load separately (getContacts) so a big workflow doesn't wait on dozens of lookups.
   */
  async getBoard(workflowId: string): Promise<Board> {
    return cache.swr(this.k(`wf:${workflowId}:board`), 15, () => this.loadBoard(workflowId), 7 * 86400);
  }

  private async loadBoard(workflowId: string): Promise<Board> {
    const [wf, steps, cards] = await Promise.all([
      cache.swr(this.k(`wf:${workflowId}`), 600, () => this.c.get(`${P}/workflows/${workflowId}`)),
      this.steps(workflowId),
      this.c.list(`${P}/workflows/${workflowId}/cards?include=person,assignee,current_step`),
    ]);
    const active = cards.filter((c) => c.stage !== "removed" && c.stage !== "completed");
    // Use contact details we already know; the rest arrive via getContacts.
    const people = new Map<string, Person>();
    for (const c of active) {
      const id = c.rel.person?.id;
      if (!id || people.has(id)) continue;
      const known = await cache.get<Person>(this.k(`person:${id}`));
      people.set(id, known ?? this.person(c.rel.person ?? { id, rel: {} }));
    }
    return {
      workflow: { id: wf.id, name: wf.name },
      steps: steps
        .map((s) => ({ id: s.id, name: s.name, sequence: s.sequence ?? 0 }))
        .sort((a, b) => a.sequence - b.sequence),
      cards: active.map((c) => this.card(c, people)),
    };
  }

  async moveCard(workflowId: string, cardId: string, toStepId: string | null, skip = false, personId?: string): Promise<WorkflowCard> {
    // Read just this card (not the whole board) to know where it is right now.
    const [stepRows, current] = await Promise.all([
      this.steps(workflowId),
      this.c.get(personId
        ? `${P}/people/${personId}/workflow_cards/${cardId}?include=person,current_step`
        : `${P}/workflows/${workflowId}/cards/${cardId}?include=person,current_step`),
    ]);
    const steps = stepRows.map((s) => ({ id: s.id, sequence: s.sequence ?? 0 })).sort((a, b) => a.sequence - b.sequence);
    const card = { personId: current.rel.person?.id as string, stepId: (current.rel.current_step?.id ?? null) as string | null,
      person: (await cache.get<Person>(this.k(`person:${current.rel.person?.id}`))) ?? this.person(current.rel.person ?? { id: "", rel: {} }) };
    const idx = (id: string | null) => (id === null ? steps.length : steps.findIndex((s) => s.id === id));
    const from = idx(card.stepId), to = idx(toStepId);
    const base = `${P}/people/${card.personId}/workflow_cards/${cardId}`;

    // PCO has no "jump to step": walk one step at a time.
    for (let i = from; i < to; i++) {
      const lastHop = i === to - 1;
      await this.c.post(`${base}/${skip && !lastHop ? "skip_step" : "promote"}`);
    }
    for (let i = from; i > to; i--) await this.c.post(`${base}/go_back`);

    const fresh = await this.c.get(`${base}?include=person,assignee,current_step`);
    await cache.bust(this.k(`wf:${workflowId}:board`));
    return this.card(fresh, new Map([[card.personId, card.person]]));
  }

  async getNotes(personId: string, cardId: string): Promise<Note[]> {
    const [cardNotes, profileNotes] = await Promise.all([
      this.c.list(`${P}/people/${personId}/workflow_cards/${cardId}/notes`, 3),
      this.c.list(`${P}/people/${personId}/notes?include=category,created_by&order=-created_at`, 3).catch(() => []),
    ]);
    const map = (n: Flat, source: Note["source"]): Note => ({
      id: `${source}-${n.id}`,
      body: n.note ?? "",
      authorName: n.rel.created_by?.name ?? n.created_by_name ?? "Staff",
      createdAt: n.created_at,
      source,
      category: n.rel.category?.name ?? n.rel.note_category?.name ?? null,
    });
    return [...cardNotes.map((n) => map(n, "card")), ...profileNotes.map((n) => map(n, "profile"))];
  }

  async addCardNote(personId: string, cardId: string, body: string): Promise<Note> {
    const doc = await this.c.post(`${P}/people/${personId}/workflow_cards/${cardId}/notes`, {
      data: { type: "WorkflowCardNote", attributes: { note: body } },
    });
    const n: any = Array.isArray(doc?.data) ? doc?.data[0] : doc?.data;
    return {
      id: `card-${n?.id}`,
      body,
      authorName: "You",
      createdAt: n?.attributes?.created_at ?? new Date().toISOString(),
      source: "card",
      category: null,
    };
  }

  async sendCardEmail(personId: string, cardId: string, subject: string, body: string) {
    // PCO sends from the signed-in staff member and logs the email on the card's activity.
    await this.c.post(`${P}/people/${personId}/workflow_cards/${cardId}/send_email`, {
      data: { attributes: { subject, note: body } },
    });
  }

  /* ───────────── Services ───────────── */

  async listServiceTypes(): Promise<ServiceType[]> {
    // Service types filed in folders in Planning Center don't always come back from the top-level
    // list, so each folder's are added too (in the list's order, then by folder).
    const rows = await cache.swr(this.k("service_types:all"), 3600, async () => {
      const [top, folders] = await Promise.all([
        this.c.list(`${S}/service_types?order=sequence`),
        this.c.list(`${S}/folders`, 5).catch(() => [] as Flat[]),
      ]);
      const inFolders = await mapLimit(folders, 3, (f) => this.c.list(`${S}/folders/${f.id}/service_types?order=sequence`, 5).catch(() => [] as Flat[]));
      const seen = new Set<string>();
      return [...top, ...inFolders.flat()].filter((r) => !seen.has(r.id) && Boolean(seen.add(r.id)));
    });
    return rows
      .filter((r) => !r.archived_at && !r.deleted_at) // hide archived service types
      .map((r) => ({ id: r.id, name: r.name }));
  }

  /**
   * Upcoming plans across service types. Kept to ONE request per service type (no rosters), and
   * served instantly from memory while it refreshes in the background. Roster counts are
   * fetched separately, only for plans actually shown (getPlanCounts).
   */
  async listUpcomingPlans(serviceTypeId?: string): Promise<PlanSummary[]> {
    const types = (await this.listServiceTypes()).filter((t) => !serviceTypeId || t.id === serviceTypeId);
    const all = await Promise.all(
      types.map(async (t) => {
        const plans = await cache.swr(this.k(`plans:${t.id}`), 60, () =>
          this.c.list(`${S}/service_types/${t.id}/plans?filter=future&order=sort_date&per_page=5`, 1),
        );
        return plans.map((p) => this.planSummary(p, t, null));
      }),
    );
    return all.flat().sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }

  async listPlansFrom(from: string, count: number, serviceTypeId?: string): Promise<PlanSummary[]> {
    const types = (await this.listServiceTypes()).filter((t) => !serviceTypeId || t.id === serviceTypeId);
    const n = Math.min(Math.max(count, 1), 25);
    const all = await Promise.all(
      types.map(async (t) => {
        const plans = await cache.swr(this.k(`plans:${t.id}:from:${from}:${n}`), 120, () =>
          this.c.list(`${S}/service_types/${t.id}/plans?filter=after&after=${encodeURIComponent(from)}&order=sort_date&per_page=${n}`, 1),
        );
        return plans.map((p) => this.planSummary(p, t, null));
      }),
    );
    return all.flat().sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }

  async getMatrix(st: string, weeks: number, past: number): Promise<Matrix> {
    const t = (await this.listServiceTypes()).find((x) => x.id === st) ?? { id: st, name: "Service" };
    const base = `${S}/service_types/${st}/plans`;
    const [upcoming, recent] = await Promise.all([
      cache.swr(this.k(`plans:${st}:next:${weeks}`), 60, () => this.c.list(`${base}?filter=future&order=sort_date&per_page=${weeks}`, 1)),
      past ? cache.swr(this.k(`plans:${st}:past:${past}`), 600, () => this.c.list(`${base}?filter=past&order=-sort_date&per_page=${past}`, 1)) : Promise.resolve([] as Flat[]),
    ]);
    const ids = [...recent.slice(0, past).reverse(), ...upcoming.slice(0, weeks)].map((p) => p.id);
    // Each plan comes from the same shared cache as the service page, 3 at a time.
    const plans = await mapLimit(ids, 3, (id) => this.getPlan(st, id));
    return { serviceType: t, plans };
  }

  async getLive(st: string, planId: string): Promise<RunSheetLive | null> {
    // Raw JSON:API here: the item each ItemTime points to is two relationships deep.
    const doc = await this.c.raw("GET", `${S}/service_types/${st}/plans/${planId}/live?include=current_item_time,next_item_time,controller`);
    const live = doc && !Array.isArray(doc.data) ? doc.data : null;
    if (!live) return null;
    const inc = new Map((doc!.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
    const ref = (name: string) => (live.relationships?.[name]?.data as { id: string; type: string } | null) ?? null;
    const itemTime = (name: string) => { const r = ref(name); return r ? inc.get(`${r.type}:${r.id}`) : undefined; };
    const itemOf = (t?: { relationships?: Record<string, { data?: unknown }> }) => ((t?.relationships?.item?.data as { id: string } | null)?.id) ?? null;
    const cur = itemTime("current_item_time");
    const ctrl = ref("controller");
    const controller = ctrl ? (inc.get(`${ctrl.type}:${ctrl.id}`)?.attributes as { full_name?: string; name?: string } | undefined) : undefined;
    const currentItemId = itemOf(cur);
    const a = (live.attributes ?? {}) as { can_control?: boolean; can_take_control?: boolean };
    if (!currentItemId && !ctrl) return { currentItemId: null, nextItemId: null, currentStartedAt: null, controller: null, youControl: false, canTakeControl: Boolean(a.can_take_control ?? a.can_control) };
    return {
      currentItemId,
      nextItemId: itemOf(itemTime("next_item_time")),
      currentStartedAt: ((cur?.attributes as { live_start_at?: string } | undefined)?.live_start_at) ?? null,
      controller: controller?.full_name ?? controller?.name ?? null,
      // You're driving Live when you're the controller.
      youControl: this.viewerId && ctrl ? ctrl.id === this.viewerId : Boolean(a.can_control) && Boolean(ctrl),
      canTakeControl: Boolean(a.can_take_control ?? a.can_control),
    };
  }

  /* ───────────── Editing the service (writes to Planning Center) ───────────── */

  async updatePlan(st: string, planId: string, input: { title?: string | null; seriesTitle?: string | null }) {
    const a: Record<string, unknown> = {};
    if (input.title !== undefined) a.title = input.title ?? "";
    if (input.seriesTitle !== undefined) a.series_title = input.seriesTitle ?? "";
    await this.c.patch(`${S}/service_types/${st}/plans/${planId}`, { data: { type: "Plan", id: planId, attributes: a } });
    await this.changed(planId);
    await cache.bust(this.k(`plans:${st}`));
    return this.getPlan(st, planId);
  }

  async savePlanTime(st: string, planId: string, input: PlanTimeInput & { id?: string }) {
    const base = `${S}/service_types/${st}/plans/${planId}/plan_times`;
    const attributes = { name: input.name, time_type: input.kind, starts_at: input.startsAt, ends_at: input.endsAt };
    if (input.id) await this.c.patch(`${base}/${input.id}`, { data: { type: "PlanTime", id: input.id, attributes } });
    else await this.c.post(base, { data: { type: "PlanTime", attributes } });
    await this.changed(planId);
    return this.getPlan(st, planId);
  }

  async deletePlanTime(st: string, planId: string, timeId: string) {
    await this.c.delete(`${S}/service_types/${st}/plans/${planId}/plan_times/${timeId}`);
    await this.changed(planId);
    return this.getPlan(st, planId);
  }


  async listNoteCategories(st: string): Promise<NoteCategory[]> {
    const rows = await cache.swr(this.k(`notecats:${st}`), 600, () => this.c.list(`${S}/service_types/${st}/item_note_categories`, 2));
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async searchSongs(query: string): Promise<SongHit[]> {
    const q = query.trim();
    const map = (r: Flat): SongHit => ({ id: r.id, title: r.title, author: r.author ?? null, lastScheduledAt: r.last_scheduled_at ?? null });
    if (!q) return (await this.c.list(`${S}/songs?where[hidden]=false&order=-last_scheduled_at&per_page=25`, 1)).map(map);
    const exact = await this.c.list(`${S}/songs?where[title]=${encodeURIComponent(q)}&where[hidden]=false&per_page=25`, 1).catch(() => [] as Flat[]);
    // Planning Center's title filter can be strict: also look through the catalog by recent use.
    const recent = await cache.swr(this.k("songs:recent"), 600, () => this.c.list(`${S}/songs?where[hidden]=false&order=-last_scheduled_at&per_page=100`, 5));
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    return [...exact, ...recent.filter((r) => `${r.title} ${r.author ?? ""}`.toLowerCase().includes(needle))]
      .filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 25).map(map);
  }

  async songArrangements(songId: string): Promise<SongArrangement[]> {
    const arr = await this.c.list(`${S}/songs/${songId}/arrangements?include=keys`, 2);
    return arr.map((a) => ({
      id: a.id, name: a.name ?? "Default", lengthSec: a.length ?? 0,
      keys: (a.rel.keys ?? []).map((k: Flat) => ({ id: k.id, name: k.name ?? k.starting_key ?? "Key", startingKey: k.starting_key ?? null })),
    }));
  }

  private async afterEdit(st: string, planId: string) {
    await this.changed(planId);
    return (await this.getPlan(st, planId)).items;
  }

  private itemAttrs(input: ItemInput) {
    const a: Record<string, unknown> = {};
    if (input.title !== undefined) a.title = input.title;
    if (input.lengthSec !== undefined) a.length = Math.max(0, Math.round(input.lengthSec));
    if (input.description !== undefined) a.description = input.description ?? "";
    if (input.servicePosition) a.service_position = input.servicePosition;
    if (input.songId !== undefined) a.song_id = input.songId;
    if (input.arrangementId !== undefined) a.arrangement_id = input.arrangementId;
    if (input.keyId !== undefined) a.key_id = input.keyId;
    return a;
  }

  async createItem(st: string, planId: string, input: ItemInput) {
    const base = `${S}/service_types/${st}/plans/${planId}`;
    const before = (await this.getPlan(st, planId)).items;
    const doc = await this.c.post(`${base}/items`, {
      data: { type: "Item", attributes: { item_type: input.kind ?? "item", ...this.itemAttrs(input), ...(input.title === undefined && !input.songId ? { title: "New item" } : {}) } },
    });
    const id = flatten(doc!)[0].id;
    if (input.afterItemId !== undefined) {
      // Put it where it was added (Planning Center adds new items at the end).
      const ids = before.map((i) => i.id);
      const at = input.afterItemId === null ? 0 : ids.indexOf(input.afterItemId) + 1;
      ids.splice(at, 0, id);
      await this.c.post(`${base}/item_reorder`, { data: { type: "PlanItemReorder", attributes: { sequence: ids } } });
    }
    return this.afterEdit(st, planId);
  }

  async updateItem(st: string, planId: string, itemId: string, input: ItemInput) {
    await this.c.patch(`${S}/service_types/${st}/plans/${planId}/items/${itemId}`, { data: { type: "Item", id: itemId, attributes: this.itemAttrs(input) } });
    return this.afterEdit(st, planId);
  }

  async deleteItem(st: string, planId: string, itemId: string) {
    await this.c.delete(`${S}/service_types/${st}/plans/${planId}/items/${itemId}`);
    return this.afterEdit(st, planId);
  }

  async reorderItems(st: string, planId: string, itemIds: string[]) {
    await this.c.post(`${S}/service_types/${st}/plans/${planId}/item_reorder`, { data: { type: "PlanItemReorder", attributes: { sequence: itemIds } } });
    return this.afterEdit(st, planId);
  }

  async saveItemNote(st: string, planId: string, itemId: string, note: { noteId?: string; categoryId: string; content: string }) {
    const base = `${S}/service_types/${st}/plans/${planId}/items/${itemId}/item_notes`;
    if (note.noteId) {
      await this.c.patch(`${base}/${note.noteId}`, { data: { type: "ItemNote", id: note.noteId, attributes: { content: note.content } } });
    } else {
      await this.c.post(base, { data: { type: "ItemNote", attributes: { content: note.content, item_note_category_id: note.categoryId } } });
    }
    return this.afterEdit(st, planId);
  }

  async deleteItemNote(st: string, planId: string, itemId: string, noteId: string) {
    await this.c.delete(`${S}/service_types/${st}/plans/${planId}/items/${itemId}/item_notes/${noteId}`);
    return this.afterEdit(st, planId);
  }

  private planSummary(p: Flat, t: ServiceType, roster: Flat[] | null): PlanSummary {
    const count = (s: string) => (roster ? roster.filter((r) => r.status === s).length : null);
    return {
      id: p.id,
      serviceTypeId: t.id,
      serviceTypeName: t.name,
      title: p.title || p.series_title || p.dates,
      seriesTitle: p.series_title ?? null,
      dates: p.dates,
      sortDate: p.sort_date,
      neededCount: p.needed_positions_count ?? 0,
      confirmedCount: count("C"),
      unconfirmedCount: count("U"),
      declinedCount: count("D"),
    };
  }

  private roster(st: string, planId: string) {
    return cache.swr(this.k(`roster:${planId}`), 20, () =>
      this.c.list(`${S}/service_types/${st}/plans/${planId}/team_members?include=team`, 10),
    );
  }

  async getPlanCounts(st: string, planId: string): Promise<PlanCounts> {
    const r = await this.roster(st, planId);
    const n = (s: string) => r.filter((x) => x.status === s).length;
    return { confirmed: n("C"), unconfirmed: n("U"), declined: n("D") };
  }

  /**
   * One plan: 5 requests in parallel (plan+times, order of service, roster, open slots; teams are cached
   * for 10 min). Served from memory for 15s and shared between concurrent callers, so the
   * conflict checker and candidate list reuse it instead of downloading it again.
   */
  async getPlan(st: string, planId: string): Promise<PlanDetail> {
    return cache.swr(this.k(`plan:${planId}`), 15, () => this.loadPlan(st, planId), 600);
  }

  private async loadPlan(st: string, planId: string): Promise<PlanDetail> {
    const base = `${S}/service_types/${st}/plans/${planId}`;
    const [types, plan, items, roster, needed, teams] = await Promise.all([
      this.listServiceTypes(),
      this.c.get(`${base}?include=plan_times`),
      this.c.list(`${base}/items?include=item_notes,key`, 5),
      this.roster(st, planId),
      this.c.list(`${base}/needed_positions?include=team`, 3),
      cache.swr(this.k(`teams:${st}`), 600, () => this.c.list(`${S}/service_types/${st}/teams?include=team_positions`)),
    ]);
    const t = types.find((x) => x.id === st) ?? { id: st, name: "Service" };

    const times: PlanTime[] = (plan.rel.plan_times ?? []).map((pt: Flat) => ({
      id: pt.id,
      name: pt.name ?? "",
      kind: pt.time_type ?? "other",
      startsAt: pt.starts_at,
      endsAt: pt.ends_at,
    }));
    const runSheet: PlanItem[] = items
      .map((i) => ({
        id: i.id,
        title: i.title,
        sequence: i.sequence ?? 0,
        kind: (i.item_type ?? "item") as PlanItem["kind"],
        lengthSec: i.length ?? 0,
        description: i.description ?? null,
        // The key chosen for this service; otherwise the arrangement key's starting key.
        songKey: i.key_name || i.rel.key?.starting_key || i.rel.key?.name || null,
        servicePosition: (i.service_position ?? "during") as PlanItem["servicePosition"],
        notes: (i.rel.item_notes ?? []).map((n: Flat) => ({ id: n.id, category: n.category_name ?? "Note", body: n.content ?? "" })),
        songId: i.rel.song?.id ?? null,
        arrangementId: i.rel.arrangement?.id ?? null,
        keyId: i.rel.key?.id ?? null,
      }))
      .sort((a, b) => a.sequence - b.sequence);
    const teamList: Team[] = teams.map((tm) => ({
      id: tm.id,
      name: tm.name,
      positions: (tm.rel.team_positions ?? []).map((p: Flat) => ({ id: p.id, name: p.name })),
    }));
    const summary = this.planSummary(plan, t, roster);

    return {
      ...summary,
      confirmedCount: summary.confirmedCount ?? 0,
      unconfirmedCount: summary.unconfirmedCount ?? 0,
      declinedCount: summary.declinedCount ?? 0,
      times,
      items: runSheet,
      roster: roster.map((r) => this.teamMember(r)),
      needed: needed.map((n) => ({
        id: n.id,
        teamId: n.rel.team?.id,
        teamName: n.rel.team?.name ?? "",
        positionName: n.team_position_name ?? "",
        quantity: n.quantity ?? 1,
      })),
      teams: teamList,
    };
  }

  private async personAvailability(personId: string) {
    return cache.swr(this.k(`avail:${personId}`), 300, async () => {
      const [blockouts, schedules] = await Promise.all([
        this.c.list(`${S}/people/${personId}/blockouts?filter=future`, 2),
        this.c.list(`${S}/people/${personId}/schedules`, 2),
      ]);
      return {
        blockouts: blockouts.map((b) => ({ start: b.starts_at, end: b.ends_at, reason: b.reason ?? null })),
        schedules: schedules.map((s) => ({
          planId: s.rel.plan?.id ?? s.plan_id ?? "",
          day: day(s.sort_date ?? ""),
          label: `${s.service_type_name ?? ""} · ${s.team_position_name ?? s.team_name ?? ""}`.trim(),
          status: (s.status ?? "U") as RosterStatus,
        })),
        lastServed: schedules.map((s) => s.sort_date).filter((d) => d && d < new Date().toISOString()).sort().pop() ?? null,
      };
    });
  }

  async getConflicts(st: string, planId: string, personId: string): Promise<Conflict[]> {
    // Both are cached/shared, so this is 2 small requests at most (the person's blockouts + schedule).
    const [plan, avail] = await Promise.all([this.getPlan(st, planId), this.personAvailability(personId)]);
    const on = plan.roster.find((r) => r.personId === personId);
    return computeConflicts({
      planId,
      planDay: day(plan.sortDate),
      serviceWindows: plan.times.filter((t) => t.kind !== "other").map((t) => ({ start: Date.parse(t.startsAt), end: Date.parse(t.endsAt) })),
      alreadyOnPlan: on ? { positionName: on.positionName } : null,
      blockouts: avail.blockouts,
      schedules: avail.schedules,
    });
  }

  /**
   * Who can fill a position. Returns immediately with just "already on this plan" checked; the
   * app then checks each person's blockouts/other services in the background (getConflicts),
   * instead of making 60 requests before showing anything.
   */
  async getCandidates(st: string, planId: string, teamId: string, positionName: string): Promise<Candidate[]> {
    const plan = await this.getPlan(st, planId);
    const find = (teams: Team[]) => {
      const pos = teams.find((t) => t.id === teamId)?.positions ?? [];
      return pos.find((p) => p.name === positionName) ?? pos.find((p) => p.name.trim().toLowerCase() === positionName.trim().toLowerCase());
    };
    let pos = find(plan.teams);
    if (!pos) {
      // The team or position may be newer than our cached copy: ask Planning Center for this team's positions.
      const fresh = await this.c.list(`${S}/teams/${teamId}/team_positions`, 3);
      pos = find([{ id: teamId, name: "", positions: fresh.map((p) => ({ id: p.id, name: p.name })) }]);
      await cache.bust(this.k(`teams:${st}`));
    }
    if (!pos) return [];
    const posId = pos.id;
    const assignments = await cache.swr(this.k(`tpa:${posId}`), 600, () =>
      // Team positions live under their service type (there is no top-level /team_positions endpoint);
      // a team shared from another service type is reached through the team instead.
      this.c.list(`${S}/service_types/${st}/team_positions/${posId}/person_team_position_assignments?include=person`, 3)
        .catch((e) => {
          if ((e as { status?: number }).status !== 404) throw e;
          return this.c.list(`${S}/teams/${teamId}/team_positions/${posId}/person_team_position_assignments?include=person`, 3);
        }),
    );
    const onPlan = new Map(plan.roster.map((r) => [r.personId, r.positionName]));
    return assignments
      .map((a) => a.rel.person)
      .filter(Boolean)
      .map((p: Flat): Candidate => ({
        personId: p.id,
        name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        avatarUrl: p.photo_thumbnail_url ?? null,
        conflicts: onPlan.has(p.id) ? [{ kind: "same_plan", label: `Already serving as ${onPlan.get(p.id)}` }] : [],
        lastServed: null,
        checked: false,
      }))
      .sort((a, b) => a.conflicts.length - b.conflicts.length || a.name.localeCompare(b.name));
  }

  /* ───────────── Check-ins ───────────── */

  /**
   * The time window a plan's check-ins belong to: from 2h before the first service time (or
   * rehearsal) to 2h after the last one ends; the whole day if the plan has no times.
   */
  private checkInWindow(plan: PlanDetail) {
    const times = plan.times.filter((t) => t.startsAt);
    if (times.length) {
      const start = Math.min(...times.map((t) => Date.parse(t.startsAt))) - 2 * 3600e3;
      const end = Math.max(...times.map((t) => Date.parse(t.endsAt || t.startsAt))) + 2 * 3600e3;
      return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
    }
    const d = new Date(plan.sortDate);
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    return { from, to: new Date(Date.parse(from) + 864e5 - 1).toISOString() };
  }

  private checkInRow(f: Flat): CheckInRow {
    const person = f.rel.person;
    return {
      id: f.id,
      personId: person?.id ?? null,
      name: `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim() || person?.name || "Guest",
      avatarUrl: person?.avatar ?? null,
      kind: (["Regular", "Guest", "Volunteer"].includes(f.kind) ? f.kind : "Regular") as CheckInRow["kind"],
      event: f.rel.event?.name ?? "",
      eventId: f.rel.event?.id ?? null,
      locations: (f.rel.locations ?? []).map((l: Flat) => l.name).filter(Boolean),
      locationIds: (f.rel.locations ?? []).map((l: Flat) => l.id).filter(Boolean),
      at: f.created_at,
      checkedOutAt: f.checked_out_at ?? null,
      securityCode: f.security_code ?? null,
      // Medical notes and emergency contacts are deliberately never passed to the app.
    };
  }

  /**
   * Live check-ins for a plan. Every ~10s only NEW check-ins are fetched (since the newest one
   * seen); a full refresh every 60s also picks up check-outs.
   */
  async getCheckIns(st: string, planId: string): Promise<CheckInsForPlan> {
    const plan = await this.getPlan(st, planId);
    const { from, to } = this.checkInWindow(plan);
    const rows = await this.checkInsBetween(`checkins:${planId}`, from, to);
    return { from, to, rows, fetchedAt: new Date().toISOString() };
  }

  /** Today's check-ins (midnight to midnight, this Mac's time), for the Kids and Nursery iPads. */
  async getTodayCheckIns(): Promise<CheckInRow[]> {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const to = new Date(Date.parse(from) + 864e5 - 1).toISOString();
    return this.checkInsBetween(`checkins:day:${from.slice(0, 10)}`, from, to);
  }

  /**
   * Check-ins in a time window. Every call after the first only fetches NEW check-ins (since the
   * newest one seen); a full refresh every 60s also picks up check-outs. Kept in memory only.
   */
  private async checkInsBetween(name: string, from: string, to: string): Promise<CheckInRow[]> {
    const key = this.k(name);
    const base = `/check-ins/v2/check_ins?include=event,locations,person&order=-created_at`;
    const range = (gte: string) => `&where[created_at][gte]=${encodeURIComponent(gte)}&where[created_at][lte]=${encodeURIComponent(to)}`;
    return once(key, async () => {
      const prev = checkInMemory.get(key);
      let rows: CheckInRow[];
      if (!prev || Date.now() - prev.full > 60_000) {
        rows = (await this.c.list(base + range(from), 30)).map((f) => this.checkInRow(f));
        checkInMemory.set(key, { rows, full: Date.now() });
      } else {
        const newest = prev.rows.reduce((m, r) => (r.at > m ? r.at : m), from);
        const since = new Date(Math.max(Date.parse(from), Date.parse(newest) - 60_000)).toISOString();
        const fresh = (await this.c.list(base + range(since), 5)).map((f) => this.checkInRow(f));
        const byId = new Map(prev.rows.map((r) => [r.id, r]));
        for (const r of fresh) byId.set(r.id, r);
        rows = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
        checkInMemory.set(key, { rows, full: prev.full });
      }
      return rows;
    });
  }

  /** Rooms from Check-Ins events that aren't archived (folders give the grouping). */
  async listCheckInLocations(): Promise<CheckInLocation[]> {
    return cache.swr(this.k("checkin-locations"), 600, async () => {
      const events = (await this.c.list(`/check-ins/v2/events?order=name`, 5)).filter((e) => !e.archived_at);
      const per = await Promise.all(events.map(async (e) => {
        const locs = await this.c.list(`/check-ins/v2/events/${e.id}/locations?include=parent&order=position`, 5);
        return locs
          .filter((l) => l.kind !== "Folder")
          .map((l): CheckInLocation => ({ id: l.id, name: l.name, event: e.name, eventId: e.id, folder: l.rel.parent?.name ?? null, childOrAdult: l.child_or_adult ?? null }));
      }));
      return per.flat();
    });
  }

  async listTeams(st: string): Promise<{ id: string; name: string }[]> {
    const rows = await cache.swr(this.k(`teams:${st}`), 600, () => this.c.list(`${S}/service_types/${st}/teams?include=team_positions`));
    return rows.filter((t) => !t.archived_at && !t.deleted_at).map((t) => ({ id: t.id, name: t.name ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** After any roster change, forget cached copies so the next load is exact. */
  private async changed(planId: string, personId?: string) {
    await cache.bust(this.k(`roster:${planId}`));
    await cache.bust(this.k(`plan:${planId}`));
    if (personId) await cache.bust(this.k(`avail:${personId}`));
  }

  async schedule(st: string, planId: string, req: ScheduleRequest): Promise<TeamMember> {
    const doc = await this.c.post(`${S}/service_types/${st}/plans/${planId}/team_members?include=person,team`, {
      data: {
        type: "PlanPerson",
        attributes: {
          person_id: req.personId,
          team_position_name: req.positionName,
          status: "U",
          // Queues the PCO scheduling request; PCO sends it with the plan's next notification batch.
          prepare_notification: req.notify,
        },
        relationships: { team: { data: { type: "Team", id: req.teamId } } },
      },
    });
    await this.changed(planId, req.personId);
    return this.teamMember(flatten(doc!)[0]);
  }

  async setStatus(st: string, planId: string, tmId: string, status: RosterStatus, reason?: string): Promise<TeamMember> {
    const doc = await this.c.patch(`${S}/service_types/${st}/plans/${planId}/team_members/${tmId}?include=person,team`, {
      data: { type: "PlanPerson", id: tmId, attributes: { status, decline_reason: status === "D" ? reason ?? null : null } },
    });
    await this.changed(planId);
    return this.teamMember(flatten(doc!)[0]);
  }

  async removeMember(st: string, planId: string, tmId: string) {
    await this.c.delete(`${S}/service_types/${st}/plans/${planId}/team_members/${tmId}`);
    await this.changed(planId);
  }
}

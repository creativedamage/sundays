/** What the ops Edge Function sends Sundays (Sundays | Operations screens). Plain data, ISO dates. */
import type { AvlLevel, Permission, Role } from "./rbac";
import type { RequestAction, RequestKind, RequestRole, RequestStatus, RequestWorkflow } from "./workflow";
import type { QuoteStatus } from "./state-machine";
import type { CheckinLevel } from "./checkin";
import type { Bill, Interval, ModuleDef, ModuleKey, OrgStatus, OrgType, PlanDef } from "./billing";

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export interface Ref { id: string; name: string }

export interface OpsSessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avlLevel: AvlLevel;
  permissions: Permission[];
  opsAccess: boolean;
  campusId: string | null;
  allCampuses: boolean;
  teamIds: string[];
}

/** An organization this person belongs to (for the switcher). */
export interface MyOrg { id: string; name: string; status: OrgStatus; memberStatus: "active" | "pending" | "inactive"; support: boolean }
interface MeBase { email: string; orgs: MyOrg[]; platform: boolean }
export type OpsMe =
  | (MeBase & { status: "ok"; user: OpsSessionUser; org: OrgBrand; nav: OpsNav })
  | (MeBase & { status: "pending" | "inactive"; name: string; org: OrgBrand })
  | (MeBase & { status: "suspended"; org: OrgBrand })
  | (MeBase & { status: "no-org" });

export interface OrgBrand { id: string; name: string | null; logo: string | null; logoDark: string | null; status: OrgStatus; trialEndsAt: string | null; modules: ModuleKey[] }
export interface OpsNav {
  handlesRequests: boolean; queueCount: number; pendingUsers: number; manager: boolean; admin: boolean; campusName: string | null;
  /** Which apps this person can open. */
  ops: boolean; avl: boolean; avlManager: boolean; avlPending: number; avlName: string | null; avlChurch: boolean;
  /** AVL Crew: only the jobs they're on, no prices. */
  avlCrew: boolean;
  /** Purchase orders waiting for this person's approval (AVL Managers). */
  poApprovals?: number;
  /** Modules this organization has. */
  modules: ModuleKey[];
  /** Sundays super admin (acting in this org as admin). */
  platform: boolean;
}

export interface RequestRow {
  id: string; number: string; title: string; details: string; location: string | null;
  priority: Priority; status: RequestStatus; quantity: number; estimatedCents: number | null;
  neededBy: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
  requesterId: string; campusId: string; assignedTeamId: string | null; assigneeId: string | null; approverTeamId: string | null;
  category: { id: string; name: string; icon: string | null; kind: RequestKind; workflow: RequestWorkflow };
  campus: { id: string; name: string; code: string };
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string; email: string } | null;
  assignedTeam: Ref | null;
  approver: Ref | null;
  lines: { id: string; description: string; quantity: number; unit: string | null }[];
}

export interface CategoryOption {
  id: string; name: string; kind: RequestKind; workflow: RequestWorkflow; description: string | null; icon: string | null;
  requiresLocation: boolean; allowLineItems: boolean; approvalThresholdCents: number | null;
  supplyItems: { id: string; name: string; unit: string; unitCostCents: number | null }[];
}

export interface TimelineEntry { at: string; who: string; kind: "event" | "comment"; action: string; toStatus: string | null; note: string | null; internal: boolean }
export interface RequestDetail { request: RequestRow; roles: RequestRole[]; actions: RequestAction[]; staffSide: boolean; timeline: TimelineEntry[]; teamMembers: Ref[] }

export interface ActivityRow { id: string; actorName: string | null; actorLabel: string | null; action: string; detail: string | null; area: string; href: string | null; createdAt: string }

export interface OverviewData {
  queue: { approval: number; open: number; urgent: number; doneWeek: number } | null;
  mine: { open: RequestRow[]; awaiting: number; completed30: number };
  activity: ActivityRow[];
  canViewActivity: boolean;
}

export interface QuoteRow {
  id: string; number: string; title: string; status: QuoteStatus; createdAt: string; updatedAt: string; sentAt: string | null; validUntil: string | null;
  customer: { name: string; contactName: string | null }; campus: { name: string } | null; totalCents: number; marginBps: number;
}

export interface LineItemDraft {
  key: string; productId: string | null; isCustom: boolean; section: string | null; sku: string | null; name: string; description: string | null;
  quantity: number; unitCostCents: number; unitPriceCents: number; taxable: boolean;
  /** Options (estimating.ts): a group with no choice is an optional add-on; with a choice, an alternate. */
  optionGroup?: string | null; optionChoice?: string | null; selected?: boolean;
  /** The kit the line came from, if any (a label for the team). */
  kitName?: string | null;
}
export interface QuoteDTO {
  id: string; number: string; title: string; status: QuoteStatus; customerId: string; campusId: string | null;
  introNotes: string | null; internalNotes: string | null; terms: string | null;
  taxBps: number; discountCents: number; depositBps: number; validUntil: string | null; sentTotalCents: number | null;
  items: LineItemDraft[];
  events: { id: string; type: string; fromStatus: QuoteStatus | null; toStatus: QuoteStatus | null; actorLabel: string | null; note: string | null; createdAt: string }[];
  signature: { signerName: string; signerEmail: string; signerTitle: string | null; signedAt: string; imageDataUrl: string; totalCents: number } | null;
  paidCents: number;
  /** The link the client opens to see, sign or answer the proposal. */
  clientUrl: string;
  viewedAt: string | null;
  /** The job made from this proposal, once it's accepted and a job is created. */
  job: { id: string; number: string } | null;
  /** 1 until it's sent again after a revision. */
  version: number;
  versions: import("./estimating").QuoteVersionRow[];
}
export interface CustomerOption { id: string; name: string; email: string | null; taxExempt: boolean }
export interface QuotePage {
  quote: QuoteDTO; customers: CustomerOption[]; vendors: Ref[]; campuses: Ref[]; defaultMarginBps: number; laborRateCents: number; canApprove: boolean;
  laborRates: import("./estimating").LaborRate[]; markupRules: import("./estimating").MarkupRule[]; kits: import("./estimating").KitRow[];
}

export interface PublicQuote {
  number: string; title: string; status: QuoteStatus; introNotes: string | null; terms: string | null; validUntil: string | null; sentAt: string | null; createdAt: string;
  customer: { name: string; contactName: string | null; email: string | null };
  items: {
    id: string; section: string | null; sku: string | null; name: string; description: string | null; quantity: number; unitPriceCents: number; taxable: boolean;
    optionGroup: string | null; optionChoice: string | null; selected: boolean;
  }[];
  totals: { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; depositCents: number };
  /** What the totals are worked out from, so the client page can show its choices' total. */
  pricing: { taxBps: number; discountCents: number; depositBps: number; taxExempt: boolean };
  version: number;
}
export interface OrgSettings {
  name: string | null; legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null;
  postalCode: string | null; phone: string | null; email: string | null; website: string | null; ein: string | null; salesTaxId: string | null;
  quotePrefix: string; taxExempt: boolean; defaultTaxBps: number; defaultDepositBps: number; defaultMarginBps: number; laborRateCents: number;
  quoteValidDays: number; quoteTerms: string | null;
  /** Integrator (sells to clients) or church team (its own projects). */
  businessType: "INTEGRATOR" | "CHURCH"; jobPrefix: string;
}
export interface PrintData { quote: PublicQuote; org: AvlBusiness; logo: string | null }

export interface CatalogProduct {
  id: string; sku: string; model: string | null; name: string; manufacturer: string | null; category: string | null; description: string | null;
  costCents: number; msrpCents: number | null; mapCents: number | null; updatedAt: string; vendor: Ref;
}
export interface VendorRow {
  id: string; name: string; accountNo: string | null; repName: string | null; repEmail: string | null; repPhone: string | null;
  website: string | null; terms: string | null; notes: string | null; active: boolean; productCount: number;
}
export interface ImportBatchRow { id: string; fileName: string; status: string; created: number; updated: number; skipped: number; createdAt: string; uploadedBy: string }

export interface UserRow {
  id: string; email: string; name: string; title: string | null; department: string | null; phone: string | null;
  active: boolean; pending: boolean; registered: boolean; campusId: string | null; campusName: string | null; allCampuses: boolean;
  role: Role; avlLevel: AvlLevel; opsAccess: boolean; effectiveRole: Role; effectiveAvl: AvlLevel; global: boolean; source: string;
  /** Team check-ins on the website (none / view / check in / manage); effectiveCheckin includes System admins. */
  checkinLevel: CheckinLevel; effectiveCheckin: CheckinLevel;
  teams: { id: string; name: string; synced: boolean }[]; lastLoginAt: string | null; createdAt: string; editable: boolean;
}
export interface CampusRow {
  id: string; name: string; code: string; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  phone: string | null; sortOrder: number; active: boolean; users: number; teams: number; requests: number;
}
export interface TeamRow { id: string; name: string; description: string | null; campusId: string | null; campusName: string | null; email: string | null; active: boolean; members: number; handles: number; approves: number; manageable: boolean }
export interface CategoryRow {
  id: string; name: string; kind: RequestKind; workflow: RequestWorkflow; description: string | null; icon: string | null;
  approvalThresholdCents: number | null; requiresLocation: boolean; allowLineItems: boolean; active: boolean; sortOrder: number;
  supplyItemCount: number; requestCount: number; routing: { campusId: string | null; handlerTeam: string; approverTeam: string | null }[];
}

/* ── AVL ── */
export interface AvlOverview {
  pipelineCents: number; acceptedCents: number; profitCents: number; openPurchasingCents: number;
  clients: number; recent: QuoteRow[]; activity: ActivityRow[];
  /** Planning, in progress or on hold. */
  openJobs: number; openJobsCostCents: number; jobs: import("./jobs").JobRow[]; businessType: "INTEGRATOR" | "CHURCH";
  /** Leads not yet won or lost, and what they're worth. */
  openLeads: number; openLeadsCents: number;
  /** My open follow-ups (assigned to me, or mine and unassigned). */
  followUps: import("./crm").FollowUps;
}
export interface ClientRow {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null; city: string | null; state: string | null;
  active: boolean; taxExempt: boolean; quotes: number; openCents: number; wonCents: number; lastQuoteAt: string | null;
}
export interface ClientContact { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }
export interface ClientDetail {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null; website: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null;
  taxExempt: boolean; notes: string | null; active: boolean; createdAt: string;
}
export interface ClientPage { client: ClientDetail; contacts: ClientContact[]; quotes: QuoteRow[]; totals: { openCents: number; wonCents: number } }
export interface AvlPerson { id: string; name: string; email: string; avlLevel: AvlLevel; opsAccess: boolean; role: Role; pending: boolean; active: boolean; lastLoginAt: string | null; hourlyCostCents: number | null }
export interface AvlBusiness {
  name: string | null; legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null;
  postalCode: string | null; phone: string | null; email: string | null; website: string | null; ein: string | null; salesTaxId: string | null;
  quotePrefix: string; defaultTaxBps: number; defaultDepositBps: number; defaultMarginBps: number; laborRateCents: number;
  quoteValidDays: number; quoteTerms: string | null;
  /** New invoices are due this many days after they're dated; the notes print at the bottom. */
  invoiceDueDays: number;
  invoiceNotes: string | null;
  /** Integrator (sells to clients) or church team (its own projects). */
  businessType: "INTEGRATOR" | "CHURCH"; jobPrefix: string;
}

/* ── Plans, billing and the super-admin console ── */
export interface PublicPricing { plans: PlanDef[]; modules: ModuleDef[]; churchDiscountBps: number; trialDays: number }
export interface InvoiceRow {
  id: string; orgId: string; orgName?: string; number: string; period: string | null; description: string | null;
  lines: { label: string; amountCents: number }[]; subtotalCents: number; discountCents: number; totalCents: number;
  status: "DRAFT" | "SENT" | "PAID" | "VOID"; dueAt: string | null; sentAt: string | null; paidAt: string | null; notes: string | null; createdAt: string;
}
export interface OrgBillingView {
  org: { id: string; name: string | null; orgType: OrgType; status: OrgStatus; trialEndsAt: string | null; billingInterval: Interval; billingEmail: string | null; fullLicense: boolean };
  plan: PlanDef | null; modules: ModuleDef[]; enabled: ModuleKey[]; bill: Bill; invoices: InvoiceRow[]; members: number; campuses: number;
}
export interface AdminOrgRow {
  id: string; name: string | null; orgType: OrgType; status: OrgStatus; planId: string | null; planName: string | null; fullLicense: boolean;
  members: number; createdAt: string; trialEndsAt: string | null; totalCents: number; billingInterval: Interval;
}
export interface AdminOrg {
  id: string; name: string | null; orgType: OrgType; status: OrgStatus; planId: string | null; billingInterval: Interval; billingEmail: string | null;
  trialEndsAt: string | null; fullLicense: boolean; moduleOverrides: Record<string, boolean>; churchDiscount: boolean; discountBps: number;
  discountCents: number; discountEndsAt: string | null; discountNote: string | null; adminNotes: string | null; createdAt: string;
}
export interface AdminOrgPage {
  org: AdminOrg; plans: PlanDef[]; modules: ModuleDef[]; enabled: ModuleKey[]; bill: Bill; churchDiscountBps: number;
  members: { id: string; name: string; email: string; role: string; avlLevel: string; active: boolean; pending: boolean; registered: boolean; lastLoginAt: string | null }[];
  invoices: InvoiceRow[];
}
export interface AdminOverview {
  orgs: number; active: number; trial: number; pastDue: number; suspended: number; fullLicense: number; people: number;
  mrrCents: number; recent: AdminOrgRow[]; openInvoicesCents: number;
}
export interface PlatformAdminRow { id: string; email: string; authId: string | null; addedBy: string | null; createdAt: string }

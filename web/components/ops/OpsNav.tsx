"use client";
/** Sidebars for Sundays | Operations (the church's business) and Sundays | AVL (quoting other churches). */
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft, CalendarRange, Clock3, CreditCard, Gauge, Layers, ShieldHalf, Activity, AudioLines, Boxes, Briefcase, Building, Building2, ClipboardList, FileText, Hammer, Inbox, LayoutGrid, LogOut, Plus, Search, Settings2, Tags, Target, Package, Percent, Users, UsersRound, Mail, ShoppingCart, ReceiptText, BarChart3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OpsMe } from "@shared/ops/types";
import { opsSignOut, useOpsMe, useOpsSession } from "@/lib/ops";

type Item = { href: string; label: string; icon: typeof Inbox; badge?: number; tone?: "warn" | "accent"; exact?: boolean; also?: string };
type Group = { title?: string; items: Item[] };
type Ok = Extract<OpsMe, { status: "ok" }>;

function useMeOk(): Ok | null {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  return me?.status === "ok" ? me : null;
}

function SideNav({ groups, footer }: { groups: Group[]; footer: string }) {
  const path = usePathname();
  const qc = useQueryClient();
  const active = (it: Item) => (it.exact ? path === it.href || (it.also ? path.startsWith(it.also) : false) : path.startsWith(it.href));
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && <div className="label px-2.5 pb-1.5">{g.title}</div>}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition", active(it) ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
                  <it.icon size={14} /><span className="flex-1">{it.label}</span>
                  {!!it.badge && <span className={clsx("rounded-full px-1.5 text-[10px] font-semibold tabular-nums", it.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent")}>{it.badge}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-muted">
        <span className="min-w-0 flex-1 truncate">{footer}</span>
        <button className="rounded p-1 hover:bg-hover hover:text-ink" title="Sign out" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={12} /></button>
      </div>
    </div>
  );
}

export function OpsNav() {
  const me = useMeOk();
  if (!me) return <div className="flex-1" />;
  const n = me.nav;
  if (!n.ops) return <SideNav groups={[]} footer={me.user.name} />;
  const groups: Group[] = [
    { items: [
      { href: "/ops", label: "Overview", icon: LayoutGrid, exact: true },
      { href: "/ops/requests/new", label: "New request", icon: Plus },
      { href: "/ops/requests", label: "My requests", icon: Inbox, exact: true, also: "/ops/requests/view" },
      ...(n.handlesRequests ? [{ href: "/ops/work", label: "Work queue", icon: ClipboardList, badge: n.queueCount, tone: "accent" as const }] : []),
    ] },
  ];
  if (n.manager) groups.push({ title: "Settings", items: [
    { href: "/ops/settings/users", label: "Users", icon: Users, badge: n.pendingUsers, tone: "warn" },
    { href: "/ops/settings/teams", label: "Teams", icon: UsersRound },
    { href: "/ops/settings/request-types", label: "Request types", icon: Tags },
    ...(n.modules.includes("campuses") ? [{ href: "/ops/settings/campuses", label: "Campuses", icon: Building }] : []),
    { href: "/ops/settings/activity", label: "Activity", icon: Activity },
    ...(n.admin ? [{ href: "/ops/settings/organization", label: "Organization & billing", icon: Settings2 }] : []),
  ] });
  return <SideNav groups={groups} footer={`Operations · ${me.user.name}${n.campusName ? ` · ${n.campusName}` : ""}`} />;
}

export function AvlNav() {
  const me = useMeOk();
  if (!me) return <div className="flex-1" />;
  const n = me.nav;
  if (!n.avl) return <SideNav groups={[]} footer={me.user.name} />;
  // AVL Crew: just their jobs, the schedule and their time.
  if (n.avlCrew) return <SideNav footer={`AVL crew · ${me.user.name}`} groups={[{ items: [
    { href: "/avl", label: "Today", icon: LayoutGrid, exact: true },
    { href: "/avl/jobs", label: "My jobs", icon: Hammer },
    { href: "/avl/schedule", label: "Schedule", icon: CalendarRange },
    { href: "/avl/time", label: "My time", icon: Clock3 },
  ] }]} />;
  const groups: Group[] = [
    { items: [
      { href: "/avl", label: "Overview", icon: LayoutGrid, exact: true },
      // A church team runs its own projects: no clients or proposals to sell.
      ...(n.avlChurch ? [] : [{ href: "/avl/leads", label: "Leads", icon: Target }, { href: "/avl/clients", label: "Clients", icon: Briefcase }, { href: "/avl/quotes", label: "Quotes", icon: FileText }]),
      { href: "/avl/jobs", label: "Jobs", icon: Hammer },
      { href: "/avl/schedule", label: "Schedule", icon: CalendarRange },
      { href: "/avl/purchasing", label: "Purchasing", icon: ShoppingCart, badge: n.poApprovals ?? 0, tone: "warn" as const },
      ...(n.avlChurch ? [] : [{ href: "/avl/invoices", label: "Invoices", icon: ReceiptText }]),
      { href: "/avl/time", label: "Time", icon: Clock3 },
      { href: "/avl/reports", label: "Reports", icon: BarChart3 },
    ] },
    { title: "Pricing", items: [
      { href: "/avl/catalog", label: "Product pricing", icon: Search },
      { href: "/avl/kits", label: "Kits", icon: Package },
      { href: "/avl/pricing", label: "Labor & markup", icon: Percent },
      { href: "/avl/vendors", label: "Vendors", icon: Boxes },
    ] },
    { title: "Settings", items: [
      ...(n.avlManager ? [{ href: "/avl/people", label: "People", icon: Users, badge: n.avlPending, tone: "warn" as const }] : []),
      { href: "/avl/settings", label: "Business", icon: Settings2 },
    ] },
  ];
  return <SideNav groups={groups} footer={`AVL · ${me.user.name}`} />;
}

function Brand({ app, logo, icon, name }: { app: string; logo: string | null; icon: React.ReactNode; name: string | null }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      {logo ? <img src={logo} alt="" className="h-[30px] w-[30px] rounded-lg object-contain" />
        : <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent text-on-accent">{icon}</span>}
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-semibold">Sundays <span className="font-normal text-ink-faint">|</span> {app}</div>
        {name && <div className="truncate text-[11px] text-ink-muted">{name}</div>}
      </div>
    </div>
  );
}

/** Top of the sidebar in Sundays | Operations: the church's own logo (Settings → Organization), or the mark. */
export function OpsBrand({ fallback }: { fallback: string | null }) {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  const org = me && "org" in me ? me.org : null;
  // The organization's name is in the switcher right under this; before sign-in, the church from Planning Center.
  return <Brand app="Operations" logo={org?.logoDark ?? null} icon={<Building2 size={16} />} name={org ? null : fallback} />;
}

/** Top of the sidebar in Sundays | AVL: AVL's business name (Business settings). */
export function AvlBrand() {
  const me = useMeOk();
  return <Brand app="AVL" logo={null} icon={<AudioLines size={16} />} name={me?.nav.avlName && me.nav.avlName !== me.org.name ? me.nav.avlName : null} />;
}

/** The super-admin console's sidebar. */
export function AdminNav() {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  if (!me?.platform) return <div className="flex-1" />;
  return (
    <>
      <SideNav footer={`Super admin · ${me.email}`} groups={[
        { items: [
          { href: "/admin", label: "Overview", icon: Gauge, exact: true },
          { href: "/admin/orgs", label: "Organizations", icon: Building },
          { href: "/admin/billing", label: "Billing", icon: CreditCard },
        ] },
        { title: "Setup", items: [
          { href: "/admin/plans", label: "Plans & modules", icon: Layers },
          { href: "/admin/email", label: "Email", icon: Mail },
          { href: "/admin/admins", label: "Super admins", icon: ShieldHalf },
        ] },
        { items: [{ href: "/ops", label: "Back to Operations", icon: ArrowLeft, exact: true }] },
      ]} />
    </>
  );
}
export function AdminBrand() {
  return <Brand app="Admin" logo={null} icon={<ShieldHalf size={16} />} name="Sundays as a service" />;
}

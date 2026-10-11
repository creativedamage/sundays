"use client";
/** Sundays | Operations building blocks, in Sundays' look. */
import { stageLabel, type LeadStage } from "@shared/ops/crm";
import { jobStatusLabel, type JobStatus } from "@shared/ops/jobs";
import clsx from "clsx";
import { CHECKIN_LEVELS, type CheckinLevel } from "@shared/ops/checkin";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { labelStatus, type RequestStatus } from "@shared/ops/workflow";
import { STATUS_LABEL, type QuoteStatus } from "@shared/ops/state-machine";
import { parseMoneyToCents } from "@shared/ops/math";
import { AVL_LEVELS, ROLES, type AvlLevel, type Role } from "@shared/ops/rbac";
import { Spinner } from "@/components/ui";

export function PageHeader({ crumb, title, description, actions, icon }: { crumb?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumb && <div className="label mb-1">{crumb}</div>}
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">{icon}{title}</h1>
        {description && <div className="mt-1 text-sm text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, eyebrow, action, children, className, pad }: { title?: React.ReactNode; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("panel overflow-hidden", className)}>
      {(title || eyebrow || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {eyebrow && <div className="label">{eyebrow}</div>}
            {title && <div className="truncate text-[15px] font-semibold">{title}</div>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx(pad && "p-4")}>{children}</div>
    </section>
  );
}

export const Empty = ({ children }: { children: React.ReactNode }) => <div className="px-4 py-12 text-center text-sm text-ink-faint">{children}</div>;
export const Loading = () => <div className="grid place-items-center py-16 text-ink-muted"><Spinner size={18} /></div>;
export const ErrorBox = ({ error }: { error: unknown }) => error ? <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{(error as Error).message}</p> : null;

/** Number tiles across the top of a page. */
export function KpiRow({ items }: { items: { value: string; label: string; href?: string; tone?: "accent" | "warn" | "ok" | "bad" }[] }) {
  return (
    <div className={clsx("grid grid-cols-2 gap-3", items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {items.map((k) => {
        const tone = { accent: "text-accent", warn: "text-warn", ok: "text-ok", bad: "text-bad" }[k.tone ?? "accent"];
        const body = (
          <>
            <div className={clsx("text-[28px] font-semibold leading-none tracking-tight tabular-nums", tone)}>{k.value}</div>
            <div className="mt-2 text-xs text-ink-muted">{k.label}</div>
          </>
        );
        const cls = "panel relative block overflow-hidden px-4 pb-4 pt-5 transition";
        return k.href ? <Link key={k.label} href={k.href} className={clsx(cls, "hover:border-line-strong hover:bg-hover/40")}>{body}</Link> : <div key={k.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "accent" | "muted" | "violet" | "info";
const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", muted: "bg-ink-faint", violet: "bg-violet", info: "bg-accent" };
const PILL: Record<Tone, string> = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", accent: "bg-accent-soft text-accent", muted: "bg-hover text-ink-muted", violet: "bg-violet-soft text-violet", info: "bg-accent-soft text-accent" };
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", PILL[tone])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", DOT[tone])} />{children}
    </span>
  );
}

const REQ_TONE: Record<RequestStatus, Tone> = {
  NEW: "accent", PENDING_APPROVAL: "warn", APPROVED: "ok", DENIED: "bad", ASSIGNED: "info", IN_PROGRESS: "info", ON_HOLD: "warn", ORDERED: "violet", COMPLETED: "ok", CANCELLED: "muted",
};
export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => <Pill tone={REQ_TONE[status]}>{labelStatus(status)}</Pill>;
const PRI_TONE = { LOW: "muted", NORMAL: "muted", HIGH: "warn", URGENT: "bad" } as const;
export const PriorityBadge = ({ priority }: { priority: keyof typeof PRI_TONE }) => <Pill tone={PRI_TONE[priority]}>{priority.toLowerCase()}</Pill>;
const Q_TONE: Record<QuoteStatus, Tone> = { DRAFT: "muted", SENT: "info", ACCEPTED: "ok", CHANGES_REQUESTED: "warn", DECLINED: "bad", CONVERTED: "violet" };
export const QuoteStatusBadge = ({ status }: { status: QuoteStatus }) => <Pill tone={Q_TONE[status]}>{STATUS_LABEL[status]}</Pill>;

const J_TONE: Record<JobStatus, Tone> = { PLANNING: "accent", IN_PROGRESS: "info", ON_HOLD: "warn", COMPLETE: "ok", CANCELLED: "muted" };
export const JobStatusBadge = ({ status }: { status: JobStatus }) => <Pill tone={J_TONE[status]}>{jobStatusLabel(status)}</Pill>;
const L_TONE: Record<LeadStage, Tone> = { NEW: "accent", CONTACTED: "info", SITE_VISIT: "violet", PROPOSAL: "warn", WON: "ok", LOST: "muted" };
export const LeadStageBadge = ({ stage }: { stage: LeadStage }) => <Pill tone={L_TONE[stage]}>{stageLabel(stage)}</Pill>;

/** Segmented tabs (links or buttons). */
export function Tabs<T extends string>({ items, value, onChange }: { items: { key: T; label: React.ReactNode; count?: number | null }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-line p-0.5">
      {items.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition", value === t.key ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>
          {t.label}{t.count != null && <span className={clsx("ml-1.5 tabular-nums", value === t.key ? "opacity-80" : "text-accent")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Check({ label, checked, onChange, hint, disabled }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className={clsx("flex items-start gap-2.5 text-sm", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="checkbox" className="mt-0.5 accent-[rgb(var(--c-accent))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-[11px] text-ink-faint">{hint}</span>}</span>
    </label>
  );
}

/** Dollar field backed by integer cents. Commits on blur / Enter. */
export function MoneyInput({ cents, onChange, disabled, className, nullable, placeholder }: { cents: number | null; onChange: (c: number | null) => void; disabled?: boolean; className?: string; nullable?: boolean; placeholder?: string }) {
  const fmt = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  const [text, setText] = useState(fmt(cents));
  useEffect(() => setText(fmt(cents)), [cents]);
  const commit = () => {
    if (nullable && !text.trim()) { if (cents !== null) onChange(null); return; }
    const v = parseMoneyToCents(text);
    if (v === null || v < 0) setText(fmt(cents));
    else if (v !== cents) onChange(v);
    else setText(fmt(cents));
  };
  return (
    <div className={clsx("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">$</span>
      <input inputMode="decimal" disabled={disabled} className="input pl-6 text-right tabular-nums" value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

/** Percent field backed by basis points. */
export function PercentInput({ bps, onChange, disabled }: { bps: number; onChange: (bps: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(String(bps / 100));
  useEffect(() => setText(String(bps / 100)), [bps]);
  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return setText(String(bps / 100));
    onChange(Math.round(n * 100));
  };
  return (
    <div className="relative">
      <input inputMode="decimal" disabled={disabled} className="input pr-7 text-right tabular-nums" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">%</span>
    </div>
  );
}

export function RolePicker({ allowed, value, onChange }: { allowed: Role[]; value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ROLES.filter((r) => allowed.includes(r.key) || r.key === value).map((r) => (
        <label key={r.key} className={clsx("flex items-start gap-2.5 rounded-lg border p-2.5 text-sm transition",
          value === r.key ? "border-accent/60 bg-accent-soft" : "border-line", allowed.includes(r.key) ? "cursor-pointer hover:border-line-strong" : "opacity-60")}>
          <input type="radio" className="mt-0.5 accent-[rgb(var(--c-accent))]" checked={value === r.key} disabled={!allowed.includes(r.key)} onChange={() => onChange(r.key)} />
          <span><span className="font-medium">{r.label}</span><span className="block text-[11px] text-ink-muted">{r.help}</span></span>
        </label>
      ))}
    </div>
  );
}

/** Team check-ins on the website: none / view / check in / manage. */
export function CheckinSelect({ value, onChange, disabled }: { value: CheckinLevel; onChange: (l: CheckinLevel) => void; disabled?: boolean }) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as CheckinLevel)}>
      {CHECKIN_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}{l.key !== "NONE" ? ` — ${l.help}` : ""}</option>)}
    </select>
  );
}

export function AvlSelect({ value, onChange }: { value: AvlLevel; onChange: (a: AvlLevel) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as AvlLevel)}>
      {AVL_LEVELS.map((a) => <option key={a.key} value={a.key}>{a.label}{a.key !== "NONE" ? ` — ${a.help}` : ""}</option>)}
    </select>
  );
}

/** A table that scrolls sideways on narrow windows. */
/**
 * On a phone, a table's rows stack into cards (globals.css, `table.rtable`): each cell is labeled
 * with its column's name, read from the table's last header row, so nothing scrolls sideways.
 */
export function useStackLabels(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const label = () => {
      for (const t of root.querySelectorAll<HTMLTableElement>("table.rtable")) {
        const heads = t.tHead?.rows;
        if (!heads?.length) continue;
        const names: string[] = [];
        for (const th of heads[heads.length - 1].cells) for (let i = 0; i < th.colSpan; i++) names.push(i ? "" : (th.textContent ?? "").trim());
        const rows = [...t.tBodies].flatMap((b) => [...b.rows]).concat(t.tFoot ? [...t.tFoot.rows] : []);
        for (const tr of rows) {
          let c = 0;
          for (const td of tr.cells) {
            const n = td.colSpan > 1 ? "" : names[c] ?? "";
            if (td.dataset.label !== n) td.dataset.label = n;
            c += td.colSpan;
          }
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref]);
}

/** A sideways-scrolling box on a computer; on a phone the `rtable` tables inside it stack into cards. */
export function Stack({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useStackLabels(ref);
  return <div ref={ref} className={clsx("overflow-x-auto", className)}>{children}</div>;
}

export function Table({ head, children, min = 760 }: { head: React.ReactNode; children: React.ReactNode; min?: number }) {
  return (
    <Stack>
      <table className="rtable w-full text-sm" style={{ minWidth: min }}>
        <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-4 [&_th]:py-2.5">{head}</thead>
        <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-3 [&_tr:hover]:bg-hover/40">{children}</tbody>
      </table>
    </Stack>
  );
}

/** A big link on an overview page. */
export function Quick({ href, icon: Icon, title, sub }: { href: string; icon: React.ComponentType<{ size?: number }>; title: string; sub: string }) {
  return (
    <Link href={href} className="panel group flex items-center gap-3 px-4 py-3 transition hover:border-line-strong hover:bg-hover/40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Icon size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-ink-muted">{sub}</span></span>
      <span className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
    </Link>
  );
}

/** Older activity links pointed at /ops for AVL pages. */
export const activityHref = (h: string | null) => (h ? h.replace(/^\/ops\/(quotes|vendors|catalog)/, "/avl/$1") : null);

export function ActivityList({ rows }: { rows: { id: string; action: string; href: string | null; createdAt: string; actorName: string | null; actorLabel: string | null; detail: string | null }[] }) {
  if (!rows.length) return <Empty>No activity yet.</Empty>;
  const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ul className="divide-y divide-line">
      {rows.map((a) => {
        const href = activityHref(a.href);
        return (
          <li key={a.id} className="px-4 py-2.5 text-[13px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{href ? <Link href={href} className="hover:text-accent">{a.action}</Link> : a.action}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">{when(a.createdAt)}</span>
            </div>
            <div className="truncate text-[11px] text-ink-muted">{a.actorName ?? a.actorLabel ?? "System"}{a.detail && ` · ${a.detail}`}</div>
          </li>
        );
      })}
    </ul>
  );
}

"use client";
/**
 * Pages for the business's clients, outside Sundays:
 *   /invoice?t=…   one invoice (the link is the key): print or save a PDF, pay by card
 *   /portal        the client portal: sign in with a code sent to your email
 */
import clsx from "clsx";
import { CalendarDays, CheckCircle2, ChevronRight, CreditCard, Download, FileText, LogOut, MessageSquare, Receipt, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ClientInvoicePage, PortalHome, PortalJob } from "@shared/ops/invoicing";
import { fmtMoney, OpsError, opsPortal, opsPublic } from "@/lib/ops";
import { Banner, input, label, Shell } from "@/components/avl/Signing";
import { Bar, Doc, Letterhead, Oops, th, useLoad } from "@/components/avl/purchasing/Public";

const longDay = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);
const shortDay = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

/* ───────────── One invoice ───────────── */

export function ClientInvoice({ token, paid }: { token: string; paid: string | null }) {
  const base = token ? `/public/invoices/${encodeURIComponent(token)}` : null;
  const { state, setState } = useLoad<ClientInvoicePage>(base ? `${base}${paid ? `?paid=${encodeURIComponent(paid)}` : ""}` : null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Back from Stripe: Stripe may take a moment to confirm, so look again a few times.
  useEffect(() => {
    if (!base || !paid || !state || "error" in state || !state.data.confirming) return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try { const d = await opsPublic<ClientInvoicePage>(`${base}?paid=${encodeURIComponent(paid)}`); setState({ data: d }); if (!d.confirming || n >= 8) clearInterval(t); } catch { clearInterval(t); }
    }, 2500);
    return () => clearInterval(t);
  }, [base, paid, state, setState]);
  if (!state) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the invoice…</div></Shell>;
  if ("error" in state) return <Oops title="We can’t open this invoice" text={state.error} />;
  const p = state.data;
  const i = p.invoice;
  const owed = Math.max(0, i.totalCents - i.paidCents);
  const pay = async () => {
    setPaying(true); setError(null);
    try { const r = await opsPublic<{ url: string }>(`${base}/pay`, {}); window.location.href = r.url; }
    catch (e) { setError((e as Error).message); setPaying(false); }
  };
  return (
    <Shell>
      <Bar title={p.business.name} sub={`Invoice ${i.number} · ${owed ? `${fmtMoney(owed)} due` : "Paid"}`} />
      <div className="mx-auto max-w-[8.5in] px-3 pt-4 sm:px-4">
        {i.status === "PAID" && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Paid. Thank you!">This invoice is paid in full{p.payments.length ? ` (${p.payments.map((x) => `${fmtMoney(x.amountCents)} on ${shortDay(x.at)}`).join(", ")})` : ""}.</Banner>}
        {p.confirming && <Banner tone="muted" icon={<CreditCard size={18} />} title="Confirming your payment…">Stripe is confirming your card payment. This page updates on its own; you’ll also get a receipt by email.</Banner>}
        {i.status === "VOID" && <Banner tone="warn" icon={<FileText size={18} />} title="Withdrawn">{p.business.name} withdrew this invoice. Nothing is owed on it.</Banner>}
      </div>
      <Doc>
        <Letterhead business={p.business} logo={p.logo} kind="Invoice" number={i.number} right={<div className="text-sm text-[#64748b]">{longDay(i.issueDate)}</div>} />
        <div className="grid gap-6 py-6 text-sm sm:grid-cols-3">
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Bill to</div><div className="mt-1 font-medium">{p.customer?.name ?? "—"}</div>{p.customer?.contactName && <div className="text-[#475569]">{p.customer.contactName}</div>}{p.customer?.address && <div className="text-[#475569]">{p.customer.address}</div>}</div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Project</div><div className="mt-1 font-medium">{i.job.name}</div>{p.site && <div className="text-[#475569]">{p.site}</div>}</div>
          <div><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Due</div><div className="mt-1 font-medium">{longDay(i.dueDate) ?? "On receipt"}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(owed)}</div></div>
        </div>
        <h1 className="text-xl font-semibold">{i.title}</h1>
        <table className="mt-4 w-full text-sm">
          <thead><tr><th className={th}>Description</th><th className={`${th} w-32 text-right`}>Amount</th></tr></thead>
          <tbody>
            {i.lines.map((g, k) => <InvoiceGroup key={k} heading={g.heading} lines={g.lines} />)}
          </tbody>
        </table>
        <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-[#64748b]">Subtotal</span><span className="tabular-nums">{fmtMoney(i.subtotalCents)}</span></div>
          {i.taxCents > 0 && <div className="flex justify-between"><span className="text-[#64748b]">Tax</span><span className="tabular-nums">{fmtMoney(i.taxCents)}</span></div>}
          <div className="flex justify-between border-t border-[#e2e8f0] pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(i.totalCents)}</span></div>
          {p.payments.map((x, k) => <div key={k} className="flex justify-between text-[#047857]"><span>Paid {shortDay(x.at)}{x.method ? ` · ${x.method === "CHECK" ? "check" : x.method === "ACH" ? "transfer" : x.method.toLowerCase()}` : ""}</span><span className="tabular-nums">−{fmtMoney(x.amountCents)}</span></div>)}
          <div className="flex justify-between border-t border-[#e2e8f0] pt-2 text-base font-semibold"><span>Amount due</span><span className="tabular-nums">{fmtMoney(owed)}</span></div>
        </div>
        {i.notes && <section className="mt-10 border-t border-[#e2e8f0] pt-4 text-sm"><div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Notes</div><p className="mt-1 whitespace-pre-wrap text-[#334155]">{i.notes}</p></section>}
      </Doc>
      {p.cardPayments && owed > 0 && !p.confirming && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-3 px-4 py-3">
            <div className="hidden flex-1 text-sm text-[#475569] sm:block">{error ? <span className="text-[#b91c1c]">{error}</span> : <>Pay securely by card with Stripe.</>}</div>
            {error && <div className="w-full text-sm text-[#b91c1c] sm:hidden">{error}</div>}
            <button className="flex-1 rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#115e59] disabled:opacity-60 sm:flex-none" disabled={paying} onClick={() => void pay()}><CreditCard size={15} className="mr-1.5 inline" />{paying ? "Opening Stripe…" : `Pay ${fmtMoney(owed)} by card`}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function InvoiceGroup({ heading, lines }: ClientInvoicePage["invoice"]["lines"][number]) {
  return <>
    {heading && <tr><td colSpan={2} className="pt-4 text-xs font-semibold uppercase tracking-[0.08em] text-[#0f766e]">{heading}</td></tr>}
    {lines.map((l, k) => (
      <tr key={k} className="border-b border-[#f1f5f9] align-top">
        <td className="py-2.5">{l.description}{l.percentBps != null && l.percentBps < 10_000 && <span className="ml-1.5 text-xs text-[#64748b]">({(l.percentBps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}% complete)</span>}</td>
        <td className={clsx("py-2.5 text-right tabular-nums", l.amountCents < 0 && "text-[#047857]")}>{fmtMoney(l.amountCents)}</td>
      </tr>
    ))}
  </>;
}

/* ───────────── The client portal ───────────── */

const TOKEN_KEY = "sundays-portal-token";
const EMAIL_KEY = "sundays-portal-email";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } },
};
const card = "rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#e2e8f0] sm:p-5";
const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115e59] disabled:opacity-60";
const pill = (tone: "ok" | "warn" | "muted" | "bad") => clsx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", { ok: "bg-[#ecfdf5] text-[#047857]", warn: "bg-[#fffbeb] text-[#b45309]", muted: "bg-[#f1f5f9] text-[#475569]", bad: "bg-[#fef2f2] text-[#b91c1c]" }[tone]);

export function Portal({ business }: { business: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [b, setB] = useState<string | null>(business);
  const [home, setHome] = useState<PortalHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setToken(store.get(TOKEN_KEY)); setReady(true); }, []);
  const load = useCallback(async () => {
    if (!token) return;
    try { setHome(await opsPortal<PortalHome>(`/public/portal${b ? `?b=${encodeURIComponent(b)}` : ""}`, token)); setError(null); }
    catch (e) {
      if (e instanceof OpsError && e.status === 401) { store.set(TOKEN_KEY, null); setToken(null); setHome(null); }
      else setError((e as Error).message);
    }
  }, [token, b]);
  useEffect(() => { void load(); }, [load]);
  if (!ready) return <Shell><div /></Shell>;
  if (!token) return <SignIn business={b} onIn={(t) => { store.set(TOKEN_KEY, t); setToken(t); }} />;
  if (!home) return <Shell>{error ? <Oops title="We can’t open your portal" text={error} /> : <div className="py-24 text-center text-[#64748b]">Loading…</div>}</Shell>;
  const signOut = async () => { try { await opsPortal("/public/portal/signout", token, {}); } catch { /* gone anyway */ } store.set(TOKEN_KEY, null); setToken(null); setHome(null); };
  return <PortalHomeView home={home} token={token} onBusiness={setB} onSignOut={() => void signOut()} onChange={setHome} />;
}

function SignIn({ business, onIn }: { business: string | null; onIn: (token: string) => void }) {
  const [email, setEmail] = useState(store.get(EMAIL_KEY) ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell>
      <div className="mx-auto max-w-sm px-4 py-16 sm:py-24">
        <div className={card}>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0f766e]">Client portal</div>
          <h1 className="mt-1 text-xl font-semibold">{step === "email" ? "Sign in" : "Check your email"}</h1>
          <p className="mt-1 text-sm text-[#475569]">{step === "email" ? "Your proposals, project schedule, files, invoices and messages, in one place. We’ll email you a code; no password needed." : `We sent a 6-digit code to ${email}. It works for 10 minutes.`}</p>
          <form className="mt-5 space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError(null);
            try {
              if (step === "email") { await opsPortal("/public/portal/code", null, { email, b: business }); store.set(EMAIL_KEY, email.trim()); setStep("code"); }
              else { const r = await opsPortal<{ token: string }>("/public/portal/verify", null, { email, code }); onIn(r.token); }
            } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }}>
            {step === "email"
              ? <div><label className={label} htmlFor="p-email">Your email</label><input id="p-email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" /></div>
              : <div><label className={label} htmlFor="p-code">Code</label><input id="p-code" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} className={`${input} text-center font-mono text-2xl tracking-[0.4em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus /></div>}
            {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
            <button className={`${btn} w-full`} disabled={busy}>{busy ? "One moment…" : step === "email" ? "Email me a code" : "Sign in"}</button>
            {step === "code" && <button type="button" className="w-full text-sm text-[#64748b] hover:text-[#0f172a]" onClick={() => { setStep("email"); setCode(""); setError(null); }}>Use a different email, or send a new code</button>}
          </form>
          {step === "email" && <p className="mt-4 text-[11px] text-[#94a3b8]">Use the email your AV company has on file for you. If it isn’t, no code is sent.</p>}
        </div>
      </div>
    </Shell>
  );
}

type View = { kind: "home" } | { kind: "job"; id: string };

function PortalHomeView({ home, token, onBusiness, onSignOut, onChange }: { home: PortalHome; token: string; onBusiness: (b: string) => void; onSignOut: () => void; onChange: (h: PortalHome) => void }) {
  const [view, setView] = useState<View>(home.jobs.length === 1 ? { kind: "job", id: home.jobs[0].id } : { kind: "home" });
  const biz = home.business!;
  const job = view.kind === "job" ? home.jobs.find((j) => j.id === view.id) : null;
  const unpaid = home.invoices.filter((i) => i.balanceCents > 0);
  const toSign = [...home.proposals.filter((p) => p.status === "SENT"), ...home.changeOrders.filter((c) => c.status === "SENT")];
  return (
    <Shell>
      <div className="sticky top-0 z-20 border-b border-[#e2e8f0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          {biz.logo ? <img src={biz.logo} alt="" className="h-8 w-auto max-w-[110px] object-contain" /> : null}
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{biz.name}</div><div className="truncate text-xs text-[#64748b]">{home.clientName ?? home.email}</div></div>
          {home.businesses.length > 1 && <select className="max-w-[40%] rounded-lg border border-[#cbd5e1] bg-white px-2 py-1.5 text-sm" value={biz.orgId} onChange={(e) => onBusiness(e.target.value)}>{home.businesses.map((x) => <option key={x.orgId} value={x.orgId}>{x.name}</option>)}</select>}
          <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-[#64748b] hover:bg-[#f1f5f9]" onClick={onSignOut}><LogOut size={14} /><span className="hidden sm:inline">Sign out</span></button>
        </div>
      </div>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        {view.kind === "job" && home.jobs.length > 1 && <button className="text-sm text-[#0f766e] hover:underline" onClick={() => setView({ kind: "home" })}>← All projects</button>}
        {(unpaid.length > 0 || toSign.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {unpaid.length > 0 && <a href={unpaid[0].url ?? "#"} className={clsx(card, "flex items-center gap-3 hover:ring-[#0f766e]")}><Receipt className="shrink-0 text-[#0f766e]" size={22} /><div className="min-w-0 flex-1"><div className="font-semibold">{fmtMoney(home.balanceCents)} to pay</div><div className="truncate text-sm text-[#475569]">{unpaid.length} invoice{unpaid.length === 1 ? "" : "s"}{unpaid.some((i) => i.state === "OVERDUE") ? " · overdue" : ""}</div></div><ChevronRight size={18} className="text-[#94a3b8]" /></a>}
            {toSign.length > 0 && <a href={toSign[0].url ?? "#"} className={clsx(card, "flex items-center gap-3 hover:ring-[#0f766e]")}><FileText className="shrink-0 text-[#0f766e]" size={22} /><div className="min-w-0 flex-1"><div className="font-semibold">{toSign.length} to review and sign</div><div className="truncate text-sm text-[#475569]">{toSign[0].title}</div></div><ChevronRight size={18} className="text-[#94a3b8]" /></a>}
          </div>
        )}
        {job ? <JobPanel job={job} home={home} token={token} onChange={onChange} /> : (
          <>
            <section className={card}>
              <h2 className="font-semibold">Projects</h2>
              {!home.jobs.length ? <p className="mt-2 text-sm text-[#64748b]">No projects yet. Once a proposal is signed, its project shows here.</p> : (
                <ul className="mt-2 divide-y divide-[#f1f5f9]">
                  {home.jobs.map((j) => (
                    <li key={j.id}><button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setView({ kind: "job", id: j.id })}>
                      <div className="min-w-0 flex-1"><div className="font-medium">{j.name}</div><div className="text-xs text-[#64748b]">{[j.site, j.startDate ? `Starts ${shortDay(j.startDate)}` : null].filter(Boolean).join(" · ")}</div></div>
                      {j.messages.some((m) => !m.fromClient && !m.readAt) && <span className={pill("warn")}>New message</span>}
                      <ChevronRight size={18} className="text-[#94a3b8]" />
                    </button></li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        <Documents home={home} jobId={job?.id ?? null} />
        <p className="pb-8 text-center text-[11px] text-[#94a3b8]">Questions? {biz.email ? <a className="underline" href={`mailto:${biz.email}`}>{biz.email}</a> : null}{biz.email && biz.phone ? " · " : ""}{biz.phone ?? ""}</p>
      </div>
    </Shell>
  );
}

function Documents({ home, jobId }: { home: PortalHome; jobId: string | null }) {
  const invoices = home.invoices.filter((i) => !jobId || i.job.id === jobId);
  const jobName = jobId ? home.jobs.find((j) => j.id === jobId)?.name : null;
  const cos = home.changeOrders.filter((c) => !jobName || c.job === jobName);
  const proposals = jobId ? [] : home.proposals;
  if (!invoices.length && !cos.length && !proposals.length) return null;
  const stateTone = (s: string) => (s === "PAID" ? "ok" : s === "OVERDUE" ? "bad" : s === "PARTIAL" ? "warn" : "muted") as "ok" | "bad" | "warn" | "muted";
  const stateLabel = (s: string) => ({ OPEN: "To pay", PARTIAL: "Partly paid", OVERDUE: "Overdue", PAID: "Paid" } as Record<string, string>)[s] ?? s;
  return (
    <section className={card}>
      <h2 className="font-semibold">Documents</h2>
      <ul className="mt-2 divide-y divide-[#f1f5f9] text-sm">
        {invoices.map((i) => (
          <li key={i.id}><a href={i.url ?? "#"} className="flex items-center gap-3 py-2.5 hover:text-[#0f766e]">
            <Receipt size={16} className="shrink-0 text-[#94a3b8]" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.title}</div><div className="truncate text-xs text-[#64748b]">Invoice {i.number} · {shortDay(i.issueDate)}{i.dueDate && i.balanceCents > 0 ? ` · due ${shortDay(i.dueDate)}` : ""}</div></div>
            <span className={pill(stateTone(i.state))}>{stateLabel(i.state)}</span>
            <span className="shrink-0 text-right tabular-nums sm:w-24">{fmtMoney(i.balanceCents > 0 ? i.balanceCents : i.totalCents)}</span>
          </a></li>
        ))}
        {cos.map((c) => (
          <li key={c.id}><a href={c.url ?? "#"} className={clsx("flex items-center gap-3 py-2.5", c.url && "hover:text-[#0f766e]")}>
            <FileText size={16} className="shrink-0 text-[#94a3b8]" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.title}</div><div className="truncate text-xs text-[#64748b]">Change order {c.number} · {c.job}</div></div>
            <span className={pill(c.status === "APPROVED" ? "ok" : c.status === "SENT" ? "warn" : "muted")}>{c.status === "SENT" ? "To sign" : c.status === "APPROVED" ? "Approved" : "Declined"}</span>
            <span className="shrink-0 text-right tabular-nums sm:w-24">{fmtMoney(c.amountCents)}</span>
          </a></li>
        ))}
        {proposals.map((q) => (
          <li key={q.id}><a href={q.url ?? "#"} className="flex items-center gap-3 py-2.5 hover:text-[#0f766e]">
            <FileText size={16} className="shrink-0 text-[#94a3b8]" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{q.title}</div><div className="truncate text-xs text-[#64748b]">Proposal {q.number} · {shortDay(q.date)}</div></div>
            <span className={pill(["ACCEPTED", "CONVERTED"].includes(q.status) ? "ok" : q.status === "SENT" ? "warn" : "muted")}>{q.status === "SENT" ? "To sign" : ["ACCEPTED", "CONVERTED"].includes(q.status) ? "Signed" : q.status === "DECLINED" ? "Declined" : q.status === "CHANGES_REQUESTED" ? "Changes asked" : q.status.toLowerCase()}</span>
            <span className="shrink-0 text-right tabular-nums sm:w-24">{fmtMoney(q.totalCents)}</span>
          </a></li>
        ))}
      </ul>
    </section>
  );
}

function JobPanel({ job, home, token, onChange }: { job: PortalJob; home: PortalHome; token: string; onChange: (h: PortalHome) => void }) {
  const b = home.business!.orgId;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = async (what: string, path: string, json: unknown) => {
    setBusy(what); setError(null);
    try { onChange(await opsPortal<PortalHome>(path, token, json)); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(null); }
  };
  const openFile = async (id: string) => {
    try { const r = await opsPortal<{ url: string; downloadUrl: string }>(`/public/portal/files/${id}?b=${encodeURIComponent(b)}`, token); window.open(r.url, "_blank", "noopener"); }
    catch (e) { setError((e as Error).message); }
  };
  const statusText = ({ PLANNING: "Planning", IN_PROGRESS: "In progress", ON_HOLD: "On hold", COMPLETE: "Complete" } as Record<string, string>)[job.status] ?? job.status;
  const paidPct = job.contractCents > 0 ? Math.min(100, (job.paidCents / job.contractCents) * 100) : 0;
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0f766e]">{statusText}</div><h1 className="text-xl font-semibold">{job.name}</h1>{job.site && <div className="text-sm text-[#475569]">{job.site}</div>}</div>
          {job.contractCents > 0 && <div className="text-right text-sm"><div className="text-[#64748b]">Contract</div><div className="font-semibold tabular-nums">{fmtMoney(job.contractCents)}</div></div>}
        </div>
        {job.contractCents > 0 && <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]"><div className="h-full bg-[#0f766e]" style={{ width: `${paidPct}%` }} /></div><div className="mt-1 text-xs text-[#64748b]">{fmtMoney(job.paidCents)} paid · {fmtMoney(job.invoicedCents)} invoiced so far (before tax)</div></div>}
      </section>
      {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}

      {job.selections.length > 0 && (
        <section className={card}>
          <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-[#0f766e]" /> Your selections</h2>
          <div className="mt-3 space-y-4">
            {job.selections.map((s) => (
              <div key={s.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="font-medium">{s.title}</div><div className="text-xs text-[#64748b]">{s.status === "LOCKED" ? "Final" : s.dueDate ? `Pick by ${shortDay(s.dueDate)}` : ""}</div></div>
                {s.description && <p className="text-sm text-[#475569]">{s.description}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {s.options.map((o) => {
                    const chosen = o.id === s.chosenOptionId;
                    return (
                      <button key={o.id} disabled={s.status === "LOCKED" || busy !== null} onClick={() => !chosen && void call(s.id, `/public/portal/selections/${s.id}`, { b, optionId: o.id })}
                        className={clsx("rounded-lg border px-3 py-2.5 text-left transition", chosen ? "border-[#0f766e] bg-[#f0fdfa] ring-1 ring-[#0f766e]" : "border-[#e2e8f0] hover:border-[#94a3b8]", s.status === "LOCKED" && !chosen && "opacity-50")}>
                        <div className="flex items-center justify-between gap-2"><span className="font-medium">{o.name}</span>{chosen && <CheckCircle2 size={16} className="text-[#0f766e]" />}</div>
                        <div className="text-xs text-[#64748b]">{o.priceCents ? `${o.priceCents > 0 ? "Adds" : "Saves"} ${fmtMoney(Math.abs(o.priceCents))}` : "Included"}</div>
                        {o.description && <div className="mt-0.5 text-xs text-[#475569]">{o.description}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={16} className="text-[#0f766e]" /> Schedule</h2>
          {!job.phases.length ? <p className="mt-2 text-sm text-[#64748b]">The schedule shows here once it’s planned.</p> : (
            <ol className="mt-2 space-y-2">
              {job.phases.map((p) => (
                <li key={p.id} className="flex items-start gap-3 text-sm">
                  <span className={clsx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", p.status === "DONE" ? "bg-[#047857]" : p.status === "IN_PROGRESS" ? "bg-[#0f766e] ring-4 ring-[#ccfbf1]" : "bg-[#cbd5e1]")} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-[#64748b]">{p.startDate ? `${shortDay(p.startDate)}${p.endDate && p.endDate !== p.startDate ? ` – ${shortDay(p.endDate)}` : ""}` : "Date to be set"}{p.status === "DONE" ? " · done" : p.status === "IN_PROGRESS" ? " · underway" : ""}</div></div>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className={card}>
          <h2 className="flex items-center gap-2 font-semibold"><Download size={16} className="text-[#0f766e]" /> Files</h2>
          {!job.files.length ? <p className="mt-2 text-sm text-[#64748b]">Drawings, manuals and photos show here when they’re shared with you.</p> : (
            <ul className="mt-2 divide-y divide-[#f1f5f9] text-sm">
              {job.files.map((f) => <li key={f.id}><button className="flex w-full items-center gap-2 py-2 text-left hover:text-[#0f766e]" onClick={() => void openFile(f.id)}><FileText size={15} className="shrink-0 text-[#94a3b8]" /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-xs text-[#94a3b8]">{shortDay(f.createdAt)}</span></button></li>)}
            </ul>
          )}
        </section>
      </div>

      <section className={card}>
        <h2 className="flex items-center gap-2 font-semibold"><MessageSquare size={16} className="text-[#0f766e]" /> Messages</h2>
        <div className="mt-3 space-y-2">
          {!job.messages.length && <p className="text-sm text-[#64748b]">Questions about the project? Write to {home.business!.name} here.</p>}
          {job.messages.map((m) => (
            <div key={m.id} className={clsx("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.fromClient ? "ml-auto bg-[#f0fdfa]" : "bg-[#f1f5f9]")}>
              <div className="whitespace-pre-wrap">{m.body}</div>
              <div className="mt-1 text-[10px] text-[#94a3b8]">{m.fromClient ? "You" : m.author ?? home.business!.name} · {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && await call("msg", "/public/portal/messages", { b, jobId: job.id, body: text })) setText(""); }}>
          <textarea rows={2} className={`${input} flex-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
          <button className={`${btn} self-end`} disabled={busy === "msg" || !text.trim()}><Send size={15} /></button>
        </form>
      </section>
    </div>
  );
}

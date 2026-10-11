"use client";
/** AVL quotes: from draft to converted sale. */
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { QUOTE_STATUSES, STATUS_LABEL, type QuoteStatus } from "@shared/ops/state-machine";
import type { QuoteRow } from "@shared/ops/types";
import { fmtDate, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, QuoteStatusBadge, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

type Data = { quotes: QuoteRow[]; counts: Record<string, number>; customers: { id: string; name: string }[]; campuses: { id: string; name: string }[]; defaultCampusId: string | null };
export default function Page() { return <Suspense><Quotes /></Suspense>; }

function Quotes() {
  const sp = useSearchParams();
  const router = useRouter();
  const status = sp.get("status") ?? "";
  const client = sp.get("client") ?? "";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(client ? { client } : {}), ...(sp.get("q") ? { q: sp.get("q")! } : {}) });
  const d = useOps<Data>(`/quotes?${params}`);
  const [creating, setCreating] = useState(sp.get("new") === "1");
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams({ status, client, q: sp.get("q") ?? "", ...p });
    for (const [k, v] of [...n.entries()]) if (!v) n.delete(k);
    router.replace(`/avl/quotes?${n}`);
  };
  const total = Object.values(d.data?.counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader crumb="AVL" title="Quotes" description="Proposals for your clients, from draft to converted sale."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New quote</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-line p-0.5">
          {[["", "All", total] as const, ...QUOTE_STATUSES.map((s) => [s, STATUS_LABEL[s], d.data?.counts[s] ?? 0] as const)].map(([k, l, n]) => (
            <button key={k} onClick={() => go({ status: k })} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", status === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>
              {l} <span className={clsx("ml-1 tabular-nums", status === k ? "opacity-80" : "text-accent")}>{n}</span>
            </button>
          ))}
        </div>
        {(d.data?.customers.length ?? 0) > 1 && (
          <select className="input w-auto py-1.5 text-xs" value={client} onChange={(e) => go({ client: e.target.value })}>
            <option value="">All clients</option>{d.data!.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <form className="w-full sm:ml-auto sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input w-full sm:w-64" placeholder="Search number, title, client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.quotes.length ? (
            <Table min={780} head={<tr><th>Quote</th><th>Client</th><th>Issued</th><th className="text-right">Total</th><th className="text-right">Margin</th><th>Status</th></tr>}>
              {d.data.quotes.map((qt) => (
                <tr key={qt.id}>
                  <td><Link href={`/avl/quotes/view?id=${qt.id}`} className="font-mono text-xs text-ink-muted hover:text-accent">{qt.number}</Link><div className="text-xs text-ink-faint">{qt.title}</div></td>
                  <td><Link href={`/avl/quotes/view?id=${qt.id}`} className="font-medium hover:text-accent">{qt.customer.name}</Link><div className="text-[11px] text-ink-faint">{qt.customer.contactName}</div></td>
                  <td className="text-ink-soft">{fmtDate(qt.sentAt ?? qt.createdAt)}</td>
                  <td className="text-right font-mono">{fmtMoney(qt.totalCents)}</td>
                  <td className={clsx("text-right font-mono", qt.marginBps < 1500 ? "text-warn" : "text-ink-soft")}>{(qt.marginBps / 100).toFixed(1)}%</td>
                  <td><QuoteStatusBadge status={qt.status as QuoteStatus} /></td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No quotes found.</Empty>}
        </Card>
      )}
      {creating && d.data && <NewQuote data={d.data} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewQuote({ data, onClose }: { data: Data; onClose: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [title, setTitle] = useState("");
  const preset = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("client") : null;
  const [customerId, setCustomerId] = useState(data.customers.find((c) => c.id === preset)?.id ?? data.customers[0]?.id ?? "");
  const [newCust, setNewCust] = useState(data.customers.length === 0);
  const [c, setC] = useState({ name: "", contactName: "", email: "", taxExempt: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New quote" width={480}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          let cid = customerId;
          if (newCust) cid = (await ops<{ id: string }>("/clients", { json: { name: c.name, taxExempt: c.taxExempt, contact: c.contactName ? { name: c.contactName, email: c.email || null } : null } })).id;
          const q = await ops<{ id: string }>("/quotes", { json: { title, customerId: cid, campusId: null } });
          void refresh();
          router.push(`/avl/quotes/view?id=${q.id}`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <Field label="Project title"><input required autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Youth room audio refresh" /></Field>
        {!newCust ? (
          <Field label="Client" hint={<button type="button" className="text-accent hover:underline" onClick={() => setNewCust(true)}>+ New client</button>}>
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{data.customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
        ) : (
          <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
            <span className="label block">New client</span>
            <input required className="input" placeholder="Church or organization" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            <input className="input" placeholder="Contact name" value={c.contactName} onChange={(e) => setC({ ...c, contactName: e.target.value })} />
            <input type="email" className="input" placeholder="Contact email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.taxExempt} onChange={(e) => setC({ ...c, taxExempt: e.target.checked })} /> Tax exempt</label>
            {data.customers.length > 0 && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setNewCust(false)}>Choose an existing client</button>}
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Create quote</button>
        </div>
      </form>
    </Modal>
  );
}

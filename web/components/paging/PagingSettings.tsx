"use client";
/**
 * Settings → ProPresenter, parent paging, and the Kids & Nursery iPad pages.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, Check, ExternalLink, KeyRound, LogOut, MonitorUp, Radar, Tablet, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CheckInLocation, Ministry, MinistryPaging, PagingConfig, ProPresenterMachine } from "@shared/types";
import { Api, ApiError, qk, type PagingPatch } from "@/lib/api";
import { MINISTRY_LABEL } from "@/lib/paging";
import { Spinner } from "@/components/ui";

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={clsx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40", on ? "bg-ok" : "bg-line-strong")}>
      <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function PagingSettings() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: qk.paging, queryFn: Api.pagingConfig });
  const save = useMutation({
    mutationKey: ["savePaging"],
    mutationFn: (patch: PagingPatch) => Api.savePaging(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.paging }); // a refetch landing now would undo this change
      qc.setQueryData<PagingConfig>(qk.paging, (c) => c && {
      ...c, ...patch,
      propresenter: { ...c.propresenter, ...patch.propresenter },
      ipads: { ...c.ipads, ...patch.ipads },
      ministries: {
        nursery: { ...c.ministries.nursery, ...patch.ministries?.nursery },
        kids: { ...c.ministries.kids, ...patch.ministries?.kids },
      },
      });
    },
    onSuccess: (c) => {
      // Quick clicks: only take the server's copy once the last save is back, so nothing flickers.
      if (qc.isMutating({ mutationKey: ["savePaging"] }) <= 1) qc.setQueryData(qk.paging, c); void qc.invalidateQueries({ queryKey: qk.ipads }); void qc.invalidateQueries({ queryKey: qk.pagingStatus }); },
    onError: (e) => { toast.error("Couldn’t save", { description: (e as Error).message }); void cfg.refetch(); },
  });
  const loaded = Boolean(cfg.data);
  useEffect(() => {
    if (loaded && location.hash === "#paging") setTimeout(() => document.getElementById("paging")?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [loaded]);
  if (!cfg.data) return <section id="paging" className="panel p-5"><Spinner /></section>;
  const c = cfg.data;
  return (
    <>
      <ProPresenterSection c={c} save={(p) => save.mutate(p)} />
      <MinistriesSection c={c} save={(p) => save.mutate(p)} />
      <IpadSection c={c} save={(p) => save.mutate(p)} />
      <CompanionsSection />
    </>
  );
}

/* ───────────── ProPresenter ───────────── */

function ProPresenterSection({ c, save }: { c: PagingConfig; save: (p: PagingPatch) => void }) {
  const [host, setHost] = useState(c.propresenter.host);
  const [port, setPort] = useState(c.propresenter.port ? String(c.propresenter.port) : "");
  const [secs, setSecs] = useState(String(c.onScreenSeconds));
  useEffect(() => { setHost(c.propresenter.host); setPort(c.propresenter.port ? String(c.propresenter.port) : ""); }, [c.propresenter.host, c.propresenter.port]);
  useEffect(() => setSecs(String(c.onScreenSeconds)), [c.onScreenSeconds]);

  const saved = c.propresenter.host && c.propresenter.port;
  const conn = useQuery({
    queryKey: ["proConn", c.propresenter.host, c.propresenter.port],
    queryFn: () => Api.testPro(c.propresenter.host, c.propresenter.port),
    enabled: Boolean(saved), retry: false, refetchInterval: 30_000,
  });
  const [found, setFound] = useState<ProPresenterMachine[] | null>(null);
  const find = useMutation({
    mutationFn: () => Api.discoverPro(Number(port) || undefined),
    onSuccess: (list) => { setFound(list); if (!list.length) toast("No ProPresenter found", { description: "Turn on Network in ProPresenter → Settings → Network, or type its IP and port." }); },
    onError: (e) => toast.error("Couldn’t search the network", { description: (e as Error).message }),
  });
  const use = (h: string, p: number) => { setHost(h); setPort(String(p)); setFound(null); save({ propresenter: { host: h, port: p } }); };

  return (
    <section id="paging" className="panel scroll-mt-6 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><MonitorUp size={16} /> ProPresenter</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        Sundays pages parents by showing the child’s security code as a ProPresenter message. In ProPresenter, open
        Settings → Network and turn on <b>Enable Network</b>. ProPresenter 7.9 or newer.
      </p>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        !saved ? "border-line text-ink-muted" : conn.isLoading ? "border-line text-ink-muted" : conn.data ? "border-ok/30 bg-ok-soft text-ok" : "border-bad/30 bg-bad-soft text-bad")}>
        {!saved ? "Not set up yet." : conn.isLoading ? "Connecting…"
          : conn.data ? <>Connected to <b>{conn.data.name || conn.data.host}</b> · {conn.data.version}</>
          : (conn.error as Error)?.message}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_110px_auto] items-end gap-2">
        <label className="block"><span className="label">Computer (IP address or name)</span>
          <input className="input mt-1 font-mono text-sm" placeholder="192.168.1.20" value={host} onChange={(e) => setHost(e.target.value.trim())}
            onBlur={() => host !== c.propresenter.host && save({ propresenter: { host } })} />
        </label>
        <label className="block"><span className="label">Port</span>
          <input className="input mt-1 font-mono text-sm" inputMode="numeric" placeholder="50001" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            onBlur={() => Number(port) !== c.propresenter.port && save({ propresenter: { port: Number(port) || 0 } })} />
        </label>
        <button className="btn-outline" onClick={() => find.mutate()} disabled={find.isPending}>
          {find.isPending ? <Spinner /> : <Radar size={14} />} Find automatically
        </button>
      </div>
      {find.isPending && <p className="mt-2 text-xs text-ink-muted">Looking around your network… (about 5 seconds)</p>}
      {found && found.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {found.map((m) => (
            <div key={`${m.host}:${m.port}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
              <MonitorUp size={15} className="text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name || m.host}</div>
                <div className="text-[11px] text-ink-muted">{m.version} · {m.host}:{m.port}</div>
              </div>
              <button className="btn-primary py-1 text-xs" onClick={() => use(m.host, m.port)}>Use this</button>
            </div>
          ))}
        </div>
      )}

      <label className="mt-5 block">
        <span className="label">Page stays on screen for</span>
        <div className="mt-1 flex items-center gap-2">
          <input className="input w-20 text-center" inputMode="numeric" value={secs} onChange={(e) => setSecs(e.target.value.replace(/\D/g, ""))}
            onBlur={() => { const n = Math.min(600, Math.max(3, Number(secs) || 15)); setSecs(String(n)); if (n !== c.onScreenSeconds) save({ onScreenSeconds: n }); }} />
          <span className="text-sm text-ink-muted">seconds</span>
        </div>
        <span className="mt-1 block text-[11px] text-ink-faint">
          Match your ProPresenter message time (15 seconds by default). While a page is on screen, nobody (in the app or on an iPad) can page again, so one page never replaces another.
        </span>
      </label>

      <label className="mt-4 flex items-start gap-3 rounded-lg border border-line p-3">
        <input type="checkbox" className="mt-0.5" checked={c.approval} onChange={(e) => save({ approval: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium">Hold iPad pages until I send them</span>
          <span className="block text-[12px] text-ink-muted">
            The Kids and Nursery iPads <b>request</b> a page. A bar across the top of Sundays shows each request with <b>Send now</b> and
            <b> Cancel</b>, so pages only go up when it suits the service. Sent pages go up one after another. Off: iPads put codes straight on the screens.
          </span>
        </span>
      </label>
    </section>
  );
}

/* ───────────── Nursery / Kids ───────────── */

function MinistriesSection({ c, save }: { c: PagingConfig; save: (p: PagingPatch) => void }) {
  const [tab, setTab] = useState<Ministry>("nursery");
  const connected = Boolean(c.propresenter.host && c.propresenter.port);
  const themes = useQuery({ queryKey: qk.proThemes, queryFn: Api.proThemes, enabled: connected, retry: false, staleTime: 30_000 });
  const messages = useQuery({ queryKey: qk.proMessages, queryFn: Api.proMessages, enabled: connected, retry: false, staleTime: 30_000 });
  const locations = useQuery({ queryKey: qk.checkInLocations, queryFn: Api.checkInLocations, retry: false, staleTime: 60_000 });
  const m = c.ministries[tab];
  const set = (patch: Partial<Omit<MinistryPaging, "hasPin">>) => save({ ministries: { [tab]: patch } });

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><BellRing size={16} /> Parent paging</h2>
          <p className="mt-0.5 text-sm text-ink-muted">What the screens show for each ministry, and whose children appear on its iPad page.</p>
        </div>
      </div>
      <div className="mt-4 flex gap-1 border-b border-line">
        {(["nursery", "kids"] as Ministry[]).map((x) => (
          <button key={x} onClick={() => setTab(x)}
            className={clsx("-mb-px border-b-2 px-3 py-2 text-sm transition", tab === x ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink-soft")}>
            {c.ministries[x].title || MINISTRY_LABEL[x]}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <label className="block flex-1"><span className="label">Name</span>
            <DeferredInput className="input mt-1" value={m.title} onSave={(v) => v.trim() && set({ title: v.trim() })} />
          </label>
          <div className="flex items-center gap-2 pt-5 text-sm text-ink-soft">
            {m.enabled ? "On" : "Off"} <Switch label={`${m.title} paging`} on={m.enabled} onChange={(v) => set({ enabled: v })} />
          </div>
        </div>

        <div>
          <span className="label">On the screens</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([["managed", "Sundays message", "Sundays keeps its own ProPresenter message with your text and theme."],
              ["existing", "My existing message", "Use a message you already have in ProPresenter."]] as const).map(([mode, title, desc]) => (
              <button key={mode} onClick={() => set({ mode })}
                className={clsx("rounded-xl border p-3 text-left transition", m.mode === mode ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                <div className={clsx("text-sm font-medium", m.mode === mode && "text-accent")}>{title}</div>
                <div className="mt-0.5 text-[11px] text-ink-muted">{desc}</div>
              </button>
            ))}
          </div>
          {!connected && <p className="mt-2 text-xs text-warn">Connect ProPresenter above to choose a theme or message.</p>}

          {m.mode === "managed" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Message text</span>
                <DeferredInput className="input mt-1" value={m.text}
                  onSave={(v) => { if (!v.includes("{code}")) return toast.error("Include {code} where the security code goes"); set({ text: v }); }} />
                <span className="mt-1 block text-[11px] text-ink-faint">{"{code}"} becomes the tag code, e.g. “{m.text.replace("{code}", "K7X4")}”.</span>
              </label>
              <label className="block"><span className="label">Theme</span>
                <select className="input mt-1" value={m.theme?.uuid ?? ""} disabled={!themes.data}
                  onChange={(e) => set({ theme: themes.data?.find((t) => t.id.uuid === e.target.value)?.id ?? null })}>
                  <option value="">ProPresenter’s default message theme</option>
                  {m.theme && !themes.data?.some((t) => t.id.uuid === m.theme!.uuid) && <option value={m.theme.uuid}>{m.theme.name}</option>}
                  {themes.data?.map((t) => <option key={t.id.uuid} value={t.id.uuid}>{t.label}</option>)}
                </select>
                {themes.error && <span className="mt-1 block text-[11px] text-bad">{(themes.error as Error).message}</span>}
                <span className="mt-1 block text-[11px] text-ink-faint">It appears in ProPresenter’s Messages as “Sundays · {m.title}”.</span>
              </label>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">ProPresenter message</span>
                <select className="input mt-1" value={m.existing?.id.uuid ?? ""} disabled={!messages.data}
                  onChange={(e) => {
                    const msg = messages.data?.find((x) => x.id.uuid === e.target.value);
                    set({ existing: msg ? { id: msg.id, token: msg.tokens[0] ?? "" } : null });
                  }}>
                  <option value="">Choose a message…</option>
                  {messages.data?.map((x) => <option key={x.id.uuid} value={x.id.uuid}>{x.id.name}: {x.message}</option>)}
                </select>
                {messages.error && <span className="mt-1 block text-[11px] text-bad">{(messages.error as Error).message}</span>}
              </label>
              <label className="block"><span className="label">Put the code in</span>
                <select className="input mt-1" value={m.existing?.token ?? ""} disabled={!m.existing}
                  onChange={(e) => m.existing && set({ existing: { ...m.existing, token: e.target.value } })}>
                  {(messages.data?.find((x) => x.id.uuid === m.existing?.id.uuid)?.tokens ?? (m.existing ? [m.existing.token] : [])).map((t) => <option key={t} value={t}>{`{${t}}`}</option>)}
                </select>
                {m.existing && messages.data && !messages.data.find((x) => x.id.uuid === m.existing!.id.uuid)?.tokens.length &&
                  <span className="mt-1 block text-[11px] text-bad">This message has no text token. Add one in ProPresenter (e.g. “Nursery: {"{Number}"}”).</span>}
              </label>
            </div>
          )}
          <TestButton ministry={tab} disabled={!connected || !m.enabled} />
        </div>

        <Rooms m={m} list={locations.data} error={locations.error as Error | null} onChange={(ids) => set({ locationIds: ids })} />

        <PinBox ministry={tab} m={m} />
      </div>
    </section>
  );
}

/** Text input that saves when you leave it (or press Enter). */
function DeferredInput({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className={className} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)}
    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function TestButton({ ministry, disabled }: { ministry: Ministry; disabled: boolean }) {
  const qc = useQueryClient();
  const t = useMutation({
    mutationFn: () => Api.testPage(ministry),
    onSuccess: (r) => { qc.setQueryData(qk.pagingStatus, r.status); toast.success("Test page sent", { description: "Check the screens for “TEST”." }); },
    onError: (e) => toast.error("Test didn’t go through", { description: e instanceof ApiError ? e.message : (e as Error).message }),
  });
  return (
    <button className="btn-outline mt-3 py-1.5 text-xs" disabled={disabled || t.isPending} onClick={() => t.mutate()}>
      {t.isPending ? <Spinner size={11} /> : <BellRing size={13} />} Send a test page (“TEST”)
    </button>
  );
}

function Rooms({ m, list, error, onChange }: { m: MinistryPaging; list: CheckInLocation[] | undefined; error: Error | null; onChange: (ids: string[]) => void }) {
  const groups = useMemo(() => {
    const g = new Map<string, CheckInLocation[]>();
    for (const l of list ?? []) {
      const key = `${l.event}${l.folder ? ` › ${l.folder}` : ""}`;
      g.set(key, [...(g.get(key) ?? []), l]);
    }
    return [...g.entries()];
  }, [list]);
  const sel = new Set(m.locationIds);
  const toggle = (ids: string[], on: boolean) => onChange(on ? [...new Set([...m.locationIds, ...ids])] : m.locationIds.filter((x) => !ids.includes(x)));
  return (
    <div>
      <span className="label">{m.title} rooms (Check-Ins)</span>
      <p className="mt-0.5 text-[11px] text-ink-faint">Children checked in to these rooms today show on the {m.title} iPad page.</p>
      {error ? (
        <p className="mt-2 text-xs text-bad">
          {error.message}
          {(error as { data?: { error?: string } }).data?.error === "checkins_signin" && <> <a className="underline" href="/api/auth/login?return=/paging">Sign in again</a></>}
        </p>
      ) : !list ? <div className="mt-2"><Spinner /></div> : (
        <div className="mt-2 max-h-64 space-y-3 overflow-y-auto rounded-lg border border-line p-3">
          {groups.length === 0 && <p className="text-xs text-ink-muted">No Check-Ins rooms found.</p>}
          {groups.map(([name, rooms]) => {
            const all = rooms.every((r) => sel.has(r.id));
            return (
              <div key={name}>
                <label className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
                  <input type="checkbox" checked={all} onChange={(e) => toggle(rooms.map((r) => r.id), e.target.checked)} /> {name}
                </label>
                <div className="mt-1 grid gap-1 pl-5 sm:grid-cols-2">
                  {rooms.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} /> {r.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PinBox({ ministry, m }: { ministry: Ministry; m: MinistryPaging }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const setIt = useMutation({
    mutationFn: (p: string | null) => Api.setPin(ministry, p),
    onSuccess: (c, p) => { qc.setQueryData(qk.paging, c); setPin(""); toast.success(p ? `${m.title} PIN saved` : `${m.title} PIN removed`, { description: "Any iPads signed in to this page need the new PIN." }); },
    onError: (e) => toast.error("Couldn’t save the PIN", { description: (e as Error).message }),
  });
  const out = useMutation({
    mutationFn: () => Api.signOutIpads(ministry),
    onSuccess: () => toast.success(`Signed out every ${m.title} iPad`),
  });
  return (
    <div>
      <span className="label flex items-center gap-1.5"><KeyRound size={11} /> {m.title} iPad PIN</span>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        {m.hasPin ? "A PIN is set. Changing it signs out every iPad on this page." : "Set a PIN (4 to 8 digits) before using the iPad page. Only this ministry’s PIN opens it."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input w-36 font-mono tracking-widest" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
          placeholder={m.hasPin ? "New PIN" : "PIN"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <button className="btn-primary py-1.5" disabled={pin.length < 4 || setIt.isPending} onClick={() => setIt.mutate(pin)}>
          {m.hasPin ? "Change PIN" : "Set PIN"}
        </button>
        {m.hasPin && <>
          <span className="inline-flex items-center gap-1 text-xs text-ok"><Check size={12} /> PIN set</span>
          <button className="btn-ghost py-1.5 text-xs" onClick={() => out.mutate()}><LogOut size={13} /> Sign out all iPads</button>
          <button className="btn-ghost py-1.5 text-xs text-bad" onClick={() => setIt.mutate(null)}>Remove PIN</button>
        </>}
      </div>
    </div>
  );
}

/* ───────────── iPads ───────────── */

function IpadSection({ c, save }: { c: PagingConfig; save: (p: PagingPatch) => void }) {
  const ipads = useQuery({ queryKey: qk.ipads, queryFn: Api.ipads, refetchInterval: c.ipads.enabled ? 5000 : false });
  const [port, setPort] = useState(String(c.ipads.port));
  useEffect(() => setPort(String(c.ipads.port)), [c.ipads.port]);
  const [which, setWhich] = useState<Ministry>("nursery");
  const base = ipads.data?.urls[0];
  const url = ipads.data?.friendly[which] ?? (base ? `${base}/${which}` : null);
  const macIp = base ? new URL(base).hostname : null;
  return (
    <section id="ipads" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Tablet size={16} /> Kids &amp; Nursery iPads</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            A separate page for each ministry that iPads open in Safari on the church Wi-Fi. It only shows that ministry’s checked-in
            children and the Page button. Nothing else in Sundays can be reached from it.
          </p>
        </div>
        <Switch label="iPad pages" on={c.ipads.enabled} onChange={(v) => save({ ipads: { enabled: v } })} />
      </div>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        ipads.data?.error ? "border-bad/30 bg-bad-soft text-bad" : ipads.data?.running ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-ink-muted")}>
        {ipads.data?.error ?? (ipads.data?.running ? <span className="inline-flex items-center gap-1.5"><Wifi size={12} /> On. iPads on this network can open the pages below.</span> : "Off. Turn it on to let iPads open the pages.")}
      </div>

      {c.ipads.enabled && ipads.data && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex gap-1">
              {(["nursery", "kids"] as Ministry[]).map((x) => (
                <button key={x} onClick={() => setWhich(x)}
                  className={clsx("rounded-md px-2.5 py-1 text-xs", which === x ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink-soft")}>
                  {c.ministries[x].title}
                </button>
              ))}
            </div>
            <span className="label mt-3 block">Address for the {c.ministries[which].title} iPads</span>
            <ul className="mt-1 space-y-1">
              {ipads.data.friendly[which] && <li className="select-all font-mono text-sm font-semibold text-accent">{ipads.data.friendly[which]}</li>}
              {ipads.data.urls.map((u) => <li key={u} className="select-all font-mono text-sm">{u}/{which}</li>)}
            </ul>
            {!c.ministries[which].hasPin && <p className="mt-2 text-xs text-warn">Set a {c.ministries[which].title} PIN above first.</p>}
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-[12px] text-ink-muted">
              <li>On the iPad, open Safari and go to the address (or scan the code).</li>
              <li>Enter the {c.ministries[which].title} PIN. The iPad stays signed in.</li>
              <li>Tap Share → <b>Add to Home Screen</b> for a full-screen app. Turn on Guided Access to keep the iPad on this page.</li>
            </ol>
            <a className="btn-ghost mt-3 py-1 text-xs" href={`/kiosk?m=${which}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Preview on this Mac</a>
          </div>
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/paging/qr?url=${encodeURIComponent(url)}`} alt={`QR code for ${url}`} className="h-40 w-40 rounded-lg bg-white p-2" />
          )}
        </div>
      )}

      <label className="mt-4 block">
        <span className="label block">Port</span>
        <input className="input mt-1 w-28 font-mono text-sm" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          onBlur={() => { const n = Number(port); if (n && n !== c.ipads.port) save({ ipads: { port: n } }); }} />
        <span className="mt-1 block text-[11px] text-ink-faint">
          Use <b>80</b> for friendly addresses (below), so nobody has to type a port. This Mac must stay on and awake with Sundays open during services. The first time, macOS asks whether Sundays
          may accept incoming network connections: choose <b>Allow</b>. The iPad pages use your Planning Center access to read Check-Ins.
        </span>
      </label>

      <FriendlyNames c={c} save={save} macIp={macIp} />
    </section>
  );
}

/**
 * Friendly addresses: kids.yourchurch.org / nursery.yourchurch.org point at this Mac in the church's
 * DNS; opening one goes straight to that ministry's page.
 */
function FriendlyNames({ c, save, macIp }: { c: PagingConfig; save: (p: PagingPatch) => void; macIp: string | null }) {
  const names = c.ipads.hostnames ?? {};
  const [v, setV] = useState({ nursery: names.nursery ?? "", kids: names.kids ?? "" });
  useEffect(() => setV({ nursery: names.nursery ?? "", kids: names.kids ?? "" }), [names.nursery, names.kids]);
  const commit = (m: Ministry) => { const x = v[m].trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (x !== (names[m] ?? "")) save({ ipads: { hostnames: { ...names, [m]: x } } }); };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <span className="label">Friendly addresses (optional)</span>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        So your team can just type <b>kids.yourchurch.org</b> or <b>nursery.yourchurch.org</b> on the church network.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(["kids", "nursery"] as Ministry[]).map((m) => (
          <label key={m} className="block"><span className="text-[11px] text-ink-muted">{c.ministries[m].title}</span>
            <input className="input mt-0.5 font-mono text-sm" placeholder={`${m}.yourchurch.org`} value={v[m]}
              onChange={(e) => setV({ ...v, [m]: e.target.value })} onBlur={() => commit(m)} onKeyDown={(e) => e.key === "Enter" && commit(m)} />
          </label>
        ))}
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-[12px] text-ink-muted">
        <li>Give this Mac a fixed IP address on the church network (a DHCP reservation in your router/firewall){macIp ? <>. Right now it’s <b className="font-mono">{macIp}</b></> : ""}.</li>
        <li>Add a DNS <b>A record</b> for each name pointing at that IP: in your router/firewall’s local DNS (UniFi, Meraki, pfSense, Windows DNS…), or in your domain’s public DNS (it only works on the church network, since the IP is private).</li>
        <li>Set <b>Port</b> above to <b>80</b>.</li>
        <li>On the iPads, open <b>http://kids.yourchurch.org</b> (with http://) and enter the PIN again once. Add it to the Home Screen again too.</li>
      </ol>
    </div>
  );
}

/* ───────────── FOH companions ───────────── */

/** Pair front-of-house computers that take over their screen when a page is requested. */
function CompanionsSection() {
  const q = useQuery({ queryKey: ["companions"], queryFn: Api.companions, refetchInterval: 3000 });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const pair = useMutation({ mutationFn: Api.pairCompanion, onSuccess: setPairing, onError: (e) => toast.error("Couldn’t start pairing", { description: (e as Error).message }) });
  const remove = useMutation({ mutationFn: Api.removeCompanion, onSuccess: () => void q.refetch() });
  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  const list = q.data?.companions ?? [];
  // A new companion showed up: the code has been used.
  useEffect(() => { if (pairing && list.some((c) => Date.parse(c.pairedAt) > Date.parse(pairing.expiresAt) - 10 * 60_000)) setPairing(null); }, [list, pairing]);
  return (
    <section id="companions" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><BellRing size={16} /> FOH companions</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            A front-of-house computer running Sundays as a <b>companion</b> takes over its screen when Kids or Nursery ask for a page,
            with big Accept, Hold until clear and Deny buttons. It never sees children’s names. You can still answer requests here too.
          </p>
        </div>
        <button className="btn-outline shrink-0 py-1 text-xs" onClick={() => pair.mutate()}>Pair a companion</button>
      </div>
      {pairing && left > 0 && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent-soft p-4 text-center">
          <div className="text-xs text-ink-muted">On the FOH computer, choose <b>FOH companion</b>, then enter:</div>
          <div className="mt-1 font-mono text-5xl font-bold tracking-[0.4em] text-accent">{pairing.code}</div>
          <div className="mt-1 text-[11px] text-ink-faint">Good for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · this Mac’s address: {q.data?.addresses[0]?.replace(/^http:\/\//, "") ?? "…"}</div>
        </div>
      )}
      <ul className="mt-4 space-y-1.5">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <span className={clsx("h-2 w-2 rounded-full", c.online ? "bg-ok" : "bg-line-strong")} />
            <span className="font-medium">{c.name}</span>
            <span className="text-xs text-ink-muted">{c.online ? "connected" : c.lastSeen ? `last seen ${new Date(c.lastSeen).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "not connected yet"}</span>
            <button className="btn-ghost ml-auto py-1 text-xs hover:text-bad" onClick={() => { if (confirm(`Unpair ${c.name}?`)) remove.mutate(c.id); }}>Unpair</button>
          </li>
        ))}
        {!list.length && <li className="text-sm text-ink-muted">No companions yet.</li>}
      </ul>
    </section>
  );
}

"use client";
/**
 * Preferences: About, Appearance, Default Startup, Campuses, Audio, Network Connections and Video.
 * In the Mac app they open in their own window (Sundays → Preferences…, ⌘,); in a browser
 * at /preferences. A hash picks the tab (and section): /preferences#smaart opens Audio at Smaart.
 */
import { SyncSettings } from "@/components/settings/SyncSettings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AudioLines, Building2, Info, Laptop, MonitorPlay, Moon, Network, Palette, Power, Sun, Trash2, Upload, UserCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppSettings, StartView, ThemePref } from "@shared/types";
import { Api, qk, type SettingsPatch } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { SECTION_TAB, type PrefsTab } from "@/lib/prefs";
import { setTheme } from "@/lib/theme";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { APP_MODE_KEY, MODE_LABEL, PinDialog, serviceLocked, useAppMode } from "@/lib/appMode";
import { PagingSettings } from "@/components/paging/PagingSettings";
import { ProComputersSettings } from "@/components/pro/ProComputersSettings";
import { WavesSettings } from "@/components/settings/WavesSettings";
import { SmaartSettings } from "@/components/settings/SmaartSettings";
import { UpdatesSettings } from "@/components/settings/UpdatesSettings";
import { ConsoleSettings } from "@/components/settings/ConsoleSettings";
import { CampusSettings } from "@/components/settings/CampusSettings";
import { ClockOutputsSettings } from "@/components/settings/ClockOutputsSettings";
import { CheckinsMoved } from "@/components/settings/CheckinsMoved";
import { ResiSettings } from "@/components/settings/ResiSettings";

const TABS: { id: PrefsTab; label: string; icon: typeof Info; blurb: string }[] = [
  { id: "about", label: "About", icon: Info, blurb: "Version, sync across your Macs, and updates." },
  { id: "appearance", label: "Appearance", icon: Palette, blurb: "Theme and your logo." },
  { id: "startup", label: "Default Startup", icon: Power, blurb: "What opens first." },
  { id: "campuses", label: "Campuses", icon: Building2, blurb: "Sort service types by campus, and choose yours." },
  { id: "checkins", label: "Team Check-ins", icon: UserCheck, blurb: "Moved to the check-in website." },
  { id: "audio", label: "Audio", icon: AudioLines, blurb: "Allen & Heath, Waves SuperRack and Smaart." },
  { id: "network", label: "Network Connections", icon: Network, blurb: "Kids & Nursery paging and iPads, FOH companions." },
  { id: "video", label: "Video", icon: MonitorPlay, blurb: "Clock outputs (NDI, network, second display), ProPresenter computers and Resi." },
];

function useHashTab(): [PrefsTab, (t: PrefsTab) => void] {
  const [tab, setTab] = useState<PrefsTab>("about");
  useEffect(() => {
    const read = () => {
      const h = location.hash.slice(1);
      if (!h) return;
      setTab(SECTION_TAB[h] ?? "about");
      // A section inside the tab (e.g. #smaart): scroll to it once the tab has rendered.
      if (!(h in TAB_IDS)) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return [tab, (t) => { history.replaceState(null, "", `#${t}`); setTab(t); }];
}
const TAB_IDS = Object.fromEntries(TABS.map((t) => [t.id, true]));

export function Preferences({ standalone }: { standalone?: boolean }) {
  const mode = useAppMode();
  if (mode.data && serviceLocked(mode.data)) return <PrefsLocked standalone={standalone} />;
  return <PreferencesOpen standalone={standalone} />;
}

/** Service Mode: Preferences need the PIN (it unlocks everything for 15 minutes). */
function PrefsLocked({ standalone }: { standalone?: boolean }) {
  const qc = useQueryClient();
  return (
    <div className={clsx("grid place-items-center bg-canvas", standalone ? "h-screen" : "h-full")}>
      <PinDialog title="Preferences are locked" sub="This computer is in Service Mode. Enter its PIN to open Preferences (and everything else) for 15 minutes." action="Unlock"
        onClose={() => { if (standalone) window.close(); else history.back(); }}
        onPin={async (pin) => { qc.setQueryData(APP_MODE_KEY, await Api.unlockServiceMode(pin)); }} />
    </div>
  );
}

function PreferencesOpen({ standalone }: { standalone?: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings });
  const [tab, setTab] = useHashTab();
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => Api.saveSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      qc.setQueryData<AppSettings>(qk.settings, (s) => s && {
        ...s, ...patch,
        waves: { ...s.waves, ...(patch.waves ?? {}), snapshots: { ...s.waves.snapshots, ...(patch.waves?.snapshots ?? {}) } },
      });
    },
    onSuccess: (s) => qc.setQueryData(qk.settings, s),
    onError: (e) => { toast.error("Couldn’t save setting", { description: (e as Error).message }); void settings.refetch(); },
  });
  const s = settings.data;
  const cur = TABS.find((t) => t.id === tab)!;

  return (
    <div className={clsx("flex overflow-hidden bg-canvas", standalone ? "h-screen" : "h-full")}>
      <nav className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface/60 p-3">
        <div className="mb-3 flex items-center gap-2 px-2 pt-1">
          <Logo size={24} /><span className="text-sm font-semibold">Preferences</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
              tab === t.id ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-8">
          <h1 className="text-xl font-semibold tracking-tight">{cur.label}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{cur.blurb}</p>
          {!s ? <div className="mt-8"><Spinner /></div> : (
            <div className="mt-6 space-y-6">
              {tab === "about" && <><AboutSection /><SyncSettings /><UpdatesSettings /></>}
              {tab === "appearance" && <AppearanceSection s={s} save={save.mutate} />}
              {tab === "startup" && <><StartupSection s={s} save={save.mutate} /><AppModeSection /></>}
              {tab === "campuses" && <CampusSettings />}
              {tab === "checkins" && <CheckinsMoved compact />}
              {tab === "audio" && <><ConsoleSettings /><WavesSettings w={s.waves} onChange={(waves) => save.mutate({ waves })} /><SmaartSettings /></>}
              {tab === "network" && <PagingSettings />}
              {tab === "video" && <><ClockOutputsSettings /><ProComputersSettings /><ResiSettings /></>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

type Save = (p: SettingsPatch) => void;

function AboutSection() {
  const me = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity, retry: false });
  const version = useQuery({ queryKey: ["version"], queryFn: Api.version, staleTime: Infinity }).data;
  return (
    <section id="about" className="panel flex items-center gap-5 p-6">
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-line bg-canvas"><Logo size={56} /></div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold tracking-tight">Sundays</div>
        <div className="mt-0.5 text-sm text-ink-soft">Version <b className="font-mono">{version ?? "…"}</b></div>
        {me.data && <div className="mt-1 text-xs text-ink-muted">{me.data.orgName} · signed in as {me.data.name}</div>}
        <div className="mt-1 text-[11px] text-ink-faint">Planning Center services, workflows and production tools for the whole team.</div>
        <div className="mt-1 text-[11px] text-ink-faint">NDI® is a registered trademark of Vizrt NDI AB (ndi.video). The clock’s NDI output uses the NDI runtime library under the NDI SDK license.</div>
      </div>
    </section>
  );
}

function AppearanceSection({ s, save }: { s: AppSettings; save: Save }) {
  const fileRef = useRef<HTMLInputElement>(null);
  async function pickLogo(file: File) {
    if (file.size > 1_500_000) return toast.error("Please use an image under 1.5 MB");
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) return toast.error("Use a PNG, JPG, SVG or WebP image");
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    save({ logo: dataUrl });
    toast.success("Logo updated");
  }
  const themeBtn = (pref: ThemePref, label: string, Icon: typeof Sun) => (
    <button onClick={() => { setTheme(pref); save({ theme: pref }); }}
      className={clsx("flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 text-sm transition",
        s.theme === pref ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:border-line-strong")}>
      <Icon size={20} /> {label}
    </button>
  );
  return (
    <>
      <section id="appearance" className="panel scroll-mt-6 p-5">
        <h2 className="font-semibold">Theme</h2>
        <p className="mt-0.5 text-sm text-ink-muted">System follows your Mac’s light or dark setting.</p>
        <div className="mt-4 flex gap-3">
          {themeBtn("dark", "Dark", Moon)}
          {themeBtn("light", "Light", Sun)}
          {themeBtn("system", "System", Laptop)}
        </div>
      </section>
      <section id="logo" className="panel scroll-mt-6 p-5">
        <h2 className="font-semibold">Logo</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Shown in the sidebar and on the sign-in page. A square PNG or SVG works best.</p>
        <div className="mt-4 flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-2xl border border-line bg-canvas"><Logo size={56} /></div>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload logo</button>
            {s.logo && <button className="btn-ghost" onClick={() => save({ logo: null })}><Trash2 size={14} /> Use default</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickLogo(f); e.target.value = ""; }} />
        </div>
      </section>
    </>
  );
}

function StartupSection({ s, save }: { s: AppSettings; save: Save }) {
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows });
  const plans = usePlans();
  const serviceTypes = [...new Map((plans.data ?? []).map((p) => [p.serviceTypeId, p.serviceTypeName])).entries()];
  const key = (v: StartView) => v.kind === "workflow" ? `workflow:${v.workflowId}`
    : v.kind === "next-service" || v.kind === "next-checkins" || v.kind === "next-runsheet" ? `${v.kind}:${v.serviceTypeId ?? ""}` : v.kind;
  function set(k: string) {
    const [kind, arg] = k.split(":");
    const v: StartView = kind === "workflow" ? { kind, workflowId: arg }
      : kind === "next-service" || kind === "next-checkins" || kind === "next-runsheet" ? { kind, serviceTypeId: arg || null }
      : { kind: kind as "dashboard" | "workflows" | "services" | "propresenter" | "paging" };
    save({ startView: v });
  }
  const nextGroup = (kind: string, label: string) => (
    <optgroup label={label}>
      <option value={`${kind}:`}>{label} · your service</option>
      {serviceTypes.map(([id, name]) => <option key={id} value={`${kind}:${id}`}>{label} · {name}</option>)}
    </optgroup>
  );
  return (
    <section id="startup" className="panel scroll-mt-6 p-5">
      <h2 className="font-semibold">When Sundays opens</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        The first screen after opening the app or signing in. Service views open the weekend picked in the sidebar; “your service” is the service type chosen at the top of the Dashboard.
      </p>
      <select className="input mt-4" value={key(s.startView)} onChange={(e) => set(e.target.value)}>
        <option value="dashboard">Dashboard</option>
        <option value="services">Services (upcoming)</option>
        {nextGroup("next-service", "The weekend’s service")}
        {nextGroup("next-runsheet", "Run sheet")}
        {nextGroup("next-checkins", "Check-ins")}
        <option value="workflows">Workflows overview</option>
        <optgroup label="A specific workflow">
          {workflows.data?.filter((w) => w.canOpen).map((w) => <option key={w.id} value={`workflow:${w.id}`}>{w.name}</option>)}
        </optgroup>
        <option value="propresenter">ProPresenter</option>
        <option value="paging">Parent paging</option>
      </select>
    </section>
  );
}

/** Full Mode, Service Mode or FOH Companion; and Service Mode's PIN. */
function AppModeSection() {
  const qc = useQueryClient();
  const m = useAppMode().data;
  const [pinA, setPinA] = useState("");
  const [pinB, setPinB] = useState("");
  const setPin = useMutation({
    mutationFn: () => Api.setAppMode("service", { newPin: pinA }),
    onSuccess: (v) => { qc.setQueryData(APP_MODE_KEY, v); setPinA(""); setPinB(""); toast.success("Service Mode PIN changed"); },
    onError: (e) => toast.error("Couldn’t change the PIN", { description: (e as Error).message }),
  });
  return (
    <section id="app-mode" className="panel scroll-mt-6 space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">This computer</h2>
        {m?.mode && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{MODE_LABEL[m.mode]}</span>}
        <a href="/setup-mode" className="btn-outline ml-auto py-1 text-xs">Change mode…</a>
      </div>
      <ul className="space-y-1 text-sm text-ink-muted">
        <li><b className="text-ink">Full Mode</b>: everything.</li>
        <li><b className="text-ink">Service Mode</b>: for a shared computer. Only Services, ProPresenter, Clock, Mic board and Parent paging; no Workflows or Check-Ins. Its PIN is needed to leave it or open Preferences.</li>
        <li><b className="text-ink">FOH Companion</b>: the front-of-house computer (page requests, the mic strip and the Tuning strip).</li>
      </ul>
      {m?.mode === "service" && (
        <form className="flex flex-wrap items-end gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); setPin.mutate(); }}>
          <label className="block"><span className="text-xs text-ink-muted">New Service Mode PIN</span>
            <input className="input mt-1 w-32 font-mono" type="password" inputMode="numeric" maxLength={8} value={pinA} onChange={(e) => setPinA(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="block"><span className="text-xs text-ink-muted">Again</span>
            <input className="input mt-1 w-32 font-mono" type="password" inputMode="numeric" maxLength={8} value={pinB} onChange={(e) => setPinB(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button className="btn-outline" disabled={!/^\d{4,8}$/.test(pinA) || pinA !== pinB || setPin.isPending}>Change PIN</button>
        </form>
      )}
    </section>
  );
}

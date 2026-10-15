"use client";
/**
 * How this Mac uses Sundays (after signing in the first time, or from Preferences / the
 * sidebar): Full Mode, Service Mode (a shared computer) or FOH Companion.
 */
import clsx from "clsx";
import { BellRing, CalendarDays, LayoutDashboard, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppMode } from "@shared/types";
import { Api } from "@/lib/api";
import { APP_MODE_KEY, serviceLocked, useAppMode } from "@/lib/appMode";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";

const MODES: { mode: AppMode; title: string; icon: typeof BellRing; tone: string; body: string }[] = [
  { mode: "full", title: "Full Mode", icon: LayoutDashboard, tone: "text-accent hover:border-accent/60",
    body: "Everything: workflows, services, dashboard, ProPresenter, clock, mic board and paging, with your Planning Center sign-in." },
  { mode: "service", title: "Service Mode", icon: CalendarDays, tone: "text-ok hover:border-ok/60",
    body: "For a shared computer: only Services, ProPresenter, Clock, Mic board and Parent paging. No Workflows or Check-Ins. A PIN you choose is needed to leave it or open Preferences." },
  { mode: "companion", title: "FOH Companion", icon: BellRing, tone: "text-warn hover:border-warn/60",
    body: "For the front-of-house computer: links to your main Sundays computer for page requests, the mic strip and the Tuning strip. No sign-in needed." },
];

export default function SetupModePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const cur = useAppMode().data;
  const [pick, setPick] = useState<AppMode | null>(null);
  const [newPin, setNewPin] = useState({ a: "", b: "" });
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needOldPin = serviceLocked(cur) && pick !== null && pick !== "service";
  const needNewPin = pick === "service" && (!cur?.hasPin || cur.mode !== "service");

  const go = async (mode: AppMode) => {
    setBusy(true); setErr(null);
    try {
      qc.setQueryData(APP_MODE_KEY, await Api.setAppMode(mode, { ...(needOldPin ? { pin } : {}), ...(mode === "service" && newPin.a ? { newPin: newPin.a } : {}) }));
      void qc.invalidateQueries();
      router.replace(mode === "companion" ? "/companion" : "/start");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const choose = (mode: AppMode) => {
    setPick(mode); setErr(null);
    // Straight in when nothing else is needed.
    const old = serviceLocked(cur) && mode !== "service";
    const fresh = mode === "service" && (!cur?.hasPin || cur.mode !== "service");
    if (!old && !fresh) void go(mode);
  };
  const pinOk = !needNewPin || (/^\d{4,8}$/.test(newPin.a) && newPin.a === newPin.b);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 py-10">
      <div className="w-full max-w-5xl">
        <div className="mb-2 flex items-center gap-3"><Logo size={36} /><div className="text-xl font-semibold">How will this computer use Sundays?</div></div>
        <p className="mb-8 text-sm text-ink-muted">{cur?.mode ? <>Now: <b className="text-ink">{MODES.find((m) => m.mode === cur.mode)?.title}</b>. </> : null}You can change it later.</p>
        <div className="grid gap-4 md:grid-cols-3">
          {MODES.map(({ mode, title, icon: Icon, tone, body }) => (
            <button key={mode} disabled={busy} onClick={() => choose(mode)}
              className={clsx("panel p-6 text-left transition disabled:opacity-50", tone, pick === mode && "ring-2 ring-current", cur?.mode === mode && "border-line-strong")}>
              <Icon size={28} />
              <div className="mt-3 flex items-center gap-2 text-lg font-semibold text-ink">{title}{cur?.mode === mode && <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] font-normal text-ink-muted">Now</span>}</div>
              <p className="mt-1 text-sm text-ink-muted">{body}</p>
            </button>
          ))}
        </div>

        {(needOldPin || needNewPin) && pick && (
          <form className="panel mx-auto mt-6 max-w-md space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); if (pinOk && (!needOldPin || pin.length >= 4)) void go(pick); }}>
            {needOldPin && (
              <label className="block">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Lock size={14} /> Service Mode PIN</span>
                <span className="block text-xs text-ink-muted">Leaving Service Mode needs its PIN.</span>
                <input autoFocus className="input mt-2 text-center font-mono text-2xl tracking-[0.4em]" type="password" inputMode="numeric" maxLength={8}
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              </label>
            )}
            {needNewPin && (
              <div>
                <span className="flex items-center gap-1.5 text-sm font-medium"><Lock size={14} /> Choose a PIN for Service Mode</span>
                <span className="block text-xs text-ink-muted">4 to 8 numbers. It’s needed to leave Service Mode or open Preferences on this computer, so keep it to staff.</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input autoFocus className="input text-center font-mono text-xl tracking-[0.3em]" type="password" inputMode="numeric" maxLength={8} placeholder="PIN"
                    value={newPin.a} onChange={(e) => setNewPin({ ...newPin, a: e.target.value.replace(/\D/g, "") })} />
                  <input className="input text-center font-mono text-xl tracking-[0.3em]" type="password" inputMode="numeric" maxLength={8} placeholder="Again"
                    value={newPin.b} onChange={(e) => setNewPin({ ...newPin, b: e.target.value.replace(/\D/g, "") })} />
                </div>
                {newPin.b.length >= 4 && newPin.a !== newPin.b && <p className="mt-1 text-xs text-bad">The two PINs aren’t the same.</p>}
              </div>
            )}
            {err && <p className="text-sm text-bad">{err}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy || !pinOk || (needOldPin && pin.length < 4)}>
              Use {MODES.find((m) => m.mode === pick)?.title}
            </button>
          </form>
        )}
        {err && !(needOldPin || needNewPin) && <p className="mt-4 text-center text-sm text-bad">{err}</p>}
      </div>
    </main>
  );
}

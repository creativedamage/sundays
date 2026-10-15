"use client";
/**
 * This Mac's mode (Full Mode, Service Mode, FOH Companion) and the Service Mode PIN dialog.
 * Service Mode keeps Services, ProPresenter, Clock, Mic board and Parent paging; the PIN leaves it
 * or unlocks the rest (Preferences included) for 15 minutes.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, X } from "lucide-react";
import { useState } from "react";
import { SERVICE_MODE_PAGES, type AppModeView } from "@shared/types";
import { Api } from "@/lib/api";

export const APP_MODE_KEY = ["appMode"];
export function useAppMode() {
  return useQuery({ queryKey: APP_MODE_KEY, queryFn: Api.appMode, staleTime: 10_000, refetchInterval: 30_000 });
}

/** Service Mode and not unlocked with the PIN. */
export const serviceLocked = (m: AppModeView | undefined) =>
  m?.mode === "service" && !(m.unlockedUntil && Date.parse(m.unlockedUntil) > Date.now());

/** A page Service Mode keeps. */
export const serviceModeAllows = (path: string) =>
  SERVICE_MODE_PAGES.some((p) => path === p || path.startsWith(`${p}/`));

export const MODE_LABEL = { full: "Full Mode", service: "Service Mode", companion: "FOH Companion" } as const;

/** Ask for the Service Mode PIN, then run `onPin` with it (it throws to show an error). */
export function PinDialog({ title, sub, action, onPin, onClose }: {
  title: string; sub?: string; action: string; onPin: (pin: string) => Promise<unknown>; onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await onPin(pin); } catch (e) { setErr((e as Error).message); setPin(""); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="panel w-full max-w-sm p-6 shadow-2xl" onSubmit={(e) => { e.preventDefault(); if (pin.length >= 4) void go(); }}>
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-accent" />
          <h2 className="font-semibold">{title}</h2>
          <button type="button" className="btn-ghost ml-auto p-1" onClick={onClose}><X size={15} /></button>
        </div>
        {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
        <input autoFocus className="input mt-4 py-3 text-center font-mono text-3xl tracking-[0.5em]" type="password" inputMode="numeric" maxLength={8}
          placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
        {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        <button className="btn-primary mt-4 w-full py-2.5" disabled={pin.length < 4 || busy}>{action}</button>
      </form>
    </div>
  );
}

/** Unlock Service Mode with the PIN (for Preferences or a closed page). */
export function useUnlock() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const dialog = open ? (
    <PinDialog title="Unlock Service Mode" sub="Enter the Service Mode PIN. Everything (Preferences, Workflows, Check-Ins) opens for 15 minutes." action="Unlock"
      onClose={() => setOpen(false)}
      onPin={async (pin) => { qc.setQueryData(APP_MODE_KEY, await Api.unlockServiceMode(pin)); setOpen(false); }} />
  ) : null;
  return { ask: () => setOpen(true), dialog };
}

/**
 * The production clock engine: one clock for the whole building.
 *
 * Holds the main and secondary timers, the message and the presets; runs presets on their schedule;
 * moves to the next preset when a timer ends; looks up "until service" and "Live item" times in
 * Planning Center. Every output (control page, network clock, NDI, second display) gets the state
 * through onClockChange and works out the display itself (shared/clock.ts).
 */
import crypto from "node:crypto";
import {
  DEFAULT_LABEL, DEFAULT_PRO_SETTINGS, DEFAULT_TIMER_COLOR, nextAt, readClock, type MessagePosition,
  type ClockOutputSettings, type ClockPreset, type ClockProStatus, type ClockProTimer, type ClockState, type ClockStatusView, type ClockTimerSpec, type ClockTimerState,
} from "../../../shared/clock.js";
import { ProPresenter } from "./propresenter.js";
import { machines as proMachines } from "../routes/pro.js";
import { pcoForUser } from "../auth/oauth.js";
import { followPlans, onWeekendChange, weekend, weekendPlans } from "./weekend.js";
import type { PcoApi } from "../pco/api.js";
import { extras } from "./db.js";

interface Stored { presets: ClockPreset[]; settings: ClockOutputSettings; state: ClockState | null; owner: { userId: string; demo: boolean } | null }
const KEY = "clock";

const defaultSettings = (): ClockOutputSettings => ({
  ndi: { enabled: false, name: "Sundays Clock", resolution: "1080p", fps: 30, transparent: false },
  screen: { enabled: false, displayId: null },
  lan: false,
  title: "MASTER TIME",
  infoHeading: "INFORMATION",
  showTimeOfDay: true,
  controlKey: crypto.randomBytes(4).toString("hex"),
  pro: { ...DEFAULT_PRO_SETTINGS },
});
const blankTimer = (): ClockTimerState => ({ mode: "countdown", label: "Countdown", running: false, startedAt: null, elapsedMs: 0, durationMs: 300_000, targetAt: null, overtime: true });
const blankState = (): ClockState => ({
  main: blankTimer(), secondary: null, message: "", messagePosition: "bottom", info: { title: "", subtitle: "", hidden: false }, timerColor: DEFAULT_TIMER_COLOR, blank: false, presetId: null, presetName: null, warnSec: 60, dangerSec: 15, serverNow: Date.now(), version: 1 });

function load(): Stored {
  const s = extras.get<Partial<Stored>>(KEY, {});
  const settings = { ...defaultSettings(), ...s.settings } as ClockOutputSettings;
  settings.ndi = { ...defaultSettings().ndi, ...s.settings?.ndi };
  settings.screen = { ...defaultSettings().screen, ...s.settings?.screen };
  settings.pro = { ...DEFAULT_PRO_SETTINGS, ...s.settings?.pro };
  if (!s.settings?.controlKey) extras.set(KEY, { ...s, settings });
  return { presets: s.presets ?? [], settings, state: s.state ?? null, owner: s.owner ?? null };
}
let stored = load();
// Older saved states don't have the newer fields.
let state: ClockState = { ...blankState(), ...(stored.state ?? {}) };
const persist = () => extras.set(KEY, { ...stored, state });

/** Settings sync: the presets and the clock's wording, not this Mac's outputs (NDI, screen, network). */
export function clockSyncValue() {
  const { title, infoHeading, showTimeOfDay } = stored.settings;
  return { presets: stored.presets, settings: { title, infoHeading, showTimeOfDay } };
}
export function applyClockSync(v: unknown) {
  const x = v as { presets?: ClockPreset[]; settings?: Partial<ClockOutputSettings> } | null;
  if (!x || !Array.isArray(x.presets)) return;
  const { title, infoHeading, showTimeOfDay } = { ...stored.settings, ...x.settings };
  stored = { ...stored, presets: x.presets, settings: { ...stored.settings, title, infoHeading, showTimeOfDay } };
  persist();
  changed();
}

/* ───────────── Change notifications ───────────── */

type Listener = (s: ClockState) => void;
const listeners = new Set<Listener>();
export function onClockChange(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function changed(save = true) {
  state = { ...state, version: state.version + 1, serverNow: Date.now() };
  if (save) persist();
  for (const fn of listeners) { try { fn(state); } catch { /* a closed stream */ } }
}
export const clockState = (): ClockState => ({ ...state, serverNow: Date.now() });
export const clockPresets = () => stored.presets;
export const clockSettings = () => stored.settings;

/* ───────────── Outputs (NDI and the second display live in the Mac app) ───────────── */

let status: ClockStatusView = { ndi: { available: false, running: false, sourceName: null, connections: 0, error: "NDI output works in the Sundays Mac app." }, displays: [] };
const settingsListeners = new Set<(s: ClockOutputSettings) => void>();
/** Registered by desktop/src/main.ts. */
export const clockOutputs = {
  settings: () => stored.settings,
  onSettings: (fn: (s: ClockOutputSettings) => void) => { settingsListeners.add(fn); },
  setStatus: (patch: { ndi?: Partial<ClockStatusView["ndi"]>; displays?: ClockStatusView["displays"] }) => {
    status = { ...status, ...patch, ndi: { ...status.ndi, ...patch.ndi } };
  },
};
export const clockStatus = () => status;

export function saveClockSettings(patch: Partial<ClockOutputSettings>) {
  const cur = stored.settings;
  stored.settings = { ...cur, ...patch, ndi: { ...cur.ndi, ...patch.ndi }, screen: { ...cur.screen, ...patch.screen }, pro: { ...cur.pro, ...patch.pro } };
  persist();
  if (patch.pro) {
    // A different computer or different timers: start over, and stop following when it's switched off.
    seen.clear(); kindsAt = 0; pick = { main: null, aux: null };
    if (!stored.settings.pro.machineId && state.source === "propresenter") state = { ...state, source: "manual", presetName: null };
    void pollPro();
  }
  for (const fn of settingsListeners) fn(stored.settings);
  changed(false); // outputs re-read showTimeOfDay / transparency
  return stored.settings;
}

export function saveClockPresets(list: ClockPreset[]) {
  stored.presets = list;
  persist();
  if (state.presetId && !list.some((p) => p.id === state.presetId)) state = { ...state, presetId: null, presetName: null };
  changed();
  return stored.presets;
}

/** Whose Planning Center access looks up service times and Live (whoever last used the clock). */
export function setClockOwner(owner: { userId: string; demo: boolean }) {
  if (stored.owner?.userId === owner.userId && stored.owner.demo === owner.demo) return;
  stored.owner = owner;
  persist();
}
const pco = (): PcoApi | null => (stored.owner ? pcoForUser(stored.owner.userId, stored.owner.demo) : null);

/* ───────────── Building timers ───────────── */

function build(spec: ClockTimerSpec & { startWhenMainEnds?: boolean }, now = Date.now()): ClockTimerState {
  const t: ClockTimerState = {
    mode: spec.mode, label: spec.label?.trim() || DEFAULT_LABEL[spec.mode], running: false, startedAt: null, elapsedMs: 0,
    durationMs: Math.max(0, (spec.durationSec ?? 300) * 1000), targetAt: null, overtime: spec.overtime ?? true,
    startWhenMainEnds: spec.startWhenMainEnds,
  };
  if (spec.mode === "totime") t.targetAt = nextAt(spec.target ?? "", now);
  if (spec.mode === "timeofday") t.running = true;
  if (spec.mode === "service" || spec.mode === "liveitem") { t.idle = "Looking it up in Planning Center…"; t.running = true; }
  return t;
}
/** Which service type a Planning Center timer follows (kept beside the state, not shown). */
const follow = { main: null as string | null, secondary: null as string | null };

function startTimer(t: ClockTimerState, now = Date.now()): ClockTimerState {
  if (t.running && t.startedAt) return t;
  if (t.mode === "countdown" || t.mode === "countup") return { ...t, running: true, startedAt: now };
  return { ...t, running: true };
}
function pauseTimer(t: ClockTimerState, now = Date.now()): ClockTimerState {
  if (!t.running || (t.mode !== "countdown" && t.mode !== "countup")) return t;
  return { ...t, running: false, elapsedMs: t.elapsedMs + (t.startedAt ? now - t.startedAt : 0), startedAt: null };
}
function resetTimer(t: ClockTimerState, spec?: ClockTimerSpec): ClockTimerState {
  if (t.mode === "countdown" || t.mode === "countup") return { ...t, running: false, startedAt: null, elapsedMs: 0 };
  if (t.mode === "totime" && spec?.target) return { ...t, targetAt: nextAt(spec.target, Date.now()) };
  return t;
}

/* ───────────── Actions ───────────── */

export type ClockAction =
  | { type: "start" | "pause" | "toggle" | "reset"; which?: "main" | "secondary" }
  | { type: "add"; sec: number; which?: "main" | "secondary" }
  | { type: "set"; which: "main" | "secondary"; spec: (ClockTimerSpec & { startWhenMainEnds?: boolean }) | null; start?: boolean }
  | { type: "message"; text: string }
  | { type: "blank"; on: boolean }
  | { type: "load"; presetId: string; start?: boolean }
  | { type: "next" | "prev" }
  | { type: "colors"; warnSec: number; dangerSec: number }
  | { type: "info"; title?: string; subtitle?: string; hidden?: boolean }
  | { type: "style"; timerColor?: string; messagePosition?: MessagePosition }
  | { type: "follow"; on: boolean };

let mainEnded = false;
const presetById = (id: string | null) => stored.presets.find((p) => p.id === id) ?? null;

function loadPreset(p: ClockPreset, start?: boolean) {
  const now = Date.now();
  let main = build(p.main, now);
  const secondary = p.secondary ? build(p.secondary, now) : null;
  follow.main = p.main.serviceTypeId ?? null;
  follow.secondary = p.secondary?.serviceTypeId ?? null;
  if (start ?? p.autoStart) main = startTimer(main, now);
  state = {
    // A secondary countdown/stopwatch runs alongside the main one (unless it waits for the main to end).
    ...state, main, secondary: secondary && !secondary.startWhenMainEnds && main.running ? startTimer(secondary, now) : secondary,
    message: p.message, blank: false, info: { title: p.info?.title ?? "", subtitle: p.info?.subtitle ?? "", hidden: state.info.hidden },
    timerColor: p.timerColor ?? DEFAULT_TIMER_COLOR, presetId: p.id, presetName: p.name, warnSec: p.warnSec, dangerSec: p.dangerSec,
  };
  mainEnded = false;
  void refreshPco(true);
}

export function clockAct(a: ClockAction): ClockState {
  const now = Date.now();
  const which = "which" in a && a.which === "secondary" ? "secondary" : "main";
  // Following ProPresenter: start, pause, reset and ± run its timer (it shows up here on the next look).
  if (state.source === "propresenter" && (a.type === "start" || a.type === "pause" || a.type === "toggle" || a.type === "reset" || a.type === "add")) {
    const uuid = which === "main" ? proStatus.mainUuid : proStatus.auxUuid;
    if (uuid) { void proTimerAct(uuid, a); return clockState(); }
  }
  // A saved timer or one set here takes over from ProPresenter.
  if (a.type === "load" || a.type === "set" || a.type === "next" || a.type === "prev") {
    if (state.source === "propresenter" && !(a.type === "set" && which === "secondary")) state = { ...state, source: "manual", presetName: null };
  }
  const on = (fn: (t: ClockTimerState) => ClockTimerState) => {
    if (which === "secondary") { if (state.secondary) state = { ...state, secondary: fn(state.secondary) }; }
    else state = { ...state, main: fn(state.main) };
  };
  switch (a.type) {
    case "start": on((t) => startTimer(t, now)); break;
    case "pause": on((t) => pauseTimer(t, now)); break;
    case "toggle": on((t) => (t.running && t.startedAt ? pauseTimer(t, now) : startTimer(t, now))); break;
    case "reset": {
      const p = presetById(state.presetId);
      on((t) => resetTimer(t, which === "main" ? p?.main : p?.secondary ?? undefined));
      if (which === "main") mainEnded = false;
      break;
    }
    case "add": on((t) => {
      const ms = Math.round(a.sec * 1000);
      if (t.mode === "countdown" || t.mode === "liveitem") return { ...t, durationMs: Math.max(0, t.durationMs + ms) };
      if (t.mode === "countup") return { ...t, elapsedMs: Math.max(0, t.elapsedMs + ms) };
      if (t.targetAt != null) return { ...t, targetAt: t.targetAt + ms };
      return t;
    }); mainEnded = false; break;
    case "set": {
      if (!a.spec) { if (which === "secondary") state = { ...state, secondary: null }; break; }
      let t = build(a.spec, now);
      if (a.start) t = startTimer(t, now);
      follow[which] = a.spec.serviceTypeId ?? null;
      // A timer set by hand isn't the loaded preset any more (so its "next" doesn't kick in).
      state = which === "main" ? { ...state, main: t, presetId: null, presetName: null } : { ...state, secondary: t };
      if (which === "main") mainEnded = false;
      void refreshPco(true);
      break;
    }
    case "message": state = { ...state, message: a.text.slice(0, 200) }; break;
    case "blank": state = { ...state, blank: a.on }; break;
    case "colors": state = { ...state, warnSec: Math.max(0, a.warnSec), dangerSec: Math.max(0, a.dangerSec) }; break;
    case "info": state = { ...state, info: { title: (a.title ?? state.info.title).slice(0, 60), subtitle: (a.subtitle ?? state.info.subtitle).slice(0, 80), hidden: a.hidden ?? state.info.hidden } }; break;
    case "style": state = { ...state, timerColor: a.timerColor ?? state.timerColor, messagePosition: a.messagePosition ?? state.messagePosition }; break;
    case "follow": {
      if (!a.on) { if (state.source === "propresenter") state = { ...state, source: "manual", presetName: null }; break; }
      if (!stored.settings.pro.machineId) throw Object.assign(new Error("Choose a ProPresenter computer first (Clock → ProPresenter)."), { status: 400 });
      state = { ...state, source: "propresenter", presetId: null, presetName: "ProPresenter", blank: false };
      mainEnded = false;
      applyPro(now, true);
      break;
    }
    case "load": {
      const p = presetById(a.presetId);
      if (!p) throw Object.assign(new Error("That timer isn’t saved any more."), { status: 404 });
      loadPreset(p, a.start);
      break;
    }
    case "next":
    case "prev": {
      const list = stored.presets;
      if (!list.length) break;
      const i = list.findIndex((p) => p.id === state.presetId);
      const j = i < 0 ? 0 : (i + (a.type === "next" ? 1 : -1) + list.length) % list.length; // loops end → start
      loadPreset(list[j]);
      break;
    }
  }
  changed();
  return clockState();
}

/* ───────────── Planning Center: until service, Live item ───────────── */

let pcoBusy = false;
async function serviceTarget(api: PcoApi, st: string | null): Promise<{ at: number; label: string } | null> {
  const now = Date.now();
  // The picked weekend's services only: it never jumps ahead to the next weekend.
  const plans = (await followPlans(api, st)).filter((p) => Date.parse(p.sortDate) > now - 12 * 3600e3).slice(0, 4);
  let best: { at: number; label: string } | null = null;
  for (const p of plans) {
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    for (const t of d?.times ?? []) {
      if (t.kind !== "service") continue;
      const at = Date.parse(t.startsAt);
      if (at > now && (!best || at < best.at)) best = { at, label: `${p.serviceTypeName} · ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` };
    }
    if (best) break; // plans come in date order
  }
  return best;
}

async function liveItem(api: PcoApi, st: string | null): Promise<{ title: string; startedAt: number; lengthMs: number } | null> {
  const now = Date.now();
  const plans = (await weekendPlans(api, st)).filter((p) => Math.abs(Date.parse(p.sortDate) - now) < 18 * 3600e3).slice(0, 6);
  for (const p of plans) {
    const live = await api.getLive(p.serviceTypeId, p.id).catch(() => null);
    if (!live?.currentItemId) continue;
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    const item = d?.items.find((i) => i.id === live.currentItemId);
    if (!item) continue;
    return { title: item.title, startedAt: live.currentStartedAt ? Date.parse(live.currentStartedAt) : now, lengthMs: item.lengthSec * 1000 };
  }
  return null;
}

/** Fill in service / Live item timers. Live is checked every few seconds; service times every minute. */
async function refreshPco(force = false) {
  const needs = (["main", "secondary"] as const).filter((w) => {
    const t = state[w];
    return t && (t.mode === "service" || t.mode === "liveitem");
  });
  if (!needs.length || pcoBusy) return;
  const api = pco();
  if (!api) {
    for (const w of needs) state = { ...state, [w]: { ...state[w]!, idle: "Open the Clock in Sundays once so it can read Planning Center." } };
    changed(false);
    return;
  }
  pcoBusy = true;
  let any = false;
  try {
    for (const w of needs) {
      const t = state[w]!;
      if (t.mode === "service" && (force || !t.targetAt || t.targetAt < Date.now() - 60_000 || Date.now() % 60_000 < 3500)) {
        const r = await serviceTarget(api, follow[w]).catch(() => null);
        const next: ClockTimerState = r ? { ...t, targetAt: r.at, idle: undefined, label: t.label === DEFAULT_LABEL.service || !t.label ? DEFAULT_LABEL.service : t.label } : { ...t, targetAt: null, idle: weekend() ? "No more services that weekend" : "Pick a weekend in Sundays" };
        if (JSON.stringify(next) !== JSON.stringify(t)) { state = { ...state, [w]: next }; any = true; }
      }
      if (t.mode === "liveitem") {
        const r = await liveItem(api, follow[w]).catch(() => null);
        const next: ClockTimerState = r
          ? { ...t, idle: undefined, running: true, label: r.title, startedAt: r.startedAt, elapsedMs: 0, durationMs: r.lengthMs }
          : { ...t, idle: "Planning Center Live isn’t running", running: false, startedAt: null };
        if (JSON.stringify(next) !== JSON.stringify(t)) { state = { ...state, [w]: next }; any = true; mainEnded = false; }
      }
    }
  } finally { pcoBusy = false; }
  if (any) changed(false);
}

/* ───────────── ProPresenter timers ───────────── */

const blankProStatus = (): ClockProStatus => ({ machineName: null, connected: false, error: null, timers: [], mainUuid: null, auxUuid: null });
let proStatus: ClockProStatus = blankProStatus();
export const clockProStatus = () => proStatus;
export const clockProMachines = () => proMachines().map((m) => ({ id: m.id, name: m.name }));

type ProKind = ClockProTimer["kind"];
/**
 * What we last saw of each ProPresenter timer. `at` is our best estimate of when its value last
 * ticked over (a second boundary): each tick happened between two looks, and since a running timer
 * ticks every 1000 ms, the windows from several ticks narrow it down to a few milliseconds.
 */
interface ProSeen { uuid: string; name: string; kind: ProKind; sec: number; running: boolean; at: number; lo: number; hi: number }
const seen = new Map<string, ProSeen>();
let kinds = new Map<string, ProKind>();
let kindsAt = 0;
/** The timers on the clock, kept while they exist so they don't jump between ProPresenter timers. */
let pick: { main: string | null; aux: string | null } = { main: null, aux: null };
let proBusy = false;
let lastLook = 0;

/** "00:04:32" / "-00:00:05" → seconds (negative = over). */
const proSeconds = (t: string) => {
  const neg = t.trim().startsWith("-");
  const v = t.replace("-", "").split(":").map((x) => Number(x) || 0).reduce((a, b) => a * 60 + b, 0);
  return neg ? -v : v;
};

function proFor(id: string | null) {
  const m = id ? proMachines().find((x) => x.id === id) : null;
  return m ? { pro: new ProPresenter(m.host, m.port), name: m.name } : null;
}

async function proTimerAct(uuid: string, a: ClockAction) {
  const p = proFor(stored.settings.pro.machineId);
  if (!p) return;
  const e = encodeURIComponent(uuid);
  const running = seen.get(uuid)?.running ?? false;
  try {
    if (a.type === "add") await p.pro.api("GET", `/v1/timer/${e}/increment/${Math.round(a.sec)}`);
    else {
      const op = a.type === "toggle" ? (running ? "stop" : "start") : a.type === "pause" ? "stop" : a.type;
      await p.pro.api("GET", `/v1/timer/${e}/${op}`);
    }
    await pollPro();
  } catch (err) { console.warn(`[clock] ProPresenter timer ${a.type}: ${(err as Error).message}`); }
}

/** A ProPresenter timer as a clock timer every screen can run on its own between looks. */
function fromPro(t: ProSeen | undefined, now: number): ClockTimerState {
  if (!t) return { ...build({ mode: "timeofday" }, now), label: "Time" };
  const base = { label: t.name || "ProPresenter", overtime: true, targetAt: null } as const;
  if (t.kind === "elapsed") {
    // Shown as whole seconds run: it ticked over to `sec` at `at`.
    const elapsedMs = t.sec * 1000 + 5;
    return t.running ? { ...base, mode: "countup", running: true, startedAt: t.at, elapsedMs, durationMs: 0 }
      : { ...base, mode: "countup", running: false, startedAt: null, elapsedMs, durationMs: 0 };
  }
  // Countdowns (to a length or a time): time left when it changed to `sec`.
  // Shown rounded up (4:59 means 4:58.x–4:59 left): just under `sec` when it ticked over at `at`.
  const leftMs = t.sec * 1000 - 5;
  const timer: ClockTimerState = leftMs >= 0
    ? { ...base, mode: "countdown", running: false, startedAt: null, elapsedMs: 0, durationMs: leftMs }
    : { ...base, mode: "countdown", running: false, startedAt: null, elapsedMs: -leftMs, durationMs: 0 };
  return t.running ? { ...timer, running: true, startedAt: t.at } : timer;
}

/** Same timer, same second and same running state: no need to send every screen an update. */
function sameShown(a: ClockTimerState | null, b: ClockTimerState | null, now: number) {
  if (!a || !b) return a === b;
  if (a.mode !== b.mode || a.label !== b.label || a.running !== b.running || Boolean(a.idle) !== Boolean(b.idle)) return false;
  if (a.mode === "timeofday") return true;
  const ms = (t: ClockTimerState) => (t.mode === "countup" ? 1 : -1) * (t.elapsedMs + (t.running && t.startedAt ? now - t.startedAt : 0)) + (t.mode === "countup" ? 0 : t.durationMs);
  return Math.abs(ms(a) - ms(b)) < 60;
}

/** Put the picked ProPresenter timers on the clock (only when following). */
function applyPro(now: number, force = false) {
  if (state.source !== "propresenter") return;
  const cfg = stored.settings.pro;
  const main = fromPro(pick.main ? seen.get(pick.main) : undefined, now);
  const aux = cfg.aux === "none" || !pick.aux ? null : fromPro(seen.get(pick.aux), now);
  if (!force && sameShown(state.main, main, now) && sameShown(state.secondary, aux, now)) return;
  state = { ...state, main, secondary: aux, presetId: null, presetName: proStatus.machineName ? `ProPresenter · ${proStatus.machineName}` : "ProPresenter" };
  if (!force) changed(false);
}

/** Look at ProPresenter's timers (twice a second while a computer is chosen). */
async function pollPro() {
  const cfg = stored.settings.pro;
  if (!cfg.machineId) {
    if (proStatus.machineName || proStatus.timers.length || proStatus.error) proStatus = blankProStatus();
    return;
  }
  if (proBusy) return;
  proBusy = true;
  const p = proFor(cfg.machineId);
  try {
    if (!p) { proStatus = { ...blankProStatus(), error: "That ProPresenter computer isn’t set up any more. Choose another." }; return; }
    const now = Date.now();
    if (now - kindsAt > 30_000) {
      const list = await p.pro.api<{ id: { uuid: string }; countdown?: unknown; count_down_to_time?: unknown; elapsed?: unknown }[]>("GET", "/v1/timers", undefined, 2500).catch(() => null);
      if (list) { kinds = new Map(list.map((c) => [c.id?.uuid, c.countdown ? "countdown" : c.count_down_to_time ? "count_down_to_time" : c.elapsed ? "elapsed" : "unknown"] as [string, ProKind])); kindsAt = now; }
    }
    const cur = (await p.pro.api<{ id: { uuid: string; name: string; index: number }; time: string; state: string }[]>("GET", "/v1/timers/current", undefined, 2500)) ?? [];
    const looked = Date.now();
    const before = lastLook && looked - lastLook < 3000 ? lastLook : looked - 500;
    lastLook = looked;
    const started: string[] = [];
    const timers: ClockProTimer[] = cur.filter((t) => t?.id?.uuid).map((t) => {
      const uuid = t.id.uuid, running = /running|overrunning/i.test(t.state ?? ""), sec = proSeconds(t.time ?? "0");
      const prev = seen.get(uuid);
      if (running && !prev?.running) started.push(uuid);
      const kind = kinds.get(uuid) ?? "unknown";
      let next: ProSeen;
      if (prev && prev.sec === sec && prev.running === running) next = { ...prev, name: t.id.name ?? "", kind };
      else {
        // It ticked between the last look and this one. One second on from the last tick? Narrow the window.
        let lo = before, hi = looked;
        if (prev?.running && running && Math.abs(sec - prev.sec) === 1) {
          const k = Math.round((hi - prev.hi) / 1000);
          const plo = prev.lo + k * 1000, phi = prev.hi + k * 1000;
          if (Math.max(lo, plo) <= Math.min(hi, phi)) { lo = Math.max(lo, plo); hi = Math.min(hi, phi); }
        }
        next = { uuid, name: t.id.name ?? "", kind, sec, running, lo, hi, at: (lo + hi) / 2 };
      }
      seen.set(uuid, next);
      return { uuid, name: t.id.name ?? "", kind, time: t.time ?? "", running };
    });
    for (const k of [...seen.keys()]) if (!timers.some((t) => t.uuid === k)) seen.delete(k);

    // Which ProPresenter timers go on the clock. "auto" takes a running one and keeps it, paused or not,
    // until another timer starts while it's stopped (or it's deleted).
    const running = timers.filter((t) => t.running).map((t) => t.uuid);
    const exists = (u: string | null): u is string => Boolean(u && seen.has(u));
    const keep = (u: string | null, other: string | null) => exists(u) && u !== other && (seen.get(u)!.running || !started.some((x) => x !== other && x !== u));
    const mainPick = cfg.main !== "auto" ? (exists(cfg.main) ? cfg.main : null)
      : keep(pick.main, null) ? pick.main : started.find((u) => u !== pick.aux) ?? running.find((u) => u !== pick.aux) ?? running[0] ?? (exists(pick.main) ? pick.main : null);
    const auxPick = cfg.aux === "none" ? null : cfg.aux !== "auto" ? (exists(cfg.aux) && cfg.aux !== mainPick ? cfg.aux : null)
      : keep(pick.aux, mainPick) ? pick.aux : started.find((u) => u !== mainPick) ?? running.find((u) => u !== mainPick) ?? null;
    pick = { main: mainPick, aux: auxPick };
    proStatus = { machineName: p.name, connected: true, error: null, timers, mainUuid: mainPick, auxUuid: auxPick };

    // Overridden by a saved timer: back to ProPresenter when one of its timers starts (if chosen).
    if (state.source !== "propresenter" && cfg.resumeOnStart && started.length && kindsAt) {
      state = { ...state, source: "propresenter", blank: false };
      applyPro(now, true);
      changed();
      return;
    }
    applyPro(now);
  } catch (e) {
    const msg = (e as Error).message;
    if (proStatus.error !== msg || proStatus.connected) proStatus = { ...proStatus, machineName: p?.name ?? null, connected: false, error: msg };
  } finally { proBusy = false; }
}

/* ───────────── The tick: ends, next presets, schedules ───────────── */

let lastMinute = "";
const fired = new Set<string>();

function tick() {
  const now = Date.now();
  const r = readClock(state.main, now);
  if (r.done && !mainEnded && state.main.running) {
    mainEnded = true;
    let touched = false;
    if (state.secondary?.startWhenMainEnds && !state.secondary.running) { state = { ...state, secondary: startTimer(state.secondary, now) }; touched = true; }
    const next = presetById(presetById(state.presetId)?.nextPresetId ?? null);
    if (next) { loadPreset(next, true); touched = true; }
    if (touched) changed();
  }
  // Schedules: "Sundays 8:55 → Walk-in".
  const d = new Date(now);
  const minute = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
  if (minute !== lastMinute) {
    lastMinute = minute;
    const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    for (const p of stored.presets) {
      const s = p.schedule;
      if (!s?.enabled || !s.days.includes(d.getDay())) continue;
      const [h, m] = s.time.split(":").map(Number);
      if (`${h}:${String(m).padStart(2, "0")}` !== hhmm) continue;
      const key = `${p.id}@${minute}`;
      if (fired.has(key)) continue;
      fired.add(key);
      loadPreset(p, true);
      changed();
      console.log(`[clock] schedule started “${p.name}”`);
    }
    if (fired.size > 500) fired.clear();
  }
}

let started = false;
export function startClock() {
  if (started) return;
  started = true;
  setInterval(tick, 200);
  setInterval(() => void refreshPco(), 3000);
  // Looks at ProPresenter about twice a second, a little irregularly, so the moments its timers tick
  // over get pinned down (looks at a fixed rhythm would always land at the same point in each second).
  const look = () => { void pollPro().finally(() => setTimeout(look, 380 + Math.random() * 240)); };
  look();
  onWeekendChange(() => void refreshPco(true));
  void refreshPco(true);
}

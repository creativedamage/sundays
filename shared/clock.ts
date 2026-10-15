/**
 * Production clock: shared types and the math every display uses.
 *
 * The server keeps the state with absolute times (when a timer started, how long it had run before
 * a pause, when "count to" lands). Every screen (control page, network clock, NDI, second display)
 * works out what to show from that and its own clock, corrected by the server's time, so they all
 * agree to the frame without sending a message every second.
 */

export type ClockMode =
  | "countdown"   // a length: 5:00 down to 0
  | "countup"     // a stopwatch
  | "totime"      // down to a time of day (9:00 AM)
  | "timeofday"   // just the time
  | "service"     // down to the next service time in Planning Center
  | "liveitem";   // time left on the current Planning Center Live item

export const CLOCK_MODES: { mode: ClockMode; label: string; hint: string }[] = [
  { mode: "countdown", label: "Countdown", hint: "A length, down to zero" },
  { mode: "countup", label: "Count up", hint: "A stopwatch" },
  { mode: "totime", label: "Count to a time", hint: "Down to a time of day" },
  { mode: "timeofday", label: "Time of day", hint: "The current time" },
  { mode: "service", label: "Until service", hint: "Down to the next service time in Planning Center" },
  { mode: "liveitem", label: "Live item", hint: "Time left on the current Planning Center Live item" },
];

/** A timer as saved in a preset. */
export interface ClockTimerSpec {
  mode: ClockMode;
  /** countdown: length in seconds. */
  durationSec?: number;
  /** totime: "HH:MM" (24-hour), the next time it comes around. */
  target?: string;
  /** service / liveitem: which service type (null = the next service of any type on your campus). */
  serviceTypeId?: string | null;
  /** Shown above the timer ("Walk-in", "Message"). Empty = the mode's own label. */
  label?: string;
  /** Keep counting past zero (shown as +0:12 in red). Off: stops at 0:00. */
  overtime?: boolean;
}

export interface ClockPreset {
  id: string;
  name: string;
  main: ClockTimerSpec;
  /** A second, smaller timer (e.g. time of day, or overtime once the main one ends). */
  secondary: (ClockTimerSpec & { startWhenMainEnds?: boolean }) | null;
  message: string;
  /** Turn yellow / red with this many seconds left (0 = never). */
  warnSec: number;
  dangerSec: number;
  /** Start the main timer as soon as the preset is loaded. */
  autoStart: boolean;
  /** When the main timer reaches zero, load (and start) this preset. */
  nextPresetId: string | null;
  /** Load and start automatically at a time on chosen days (0 = Sunday). */
  schedule: { enabled: boolean; days: number[]; time: string } | null;
  /** Accent for its button. */
  color: string;
  /** The Information box (top right): a big title and a smaller line under it. */
  info?: { title: string; subtitle: string };
  /** The main timer's color while it has time left (yellow/red take over near the end). */
  timerColor?: string;
}

export const TIMER_COLORS = [
  { color: "#FF1F1F", name: "Red" }, { color: "#FFFFFF", name: "White" }, { color: "#FFE81A", name: "Yellow" },
  { color: "#33E06B", name: "Green" }, { color: "#3DD6FF", name: "Cyan" }, { color: "#FF9F1A", name: "Orange" },
];
export const DEFAULT_TIMER_COLOR = "#FF1F1F";
export type MessagePosition = "bottom" | "top" | "full";

/** A timer as it's running. Absolute epoch milliseconds, so every screen can work it out. */
export interface ClockTimerState {
  mode: ClockMode;
  label: string;
  running: boolean;
  /** When it (re)started; null while paused/stopped. */
  startedAt: number | null;
  /** Run time banked before the last pause. */
  elapsedMs: number;
  /** countdown / liveitem: its length. */
  durationMs: number;
  /** totime / service: when it lands. */
  targetAt: number | null;
  overtime: boolean;
  /** A secondary that starts when the main one reaches zero. */
  startWhenMainEnds?: boolean;
  /** Nothing to count to (no upcoming service, Live not running). */
  idle?: string;
}

export interface ClockState {
  main: ClockTimerState;
  secondary: ClockTimerState | null;
  message: string;
  /** Where the message shows: across the bottom or top of the main timer, or covering it. */
  messagePosition: MessagePosition;
  /** The Information box. Empty title: the main timer's label; empty subtitle: the timer's name. */
  info: { title: string; subtitle: string; hidden: boolean };
  timerColor: string;
  /** Hide the timers (shows just the message, or black/transparent). */
  blank: boolean;
  presetId: string | null;
  presetName: string | null;
  /**
   * Where the timers come from: "propresenter" mirrors ProPresenter's running timers (main, and its
   * second one as the aux timer); "manual" is a saved timer or one set here. Loading a saved timer
   * always takes over from ProPresenter; Follow ProPresenter goes back. Older states: manual.
   */
  source?: "manual" | "propresenter";
  warnSec: number;
  dangerSec: number;
  /** The server's clock when this was sent (to correct each screen's clock). */
  serverNow: number;
  /** Bumped on every change. */
  version: number;
}

export interface ClockOutputSettings {
  ndi: { enabled: boolean; name: string; resolution: "720p" | "1080p"; fps: 25 | 30 | 50 | 60; transparent: boolean };
  /** Full-screen clock on another display of this Mac (display id), or off. */
  screen: { enabled: boolean; displayId: number | null };
  /** Show the clock on the church network (http://<this Mac>/clock) for TVs, iPads and stage displays. */
  lan: boolean;
  /** The bar across the top of the clock ("MASTER TIME"). Empty: no bar. */
  title: string;
  /** The small heading in the Information box. */
  infoHeading: string;
  /** With no second timer, show the time of day in the left box. */
  showTimeOfDay: boolean;
  /** Key in the network control links (Stream Deck / Companion). */
  controlKey: string;
  /** Following ProPresenter's timers. */
  pro: ClockProSettings;
}

/**
 * ProPresenter timers on the clock. With a computer chosen, the clock can follow its timers: the
 * main timer is the one picked ("auto" = the first one running) and the aux timer (the left box)
 * the second ("auto" = another one running, "none" = keep the time of day).
 */
export interface ClockProSettings {
  /** A ProPresenter computer from Preferences → Video (null = not following ProPresenter). */
  machineId: string | null;
  main: string;
  aux: string;
  /** While a saved timer has taken over: go back to ProPresenter as soon as one of its timers starts. */
  resumeOnStart: boolean;
}
export const DEFAULT_PRO_SETTINGS: ClockProSettings = { machineId: null, main: "auto", aux: "auto", resumeOnStart: false };

/** A ProPresenter timer as the clock page lists it. */
export interface ClockProTimer { uuid: string; name: string; kind: "countdown" | "count_down_to_time" | "elapsed" | "unknown"; time: string; running: boolean }
/** How following ProPresenter is going (shown on the clock page). */
export interface ClockProStatus {
  machineName: string | null;
  connected: boolean;
  error: string | null;
  timers: ClockProTimer[];
  /** The timers on the clock right now, while following. */
  mainUuid: string | null;
  auxUuid: string | null;
}

export interface ClockStatusView {
  ndi: { available: boolean; running: boolean; sourceName: string | null; connections: number; error?: string };
  displays: { id: number; label: string; primary: boolean }[];
}

export interface ClockView { state: ClockState; presets: ClockPreset[]; settings: ClockOutputSettings; status: ClockStatusView; urls: string[]; pro: ClockProStatus; proMachines: { id: string; name: string }[] }

/* ───────────── The math ───────────── */

export type ClockTone = "normal" | "warn" | "danger" | "over" | "idle";

export interface ClockReading {
  /** "4:59", "1:02:03", "+0:12", "9:41 AM" */
  text: string;
  /** Seconds left (down) or run (up); negative = past zero. */
  seconds: number;
  /** 0..1 used of the length (for a progress bar), or null. */
  progress: number | null;
  tone: ClockTone;
  /** Counting down and reached zero (for "start when main ends" / next preset). */
  done: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function hms(totalSec: number): string {
  const s = Math.abs(Math.trunc(totalSec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (d) return `${d}d ${h}:${pad(m)}:${pad(x)}`;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
export const timeOfDay = (ms: number, seconds = false) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

const runMs = (t: ClockTimerState, now: number) => t.elapsedMs + (t.running && t.startedAt ? now - t.startedAt : 0);

/** What a timer shows right now. */
export function readClock(t: ClockTimerState, now: number, warnSec = 0, dangerSec = 0): ClockReading {
  if (t.idle) return { text: "--:--", seconds: 0, progress: null, tone: "idle", done: false };
  if (t.mode === "timeofday") return { text: timeOfDay(now), seconds: 0, progress: null, tone: "normal", done: false };
  if (t.mode === "countup") {
    const s = Math.floor(runMs(t, now) / 1000);
    return { text: hms(s), seconds: s, progress: null, tone: "normal", done: false };
  }
  // Counting down: to a length (countdown, live item) or to a moment (to-time, service).
  let leftMs: number;
  let total: number | null = null;
  if (t.mode === "totime" || t.mode === "service") {
    if (t.targetAt == null) return { text: "--:--", seconds: 0, progress: null, tone: "idle", done: false };
    leftMs = t.targetAt - now;
  } else {
    leftMs = t.durationMs - runMs(t, now);
    total = t.durationMs;
  }
  // Round up so 4:59.2 shows 5:00 until a full second has gone (like every production clock).
  const sec = leftMs > 0 ? Math.ceil(leftMs / 1000) : -Math.floor(-leftMs / 1000);
  const done = leftMs <= 0;
  if (done && !t.overtime) return { text: "0:00", seconds: 0, progress: total ? 1 : null, tone: "danger", done };
  const tone: ClockTone = done ? "over" : dangerSec && sec <= dangerSec ? "danger" : warnSec && sec <= warnSec ? "warn" : "normal";
  return {
    text: done ? `+${hms(-sec)}` : hms(sec), seconds: sec,
    progress: total ? Math.min(1, Math.max(0, 1 - leftMs / total)) : null, tone, done,
  };
}

/** The next time "HH:MM" comes around (today if still ahead, else tomorrow). */
export function nextAt(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= now - 1000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const DEFAULT_LABEL: Record<ClockMode, string> = {
  countdown: "Countdown", countup: "Elapsed", totime: "Countdown", timeofday: "Time", service: "Service starts in", liveitem: "Live item",
};

export function newPreset(id: string, name = "New timer"): ClockPreset {
  return {
    id, name, main: { mode: "countdown", durationSec: 300, overtime: true, label: "" }, secondary: null, message: "",
    warnSec: 60, dangerSec: 15, autoStart: false, nextPresetId: null, schedule: null, color: "#60A5FA",
    info: { title: "", subtitle: "" }, timerColor: DEFAULT_TIMER_COLOR,
  };
}

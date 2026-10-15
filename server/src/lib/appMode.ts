/**
 * How this Mac uses Sundays (see AppMode in shared/types.ts).
 *
 * Service Mode is for a shared computer: Services, ProPresenter, Clock, Mic board and Parent paging.
 * Workflows, Check-Ins (Team check-ins) and the Dashboard are
 * closed, on the server as well as in the sidebar. A PIN (set when Service Mode is chosen) is needed
 * to leave Service Mode or to open Preferences; entering it unlocks everything for 15 minutes.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppMode, AppModeView } from "../../../shared/types.js";
import { extras, logEvent } from "./db.js";

interface Pin { salt: string; hash: string }
const hashPin = (pin: string, salt: string) => crypto.scryptSync(pin, salt, 32).toString("hex");

/** Sundays FOH is always an FOH companion (SUNDAYS_APP_MODE, set by the app). */
const FORCED = ((m) => (m === "full" || m === "service" || m === "companion" ? m : null))(process.env.SUNDAYS_APP_MODE);
/** The mode a Mac starts in when it has none yet (a Mac that was Sundays FOH: "companion"). */
const INITIAL = ((m) => (m === "full" || m === "service" || m === "companion" ? m : null))(process.env.SUNDAYS_INITIAL_APP_MODE);
export const appMode = (): AppMode | null => {
  if (FORCED) return FORCED;
  const m = extras.get<AppMode | null>("appMode", null);
  if (m === null && INITIAL) { extras.set("appMode", INITIAL); return INITIAL; }
  return m;
};
const pinStored = () => extras.get<Pin | null>("serviceModePin", null);

let unlockedUntil = 0;
let tries = { n: 0, until: 0 };

export function appModeView(): AppModeView {
  return { mode: appMode(), hasPin: Boolean(pinStored()), unlockedUntil: unlockedUntil > Date.now() ? new Date(unlockedUntil).toISOString() : null };
}

export class PinError extends Error { status = 403; }

/** Check the Service Mode PIN (5 wrong tries → wait a minute). */
function checkPin(pin: string | undefined) {
  const p = pinStored();
  if (!p) return; // no PIN set: nothing to check
  if (tries.until > Date.now()) throw new PinError(`Too many wrong PINs. Try again in ${Math.ceil((tries.until - Date.now()) / 1000)} seconds.`);
  if (!pin || !crypto.timingSafeEqual(Buffer.from(hashPin(pin, p.salt), "hex"), Buffer.from(p.hash, "hex"))) {
    tries.n++;
    if (tries.n >= 5) { tries = { n: 0, until: Date.now() + 60_000 }; }
    throw new PinError(pin ? "That PIN isn’t right." : "Enter the Service Mode PIN.");
  }
  tries = { n: 0, until: 0 };
}

export const serviceLocked = () => appMode() === "service" && unlockedUntil <= Date.now();

/**
 * Change the mode. Leaving Service Mode needs its PIN (unless it's unlocked). Choosing Service Mode
 * needs a PIN to be set (newPin), the first time or to change it.
 */
export function setAppMode(mode: AppMode | null, opts: { pin?: string; newPin?: string } = {}) {
  const cur = appMode();
  if (FORCED && mode !== FORCED) throw Object.assign(new Error("This app always works this way. Use the full Sundays app for the other modes."), { status: 400 });
  if (cur === "service" && mode !== "service" && serviceLocked()) checkPin(opts.pin);
  if (mode === "service") {
    if (opts.newPin) {
      if (!/^\d{4,8}$/.test(opts.newPin)) throw Object.assign(new Error("The PIN is 4 to 8 numbers."), { status: 400 });
      if (cur === "service" && pinStored() && serviceLocked()) checkPin(opts.pin); // changing it needs the old one
      const salt = crypto.randomBytes(16).toString("hex");
      extras.set("serviceModePin", { salt, hash: hashPin(opts.newPin, salt) } satisfies Pin);
    } else if (!pinStored()) {
      throw Object.assign(new Error("Choose a PIN for Service Mode."), { status: 400 });
    }
  }
  extras.set("appMode", mode);
  unlockedUntil = 0; // a new mode starts locked
  if (cur !== mode) logEvent(`app mode: ${cur ?? "none"} → ${mode ?? "none"}`);
  return appModeView();
}

/** Service Mode: the PIN unlocks Preferences and everything else for 15 minutes. */
export function unlockServiceMode(pin: string) {
  checkPin(pin);
  unlockedUntil = Date.now() + 15 * 60_000;
  return appModeView();
}
export function lockServiceMode() { unlockedUntil = 0; return appModeView(); }

/** API paths Service Mode closes: Workflows, Check-Ins, the Dashboard. */
const CLOSED = [
  /^\/api\/(workflows|workflow-requests)(\/|$)/,
  /^\/api\/services\/plans\/[^/]+\/[^/]+\/team-checkins(\/|$)/,
  /^\/api\/(dashboard|team-groups|team-phones|volunteer-checkin)(\/|$)/,
];
export function serviceModeGuard(req: Request, res: Response, next: NextFunction) {
  if (serviceLocked() && CLOSED.some((re) => re.test(req.originalUrl.split("?")[0]))) {
    return res.status(403).json({ error: "service_mode", message: "That isn’t available in Service Mode. Enter the PIN to unlock it." });
  }
  next();
}

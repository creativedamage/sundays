/**
 * /api/clock (signed in): run the production clock, edit presets and output settings.
 * /api/clock-out (no sign-in; also on the network listener): what the clock outputs show, a live
 * stream of changes, and simple control links for a Stream Deck / Bitfocus Companion, which need
 * the control key from Preferences.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ClockPreset, ClockView } from "../../../shared/clock.js";
import {
  clockAct, clockPresets, clockProMachines, clockProStatus, clockSettings, clockState, clockStatus, onClockChange, saveClockPresets, saveClockSettings, setClockOwner, type ClockAction,
} from "../lib/clock.js";
import { kioskAddresses } from "./paging.js";

const Mode = z.enum(["countdown", "countup", "totime", "timeofday", "service", "liveitem"]);
const Spec = z.object({
  mode: Mode, durationSec: z.number().int().min(0).max(24 * 3600 * 7).optional(), target: z.string().regex(/^\d{1,2}:\d{2}$/).optional().or(z.literal("")),
  serviceTypeId: z.string().max(40).nullable().optional(), label: z.string().max(60).optional(), overtime: z.boolean().optional(),
  startWhenMainEnds: z.boolean().optional(),
});
const Which = z.enum(["main", "secondary"]).optional();
const Action = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["start", "pause", "toggle", "reset"]), which: Which }),
  z.object({ type: z.literal("add"), sec: z.number().min(-86400).max(86400), which: Which }),
  z.object({ type: z.literal("set"), which: z.enum(["main", "secondary"]), spec: Spec.nullable(), start: z.boolean().optional() }),
  z.object({ type: z.literal("message"), text: z.string().max(200) }),
  z.object({ type: z.literal("blank"), on: z.boolean() }),
  z.object({ type: z.literal("load"), presetId: z.string().max(40), start: z.boolean().optional() }),
  z.object({ type: z.enum(["next", "prev"]) }),
  z.object({ type: z.literal("colors"), warnSec: z.number().int().min(0).max(36000), dangerSec: z.number().int().min(0).max(36000) }),
  z.object({ type: z.literal("info"), title: z.string().max(60).optional(), subtitle: z.string().max(80).optional(), hidden: z.boolean().optional() }),
  z.object({ type: z.literal("style"), timerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), messagePosition: z.enum(["bottom", "top", "full"]).optional() }),
  z.object({ type: z.literal("follow"), on: z.boolean() }),
]);
const Preset = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/), name: z.string().trim().min(1).max(60), main: Spec, secondary: Spec.nullable(), message: z.string().max(200),
  warnSec: z.number().int().min(0).max(36000), dangerSec: z.number().int().min(0).max(36000), autoStart: z.boolean(),
  nextPresetId: z.string().max(40).nullable(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  schedule: z.object({ enabled: z.boolean(), days: z.array(z.number().int().min(0).max(6)).max(7), time: z.string().regex(/^\d{1,2}:\d{2}$/) }).nullable(),
  info: z.object({ title: z.string().max(60), subtitle: z.string().max(80) }).optional(),
  timerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const addrs = () => {
  const a = kioskAddresses();
  return a.running ? a.urls.map((u) => `${u}/clock`) : [];
};

export const clockRouter = Router();
clockRouter.use((req: any, _res, next) => { if (req.user) setClockOwner({ userId: req.user.id, demo: Boolean(req.demo) }); next(); });
clockRouter.get("/", (_req, res) => {
  const v: ClockView = { state: clockState(), presets: clockPresets(), settings: clockSettings(), status: clockStatus(), urls: addrs(), pro: clockProStatus(), proMachines: clockProMachines() };
  res.json(v);
});
clockRouter.post("/action", (req, res) => {
  try { res.json(clockAct(Action.parse(req.body) as ClockAction)); }
  catch (e) {
    const status = (e as { status?: number }).status;
    if (status) return res.status(status).json({ error: "clock", message: (e as Error).message });
    throw e;
  }
});
clockRouter.put("/presets", (req, res) => res.json(saveClockPresets(z.array(Preset).max(200).parse(req.body) as ClockPreset[])));
clockRouter.put("/settings", (req, res) => {
  const p = z.object({
    ndi: z.object({ enabled: z.boolean(), name: z.string().trim().min(1).max(60), resolution: z.enum(["720p", "1080p"]), fps: z.union([z.literal(25), z.literal(30), z.literal(50), z.literal(60)]), transparent: z.boolean() }).partial(),
    screen: z.object({ enabled: z.boolean(), displayId: z.number().nullable() }).partial(),
    showTimeOfDay: z.boolean(), lan: z.boolean(), title: z.string().max(40), infoHeading: z.string().max(30),
    pro: z.object({ machineId: z.string().max(60).nullable(), main: z.string().max(80), aux: z.string().max(80), resumeOnStart: z.boolean() }).partial(),
  }).partial().parse(req.body);
  res.json(saveClockSettings(p as any));
});
clockRouter.post("/settings/new-key", (_req, res) => res.json(saveClockSettings({ controlKey: Math.random().toString(16).slice(2, 10) })));

/* ───────────── Outputs and control links (no sign-in) ───────────── */

export const clockOutRouter = Router();
const outView = () => {
  const s = clockSettings();
  return { state: clockState(), showTimeOfDay: s.showTimeOfDay, transparent: s.ndi.transparent, title: s.title, infoHeading: s.infoHeading };
};
clockOutRouter.get("/state", (_req, res) => res.set("Cache-Control", "no-store").json(outView()));

/** Server-sent events: the state on every change, and a heartbeat. */
clockOutRouter.get("/stream", (req: Request, res: Response) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const send = () => res.write(`data: ${JSON.stringify(outView())}\n\n`);
  send();
  const off = onClockChange(send);
  const beat = setInterval(() => res.write(`: ${Date.now()}\n\n`), 15_000);
  req.on("close", () => { off(); clearInterval(beat); });
});

/**
 * Stream Deck / Companion: GET or POST /api/clock-out/control/<key>/<action>[/<value>]
 * start · pause · toggle · reset · next · prev · blank · unblank · add/<seconds> · load/<preset name or number>
 * secondary-start · secondary-pause · secondary-toggle · secondary-reset · message/<text> · clear-message
 * info/<title> · subtitle/<text> · follow-pro (show ProPresenter's timers) · manual (stop following)
 */
clockOutRouter.all("/control/:key/:action/:value?", (req, res) => {
  if (req.params.key !== clockSettings().controlKey) return res.status(403).json({ error: "wrong_key", message: "That control key isn’t right. Copy the links again from Preferences → Clock." });
  const v = req.params.value ? decodeURIComponent(req.params.value) : "";
  const act = req.params.action.toLowerCase();
  let a: ClockAction | null = null;
  const sec = act.match(/^secondary-(start|pause|toggle|reset)$/);
  if (sec) a = { type: sec[1] as "start", which: "secondary" };
  else if (["start", "pause", "toggle", "reset", "next", "prev"].includes(act)) a = { type: act as "start" };
  else if (act === "blank" || act === "unblank") a = { type: "blank", on: act === "blank" };
  else if (act === "follow-pro" || act === "manual") a = { type: "follow", on: act === "follow-pro" };
  else if (act === "add") a = { type: "add", sec: Number(v) || 0 };
  else if (act === "message") a = { type: "message", text: v };
  else if (act === "clear-message") a = { type: "message", text: "" };
  else if (act === "info") a = { type: "info", title: v };
  else if (act === "subtitle") a = { type: "info", subtitle: v };
  else if (act === "load") {
    const list = clockPresets();
    const p = list.find((x) => x.name.toLowerCase() === v.toLowerCase()) ?? list[Number(v) - 1];
    if (!p) return res.status(404).json({ error: "not_found", message: `No timer called “${v}”.` });
    a = { type: "load", presetId: p.id, start: req.query.start === "0" ? false : true };
  }
  if (!a) return res.status(400).json({ error: "unknown_action" });
  let s;
  try { s = clockAct(a); } catch (e) { return res.status((e as { status?: number }).status ?? 500).json({ error: "clock", message: (e as Error).message }); }
  res.json({ ok: true, preset: s.presetName, running: s.main.running });
});

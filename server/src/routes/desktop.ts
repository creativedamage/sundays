/**
 * /api/desktop: things only the Mac apps can do. Each window asks its own app (lib/engine.ts):
 * Preferences in their own window, and which Sundays apps are on this Mac (the apps open each other themselves: sundays-open:// links).
 */
import { Router } from "express";
import { z } from "zod";
import { appFromUserAgent } from "../../../shared/apps.js";
import { appCall, appListing } from "../lib/engine.js";

export const desktopRouter = Router();
const appOf = (req: { get(h: string): string | undefined }) => appFromUserAgent(req.get("user-agent"));
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

desktopRouter.post("/preferences", h(async (req, res) => {
  const { section } = z.object({ section: z.string().regex(/^[a-z-]{1,30}$/).default("about") }).parse(req.body ?? {});
  const r = await appCall(appOf(req), "prefs.open", section);
  if (!r) return res.status(404).json({ error: "unavailable" });
  res.json({ ok: true });
}));

/** The Sundays apps: which are on this Mac, and which is asking. */
desktopRouter.get("/apps", (req, res) => res.json({ current: appOf(req), apps: appListing(appOf(req)) }));

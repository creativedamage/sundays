import { Router } from "express";
import { z } from "zod";
import { settings } from "../lib/db.js";
import { requireAuth } from "../auth/oauth.js";

export const settingsRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/** Public: the sign-in page needs the logo and theme before anyone signs in. */
settingsRouter.get("/", h(async (_req, res) => res.json(settings.get())));

const Start = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard") }),
  z.object({ kind: z.literal("propresenter") }),
  z.object({ kind: z.literal("paging") }),
  z.object({ kind: z.literal("next-runsheet"), serviceTypeId: z.string().nullable() }),
  z.object({ kind: z.literal("workflows") }),
  z.object({ kind: z.literal("workflow"), workflowId: z.string() }),
  z.object({ kind: z.literal("services") }),
  z.object({ kind: z.literal("next-service"), serviceTypeId: z.string().nullable() }),
  z.object({ kind: z.literal("next-checkins"), serviceTypeId: z.string().nullable() }),
]);
const Patch = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  // ~1.5 MB image max, PNG/JPG/SVG/WebP only
  logo: z.string().max(2_000_000).regex(/^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG, JPG, SVG or WebP image").nullable().optional(),
  startView: Start.optional(),
  serviceView: z.record(z.string().max(40), z.object({
    teams: z.array(z.string().max(40)).max(500),
    times: z.array(z.string().max(120)).max(200),
  })).optional(),
  waves: z.object({
    enabled: z.boolean(),
    output: z.string().max(200).nullable(),
    channel: z.number().int().min(1).max(16),
    snapshots: z.record(z.string().regex(/^([A-G][#b]?m?|CHROMATIC|OFF)$/), z.number().int().min(0).max(999).nullable()),
    hideFromTuning: z.array(z.string().trim().min(1).max(100)).max(30),
    numbering: z.enum(["externalId", "program"]),
  }).partial().optional(),
});

settingsRouter.put("/", requireAuth, h(async (req, res) => res.json(settings.save(Patch.parse(req.body)))));


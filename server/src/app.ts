/**
 * The Sundays server: API + (in the Mac app) the web UI, on one 127.0.0.1 address.
 */
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { config, pcoConfigured, usingPat } from "./config.js";
import { authRouter, requireAuth } from "./auth/oauth.js";
import { peopleRouter } from "./routes/people.js";
import { servicesRouter } from "./routes/services.js";
import { micsRouter } from "./routes/mics.js";
import { settingsRouter } from "./routes/settings.js";
import { pagingRouter } from "./routes/paging.js";
import { updatesRouter } from "./routes/updates.js";
import { desktopRouter } from "./routes/desktop.js";
import { engineRouter } from "./routes/engine.js";
import { registerLocalApp } from "./lib/engine.js";
import { proRouter } from "./routes/pro.js";
import { smaartRouter, startSmaart } from "./routes/smaart.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { consoleRouter } from "./routes/console.js";
import { campusesRouter } from "./routes/campuses.js";
import { teamGroupsRouter } from "./routes/teamGroups.js";
import { teamPhonesRouter } from "./routes/teamPhones.js";
import { volunteerCheckInRouter } from "./routes/volunteerCheckIn.js";
import { clockOutRouter, clockRouter } from "./routes/clock.js";
import { boardOutRouter, boardRouter } from "./routes/board.js";
import { startClock } from "./lib/clock.js";
import { appModeRouter, companionClientRouter } from "./routes/companionClient.js";
import { setAttentionBridge, setCompanionWindowBridge, startCompanion } from "./lib/companion.js";
import { serviceModeGuard } from "./lib/appMode.js";
import { wavesRelayRouter } from "./routes/wavesRelay.js";
import { resiRouter } from "./routes/resi.js";
import { weekendRouter } from "./routes/weekend.js";
import { syncRouter } from "./routes/sync.js";
import { cloudRouter } from "./routes/cloud.js";
import { startSync } from "./lib/sync.js";
import { startResi } from "./lib/resi.js";
import { initKiosk, kioskRouter } from "./kiosk.js";
import { PcoError, SignedOutError } from "./pco/client.js";
import { flush, settings } from "./lib/db.js";

export function createApp(webDir?: string) {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false })); // UI is our own static files; PCO avatars load from their CDN
  app.use(cookieParser());
  app.use(express.json({ limit: "25mb" })); // logos and pictures

  app.get("/api/health", (_req, res) => res.json({ ok: true, version: process.env.APP_VERSION ?? "dev" }));
  app.use("/api/auth", authRouter);
  app.use("/api/engine", engineRouter); // the other Sundays apps on this Mac using this server
  app.use(serviceModeGuard); // Service Mode: Workflows, Check-Ins, Dashboard and Chat are closed
  app.use("/api/board-out", boardOutRouter); // the stage display (mic board / clock)
  app.use("/api/clock-out", clockOutRouter); // clock outputs (NDI window, second display) and control links
  app.use("/api/settings", settingsRouter);
  app.use("/api/services", requireAuth, servicesRouter);
  app.use("/api/mics", requireAuth, micsRouter);
  app.use("/api/paging", requireAuth, pagingRouter);
  app.use("/api/updates", requireAuth, updatesRouter);
  app.use("/api/desktop", requireAuth, desktopRouter);
  app.use("/api/pro", requireAuth, proRouter);
  app.use("/api/smaart", requireAuth, smaartRouter);
  app.use("/api/dashboard", requireAuth, dashboardRouter);
  app.use("/api/console", requireAuth, consoleRouter);
  app.use("/api/campuses", requireAuth, campusesRouter);
  app.use("/api/team-groups", requireAuth, teamGroupsRouter);
  app.use("/api/team-phones", requireAuth, teamPhonesRouter);
  app.use("/api/volunteer-checkin", requireAuth, volunteerCheckInRouter);
  app.use("/api/clock", requireAuth, clockRouter);
  app.use("/api/board", requireAuth, boardRouter);
  app.use("/api/cloud", requireAuth, cloudRouter); // Sundays | Operations (Supabase)
  app.use("/api/sync", requireAuth, syncRouter); // settings sync across your Macs
  app.use("/api/weekend", requireAuth, weekendRouter); // the weekend everything works on
  app.use("/api/resi", requireAuth, resiRouter); // Resi live status (read-only)
  app.use("/api/waves", requireAuth, wavesRelayRouter); // Tuning keys from FOH companions, sent to Waves from this Mac
  app.use("/api/kiosk", kioskRouter); // the iPad page, also previewable inside the app
  app.use("/api/app-mode", appModeRouter); // Full Mode, Service Mode or FOH Companion (this Mac only)
  app.use("/api/companion-client", companionClientRouter);
  app.use("/api", requireAuth, peopleRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  // The exported web UI (Mac app). /workflows → workflows.html, etc.
  if (webDir && fs.existsSync(webDir)) {
    // Pages: /workflows → workflows.html (checked first, since a same-named folder also exists).
    const root = path.resolve(webDir);
    app.get(/^\/[^.]*$/, (req, res, next) => {
      const page = req.path === "/" ? "index" : req.path.replace(/^\/+|\/+$/g, "");
      const file = path.resolve(root, `${page}.html`);
      // Pages must never come from the window's cache, or an update wouldn't show until much later.
      if (file.startsWith(root + path.sep) && fs.existsSync(file)) return res.set("Cache-Control", "no-cache").sendFile(file);
      next();
    });
    app.use(express.static(webDir, {
      redirect: false,
      setHeaders: (res, file) =>
        res.setHeader("Cache-Control", file.includes(`${path.sep}_next${path.sep}static${path.sep}`)
          ? "public, max-age=31536000, immutable" // file names change with every build
          : "no-cache"),
    }));
    app.use((_req, res) => res.status(404).sendFile(path.join(webDir, "404.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "invalid_request", issues: err.issues });
    if (err instanceof SignedOutError) return res.status(401).json({ error: "reauth_required", message: err.message });
    if (err instanceof PcoError) {
      console.error(err.message);
      // Not allowed to use one Planning Center product: say so (a 401 would send you to sign in).
      if (err.productDenied) return res.status(403).json({ error: "no_access", message: `Your Planning Center sign-in can’t use this part of Planning Center. ${err.message}` });
      if (err.status === 403) return res.status(403).json({ error: "forbidden", message: `Planning Center didn’t allow that for your account. ${err.message}` });
      return res.status(err.status === 401 ? 401 : 502).json({ error: err.status === 401 ? "reauth_required" : "pco_error", message: err.message });
    }
    const st = (err as { status?: number })?.status;
    if (typeof st === "number" && st >= 400 && st < 500) return res.status(st).json({ error: st === 403 ? "forbidden" : "request_failed", message: (err as Error).message });
    console.error(err);
    res.status(500).json({ error: "server_error", message: (err as Error)?.message });
  });
  return app;
}

/** Start listening on 127.0.0.1 only — nothing on the network can reach it. */
export function startServer(opts: { port: number; webDir?: string }): Promise<Server> {
  const app = createApp(opts.webDir);
  return new Promise((resolve, reject) => {
    const server = app.listen(opts.port, "127.0.0.1", () => {
      console.log(`Sundays on http://127.0.0.1:${opts.port}`);
      console.log(pcoConfigured()
        ? `  Planning Center sign-in on (client ${config.pco.clientId.slice(0, 6)}…) · return address ${config.pco.redirectUri}`
        : "  Planning Center sign-in OFF — add the Client ID in server/src/pco/registration.ts");
      console.log(usingPat() ? "  Data: shared Personal Access Token" : "  Data: each person's own sign-in");
      initKiosk(opts.webDir);
      startCompanion(); // if this Mac is an FOH companion, start watching the main computer
      startResi(); // Resi live status, if it's set up
      startSmaart();
      startClock();
      startSync(); // settings from/to your other Macs
      resolve(server);
    });
    server.on("error", reject);
  });
}

process.on("exit", flush);


/** Used by the Mac app: its updater, Chat and Preferences (registerLocalApp), and the FOH companion's windows. */
export { registerLocalApp, setAttentionBridge, setCompanionWindowBridge };
/** The Mac app's NDI sender and second-display window read clock output settings here. */
export { clockOutputs } from "./lib/clock.js";
/** …and the stage display's second-display window. */
export { boardOutputs } from "./lib/board.js";

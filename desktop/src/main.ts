/**
 * The Sundays Mac apps (one shell for all of them; which one it is comes from package.json →
 * sundaysApp, set when each app is packaged: see shared/apps.ts and desktop/dist.mjs).
 *
 * Sundays runs the Sundays server on 127.0.0.1 (never reachable from the network). Before 1.33,
 * Services, Workflows and Paging were separate apps sharing that data folder and server (the first
 * one open hosted it, the others were guests); the host/guest machinery stays for older copies. Signing in to Planning Center happens on Planning Center's own page, which
 * returns to 127.0.0.1.
 *
 * The FOH companion is a mode of Sundays (Sundays FOH, retired in 1.33, had its own data; see
 * adoptFoh). Operations and AVL show Sundays' cloud screens (the website's) from inside the app,
 * on their own sundays-app:// address. Retired apps' last version only says goodbye (farewell).
 */
import { startClockOutputs } from "./clockOut";
import { startBoardOutput } from "./boardOut";
import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, safeStorage, screen, session, shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createUpdater } from "./updater";
import { ACTIVE_APP_IDS, APPS, type AppId } from "../../shared/apps";
import { WEBSITE_URL } from "../../shared/cloud";

// Must match server/src/pco/registration.ts (and the redirect URIs registered with Planning Center).
const PORTS = [47123, 47124, 47125];

/* ───────────── Which app this is ───────────── */

function productId(): AppId {
  const env = process.env.SUNDAYS_APP; // developing: SUNDAYS_APP=services npm run app
  if (env && env in APPS) return env as AppId;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    if (typeof pkg.sundaysApp === "string" && pkg.sundaysApp in APPS) return pkg.sundaysApp as AppId;
  } catch { /* the full app */ }
  return "sundays";
}
const APP_ID = productId();
const DEF = APPS[APP_ID];
app.setName(DEF.name);
// Every window says which app it is, so the screens and the server know who's asking.
app.userAgentFallback = `${app.userAgentFallback} SundaysApp/${APP_ID}`;

/* ───────────── Folders ───────────── */

const appData = app.getPath("appData");
// Cool Services was renamed Sundays in 1.24. Its data folder (sign-ins, settings, notes)
// comes along: ~/Library/Application Support/Cool Services → …/Sundays, the first time.
function sundaysDir(): string {
  const before = path.join(appData, "Cool Services");
  const now = path.join(appData, "Sundays");
  try {
    if (fs.existsSync(before) && !fs.existsSync(now)) fs.renameSync(before, now);
  } catch {
    return before; // couldn't move it: keep using it where it is
  }
  adoptFoh(now);
  return now;
}

/**
 * Sundays FOH was folded into Sundays in 1.33 (FOH Companion mode). On a Mac that only ever ran
 * Sundays FOH, the first Sundays launch takes over its data, so it's still the FOH companion,
 * still linked to the main computer, with its mic strip settings.
 */
const FOH_DIR = path.join(appData, "Sundays FOH");
const FOH_MOVED = "foh-moved";
function adoptFoh(dir: string) {
  if (APP_ID !== "sundays" || fs.existsSync(dir) || !fs.existsSync(FOH_DIR)) return;
  try {
    fs.cpSync(FOH_DIR, dir, { recursive: true, filter: (src) => !/Singleton(Lock|Socket|Cookie)$/.test(src) });
    fs.writeFileSync(path.join(dir, FOH_MOVED), new Date().toISOString());
  } catch { /* couldn't copy it: Sundays starts fresh, and FOH Companion can be chosen in Preferences */ }
}
/** Where the server keeps its data: shared by the engine apps; Sundays FOH has its own. */
const ENGINE_DIR = DEF.kind === "companion" ? path.join(appData, DEF.name) : sundaysDir();
/** This app's own browser storage (each app has its own; the full app keeps the one it had). */
const PROFILE_DIR = APP_ID === "sundays" || DEF.kind === "companion" ? ENGINE_DIR : path.join(sundaysDir(), "Apps", APP_ID);
app.setPath("userData", PROFILE_DIR);

/**
 * The app itself: an update from Cool Services lands as "Cool Services.app"; rename it Sundays.app
 * (once, in place) and start again from there, before any window or helper is open.
 */
function renameBundle(): boolean {
  if (APP_ID !== "sundays" || !app.isPackaged || process.platform !== "darwin") return false;
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  if (path.basename(bundle) !== "Cool Services.app") return false;
  const target = path.join(path.dirname(bundle), "Sundays.app");
  try {
    if (fs.existsSync(target)) return false;
    fs.renameSync(bundle, target);
    app.relaunch({ execPath: path.join(target, "Contents", "MacOS", path.basename(process.execPath)) });
    app.exit(0);
    return true;
  } catch {
    return false; // not allowed to rename it (another account's Applications folder): it still works
  }
}

// Never use the macOS Keychain (it asked for the password after every update of the ad hoc-signed
// app). Chromium's own storage then uses a built-in key instead of a Keychain item. The one
// exception is the full app's first launch after updating from a version that kept the sign-in key
// in the Keychain: that launch reads it once and moves it to a file (encryptionKey below).
const KEY_FILE = "key.txt";
const OLD_KEY_FILE = "key.bin";
{
  const migrating = APP_ID === "sundays" && fs.existsSync(path.join(ENGINE_DIR, OLD_KEY_FILE)) && !fs.existsSync(path.join(ENGINE_DIR, KEY_FILE));
  if (!migrating) app.commandLine.appendSwitch("use-mock-keychain");
}
nativeTheme.themeSource = "system"; // the page picks dark/light from Settings; "System" follows the Mac

// Operations and AVL: their screens come from inside the app (sundays-app://local/…).
const SCHEME = "sundays-app";
if (DEF.kind === "cloud") {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
}

/* ───────────── Start ───────────── */

let win: BrowserWindow | null = null;
let origin = "";
let updater: ReturnType<typeof createUpdater> | null = null;
/** host: runs the server; guest: uses another Sundays app's. */
let role: "host" | "guest" | "cloud" | "none" = "none";
let key = "";

/** A page to open at (another Sundays app sent us here: --sundays-path=/services/…). */
const pathArg = (argv: string[]) => {
  const v = argv.find((x) => x.startsWith("--sundays-path="))?.slice("--sundays-path=".length);
  return v && /^\/(?!\/)/.test(v) ? v : null;
};
let startPath = pathArg(process.argv);

if (renameBundle()) {
  // starting again as Sundays.app
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const p = pathArg(argv);
    if (p && origin) void go(p);
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(boot).catch((e) => fatal(String(e?.stack ?? e)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

/**
 * Key that encrypts saved Planning Center sign-ins: a file only this Mac user can read
 * (~/Library/Application Support/Sundays/key.txt). Every engine app reads the same one, which is
 * also how they recognise each other's server.
 *
 * It used to be kept in the macOS Keychain, but the app is signed ad hoc, so every update looks like
 * a different app to the Keychain and macOS asked for the password again. The first launch of
 * this version reads the old Keychain key one last time (key.bin) and moves it to the file, so
 * nobody has to sign in again; after that the app never touches the Keychain (see above).
 */
function encryptionKey(dir: string): string {
  const file = path.join(dir, KEY_FILE);
  try {
    const k = fs.readFileSync(file, "utf8").trim();
    if (k) return k;
  } catch { /* first time */ }
  let k = "";
  const old = path.join(dir, OLD_KEY_FILE);
  if (APP_ID === "sundays" && fs.existsSync(old)) {
    try {
      const raw = fs.readFileSync(old);
      k = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
    } catch { k = ""; } // couldn't read it: a new key (sign in to Planning Center again)
  }
  k ||= crypto.randomBytes(32).toString("base64");
  fs.mkdirSync(dir, { recursive: true });
  // Two apps starting at once: whoever writes first wins, and both use that.
  try { fs.writeFileSync(file, k, { mode: 0o600, flag: "wx" }); } catch { return fs.readFileSync(file, "utf8").trim() || k; }
  fs.rmSync(old, { force: true });
  return k;
}
/** What a guest shows the host (server/src/lib/engine.ts → engineToken). */
const engineToken = () => crypto.createHash("sha256").update(`sundays-engine:${key}`).digest("hex");
const engineHeaders = () => ({ "X-Sundays-Engine": engineToken(), "Content-Type": "application/json" });

function fatal(message: string) {
  dialog.showErrorBox(`${DEF.name} couldn’t start`, message);
  app.quit();
}

/**
 * A retired app's last version (Services, Workflows, Paging, FOH; shared/apps.ts): it says it's now
 * part of Sundays, opens Sundays at the same place (or its download), and can put itself in the Trash.
 */
async function farewell() {
  const full = bundleOf("sundays");
  const foh = APP_ID === "foh";
  const fresh = !fs.existsSync(path.join(appData, "Sundays")) && !fs.existsSync(path.join(appData, "Cool Services"));
  const r = await dialog.showMessageBox({
    type: "info",
    message: `${DEF.name} is now part of Sundays`,
    detail: (foh
      ? fresh
        ? "The FOH companion is a mode in the Sundays app now: the mic strip, Tuning keys and page requests work the same. Open Sundays on this Mac and it carries on as the FOH companion, still linked to your main computer."
        : "The FOH companion is a mode in the Sundays app now. In Sundays, choose Preferences → Mode → FOH Companion, then link it to your main computer again."
      : `Everything in ${DEF.short} is in the Sundays app, with the same sign-in and settings.`)
      + (full ? "" : "\n\nSundays isn’t on this Mac yet: download it, drag it to Applications and open it."),
    buttons: [full ? "Open Sundays" : "Download Sundays", "Quit"],
    defaultId: 0, cancelId: 1,
    ...(app.isPackaged ? { checkboxLabel: `Move ${DEF.name} to the Trash`, checkboxChecked: true } : {}),
  });
  if (r.response === 0) {
    const page = foh ? "/companion" : DEF.home;
    if (full) spawn("/usr/bin/open", ["-n", "-a", full, "--args", `--sundays-path=${page}`], { detached: true, stdio: "ignore" }).on("error", () => undefined).unref();
    else { const repo = updateRepo(); void shell.openExternal(repo ? `https://github.com/${repo}/releases/latest` : WEBSITE_URL); }
    if (r.checkboxChecked && app.isPackaged) await shell.trashItem(path.resolve(process.execPath, "..", "..", "..")).catch(() => undefined);
  }
  app.quit();
}

async function boot() {
  if (DEF.retired) return farewell();
  // Start from a clean page cache so an updated app always shows its new screens.
  await session.defaultSession.clearCache();
  // Our own pages may use anything they ask for (MIDI for Waves SuperRack, clipboard…);
  // other sites (Planning Center's sign-in) get no extra permissions.
  const ours = (url?: string) => { try { return new URL(url ?? "").origin === origin; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb, details) => cb(ours(details.requestingUrl ?? wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, requestingOrigin) => ours(requestingOrigin));

  // Check for Updates (GitHub Releases). Only the packaged app can replace itself.
  updater = createUpdater({
    currentVersion: app.getVersion(),
    appId: DEF.bundleId, appName: DEF.name, artifact: DEF.artifact,
    repo: process.env.COOL_UPDATE_REPO || updateRepo(),
    apiBase: process.env.COOL_UPDATE_API, // tests only
    appBundle: app.isPackaged ? path.resolve(process.execPath, "..", "..", "..") : "",
    quit: () => app.quit(),
    log: (m) => console.log(`[updates] ${m}`),
  });
  updater.start();
  buildMenu(updater);

  if (DEF.kind === "cloud") bootCloud();
  else {
    key = encryptionKey(ENGINE_DIR);
    const ok = await connect();
    if (!ok) return;
  }
  await createWindow();
}

/* ───────────── One server for every Sundays app ───────────── */

/** Another Sundays app's server on this Mac (same Mac user: it knows our key). */
async function findHost(): Promise<string | null> {
  for (const p of PORTS) {
    const o = `http://127.0.0.1:${p}`;
    try {
      const r = await fetch(`${o}/api/engine/hello`, { headers: engineHeaders(), signal: AbortSignal.timeout(1200) });
      if (r.ok) return o;
    } catch { /* nothing there */ }
  }
  return null;
}

/** engine.lock: only one app starts the server at a time (two opened at once would both try). */
const LOCK = () => path.join(ENGINE_DIR, "engine.lock");
let lockHeld = false;
function pidAlive(pid: number) { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } }
function takeLock(): boolean {
  for (let i = 0; i < 2; i++) {
    try {
      fs.mkdirSync(ENGINE_DIR, { recursive: true });
      fs.writeFileSync(LOCK(), JSON.stringify({ pid: process.pid, app: APP_ID }), { flag: "wx" });
      lockHeld = true;
      return true;
    } catch {
      try {
        const { pid } = JSON.parse(fs.readFileSync(LOCK(), "utf8"));
        if (pid === process.pid) { lockHeld = true; return true; }
        if (typeof pid === "number" && pidAlive(pid)) return false;
      } catch { /* unreadable: stale */ }
      fs.rmSync(LOCK(), { force: true }); // left by an app that quit unexpectedly
    }
  }
  return false;
}
function releaseLock() {
  if (!lockHeld) return;
  try { if (JSON.parse(fs.readFileSync(LOCK(), "utf8")).pid === process.pid) fs.rmSync(LOCK(), { force: true }); } catch { /* gone */ }
  lockHeld = false;
}

/** Use the server another Sundays app runs, or start it here. */
async function connect(): Promise<boolean> {
  if (DEF.kind === "companion") return hostEngine(); // Sundays FOH: always its own
  for (let i = 0; i < 40; i++) {
    const h = await findHost();
    if (h) { origin = h; role = "guest"; void guestLoop(); return true; }
    if (takeLock()) return hostEngine();
    await sleep(500); // another app is starting it: wait for it to answer
  }
  fatal("Another Sundays app is starting and didn’t finish. Quit the Sundays apps and open this one again.");
  return false;
}

let serverMod: typeof import("../../server/src/app") | null = null;
async function hostEngine(): Promise<boolean> {
  let port: number | undefined;
  for (const p of PORTS) if (await portFree(p)) { port = p; break; }
  if (!port) { fatal(`Ports ${PORTS.join(", ")} are all in use. Quit other copies of Sundays and try again.`); return false; }

  origin = `http://127.0.0.1:${port}`;
  // The server reads its settings from the environment when it loads, so set them first.
  process.env.APP_URL = origin;
  process.env.DATA_DIR = ENGINE_DIR;
  process.env.TOKEN_ENCRYPTION_KEY = key;
  process.env.NODE_ENV = "production";
  process.env.APP_VERSION = app.getVersion();
  if (DEF.kind === "companion") process.env.SUNDAYS_APP_MODE = "companion";
  // Taken over from Sundays FOH (adoptFoh): start as the FOH companion.
  const fohMoved = path.join(ENGINE_DIR, FOH_MOVED);
  if (fs.existsSync(fohMoved)) { process.env.SUNDAYS_INITIAL_APP_MODE = "companion"; fs.rmSync(fohMoved, { force: true }); }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const srv = (serverMod ??= require("./server.cjs") as typeof import("../../server/src/app"));
  // Let go of engine.lock only after the server has saved its data on the way out (its own exit
  // handler, registered when it loaded), so a guest taking over reads everything.
  process.once("exit", releaseLock);
  await srv.startServer({ port, webDir: path.join(__dirname, "web") });
  role = "host";
  // This app's updater and Preferences; guests' windows reach theirs through the server.
  srv.registerLocalApp(APP_ID, { updates: updater!, prefs: (section) => openPreferences(section) });
  // Production clock: NDI output and the second-display window.
  startClockOutputs(origin, srv.clockOutputs);
  // Stage display (mic board / clock) on a second display.
  startBoardOutput(origin, srv.boardOutputs);
  // FOH companion: a page request takes over the screen until someone answers it.
  srv.setAttentionBridge((on) => attention(on));
  // FOH companion: the mic strip along the bottom of the screen between page requests.
  srv.setCompanionWindowBridge({ strip: (s) => { stripCfg = s; layoutStrip(); }, open: (view) => openCompanion(view) });
  return true;
}

/** A guest answers what the server asks of this app (Check for Updates, Preferences). */
async function guestLoop() {
  while (role === "guest" && !quitting) {
    try {
      const r = await fetch(`${origin}/api/engine/calls?app=${APP_ID}&v=${encodeURIComponent(app.getVersion())}`, { headers: engineHeaders(), signal: AbortSignal.timeout(35_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { calls } = (await r.json()) as { calls: { id: string; method: string; args: unknown }[] };
      for (const c of calls) void answer(c);
    } catch {
      if (quitting) return;
      // Still there (a slow moment)? Keep going. Gone: take over.
      if (await findHost() === origin) { await sleep(1000); continue; }
      await takeOver();
      return;
    }
  }
}
async function answer(c: { id: string; method: string; args: unknown }) {
  const reply = (body: object) => fetch(`${origin}/api/engine/results?app=${APP_ID}`, { method: "POST", headers: engineHeaders(), body: JSON.stringify({ id: c.id, ...body }) }).catch(() => undefined);
  try {
    let value: unknown;
    if (c.method === "updates.status") value = updater!.status();
    else if (c.method === "updates.check") value = await updater!.check();
    else if (c.method === "updates.install") value = await updater!.install();
    else if (c.method === "prefs.open") { openPreferences(String(c.args ?? "")); value = { ok: true }; }
    else throw new Error("unknown");
    await reply({ ok: true, value });
  } catch (e) {
    await reply({ ok: false, error: (e as Error).message });
  }
}

/** The app that hosted the server quit: use whoever hosts it now, or host it here. */
async function takeOver() {
  const page = currentPage();
  role = "none";
  prefsWin?.close();
  if (!(await connect())) return;
  if (win) void win.loadURL(await enterUrl(page));
}
const currentPage = () => {
  try { const u = new URL(win?.webContents.getURL() ?? ""); return u.origin === origin ? `${u.pathname}${u.search}` : DEF.home; } catch { return DEF.home; }
};

/**
 * The address a window opens: signed in as whoever signed in last in any Sundays app (a one-time
 * ticket), at a page. Not signed in yet: the sign-in page, which comes back to the page.
 */
async function enterUrl(page: string): Promise<string> {
  if (role === "cloud") return `${origin}${page}`;
  try {
    const r = await fetch(`${origin}/api/engine/ticket`, { method: "POST", headers: engineHeaders(), signal: AbortSignal.timeout(5000) });
    const { ticket } = (await r.json()) as { ticket: string };
    return `${origin}/api/engine/enter?t=${encodeURIComponent(ticket)}&next=${encodeURIComponent(page)}`;
  } catch {
    return `${origin}/`;
  }
}

/** Go to a page in the main window. */
async function go(page: string) {
  if (!win && origin) { startPath = page; return void createWindow(); }
  if (win) void win.loadURL(`${origin}${page}`);
}

/* ───────────── Operations and AVL ───────────── */

/** The website's screens, built into the app (desktop/app/site), on sundays-app://local. */
function bootCloud() {
  const root = path.join(__dirname, "site");
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".webmanifest": "application/manifest+json",
  };
  protocol.handle(SCHEME, (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const clean = p.replace(/\/+$/, "") || "/index";
    const candidates = [path.join(root, `${clean}.html`), path.join(root, p), path.join(root, clean, "index.html")];
    const file = candidates.find((f) => f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) ?? path.join(root, "404.html");
    const body = fs.readFileSync(file);
    return new Response(body, { status: file.endsWith("404.html") && !p.endsWith("404.html") ? 404 : 200, headers: { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" } });
  });
  origin = `${SCHEME}://local`;
  role = "cloud";
}

/* ───────────── The other Sundays apps ───────────── */

function bundleOf(id: AppId): string | null {
  if (process.platform !== "darwin") return null;
  for (const dir of ["/Applications", path.join(os.homedir(), "Applications")]) {
    const p = path.join(dir, `${APPS[id].name}.app`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
/**
 * sundays-open://<app>/<page>: open another Sundays app at a page. Not on this Mac: Operations and
 * AVL open on the website; the others open in the full Sundays app if it's here, else the download.
 */
function openSibling(url: string) {
  let id: string, page: string;
  try { const u = new URL(url); id = u.hostname; page = `${u.pathname || "/"}${u.search}`; } catch { return; }
  if (!(id in APPS)) return;
  let target = id as AppId;
  if (!/^\/(?!\/)/.test(page)) page = APPS[target].home;
  if (APPS[target].retired) target = "sundays"; // folded into Sundays
  if (target === APP_ID) return void go(page);
  const launch = (bundle: string) => {
    const child = spawn("/usr/bin/open", ["-n", "-a", bundle, "--args", `--sundays-path=${page}`], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  };
  const b = bundleOf(target);
  if (b) return launch(b);
  if (APPS[target].kind === "cloud") return void shell.openExternal(`${WEBSITE_URL}${page}`);
  const full = bundleOf("sundays");
  if (full) return launch(full);
  const repo = updateRepo();
  void shell.openExternal(repo ? `https://github.com/${repo}/releases/latest` : WEBSITE_URL);
}

/** "owner/repo" from package.json → sundays.updateRepo (set with `npm run set-repo`). */
function updateRepo(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    const r = String(pkg.sundays?.updateRepo ?? "");
    return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith("YOUR-") ? r : null;
  } catch {
    return null;
  }
}

type Updater = ReturnType<typeof createUpdater>;

/** Show a page of the app (e.g. Settings → Updates). */
function show(page: string) {
  if (!win && origin) void createWindow();
  if (win) { void win.loadURL(`${origin}${page}`); win.show(); win.focus(); }
}

async function checkFromMenu(u: Updater) {
  const st = await u.check();
  const parent = win ?? undefined;
  if (st.state === "up-to-date") {
    await dialog.showMessageBox(parent!, { type: "info", message: "You’re up to date", detail: `${DEF.name} ${st.current} is the newest version.` });
  } else if (st.state === "available" && st.latest) {
    const notes = st.latest.notes.length > 600 ? `${st.latest.notes.slice(0, 600)}…` : st.latest.notes;
    const r = await dialog.showMessageBox(parent!, {
      type: "info",
      message: `${DEF.name} ${st.latest.version} is available`,
      detail: `You have ${st.current}.${notes ? `\n\n${notes}` : ""}\n\nUpdating downloads it, restarts ${DEF.name} and keeps all your settings.`,
      buttons: ["Update Now", "Later", "What’s New"],
      defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) {
      if (st.installProblem) return void dialog.showMessageBox(parent!, { type: "warning", message: "Can’t update here", detail: st.installProblem });
      if (role !== "cloud") openPreferences("updates");
      void u.install();
    } else if (r.response === 2) {
      void shell.openExternal(st.latest.url);
    }
  } else if (st.state === "error" || st.state === "unavailable") {
    await dialog.showMessageBox(parent!, { type: "warning", message: "Couldn’t check for updates", detail: st.error ?? "Try again later." });
  }
}

function buildMenu(u: Updater) {
  const others = ACTIVE_APP_IDS.filter((id) => id !== APP_ID && id !== "sundays");
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => void checkFromMenu(u) },
        { type: "separator" },
        ...(DEF.kind === "cloud" ? [] : [{ label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => preferencesHere() }, { type: "separator" as const }]),
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    {
      label: "Apps",
      submenu: [
        ...(APP_ID === "sundays" ? [] : [{ label: "Sundays (everything)", click: () => openSibling(`sundays-open://sundays${startOf("sundays")}`) }, { type: "separator" as const }]),
        ...others.map((id) => ({ label: APPS[id].name, click: () => openSibling(`sundays-open://${id}${APPS[id].home}`) })),
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}
const startOf = (id: AppId) => APPS[id].home;

/** Stay inside the app for our pages and Planning Center's sign-in; open everything else in the browser. */
function isInApp(url: string) {
  try {
    const u = new URL(url);
    return u.origin === origin || u.hostname === "planningcenteronline.com" || u.hostname.endsWith(".planningcenteronline.com");
  } catch {
    return false;
  }
}
const isSibling = (url: string) => url.startsWith("sundays-open://");

/**
 * Sundays → Preferences… (⌘,) follows where you are: in Operations or AVL (separate apps in the same
 * window) it opens that app's own settings instead of Sundays' Preferences, which aren't part of it.
 */
function preferencesHere() {
  let path = "";
  try { path = win ? new URL(win.webContents.getURL()).pathname : ""; } catch { /* no page yet */ }
  if (win && /^\/(ops|avl|admin)(\/|$)/.test(path)) {
    void win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("sundays:app-settings"))`);
    win.show(); win.focus();
    return;
  }
  openPreferences();
}

/** Preferences in their own window (Sundays → Preferences…). One at a time. */
let prefsWin: BrowserWindow | null = null;
function openPreferences(section = "") {
  if (!origin || role === "cloud") return;
  const url = `${origin}/preferences${section ? `#${section}` : ""}`;
  if (prefsWin) {
    if (section) void prefsWin.webContents.executeJavaScript(`location.hash = ${JSON.stringify(section)}`);
    prefsWin.show(); prefsWin.focus();
    return;
  }
  prefsWin = new BrowserWindow({
    width: 980, height: 720, minWidth: 820, minHeight: 560,
    title: "Preferences", backgroundColor: "#0A0C10", show: false,
    fullscreenable: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  prefsWin.once("ready-to-show", () => prefsWin?.show());
  prefsWin.webContents.setWindowOpenHandler(({ url: u }) => { if (isSibling(u)) openSibling(u); else void shell.openExternal(u); return { action: "deny" }; });
  prefsWin.webContents.on("will-navigate", (e, u) => {
    // Preferences stay on their own page; anything else opens in the main window or the browser.
    const same = u.startsWith(`${origin}/preferences`);
    if (same) return;
    e.preventDefault();
    if (isSibling(u)) openSibling(u);
    else if (u.startsWith(origin)) { show(u.slice(origin.length)); } else void shell.openExternal(u);
  });
  void prefsWin.loadURL(url);
  prefsWin.on("closed", () => { prefsWin = null; });
}

/* ───────────── FOH companion mic strip ───────────── */

let strip: BrowserWindow | null = null;
let stripCfg: { on: boolean; size: "s" | "m" | "l"; displayId: number | null; displayLabel?: string | null; tuning?: boolean } = { on: false, size: "m", displayId: null };
let attentionOn = false;
let fullOpen = false; // the companion window opened from the strip (settings, held requests)
let quitting = false;
let hiddenForStrip = false; // the main window is hidden because the strip is showing
app.on("before-quit", () => { quitting = true; });
const STRIP_H = { s: 120, m: 170, l: 230 } as const;
/** The Tuning strip above the mics. */
const TUNING_H = { s: 62, m: 74, l: 88 } as const;
/** The display you chose (found again by name if macOS renumbers displays), else the main one. */
function stripDisplay() {
  const all = screen.getAllDisplays();
  const label = (d: Electron.Display, i: number) => `${(d as { label?: string }).label || `Display ${i + 1}`} · ${d.size.width}×${d.size.height}`;
  return all.find((d) => d.id === stripCfg.displayId)
    ?? (stripCfg.displayLabel ? all.find((d, i) => label(d, i) === stripCfg.displayLabel) : undefined)
    ?? screen.getPrimaryDisplay();
}
/** The strip is showing instead of the main window. */
const stripActive = () => stripCfg.on && !attentionOn && !fullOpen;

/**
 * A short, always-on-top bar across the bottom of the chosen display (above the Dock). Only that
 * bar is a window, so everything above it (Waves SuperRack, the console app) stays clickable.
 */
function layoutStrip() {
  if (!stripActive()) {
    strip?.hide();
    // The strip was turned off (or this Mac went back to the full app): the window comes back.
    if (hiddenForStrip && !attentionOn) { hiddenForStrip = false; win?.show(); }
    return;
  }
  const display = stripDisplay();
  const wa = display.workArea;
  const h = (STRIP_H[stripCfg.size] ?? STRIP_H.m) + (stripCfg.tuning === false ? 0 : TUNING_H[stripCfg.size] ?? TUNING_H.m);
  const bounds = { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
  if (!strip || strip.isDestroyed()) {
    strip = new BrowserWindow({
      // A non-activating panel: pressing a Tuning key or looking at the mics never takes the
      // keyboard or focus away from the app you're working in (SuperRack, the console).
      ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
      ...bounds, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, title: "Mic strip", acceptFirstMouse: true,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    strip.setAlwaysOnTop(true, "floating");
    strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void strip.loadURL(`${origin}/companion/strip`);
    strip.once("ready-to-show", () => { if (stripActive()) strip?.showInactive(); });
    strip.on("closed", () => { strip = null; });
  } else {
    strip.setBounds(bounds);
    if (!strip.isVisible()) strip.showInactive();
  }
  // The full companion window steps aside while the strip shows.
  if (win?.isVisible()) win.hide();
  if (win) hiddenForStrip = true;
}
for (const ev of ["display-added", "display-removed", "display-metrics-changed"] as const) {
  app.whenReady().then(() => screen.on(ev as "display-added", () => layoutStrip())).catch(() => undefined);
}

/** From the strip's gear (or the companion window's "Back to the mic strip"). */
function openCompanion(view: "full" | "strip") {
  fullOpen = view === "full";
  if (fullOpen) {
    strip?.hide();
    if (!win && origin) void createWindow();
    if (win && !win.webContents.getURL().includes("/companion")) void win.loadURL(`${origin}/companion`);
    hiddenForStrip = false;
    win?.show(); win?.focus(); app.focus({ steal: true });
  } else layoutStrip();
}

/** Bring the window over everything (FOH companion page request), or let it go back to normal. */
function attention(on: boolean) {
  attentionOn = on;
  if (on) strip?.hide();
  if (!win && origin) void createWindow();
  const w = win;
  if (!w) return;
  if (on) {
    if (w.isMinimized()) w.restore();
    if (!w.webContents.getURL().includes("/companion")) void w.loadURL(`${origin}/companion`);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setSimpleFullScreen(true);
    w.show();
    w.focus();
    app.focus({ steal: true });
  } else {
    w.setSimpleFullScreen(false);
    w.setAlwaysOnTop(false);
    w.setVisibleOnAllWorkspaces(false);
    // Answered: back to how it looked before (the mic strip, if it's on).
    if (stripActive()) setTimeout(layoutStrip, 350); // after leaving full screen
  }
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: DEF.name,
    backgroundColor: "#0A0C10",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const w = win;
  w.once("ready-to-show", () => { if (stripActive()) hiddenForStrip = true; else w.show(); });
  // FOH companion with the mic strip: closing the window goes back to the strip (Quit still quits).
  w.on("close", (e) => {
    if (quitting || !stripCfg.on) return;
    e.preventDefault();
    fullOpen = false;
    w.hide();
    hiddenForStrip = true;
    layoutStrip();
  });

  // New windows (links with target=_blank, "Open in Planning Center") go to the default browser;
  // sundays-open:// links open another Sundays app.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isSibling(url)) openSibling(url); else void shell.openExternal(url);
    return { action: "deny" };
  });
  // mailto:, tel: and other sites open outside the app.
  w.webContents.on("will-navigate", (e, url) => {
    if (isSibling(url)) { e.preventDefault(); openSibling(url); return; }
    if (!isInApp(url)) { e.preventDefault(); void shell.openExternal(url); }
  });

  const page = startPath ?? DEF.home;
  startPath = null;
  void w.loadURL(await enterUrl(page));
  w.on("closed", () => { if (win === w) win = null; prefsWin?.close(); });
}

app.on("activate", () => {
  if (stripActive()) openCompanion("full"); // the Dock icon opens the companion window from the strip
  else if (!win && origin) void createWindow();
});
app.on("window-all-closed", () => app.quit()); // closing the main window also closes Preferences (above)
// A guest says goodbye, so the server stops sending it requests straight away.
app.on("before-quit", () => {
  if (role === "guest") void fetch(`${origin}/api/engine/bye?app=${APP_ID}`, { method: "POST", headers: engineHeaders(), signal: AbortSignal.timeout(500) }).catch(() => undefined);
});

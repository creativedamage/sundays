/**
 * The Sundays apps. One codebase builds each of them (desktop/dist.mjs).
 *
 * Since 1.33 there are three: Sundays (everything that runs on the Mac, including FOH Companion
 * mode), Sundays Operations and Sundays AVL. Services, Workflows, Paging and FOH are retired (in the
 * `retired` version): every release still has a farewell build of each that only says they're now
 * part of Sundays and opens it.
 *
 * - engine apps (Sundays, Services, Workflows, Paging) run the Sundays server on this Mac. They
 *   share one data folder and one running server: whichever opens first hosts it, the others use
 *   it, so sign-in, settings, the weekend and the mic board are the same in all of them.
 * - FOH is an FOH companion (its own data, linked to the main computer).
 * - Operations and AVL are Sundays' cloud apps (the website's screens in a Mac window).
 *
 * Each window says which app it belongs to in its user agent ("SundaysApp/<id>"), so the screens
 * and the server know which app is asking.
 */
export type AppId = "sundays" | "services" | "workflows" | "paging" | "foh" | "ops" | "avl";
export type AppKind = "engine" | "companion" | "cloud";

export interface AppDef {
  id: AppId;
  /** The name in the Dock and Finder. */
  name: string;
  /** Short name for menus and the app list. */
  short: string;
  /** macOS bundle id (the full app keeps the id it has always had, so updates still work). */
  bundleId: string;
  /** Release files: <artifact>-<version>.dmg and <artifact>-<version>-mac.zip */
  artifact: string;
  kind: AppKind;
  /** Where the app opens. */
  home: string;
  /** Pages that belong to it (path prefixes). The full app has them all. */
  sections: string[];
  blurb: string;
  /** Icon tint (desktop/build/icons). */
  color: string;
  /**
   * Folded into Sundays: the version whose build of this app is its last (a farewell that opens
   * Sundays). Later versions don't build it, and nothing links to it.
   */
  retired?: string;
}

/** Path prefixes every engine app has (sign-in, start-up, settings and the pop-out screens). */
export const SHARED_PATHS = ["/start", "/preferences", "/settings", "/setup-mode", "/team", "/kiosk", "/clockout", "/displayout", "/companion", "/ops-print"];

export const APPS: Record<AppId, AppDef> = {
  sundays: {
    id: "sundays", name: "Sundays", short: "Sundays", bundleId: "org.coolchurch.coolservices", artifact: "Sundays", kind: "engine",
    home: "/start", sections: ["/"], blurb: "Everything in one app.", color: "#6366F1",
  },
  services: {
    id: "services", name: "Sundays Services", short: "Services", bundleId: "org.coolchurch.sundays.services", artifact: "Sundays-Services", kind: "engine",
    home: "/services", sections: ["/services", "/team-checkins", "/propresenter", "/clock", "/micboard", "/dashboard"],
    blurb: "Services, team check-ins, ProPresenter, the Clock and the Mic board.", color: "#0EA5E9", retired: "1.33.0",
  },
  workflows: {
    id: "workflows", name: "Sundays Workflows", short: "Workflows", bundleId: "org.coolchurch.sundays.workflows", artifact: "Sundays-Workflows", kind: "engine",
    home: "/workflows", sections: ["/workflows"], blurb: "People workflows as boards.", color: "#22C55E", retired: "1.33.0",
  },
  paging: {
    id: "paging", name: "Sundays Paging", short: "Paging", bundleId: "org.coolchurch.sundays.paging", artifact: "Sundays-Paging", kind: "engine",
    home: "/paging", sections: ["/paging"], blurb: "Parent paging and the Kids & Nursery iPads.", color: "#F59E0B", retired: "1.33.0",
  },
  foh: {
    id: "foh", name: "Sundays FOH", short: "FOH", bundleId: "org.coolchurch.sundays.foh", artifact: "Sundays-FOH", kind: "companion",
    home: "/companion", sections: ["/companion"], blurb: "The FOH companion: mics, Tuning keys and page requests at the console.", color: "#EF4444", retired: "1.33.0",
  },
  ops: {
    id: "ops", name: "Sundays Operations", short: "Operations", bundleId: "org.coolchurch.sundays.operations", artifact: "Sundays-Operations", kind: "cloud",
    home: "/ops", sections: ["/ops", "/admin"], blurb: "Requests, the work queue, teams and campuses for your church.", color: "#8B5CF6",
  },
  avl: {
    id: "avl", name: "Sundays AVL", short: "AVL", bundleId: "org.coolchurch.sundays.avl", artifact: "Sundays-AVL", kind: "cloud",
    home: "/avl", sections: ["/avl"], blurb: "Clients, quotes, vendor price lists and proposals.", color: "#14B8A6",
  },
};

export const APP_IDS = Object.keys(APPS) as AppId[];
/** The apps people use now: Sundays, Operations and AVL. */
export const ACTIVE_APP_IDS = APP_IDS.filter((id) => !APPS[id].retired);
const isAppId = (v: unknown): v is AppId => typeof v === "string" && v in APPS;

/** Which app a user agent belongs to ("… SundaysApp/services"); null in a plain browser. */
export function appFromUserAgent(ua: string | null | undefined): AppId | null {
  const m = /\bSundaysApp\/([a-z]+)/.exec(ua ?? "");
  return m && isAppId(m[1]) ? m[1] : null;
}

const under = (path: string, prefix: string) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);

/** Does this app have this page? (The full app has every page.) */
export function appHas(id: AppId, path: string): boolean {
  const a = APPS[id];
  if (a.sections.includes("/")) return true;
  if (path === "/" || SHARED_PATHS.some((p) => under(path, p))) return true;
  return a.sections.some((p) => under(path, p));
}

/** The app a page lives in (other than the full app). */
export function appFor(path: string): AppId | null {
  for (const id of ACTIVE_APP_IDS) {
    if (id === "sundays") continue;
    if (APPS[id].sections.some((p) => under(path, p))) return id;
  }
  return null;
}

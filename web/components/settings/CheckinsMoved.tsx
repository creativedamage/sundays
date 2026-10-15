"use client";
/**
 * Team check-ins live only on the website now (sundays-checkin.vercel.app). This says so wherever
 * they used to be in the Mac app, and brings this Mac's ministries (and each service type's event
 * and team areas) over to the website, merged in: ministries the website already has keep their
 * teams, and new ones are added.
 */
import { CloudUpload, ExternalLink, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CHECKIN_URL } from "@shared/cloud";
import { Api } from "@/lib/api";
import { ops, OpsError } from "@/lib/ops";
import { Spinner } from "@/components/ui";

const DONE = "sundays.checkinsBroughtOver";

interface Added { groups: number; teams: number }

/** Merge this Mac's check-in settings into the website's. Returns what was added (null: nothing to bring). */
export async function bringCheckinSettings(): Promise<Added | null> {
  // Never from the built-in sample data.
  if ((await Api.me().catch(() => null))?.demo !== false) return null;
  const [config, groups] = await Promise.all([Api.volunteerConfig().catch(() => ({ events: {}, teamLocations: {} })), Api.teamGroups()]);
  const body = { events: config.events ?? {}, teamLocations: config.teamLocations ?? {}, groups: groups.filter((g) => g.name.trim()) };
  if (!body.groups.length && !Object.keys(body.events).length && !Object.keys(body.teamLocations).length) return null;
  const r = await ops<{ added?: Added }>("/settings/checkin/import", { method: "PUT", json: body });
  return r.added ?? { groups: body.groups.length, teams: 0 };
}

/**
 * Once per Mac, after updating: bring the Mac's ministries over without asking. Quietly does
 * nothing when this Mac isn't signed in to Sundays | Operations (Preferences shows a button then).
 */
export async function bringCheckinSettingsOnce() {
  try { if (localStorage.getItem(DONE)) return; } catch { return; }
  if ((await Api.me().catch(() => null))?.demo !== false) return; // sample data, or not signed in: later
  try {
    const added = await bringCheckinSettings();
    localStorage.setItem(DONE, new Date().toISOString());
    if (added && (added.groups || added.teams)) {
      toast.success("Ministries moved to the check-in website", { description: `${added.groups} ministr${added.groups === 1 ? "y" : "ies"} added, ${added.teams} team${added.teams === 1 ? "" : "s"} placed.` });
    }
  } catch { /* not signed in to Operations yet, or offline: try again next launch */ }
}

export function CheckinsMoved({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const bring = async () => {
    setBusy(true); setDone(null);
    try {
      const added = await bringCheckinSettings();
      try { localStorage.setItem(DONE, new Date().toISOString()); } catch { /* private */ }
      setDone(added ? `${added.groups} ministr${added.groups === 1 ? "y" : "ies"} added and ${added.teams} team${added.teams === 1 ? "" : "s"} placed. Ministries the website already had were kept.` : "This Mac had no ministries or check-in settings to bring.");
    } catch (e) {
      toast.error("Couldn’t bring them over", { description: e instanceof OpsError && e.status === 401 ? "Sign in to Sundays | Operations in this app first (the sidebar switcher)." : (e as Error).message });
    } finally { setBusy(false); }
  };
  const host = CHECKIN_URL.replace("https://", "");
  return (
    <div className={compact ? "space-y-4" : "mx-auto max-w-xl space-y-5 p-10 text-center"}>
      {!compact && <UsersRound size={40} className="mx-auto text-accent" />}
      <div>
        <h2 className={compact ? "font-semibold" : "text-xl font-semibold"}>Team check-ins are on the website now</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Seeing who’s in, checking people in, check-in settings, ministries and reports all live at <b className="text-ink-soft">{host}</b>, where everyone signs in with Planning Center.
          They’re no longer in the Mac app. (Kids check-ins by room stay on each service’s Check-ins tab, for paging.)
        </p>
      </div>
      <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap justify-center gap-2"}>
        <a className="btn-primary" href={CHECKIN_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open {host}</a>
        <button className="btn-outline" disabled={busy} onClick={() => void bring()}>{busy ? <Spinner /> : <CloudUpload size={14} />} Bring this Mac’s ministries over</button>
      </div>
      {done && <p className="text-sm text-ok">{done}</p>}
    </div>
  );
}

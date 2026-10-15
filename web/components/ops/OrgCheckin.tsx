"use client";
/**
 * Settings → Organization → Team check-ins: the phone page at sundays-checkin.vercel.app, whether
 * Planning Center is connected, and how many people can use it (given in Settings → Users).
 */
import { ExternalLink, Link2Off, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CHECKIN_URL } from "@shared/cloud";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

type Data = {
  linked: { pcoOrgId: string; pcoOrgName: string | null } | null;
  configured: { events: number; teamLocations: number; groups: number };
  people: Partial<Record<"NONE" | "VIEW" | "CHECKIN" | "MANAGER", number>>;
};

export function OrgCheckin() {
  const d = useOps<Data>("/settings/checkin");
  const refresh = useOpsRefresh();
  const [busy, setBusy] = useState(false);
  if (!d.data) return <Card eyebrow="Team check-ins" title="Check-ins on phones"><ErrorBox error={d.error} />{!d.error && <Loading />}</Card>;
  const { linked, configured, people } = d.data;
  const n = (k: keyof Data["people"]) => people[k] ?? 0;
  return (
    <Card eyebrow="Team check-ins" title="Check-ins on phones">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-ink-soft">
          Team leads and staff see who’s here and check people in at{" "}
          <a href={CHECKIN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{CHECKIN_URL.replace("https://", "")} <ExternalLink size={11} /></a>,
          signed in with their own Planning Center account.
        </p>
        <div className="rounded-lg border border-line px-3 py-2.5">
          {linked ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">Connected to Planning Center: <b>{linked.pcoOrgName ?? linked.pcoOrgId}</b></span>
              <button className="btn-ghost py-1 text-xs text-bad" disabled={busy} onClick={async () => {
                if (!window.confirm("Disconnect Planning Center? Everyone signed in to check-ins is signed out until a System admin signs in there again.")) return;
                setBusy(true);
                try { await ops("/settings/checkin/link", { method: "DELETE" }); toast.success("Disconnected"); await refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
              }}>{busy ? <Spinner /> : <Link2Off size={13} />} Disconnect</button>
            </div>
          ) : (
            <span className="text-ink-muted">Not connected yet. A System admin connects it by opening the check-in page and signing in with Planning Center once.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted">
          <span className="flex items-center gap-1.5"><UsersRound size={13} /> {n("MANAGER")} manage · {n("CHECKIN")} check in · {n("VIEW")} view</span>
          <Link href="/ops/settings/users" className="text-accent hover:underline">Give people access →</Link>
        </div>
        <p className="text-xs text-ink-faint">
          {configured.events ? `${configured.events} service type${configured.events === 1 ? "" : "s"} have a volunteer event, ${configured.teamLocations} team area${configured.teamLocations === 1 ? "" : "s"}, ${configured.groups} ministr${configured.groups === 1 ? "y" : "ies"}.` : "No check-in settings yet."}{" "}
          People who manage check-ins change these on the check-in page (a Mac running Sundays brings its ministries over by itself: Preferences → Team Check-ins).
        </p>
      </div>
    </Card>
  );
}

"use client";
/** Sends you to the start-up view chosen in Settings (after signing in or opening the app). */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { pickWeekendService } from "@/lib/weekend";
import { lastApp, lastHref } from "@/components/AppSwitcher";
import { Logo } from "@/components/Logo";
import { APPS, appFromUserAgent } from "@shared/apps";

export default function StartPage() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      try {
        // First time on this Mac: Full Mode, Service Mode or FOH Companion?
        const { mode } = await Api.appMode().catch(() => ({ mode: "full" as const }));
        if (mode === null) return router.replace("/setup-mode");
        if (mode === "companion") return router.replace("/companion");
        // A separate Sundays app (Services, Workflows, Paging) opens on its own home.
        const app = appFromUserAgent(navigator.userAgent);
        if (app && app !== "sundays") return router.replace(APPS[app].home);
        // Sundays | Operations was open last: back to it (Full Mode only).
        if (mode === "full" && lastApp() !== "sundays") return router.replace(lastHref(lastApp()));
        const s = await Api.settings();
        let v = s.startView;
        // Service Mode opens only what it keeps (Services by default).
        if (mode === "service" && !["services", "propresenter", "paging", "next-service", "next-runsheet"].includes(v.kind)) v = { kind: "services" };
        if (v.kind === "workflow") return router.replace(routes.board(v.workflowId));
        if (v.kind === "services") return router.replace("/services");
        if (v.kind === "dashboard") return router.replace("/dashboard");
        if (v.kind === "propresenter") return router.replace("/propresenter");
        if (v.kind === "paging") return router.replace("/paging");
        if (v.kind === "next-service" || v.kind === "next-checkins" || v.kind === "next-runsheet") {
          // The picked weekend's service (no type chosen: "Your service" from the dashboard, if set).
          const st = v.serviceTypeId ?? (await Api.home().catch(() => null))?.serviceTypeId ?? null;
          const next = pickWeekendService(await Api.weekend(), st);
          if (!next) return router.replace("/services");
          // (Run sheet and Check-ins were removed in 1.45: those open the service too.)
          return router.replace(routes.plan(next.serviceTypeId, next.id));
        }
      } catch { /* fall through */ }
      router.replace("/workflows");
    })();
  }, [router]);
  return <div className="grid min-h-screen place-items-center"><div className="animate-pulse"><Logo size={48} /></div></div>;
}

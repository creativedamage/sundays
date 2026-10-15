"use client";
/** /invoice?t=<the link token>: no sign-in, the link is the key. Back from Stripe with &paid=<session>. */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ClientInvoice } from "@/components/avl/billing/Public";

export default function Page() { return <Suspense><Inner /></Suspense>; }
function Inner() { const sp = useSearchParams(); return <ClientInvoice token={sp.get("t") ?? ""} paid={sp.get("paid")} />; }

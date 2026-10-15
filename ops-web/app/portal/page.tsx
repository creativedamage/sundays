"use client";
/** /portal?b=<business>: the client portal, signed in with a code sent to the client's email. */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Portal } from "@/components/avl/billing/Public";

export default function Page() { return <Suspense><Inner /></Suspense>; }
function Inner() { return <Portal business={useSearchParams().get("b")} />; }

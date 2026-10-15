import type { Metadata, Viewport } from "next";

/** The business's document, not Sundays: a plain title, and never indexed. */
export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff", colorScheme: "light" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

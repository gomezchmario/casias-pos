import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // The time clock is now one room in a bigger building — register, inventory,
  // close-out and admin all live here too — so it has no business being in the
  // name over the door.
  //
  // `template` supplies the "· Casias Tire Shop" suffix to every page that names
  // itself. Almost none of them can do that directly: a `"use client"` module
  // cannot export `metadata` and Next silently ignores it if you try. Instead
  // each section carries a two-line server `layout.tsx` re-exporting
  // `src/lib/title-layout.tsx`, which is where the full reasoning lives.
  //
  // Note that any layout below this one which sets `title` must restate this
  // template, because setting `title` replaces the whole field rather than
  // merging into it — see the comment in `src/app/pos/(shell)/layout.tsx`.
  title: {
    default: "Casias Tire Shop",
    template: "%s · Casias Tire Shop",
  },
  description: "Point of sale, inventory and time clock for Casias Tire Shop",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

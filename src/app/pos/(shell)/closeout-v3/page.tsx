import { redirect } from "next/navigation";

/**
 * The old address, kept alive.
 *
 * The screen moved to /pos/drawer when it was renamed — four of its six steps
 * are daytime jobs, so "Close-out" was the wrong word on the tab everybody
 * clicks. This exists because the old URL is in browser history, in bookmarks
 * on the counter PC, and quite possibly written on a sticky note; a 404 there
 * is a screen somebody needs and cannot find.
 */
export default function OldCloseoutRoute() {
  redirect("/pos/drawer");
}

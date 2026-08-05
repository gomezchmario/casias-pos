export { default } from "@/lib/title-layout";

// The kiosk lives at "/", which has no segment of its own to hang a title on —
// hence the (kiosk) route group. Parentheses keep it out of the URL, so the
// address is still localhost:3000 and the punch-in screen is unmoved; all this
// buys is a place for the name.
export const metadata = { title: "Time Clock" };

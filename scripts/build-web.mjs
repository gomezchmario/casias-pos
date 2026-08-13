/**
 * The shop's public website, wrapped for a browser.
 *
 * Same arrangement as the brochure: the source is written as a body fragment
 * so it can be published and previewed as an artifact, and a whole document is
 * assembled here for the server to hand out at /web. One source, two outputs,
 * and no second copy on disk to drift.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const body = fs.readFileSync(path.join(root, "docs", "casias-web.html"), "utf8");

fs.writeFileSync(
  path.join(root, "public", "web.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Casias Tire and Muffler Shop — new and used tires, flat repair, mount and balance, mufflers and exhaust. 8715 Grissom Rd, San Antonio TX. Open seven days.">
<meta name="theme-color" content="#1e3a5f">
<link rel="icon" href="/logo-256.png">
</head>
<body>
${body}
</body>
</html>`,
  "utf8",
);
console.log("wrote public/web.html — served at /web");

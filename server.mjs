import { createServer } from "https";
import { readFileSync } from "fs";
import { parse } from "url";
import next from "next";

const dev = process.argv.includes("--dev");
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: readFileSync("certs/key.pem"),
  cert: readFileSync("certs/cert.pem"),
};

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, "0.0.0.0", () => {
    console.log(`> HTTPS ready on https://localhost:${port}`);
    console.log(`> Network:      https://192.168.1.118:${port}`);
  });
});

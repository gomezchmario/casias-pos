import { createServer as createHttpsServer } from "https";
import { createServer as createHttpServer } from "http";
import { createServer as createRawServer } from "net";
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
  const https = createHttpsServer(httpsOptions, (req, res) => {
    handle(req, res, parse(req.url, true));
  });

  /**
   * Anybody who typed "localhost:3000" instead of "https://localhost:3000".
   *
   * This used to be a TLS socket and nothing else, so a plain HTTP request got
   * no reply at all and the browser showed "sent back an empty page". That is
   * indistinguishable from the register being down, and the person reading it
   * is standing at a counter with a customer -- they are not going to work out
   * that a scheme is missing from a URL they never typed a scheme into. The
   * browser omits "https://" from the address bar too, so copying what is on
   * screen reproduces the fault exactly.
   */
  const redirect = createHttpServer((req, res) => {
    // The Host header carries the port the client actually used, so this keeps
    // working from another device on the shop wifi rather than sending a phone
    // to the register's own localhost.
    const host = req.headers.host ?? `localhost:${port}`;
    res.writeHead(308, { Location: `https://${host}${req.url}` });
    res.end();
  });

  /**
   * One port, both protocols, decided per connection by its first byte.
   *
   * A TLS handshake always opens with 0x16 (22, "handshake record"); every HTTP
   * method starts with an ASCII letter. So one peek is enough to know which
   * server should own the socket, and the alternative -- a second port for the
   * redirect -- does not help the person who typed the wrong scheme on the
   * RIGHT port, which is the entire problem.
   *
   * The byte is put back with `unshift` before either server sees the socket,
   * so both get an untouched stream. `resume` waits a tick because the server
   * needs to attach its own listeners first.
   */
  createRawServer((socket) => {
    socket.once("data", (buf) => {
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? https : redirect).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
    // A connection that opens and says nothing must not sit on a file
    // descriptor forever. Browsers do this routinely when they pre-connect.
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
  }).listen(port, "0.0.0.0", () => {
    console.log(`> HTTPS ready on https://localhost:${port}`);
    console.log(`> Network:      https://192.168.1.118:${port}`);
    console.log(`> Plain http:// on this port is redirected, not dropped.`);
  });
});

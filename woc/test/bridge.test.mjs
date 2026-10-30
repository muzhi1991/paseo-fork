import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
test(
  "bridge validates WOC session, strips credentials, protects websocket and closes on logout",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "woc-bridge-"));
    const secret = "fixture-private-password";
    const key = join(dir, "key");
    writeFileSync(key, secret, { mode: 0o600 });
    let loggedIn = true;
    const panel = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          user: loggedIn && req.headers.cookie === "woc_sess=valid" ? { role: "admin" } : null,
        }),
      );
    });
    const panelPort = await listen(panel);
    let received;
    const daemon = http.createServer((req, res) => {
      received = req.headers;
      if (req.url?.startsWith("/_expo/static/")) {
        res.setHeader("content-type", "application/javascript");
        res.setHeader("content-length", Buffer.byteLength("const sample = 1;".repeat(1000)));
        res.end("const sample = 1;".repeat(1000));
        return;
      }
      res.end("paseo fixture");
    });
    const daemonPort = await listen(daemon);
    const wsServer = new WebSocketServer({ server: daemon });
    wsServer.on("connection", (ws) => ws.on("message", (data) => ws.send(data)));
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["woc/runtime/bridge.mjs"], {
      env: {
        ...process.env,
        WOC_PANEL_URL: `http://127.0.0.1:${panelPort}`,
        WOC_AGENT_PUBLIC_URL: origin,
        WOC_PASEO_INTERNAL_URL: `http://127.0.0.1:${daemonPort}`,
        WOC_BRIDGE_PORT: String(port),
        WOC_PASEO_PASSWORD_FILE: key,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const exited = once(child, "exit");
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    let socket;
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          await fetch(origin);
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert(ready, errors);
      assert.equal((await fetch(origin)).status, 401);
      assert.equal((await fetch(origin, { headers: { cookie: "woc_sess=bad" } })).status, 401);
      assert.equal(
        (
          await fetch(origin, {
            headers: { cookie: "woc_sess=valid", origin: "https://foreign.invalid" },
          })
        ).status,
        401,
      );
      const r = await fetch(origin, {
        headers: {
          cookie: "woc_sess=valid; unrelated=hidden",
          authorization: "Bearer browser-value",
          origin,
        },
      });
      assert.equal(await r.text(), "paseo fixture");
      assert.equal(received.cookie, undefined);
      assert.equal(received.authorization, `Bearer ${secret}`);
      assert.equal(received.host, `127.0.0.1:${port}`);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const asset = "/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js";
      const compressed = await fetch(origin + asset, {
        headers: { cookie: "woc_sess=valid", "accept-encoding": "gzip" },
      });
      assert.equal(compressed.headers.get("content-encoding"), "gzip");
      assert.equal(compressed.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.match(compressed.headers.get("vary"), /Accept-Encoding/i);
      assert.equal(await compressed.text(), "const sample = 1;".repeat(1000));
      const plain = await fetch(origin + asset, {
        headers: { cookie: "woc_sess=valid", "accept-encoding": "gzip;q=0, identity" },
      });
      assert.equal(plain.headers.get("content-encoding"), null);
      assert.equal(await plain.text(), "const sample = 1;".repeat(1000));
      const dynamic = await fetch(origin + "/api/private.js", {
        headers: { cookie: "woc_sess=valid", "accept-encoding": "gzip" },
      });
      assert.equal(dynamic.headers.get("cache-control"), "no-store");
      assert.equal(dynamic.headers.get("content-encoding"), null);
      const unversioned = await fetch(origin + "/_expo/static/js/web/latest.js", {
        headers: { cookie: "woc_sess=valid", "accept-encoding": "gzip" },
      });
      assert.equal(unversioned.headers.get("cache-control"), "no-store");
      await unversioned.text();
      assert.equal((await fetch(origin + asset)).status, 401);
      const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { cookie: "woc_sess=valid", origin: "https://foreign.invalid" },
      });
      const refused = await new Promise((resolve) => {
        bad.on("unexpected-response", (_req, response) => {
          response.resume();
          resolve(response.statusCode);
          bad.terminate();
        });
        bad.on("error", () => {});
      });
      assert.equal(refused, 401);
      socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { cookie: "woc_sess=valid", origin },
      });
      await once(socket, "open");
      socket.send("hello");
      const [echo] = await once(socket, "message");
      assert.equal(echo.toString(), "hello");
      loggedIn = false;
      const [code] = await once(socket, "close");
      assert.equal(code, 1008);
      assert.equal((await fetch(origin, { headers: { cookie: "woc_sess=valid" } })).status, 401);
    } finally {
      socket?.terminate();
      child.kill("SIGTERM");
      await exited;
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close();
      panel.closeAllConnections();
      daemon.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => panel.close(resolve)),
        new Promise((resolve) => daemon.close(resolve)),
      ]);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

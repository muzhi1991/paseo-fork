import { proxyTrigger } from "./trigger-proxy.mjs";
import { agentApi } from "./associations.mjs";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { createPaseoClient } from "@getpaseo/client";

const panel = new URL(process.env.WOC_PANEL_URL);
const publicOrigin = new URL(process.env.WOC_AGENT_PUBLIC_URL).origin;
const upstream = new URL(process.env.WOC_PASEO_INTERNAL_URL || "http://127.0.0.1:6767");
const password = readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim();
const workspacePath = "/workspace/woc";
let workspacePromise;
async function workspace() {
  if (!workspacePromise) {
    workspacePromise = (async () => {
      const client = createPaseoClient({ url: `ws://${upstream.host}/ws`, password });
      try {
        await client.connect();
        const result = await client.workspaces.open(workspacePath);
        return result.id;
      } finally {
        await client.close();
      }
    })().catch((error) => {
      workspacePromise = undefined;
      throw error;
    });
  }
  return workspacePromise;
}
async function authenticated(req) {
  if (req.headers.host !== new URL(publicOrigin).host) return false;
  if (
    req.headers.origin &&
    req.headers.origin !== publicOrigin &&
    req.headers.origin !== panel.origin
  )
    return false;
  const cookie = req.headers.cookie
    ?.split(";")
    .find((value) => value.trim().startsWith("woc_sess="))
    ?.trim();
  if (!cookie) return false;
  try {
    const result = await fetch(new URL("/api/auth/me", panel), {
      headers: { cookie },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) return false;
    const body = await result.json();
    return body.user?.role === "admin";
  } catch {
    return false;
  }
}
function headers(req) {
  const result = {
    ...req.headers,
    host: new URL(publicOrigin).host,
    authorization: `Bearer ${password}`,
  };
  for (const name of [
    "cookie",
    "origin",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-for",
  ])
    delete result[name];
  return result;
}
function acceptsGzip(header = "") {
  return header.split(",").some((entry) => {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find((value) => value.trim().startsWith("q="));
    return name === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
  });
}
function isVersionedWebAsset(req, response) {
  // Only content-addressed application code is cacheable. HTML, bootstrap data,
  // workspace files and APIs must retain their authenticated no-store behavior.
  return (
    ["GET", "HEAD"].includes(req.method) &&
    response.statusCode === 200 &&
    /^\/_expo\/static\/(?:js\/web|css)\/[a-zA-Z0-9_-]+-[a-f0-9]{32}\.(?:js|css)$/.test(
      new URL(req.url, publicOrigin).pathname,
    )
  );
}
const handleAgentApi = agentApi({ password, upstream, workspace, panel });
const server = http.createServer(async (req, res) => {
  if (
    /^\/hooks\/[a-f0-9-]{36}$/.test(req.url || "") &&
    req.method === "POST" &&
    req.headers.host === new URL(publicOrigin).host
  ) {
    await proxyTrigger(req, res, { webhook: true });
    return;
  }

  if (!(await authenticated(req))) {
    res.writeHead(401, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("请先登录 WOC 管理员账号，再打开 AI 助手。");
    return;
  }
  if (req.url?.startsWith("/automation/")) {
    await proxyTrigger(req, res);
    return;
  }
  if (await handleAgentApi(req, res)) return;
  if (req.url === "/woc-config") {
    try {
      const workspaceId = await workspace();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          workspaceId,
          workspacePath,
          provider: "pi",
          model: "cliproxy/deepseek-flash",
          models: ["cliproxy/deepseek-flash", "cliproxy/glm-5.3-flash"],
        }),
      );
    } catch {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    }
    return;
  }
  const proxy = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers: headers(req),
    },
    (response) => {
      const cacheable = isVersionedWebAsset(req, response);
      const compress =
        cacheable &&
        req.method === "GET" &&
        !response.headers["content-encoding"] &&
        acceptsGzip(req.headers["accept-encoding"]);
      const outgoing = {
        ...response.headers,
        "content-security-policy": `frame-ancestors ${panel.origin} ${publicOrigin}`,
        "cache-control": cacheable ? "private, max-age=31536000, immutable" : "no-store",
      };
      if (cacheable) outgoing.vary = [outgoing.vary, "Accept-Encoding"].filter(Boolean).join(", ");
      if (compress) {
        outgoing["content-encoding"] = "gzip";
        delete outgoing["content-length"];
        delete outgoing["accept-ranges"];
        delete outgoing.etag;
      }
      delete outgoing["set-cookie"];
      delete outgoing["x-frame-options"];
      res.writeHead(response.statusCode ?? 502, outgoing);
      if (compress) pipeline(response, createGzip(), res, () => {});
      else response.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Agent service unavailable");
  });
  req.on("aborted", () => proxy.destroy());
  req.pipe(proxy);
});
function connectSockets(req, remote, client) {
  const timer = setInterval(async () => {
    if (!(await authenticated(req))) client.close(1008, "WOC session expired");
  }, 15000);
  client.on("message", (data, binary) => {
    if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary });
  });
  remote.on("message", (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  client.on("close", () => {
    clearInterval(timer);
    remote.close();
  });
  remote.on("close", () => client.close());
  client.on("error", () => remote.close());
}
const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
server.on("upgrade", async (req, socket, head) => {
  if (!(await authenticated(req))) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const remote = new WebSocket(`ws://${upstream.host}${req.url}`, {
    headers: { authorization: `Bearer ${password}` },
    maxPayload: 32 * 1024 * 1024,
  });
  remote.on("error", () => socket.destroy());
  remote.once("open", () =>
    sockets.handleUpgrade(req, socket, head, (client) => connectSockets(req, remote, client)),
  );
});
server.listen(Number(process.env.WOC_BRIDGE_PORT || 6769), "0.0.0.0");

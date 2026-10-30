import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
const uuid = /^[a-f0-9-]{36}$/;
export function associationStore(path) {
  function read() {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  }
  return {
    read,
    set(id, machine) {
      if (!uuid.test(id)) throw Error("Invalid agent ID");
      const all = read();
      if (machine) all[id] = machine;
      else delete all[id];
      if (Object.keys(all).length > 5000) throw Error("Association limit reached");
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path + ".tmp", JSON.stringify(all), { mode: 0o600 });
      renameSync(path + ".tmp", path);
    },
  };
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw Error("Body too large");
  }
  return JSON.parse(raw);
}
export function agentApi({
  password,
  upstream,
  workspace,
  panel,
  createClient = (options) => new DaemonClient(options),
}) {
  const store = associationStore(
    process.env.WOC_ASSOCIATIONS_FILE || "/state/agent-associations.json",
  );
  async function machines(cookie) {
    const r = await fetch(new URL("/api/instances", panel), {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw Error("Cannot read computers");
    const x = await r.json();
    return x.instances.map((m) => ({
      id: m.id,
      name: m.name,
      status: m.runtime,
      mode: m.mode,
      app: m.app,
    }));
  }
  async function resolveMachine(id, cookie = "") {
    if (!id) return null;
    return (await machines(cookie)).find((m) => m.id === id);
  }
  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/woc-api/")) return false;
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    let client;
    try {
      if (url.pathname === "/woc-api/machines" && req.method === "GET") {
        send(200, { machines: await machines(req.headers.cookie || "") });
        return true;
      }
      client = createClient({
        url: `ws://${upstream.host}/ws`,
        password,
        clientId: "woc-associations",
        appVersion: "0.14.0",
      });
      await client.connect();
      const workspaceId = await workspace();
      if (url.pathname === "/woc-api/associations" && req.method === "GET") {
        send(200, { associations: store.read() });
        return true;
      }
      const match = /^\/woc-api\/associations\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (match) {
        const agent = (await client.fetchAgent(match[1]))?.agent;
        if (!agent || agent.workspaceId !== workspaceId) {
          send(404, { error: "会话不存在" });
          return true;
        }
        if (req.method === "GET") {
          send(200, {
            machine: store.read()[match[1]] || null,
            busy: !["idle", "closed", "error"].includes(agent.status),
          });
          return true;
        }
        if (req.method === "PUT") {
          if (!["idle", "closed", "error"].includes(agent.status)) {
            send(409, { error: "任务执行中，请完成后再切换电脑" });
            return true;
          }
          const body = await readBody(req);
          const machine = await resolveMachine(body.machine_id, req.headers.cookie);
          if (body.machine_id && !machine) {
            send(404, { error: "电脑不存在或无权访问" });
            return true;
          }
          store.set(match[1], machine);
          send(200, { machine });
          return true;
        }
      }
      send(404, { error: "Not found" });
      return true;
    } catch (e) {
      send(500, { error: e.message });
      return true;
    } finally {
      await client?.close();
    }
  };
}

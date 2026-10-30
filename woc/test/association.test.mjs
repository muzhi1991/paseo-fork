import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { associationStore, agentApi } from "../runtime/associations.mjs";
const id = "11111111-1111-1111-1111-111111111111";
test("association persists, rejects missing machine/workspace and changes during active tasks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "woc-assoc-"));
  const previous = process.env.WOC_ASSOCIATIONS_FILE;
  process.env.WOC_ASSOCIATIONS_FILE = join(dir, "bindings");
  let status = "idle",
    workspaceId = "w";
  const panel = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        instances: [{ id: "m", name: "Computer", runtime: "running", mode: "desktop" }],
      }),
    );
  });
  panel.listen(0, "127.0.0.1");
  await once(panel, "listening");
  const handler = agentApi({
    panel: `http://127.0.0.1:${panel.address().port}`,
    upstream: new URL("http://localhost"),
    workspace: async () => "w",
    password: "fixture",
    createClient: () => ({
      connect: async () => {},
      close: async () => {},
      fetchAgent: async () => ({ agent: { workspaceId, status } }),
    }),
  });
  const server = http.createServer((req, res) => handler(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/woc-api/associations/${id}`;
  const put = (machine_id) =>
    fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machine_id }),
    });
  try {
    assert.equal((await put("missing")).status, 404);
    assert.equal((await put("m")).status, 200);
    assert.equal(associationStore(process.env.WOC_ASSOCIATIONS_FILE).read()[id].id, "m");
    status = "running";
    assert.equal((await put(null)).status, 409);
    assert((await (await fetch(base)).json()).busy);
    status = "idle";
    assert.equal((await put(null)).status, 200);
    assert.equal((await (await fetch(base)).json()).machine, null);
    workspaceId = "other";
    assert.equal((await put("m")).status, 404);
  } finally {
    server.closeAllConnections();
    panel.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => panel.close(r))]);
    if (previous === undefined) delete process.env.WOC_ASSOCIATIONS_FILE;
    else process.env.WOC_ASSOCIATIONS_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

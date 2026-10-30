import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const machine = "dfde788ec9",
  space = "direct:192.168.31.101:13342";
function config(model) {
  const { agentId } = JSON.parse(readFileSync(`/state/acceptance-${model}.json`, "utf8"));
  return JSON.parse(readFileSync(`/state/identities/${agentId}/client.json`, "utf8"));
}
const a = config("deepseek-flash"),
  b = config("glm-5.3-flash");
assert.notEqual(a.cuaHome, b.cuaHome);
async function woc(cfg, op, args = {}) {
  const response = await fetch(`${cfg.panelUrl}/api/integrations/woc/${op}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readFileSync(cfg.tokenFile, "utf8").trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ machine_id: machine, ...args }),
  });
  return { status: response.status, body: await response.json() };
}
async function cua(cfg) {
  const client = new Client({ name: "woc-lock-acceptance", version: "1" }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: "cua",
      args: ["--embedded", "mcp"],
      env: { ...process.env, CUA_HOME: cfg.cuaHome },
    }),
  );
  return client;
}
const ca = await cua(a),
  cb = await cua(b);
let lock;
const call = (client, tool, args = {}) =>
  client.callTool({ name: "call_tool", arguments: { space, tool, arguments: args } });
try {
  assert.equal(
    (await woc(a, "status")).body.state,
    "free",
    "Desktop is occupied; do not take over",
  );
  const read = await call(ca, "get_screen_size");
  assert(!read.isError);
  const denied = await call(ca, "move_cursor", { scope: "desktop", x: 40, y: 40 });
  assert(denied.isError);
  assert.match(JSON.stringify(denied), /WOC_LOCK_REQUIRED/);
  const acquired = await woc(a, "acquire");
  assert.equal(acquired.status, 200);
  lock = acquired.body.lock_id;
  assert(lock);
  const busy = await woc(b, "acquire");
  assert.equal(busy.status, 409);
  assert.equal(busy.body.mine, false);
  assert(!(await call(cb, "get_screen_size")).isError, "Other agent can still read");
  const rejected = await call(cb, "move_cursor", { scope: "desktop", x: 45, y: 45 });
  assert(rejected.isError);
  assert.match(JSON.stringify(rejected), /WOC_LOCK/);
  const moved = await call(ca, "move_cursor", { scope: "desktop", x: 40, y: 40 });
  assert(!moved.isError, JSON.stringify(moved));
  assert.equal((await woc(a, "release", { lock_id: lock })).status, 200);
  lock = null;
  assert.equal((await woc(b, "status")).body.state, "free");
  console.log(
    JSON.stringify({
      identities_distinct: true,
      read_without_lock: true,
      unlocked_write_error_visible: true,
      second_agent_busy: true,
      read_while_other_holds: true,
      other_write_denied: true,
      holder_cua_write: true,
      released: true,
    }),
  );
} finally {
  if (lock) await woc(a, "release", { lock_id: lock });
  await ca.close();
  await cb.close();
}

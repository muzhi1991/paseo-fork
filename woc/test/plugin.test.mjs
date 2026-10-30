import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import contribute from "../plugin/index.server.ts";

test("launch hook has cleanup, preserves identity on resume and separates conversations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "woc-plugin-"));
  const key = join(dir, "key");
  writeFileSync(key, "fixture-service-key");
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    assert.equal(req.headers.authorization, "Bearer fixture-service-key");
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const old = {
    WOC_PANEL_URL: process.env.WOC_PANEL_URL,
    WOC_IDENTITIES_DIR: process.env.WOC_IDENTITIES_DIR,
    WOC_PROVISION_TOKEN_FILE: process.env.WOC_PROVISION_TOKEN_FILE,
  };
  Object.assign(process.env, {
    WOC_PANEL_URL: `http://127.0.0.1:${server.address().port}`,
    WOC_IDENTITIES_DIR: dir,
    WOC_PROVISION_TOKEN_FILE: key,
  });
  try {
    let handler;
    let removed = false;
    const cleanup = contribute({
      addHook(name, callback) {
        assert.equal(name, "agent.open.before");
        handler = callback;
        return () => {
          removed = true;
        };
      },
    });
    assert.equal(typeof cleanup, "function");
    const first = {
      agentId: "11111111-1111-1111-1111-111111111111",
      title: "one",
      env: { KEEP: "yes" },
      mcpServers: {},
    };
    const a = await handler({ request: first });
    const b = await handler({ request: first });
    const c = await handler({
      request: { ...first, agentId: "22222222-2222-2222-2222-222222222222" },
    });
    assert.equal(a.env.WOC_CLIENT_CONFIG, b.env.WOC_CLIENT_CONFIG);
    assert.equal(a.env.CUA_HOME, b.env.CUA_HOME);
    assert.notEqual(a.env.CUA_HOME, c.env.CUA_HOME);
    assert.equal(a.env.KEEP, "yes");
    assert.equal(calls[0].tokenHash, calls[1].tokenHash);
    assert.notEqual(calls[0].tokenHash, calls[2].tokenHash);
    const config = JSON.parse(readFileSync(a.env.WOC_CLIENT_CONFIG, "utf8"));
    assert.equal(config.cuaHome, a.env.CUA_HOME);
    assert.equal(readFileSync(config.tokenFile, "utf8").length, 64);
    assert.deepEqual(Object.keys(a.mcpServers), ["woc", "cua"]);
    cleanup();
    assert(removed);
  } finally {
    for (const [variable, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import target from "../runtime/target-extension.ts";
test("Pi target context re-reads at task start without accumulating old prompts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "woc-target-")),
    file = join(dir, "binding");
  const old = {
    WOC_AGENT_ID: process.env.WOC_AGENT_ID,
    WOC_ASSOCIATIONS_FILE: process.env.WOC_ASSOCIATIONS_FILE,
  };
  Object.assign(process.env, { WOC_AGENT_ID: "agent", WOC_ASSOCIATIONS_FILE: file });
  try {
    let hook;
    (target.default || target)({
      on: (event, fn) => {
        assert.equal(event, "before_agent_start");
        hook = fn;
      },
    });
    assert.match((await hook({ systemPrompt: "BASE" })).systemPrompt, /没有默认/);
    writeFileSync(file, JSON.stringify({ agent: { id: "machineA", name: "A" } }));
    assert.match((await hook({ systemPrompt: "BASE" })).systemPrompt, /machineA/);
    writeFileSync(file, JSON.stringify({ agent: { id: "machineB", name: "B" } }));
    const output = await hook({ systemPrompt: "BASE" });
    assert.equal(output.message.display, false);
    assert.match(output.message.content, /machineB/);
    const result = output.systemPrompt;
    assert.match(result, /machineB/);
    assert(!result.includes("machineA"));
    writeFileSync(file, "broken");
    await assert.rejects(hook({ systemPrompt: "BASE" }));
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

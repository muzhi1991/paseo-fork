// Run explicitly inside woc-agent. Creates a labelled disposable conversation;
// exercises model-visible target changes without computer tools or GUI writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPaseoClient } from "@getpaseo/client";
import { associationStore } from "../runtime/associations.mjs";
if (process.env.WOC_ACCEPTANCE_ALLOW_MODEL !== "1")
  throw Error("Set WOC_ACCEPTANCE_ALLOW_MODEL=1 to run this model-backed acceptance");
const client = createPaseoClient({
  url: "ws://127.0.0.1:6767/ws",
  password: readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim(),
});
const bindings = associationStore(
  process.env.WOC_ASSOCIATIONS_FILE || "/state/agent-associations.json",
);
let agent;
try {
  await client.connect();
  const workspace = await client.workspaces.open("/workspace/woc");
  agent = await workspace.agents.create({
    config: { provider: "pi/cliproxy/deepseek-flash" },
    title: "验收 · 每次任务目标",
    labels: { "woc/acceptance": "true" },
  });
  for (const id of ["acceptance-target-a", "acceptance-target-b", null]) {
    bindings.set(agent.id, id ? { id, name: id, mode: "desktop" } : null);
    const result = await agent.run(
      "这是上下文验收，不要调用工具、读取文件或操作电脑。只回答本次最新 WOC 任务目标的默认电脑 id；本次没有关联时回答 NONE。历史任务的目标已经失效。",
      { timeoutMs: 120000 },
    );
    assert.equal(result.status, "idle");
    assert.equal(result.lastMessage.trim().toLowerCase(), (id || "NONE").toLowerCase());
    console.log(JSON.stringify({ target: id, passed: true }));
  }
} finally {
  if (agent) {
    bindings.set(agent.id, null);
    await agent.archive();
  }
  await client.close();
}

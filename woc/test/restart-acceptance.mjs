import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
assert(["before", "after"].includes(process.argv[2]), "Pass before or after");
const client = new DaemonClient({
  url: "ws://127.0.0.1:6767/ws",
  password: readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim(),
  clientId: "woc-restart-acceptance",
  appVersion: "0.14.0",
});
await client.connect();
try {
  const list = await client.fetchAgents({
    filter: { includeArchived: true },
    page: { limit: 200 },
  });
  assert(!list.entries.some((e) => e.agent.status === "running"));
  const evidence = {
    agents: list.entries
      .map((e) => ({ id: e.agent.id, title: e.agent.title, model: e.agent.model }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    files: ["deepseek-flash.txt", "glm-5.3-flash.txt", "ui.txt"].map((n) => [
      n,
      createHash("sha256")
        .update(readFileSync("/workspace/woc/acceptance/" + n))
        .digest("hex"),
    ]),
    identities: ["deepseek-flash", "glm-5.3-flash"].map((n) => {
      const { agentId } = JSON.parse(readFileSync("/state/acceptance-" + n + ".json"));
      return [
        agentId,
        createHash("sha256")
          .update(readFileSync("/state/identities/" + agentId + "/token"))
          .digest("hex"),
      ];
    }),
  };
  if (process.argv[2] === "before")
    writeFileSync("/state/acceptance-restart-before.json", JSON.stringify(evidence));
  else
    assert.deepEqual(evidence, JSON.parse(readFileSync("/state/acceptance-restart-before.json")));
  console.log(
    JSON.stringify({
      phase: process.argv[2],
      agents: evidence.agents.length,
      files: evidence.files.length,
      stableIdentities: evidence.identities.length,
      plugins: (await client.listPlugins()).filter((p) => p.id === "woc-agent"),
    }),
  );
} finally {
  await client.close();
}

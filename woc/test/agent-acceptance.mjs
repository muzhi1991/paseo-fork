// Run inside the dedicated Agent container. Creates labelled, disposable sessions.
import { readFileSync, writeFileSync } from "node:fs";
import { createPaseoClient } from "@getpaseo/client";
const model = process.argv[2] || "deepseek-flash";
if (!["deepseek-flash", "glm-5.3-flash"].includes(model))
  throw new Error("Unknown acceptance model");
const client = createPaseoClient({
  url: "ws://127.0.0.1:6767/ws",
  password: readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim(),
});
await client.connect();
try {
  const workspace = await client.workspaces.open("/workspace/woc");
  const agent = await workspace.agents.create({
    config: { provider: `pi/cliproxy/${model}` },
    title: `接入验收 · ${model}`,
    labels: { "woc/acceptance": "true" },
  });
  writeFileSync(
    `/state/acceptance-${model}.json`,
    JSON.stringify({ agentId: agent.id, workspaceId: workspace.id }),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ created: agent.id, model, workspace: workspace.id }));
  const commands = await agent.commands();
  console.log(
    JSON.stringify({
      skills: commands.commands
        .filter((command) => command.kind === "skill")
        .map((command) => command.name),
      commandsError: commands.error,
    }),
  );
  const result = await agent.run(
    "这是 WOC 接入验收。请先读取 /opt/skills/woc-control/SKILL.md 和 /opt/skills/cua-spaces/SKILL.md，再通过已配置的 WOC MCP 查询机器列表，通过原生 Cua MCP 查询 Spaces 列表，核对数量与对应关系。在工作区创建 acceptance/" +
      model +
      ".txt，写入模型名和机器数量。禁止读取任何凭证文件；禁止申请 GUI 锁、点击、输入、发送微信消息或启动/停止机器。用中文简洁报告实际工具结果；工具失败就明确报告，不要虚构。",
    { timeoutMs: 180000 },
  );
  console.log(
    JSON.stringify({ status: result.status, error: result.error, reply: result.lastMessage }),
  );
  const timeline = await agent.timeline.refetch({ limit: 100 });
  writeFileSync(`/state/acceptance-timeline-${model}.json`, JSON.stringify(timeline), {
    mode: 0o600,
  });
  if (result.status !== "idle") process.exitCode = 1;
} finally {
  await client.close();
}

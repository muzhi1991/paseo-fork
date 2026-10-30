import { readFileSync, writeFileSync } from "node:fs";
import { createPaseoClient } from "@getpaseo/client";
const client = createPaseoClient({
  url: "ws://127.0.0.1:6767/ws",
  password: readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim(),
});
await client.connect();
try {
  const { agentId } = JSON.parse(readFileSync("/state/acceptance-deepseek-flash.json", "utf8"));
  const agent = client.agents.ref(agentId);
  const result = await agent.run(
    "继续做最小 GUI 验收，只操作完整桌面 dfde788ec9（Cua direct:192.168.31.101:13342）。先读 woc-control Skill，查锁，若有人持锁则停止。通过 WOC MCP 申请锁；通过原生 Cua MCP 查询 driver 的 get_desktop_state / move_cursor / get_cursor_position schema，读取桌面截图，使用 move_cursor 的 scope=desktop 将鼠标移动到 (60,60)，读取位置验证，最后主动释放 WOC 锁。除此之外禁止点击、键盘输入、应用启动、文件变更、发送消息；禁止使用 shell 或其他方法绕过 GUI 锁。清楚报告截图是否可见、移动与释放是否成功，工具失败要如实说明。",
    { timeoutMs: 180000 },
  );
  console.log(
    JSON.stringify({ status: result.status, error: result.error, reply: result.lastMessage }),
  );
  writeFileSync(
    "/state/acceptance-gui-timeline.json",
    JSON.stringify(await agent.timeline.refetch({ limit: 100 })),
    { mode: 0o600 },
  );
  if (result.status !== "idle") process.exitCode = 1;
} finally {
  await client.close();
}

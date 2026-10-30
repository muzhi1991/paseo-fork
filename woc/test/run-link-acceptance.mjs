import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
// Read-only live regression. Requires an existing Agent run whose conversation is archived.
// Pipe panel password on stdin or set WOC_PANEL_PASSWORD_FILE; no model tasks are sent.
const base = process.env.WOC_PANEL_URL || "http://192.168.31.101:36083";
const password = readFileSync(process.env.WOC_PANEL_PASSWORD_FILE || 0, "utf8").trim();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  await context.request.post(base + "/api/auth/login", { data: { username: "admin", password } });
  const runs = (await (await context.request.get(base + "/api/automation/runs")).json()).runs;
  const run = runs.find(
    (r) => r.result?.agent_id && (!process.env.WOC_RUN_ID || r.id === process.env.WOC_RUN_ID),
  );
  if (!run) throw Error("No matching agent run");
  const p = await context.newPage();
  await p.addInitScript(() => {
    window.__selectedAgents = [];
    window.addEventListener("message", (e) => {
      if (e.data?.type === "woc-agent-selected") window.__selectedAgents.push(e.data.agentId);
    });
  });
  await p.goto(base + "/automation");
  await p
    .locator(".auto-run")
    .nth(runs.findIndex((r) => r.id === run.id))
    .click();
  const link = p.getByRole("link", { name: "打开 Agent 会话" });
  await expect(link).toHaveAttribute("href", "/agent?conversation=" + run.result.agent_id);
  await link.click();
  const f = p.frameLocator('iframe[title="WOC AI 助手"]');
  await f.getByTestId("woc-target-picker").waitFor({ timeout: 30000 });
  await expect
    .poll(() => p.evaluate(() => window.__selectedAgents.at(-1)), { timeout: 15000 })
    .toBe(run.result.agent_id);
  await p.reload();
  await expect
    .poll(() => p.evaluate(() => window.__selectedAgents.at(-1)), { timeout: 30000 })
    .toBe(run.result.agent_id);
  // Directory reconciliation runs after initial navigation; an early match alone missed this bug.
  for (let i = 0; i < 15; i++) {
    await p.waitForTimeout(200);
    expect(await p.evaluate(() => window.__selectedAgents.at(-1))).toBe(run.result.agent_id);
  }
  console.log("Run history opens the recorded Agent, including after reload and reconciliation");
} finally {
  await browser.close();
}

// Pipe the panel password on stdin, or set WOC_PANEL_PASSWORD_FILE. Never log it.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  serviceWorkers: "block",
});
const panel = process.env.WOC_PANEL_URL || "http://192.168.31.101:36083";
try {
  const password = readFileSync(process.env.WOC_PANEL_PASSWORD_FILE || 0, "utf8").trim();
  assert(
    (
      await context.request.post(panel + "/api/auth/login", {
        data: { username: "admin", password },
      })
    ).ok(),
  );
  const page = await context.newPage();
  if (process.env.PERF_MBPS) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 20,
      downloadThroughput: (Number(process.env.PERF_MBPS) * 1000 * 1000) / 8,
      uploadThroughput: (Number(process.env.PERF_MBPS) * 1000 * 1000) / 8,
    });
  }
  const measurements = [];
  for (const mode of ["cold", "reload"]) {
    const started = performance.now();
    const sockets = [];
    page.removeAllListeners("websocket");
    page.on("websocket", (ws) => {
      sockets.push({
        path: new URL(ws.url()).pathname,
        opened: Math.round(performance.now() - started),
      });
    });
    if (mode === "cold") await page.goto(panel + "/agent", { waitUntil: "domcontentloaded" });
    else await page.reload({ waitUntil: "domcontentloaded" });
    const f = page.frameLocator('iframe[title="WOC AI 助手"]');
    await f.getByRole("button", { name: "＋ 新建会话", exact: true }).waitFor({ timeout: 60000 });
    await f
      .locator('[data-testid="woc-conversations"] button:not([disabled])')
      .first()
      .waitFor({ timeout: 60000 });
    const ready = performance.now() - started;
    const inner = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
    const perf = await inner.evaluate(() => ({
      navigation: performance.getEntriesByType("navigation").map((x) => ({
        ttfb: x.responseStart,
        load: x.loadEventEnd,
        dom: x.domContentLoadedEventEnd,
      })),
      resources: performance
        .getEntriesByType("resource")
        .map((x) => ({
          path: new URL(x.name).pathname,
          host: new URL(x.name).host,
          ms: Math.round(x.duration),
          start: Math.round(x.startTime),
          bytes: x.transferSize,
          decoded: x.decodedBodySize,
          encoded: x.encodedBodySize,
        }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 20),
    }));
    const row = { mode, readyMs: Math.round(ready), sockets, ...perf };
    measurements.push(row);
    console.log(JSON.stringify(row));
  }
  await context.request.post(panel + "/api/auth/logout");
  assert(measurements[0].readyMs < 6000, "Cold page readiness exceeds 6 seconds");
  assert(measurements[1].readyMs < 1500, "Cached page readiness exceeds 1.5 seconds");
  assert(
    measurements[1].resources
      .filter((x) => x.path.startsWith("/_expo/static/"))
      .every((x) => x.bytes === 0),
    "Static assets were downloaded again",
  );
  assert(
    !measurements[0].resources.some((x) => /\/html-[a-f0-9]+\.js$/.test(x.path)),
    "Ordinary chat loaded the Mermaid engine",
  );
} finally {
  await browser.close();
}

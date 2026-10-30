import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const pi = process.env.PI_CODING_AGENT_DIR;
const paseo = process.env.PASEO_HOME;
mkdirSync(pi, { recursive: true, mode: 0o700 });
mkdirSync(paseo, { recursive: true, mode: 0o700 });
writeFileSync(
  `${pi}/models.json`,
  JSON.stringify({
    providers: {
      cliproxy: {
        baseUrl: process.env.WOC_MODEL_BASE_URL,
        api: "openai-completions",
        apiKey: "!cat /run/secrets/cliproxy-key",
        models: ["deepseek-flash", "glm-5.3-flash"].map((id) => ({
          id,
          name: id,
          reasoning: false,
          input: ["text", "image"],
          contextWindow: 131072,
          maxTokens: 8192,
        })),
      },
    },
  }),
  { mode: 0o600 },
);
if (!existsSync(`${pi}/settings.json`))
  writeFileSync(
    `${pi}/settings.json`,
    JSON.stringify({
      defaultProvider: "cliproxy",
      defaultModel: "deepseek-flash",
      defaultThinkingLevel: "off",
      skills: ["/opt/skills"],
    }),
    { mode: 0o600 },
  );
if (!existsSync(`${paseo}/config.json`))
  writeFileSync(
    `${paseo}/config.json`,
    JSON.stringify({
      version: 1,
      daemon: {
        listen: "127.0.0.1:6767",
        hostnames: ["localhost", "127.0.0.1", new URL(process.env.WOC_AGENT_PUBLIC_URL).hostname],
        relay: { enabled: false },
      },
      pluginsEnabled: true,
      agents: {
        providers: {
          pi: { enabled: true },
          codex: { enabled: false },
          claude: { enabled: false },
          copilot: { enabled: false },
          opencode: { enabled: false },
          omp: { enabled: false },
          antigravity: { enabled: false },
          muse: { enabled: false },
        },
      },
      features: { webUi: { enabled: true } },
    }),
    { mode: 0o600 },
  );
const password = readFileSync(process.env.WOC_PASEO_PASSWORD_FILE, "utf8").trim();
const daemon = spawn("paseo", ["daemon", "run"], {
  stdio: "inherit",
  env: { ...process.env, PASEO_PASSWORD: password },
});
let bridge;
let stopped = false;
function stop(signal) {
  stopped = true;
  daemon.kill(signal);
  bridge?.kill(signal);
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop(signal));
daemon.on("exit", (code) => {
  bridge?.kill("SIGTERM");
  process.exit(code ?? 1);
});
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch("http://127.0.0.1:6767/api/health");
    if (r.ok) break;
  } catch {}
  if (stopped) process.exit(0);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const client = new DaemonClient({
  url: "ws://127.0.0.1:6767/ws",
  password,
  clientId: "woc-bootstrap",
  appVersion: "0.14.0",
});
try {
  await client.connect();
  const installed = (await client.listPlugins()).find((plugin) => plugin.id === "woc-agent");
  if (installed) await client.reloadPlugin("woc-agent");
  else await client.installDirectoryPlugin("/opt/paseo-woc/woc/plugin");
} finally {
  await client.close();
}
bridge = spawn("node", ["/opt/paseo-woc/woc/runtime/bridge.mjs"], {
  stdio: "inherit",
  env: process.env,
});
bridge.on("exit", (code) => {
  daemon.kill("SIGTERM");
  process.exit(code ?? 1);
});

import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const { reconcile } = await import(
  new URL("file:///opt/woc/integrations/cua-master-sync/sync.mjs")
);

const execute = promisify(execFile);
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.env.CUA_HOME = config.cuaHome;
mkdirSync(config.cuaHome, { recursive: true, mode: 0o700 });
const ledger = join(config.cuaHome, "woc-sync.json");
const saved = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8")) : null;
let state = saved;
async function sync() {
  const credential = readFileSync(config.tokenFile, "utf8").trim();
  const response = await fetch(`${config.panelUrl}/api/integrations/cua/snapshot`, {
    headers: { authorization: `Bearer ${credential}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`WOC machine sync failed (${response.status})`);
  const snapshot = await response.json();
  state ??= { deploymentId: snapshot.deploymentId, revision: -1, records: {} };
  const cli = async (args, token) =>
    execute("cua", ["--embedded", ...args], {
      env: { ...process.env, ...(token ? { CUA_ENV_TOKEN: token } : {}) },
      timeout: 20000,
      maxBuffer: 4194304,
    });
  await reconcile(
    snapshot,
    state,
    {
      list: async () => JSON.parse((await cli(["spaces", "ls", "--json"])).stdout).spaces,
      add: async (endpoint, name, token) => {
        await cli(["spaces", "add", endpoint, "--name", name], token);
      },
      remove: async (ref) => {
        await cli(["spaces", "rm", ref]);
      },
      save: async (value) => {
        writeFileSync(`${ledger}.tmp`, JSON.stringify(value), { mode: 0o600 });
        renameSync(`${ledger}.tmp`, ledger);
      },
      // Registration diagnostics of the existing Mac coordinator remain independent.
      ack: async () => {},
    },
    {
      deploymentId: snapshot.deploymentId,
      namespace: snapshot.namespace,
      allowedHost: new URL(config.panelUrl).hostname,
      firstPort: 13340,
      lastPort: 13359,
    },
  );
}
await sync();
const child = spawn("cua", ["--embedded", "mcp"], { stdio: "inherit", env: process.env });
let stopped = false;
async function refresh() {
  if (stopped) return;
  try {
    await sync();
  } catch {
    process.stderr.write("WOC machine refresh failed; retaining existing registrations.\n");
  }
  if (!stopped) setTimeout(refresh, 15000);
}
setTimeout(refresh, 15000);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    child.kill(signal);
  });
child.on("exit", (code) => {
  stopped = true;
  process.exit(code ?? 1);
});

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepareIdentity(agentId: string, label: string) {
  if (!/^[a-f0-9-]{36}$/.test(agentId)) throw new Error("Invalid Paseo agent ID");
  const panelUrl = process.env.WOC_PANEL_URL;
  const root = process.env.WOC_IDENTITIES_DIR;
  const provisionFile = process.env.WOC_PROVISION_TOKEN_FILE;
  if (!panelUrl || !root || !provisionFile) throw new Error("WOC launcher configuration missing");
  const directory = join(root, agentId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tokenFile = join(directory, "token");
  try {
    await writeFile(tokenFile, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const token = (await readFile(tokenFile, "utf8")).trim();
  const provision = (await readFile(provisionFile, "utf8")).trim();
  const response = await fetch(`${panelUrl}/api/integrations/agent/clients`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${provision}`, "content-type": "application/json" },
    body: JSON.stringify({
      agentId,
      label: label.slice(0, 48),
      tokenHash: createHash("sha256").update(token).digest("hex"),
    }),
  });
  if (!response.ok) throw new Error(`WOC identity provisioning failed (${response.status})`);
  const config = join(directory, "client.json");
  const cuaHome = join(directory, "cua");
  await writeFile(config, JSON.stringify({ panelUrl, tokenFile, cuaHome }), { mode: 0o600 });
  return { config, cuaHome };
}

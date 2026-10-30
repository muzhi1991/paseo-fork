import { readFileSync } from "node:fs";
export async function proxyTrigger(req, res, { webhook = false } = {}) {
  const path = webhook ? req.url : req.url.replace(/^\/automation/, "");
  try {
    const token = webhook
      ? req.headers.authorization || ""
      : "Bearer " +
        readFileSync(
          process.env.WOC_TRIGGER_TOKEN_FILE || "/state/automation/admin.token",
          "utf8",
        ).trim();
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536) {
        res.writeHead(413);
        res.end('{"error":"Input too large"}');
        return;
      }
    }
    const r = await fetch("http://127.0.0.1:6771" + path, {
      method: req.method,
      headers: { authorization: token, "content-type": "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : raw,
      signal: AbortSignal.timeout(15000),
    });
    res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(await r.text());
  } catch {
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":"自动化服务暂时不可用"}');
  }
}

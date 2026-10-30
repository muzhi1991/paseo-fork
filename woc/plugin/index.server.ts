import type { PluginServerContext } from "@getpaseo/plugin/server";
import { prepareIdentity } from "./server/identity";

export default function contribute(server: PluginServerContext) {
  return server.addHook("agent.open.before", async ({ request }) => {
    const identity = await prepareIdentity(
      request.agentId,
      request.title || request.agentId.slice(0, 8),
    );
    return {
      ...request,
      env: {
        ...request.env,
        WOC_CLIENT_CONFIG: identity.config,
        CUA_HOME: identity.cuaHome,
        WOC_AGENT_ID: request.agentId,
        WOC_ASSOCIATIONS_FILE:
          process.env.WOC_ASSOCIATIONS_FILE || "/state/agent-associations.json",
      },
      mcpServers: {
        ...request.mcpServers,
        woc: {
          type: "stdio",
          command: "node",
          args: ["/opt/woc/integrations/woc-mcp/server.mjs", identity.config],
        },
        cua: {
          type: "stdio",
          command: "node",
          args: ["/opt/paseo-woc/woc/runtime/cua-mcp.mjs", identity.config],
        },
      },
    };
  });
}

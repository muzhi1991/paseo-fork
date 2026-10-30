import { useFetchQuery } from "@/data/query";
import { z } from "zod";
const schema = z.object({
  workspaceId: z.string().min(1),
  workspacePath: z.string(),
  provider: z.literal("pi"),
  model: z.string(),
  models: z.array(z.string()),
});
export function useWocConfig() {
  return useFetchQuery({
    dataShape: "value",
    immutableWhen: () => true,
    queryKey: ["woc-config"],
    queryFn: async () => {
      const response = await fetch("/woc-config");
      if (!response.ok) throw new Error("AI 服务未就绪，请检查 WOC 登录状态");
      return schema.parse(await response.json());
    },
  });
}

import { useIsCompactFormFactor } from "@/constants/layout";
import { EditingTextInput } from "@/components/ui/text-input";
import { useCallback, useEffect, useState, useRef } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useWocConfig } from "./config";
import { isWocEmbedded } from "./mode";
export interface WocMachine {
  id: string;
  name: string;
  status: string;
  mode: string;
}
const params = isWocEmbedded ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const entryMachine = params.get("woc_machine");
export const entryAgent = params.get("woc_agent");
export async function wocRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch("/woc-api/" + path, {
    method,
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10000),
    ...(method === "GET" || body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(Error(data.error || "请求失败"), { status: r.status });
  return data;
}
export const associate = (agentId: string, machineId: string | null) =>
  wocRequest("associations/" + agentId, "PUT", { machine_id: machineId });
export function useWocMachines() {
  return useFetchQuery({
    queryKey: ["woc-machines"],
    dataShape: "value",
    staleTimeMs: 5000,
    refetchInterval: 15000,
    queryFn: () => wocRequest<{ machines: WocMachine[] }>("machines"),
  });
}
export function WocTargetPicker({ agentId }: { agentId: string }) {
  const compact = useIsCompactFormFactor();
  const machines = useWocMachines(),
    cache = useQueryClient();
  const target = useFetchQuery({
    queryKey: ["woc-association", agentId],
    dataShape: "value",
    staleTimeMs: 1000,
    refetchInterval: 3000,
    queryFn: () =>
      wocRequest<{ machine: WocMachine | null; busy: boolean }>("associations/" + agentId),
  });
  const change = useMutation({
    mutationFn: (id: string | null) => associate(agentId, id),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["woc-association", agentId] }),
  });
  const { mutate: changeTarget } = change;
  const clear = useCallback(() => changeTarget(null), [changeTarget]);
  const selected = target.data?.machine;
  useEffect(() => {
    window.parent.postMessage(
      { type: "woc-agent-selected", agentId },
      new URL(document.referrer || window.location.href).origin,
    );
  }, [agentId]);
  const open = useCallback(() => {
    if (selected)
      window.parent.postMessage(
        { type: "woc-open-machine", machineId: selected.id },
        new URL(document.referrer || window.location.href).origin,
      );
  }, [selected]);
  return (
    <View style={styles.row}>
      <DropdownMenu>
        <ToolbarButton
          kind="menu"
          label="关联电脑"
          disabled={target.data?.busy || change.isPending}
          testID="woc-target-picker"
        >
          <Text style={styles.label} numberOfLines={1}>
            {selected?.name || "关联电脑"} ▾
          </Text>
        </ToolbarButton>
        <DropdownMenuContent align="end" width={220}>
          <DropdownMenuItem onSelect={clear}>不关联电脑</DropdownMenuItem>
          {machines.data?.machines.map((m) => (
            <MachineChoice key={m.id} machine={m} select={change.mutate} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected && !compact && (
        <Button size="xs" variant="ghost" onPress={open}>
          打开电脑
        </Button>
      )}
      {(change.error || target.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {(change.error || target.error)?.message}
        </Text>
      )}
    </View>
  );
}
function MachineChoice({ machine, select }: { machine: WocMachine; select: (id: string) => void }) {
  const choose = useCallback(() => select(machine.id), [machine.id, select]);
  return (
    <DropdownMenuItem onSelect={choose}>
      {machine.name}
      {machine.status === "running" ? "" : " · 离线"}
    </DropdownMenuItem>
  );
}
// Launch context is read once from the iframe URL, not from untrusted postMessage data.
export function WocMachineEntry({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId),
    config = useWocConfig(),
    cache = useQueryClient();
  const [ready, setReady] = useState(!entryMachine && !entryAgent),
    [missing, setMissing] = useState(false),
    [text, setText] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError("");
    setAttempt((value) => value + 1);
  }, []);
  const backToRuns = useCallback(() => {
    if (document.referrer) window.open(new URL("/automation", document.referrer).href, "_top");
  }, []);
  const workspaceId = config.data?.workspaceId;
  useEffect(() => {
    if (!client || !workspaceId || ready || missing) return;
    let live = true;
    void (async () => {
      let id = entryAgent;
      if (!id) {
        const bindings = await wocRequest<{ associations: Record<string, WocMachine> }>(
          "associations",
        );
        const history = await client.fetchAgents({
          filter: { includeArchived: false },
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: 200 },
        });
        id =
          history.entries.find(
            (e) =>
              e.agent.workspaceId === workspaceId &&
              bindings.associations[e.agent.id]?.id === entryMachine,
          )?.agent.id || null;
      }
      if (id) await wocRequest("associations/" + encodeURIComponent(id));
      if (!live) return;
      if (id) {
        // Explicit history links must survive reconciliation of the active-only directory.
        navigateToAgent({ serverId, agentId: id, workspaceId, pin: true });
        setReady(true);
      } else setMissing(true);
    })().catch((e) => {
      if (live)
        setError(
          e.status === 404
            ? "会话已删除或不存在，无法打开。"
            : "暂时无法打开会话，请检查连接后重试。",
        );
    });
    return () => {
      live = false;
    };
  }, [client, workspaceId, ready, missing, serverId, attempt]);
  const created = useRef<string | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      if (!client || !config.data || !text.trim()) return;
      if (created.current) {
        navigateToAgent({
          serverId,
          agentId: created.current,
          workspaceId: config.data.workspaceId,
        });
        setReady(true);
        return;
      }
      const agent = await client.createAgent({
        workspaceId: config.data.workspaceId,
        cwd: config.data.workspacePath,
        provider: "pi",
        model: config.data.model,
      });
      try {
        await associate(agent.id, entryMachine);
      } catch (e) {
        await client.deleteAgent(agent.id);
        throw e;
      }
      created.current = agent.id;
      await cache.invalidateQueries({ queryKey: ["woc-conversations", serverId] });
      try {
        await client.sendMessage(agent.id, text);
      } catch {
        throw Error("会话已创建，消息提交结果待核对。请打开会话查看，不要重复发送。");
      }
      navigateToAgent({ serverId, agentId: agent.id, workspaceId: config.data.workspaceId });
      setReady(true);
    },
  });
  const { mutate: startTask } = start;
  const submit = useCallback(() => startTask(), [startTask]);
  const entryTitle = missing ? "在这台电脑开始新对话" : "正在打开关联会话…";
  if (ready) return null;
  return (
    <View style={styles.entry} testID="woc-machine-entry">
      <View style={styles.entryCard}>
        <Text style={styles.title}>{error ? "无法打开会话" : entryTitle}</Text>
        {missing && (
          <>
            <EditingTextInput
              accessibilityLabel="这台电脑的任务"
              multiline
              onChangeText={setText}
              placeholder="想让助手做什么？"
              style={styles.input}
            />
            <Button
              onPress={submit}
              disabled={!text.trim() || start.isPending}
              loading={start.isPending}
            >
              {created.current ? "打开已创建会话" : "开始对话"}
            </Button>
          </>
        )}
        {error && (
          <>
            <Button onPress={retry}>重试</Button>
            {document.referrer && <Button onPress={backToRuns}>返回运行记录</Button>}
          </>
        )}
        {(error || start.error) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error || start.error?.message}
          </Text>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexShrink: 1 },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, maxWidth: 150 },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
  entry: {
    position: "absolute",
    inset: 0,
    zIndex: 200,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  entryCard: { width: "100%", maxWidth: 480, padding: theme.spacing[6], gap: theme.spacing[4] },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    minHeight: 120,
    color: theme.colors.foreground,
  },
}));

import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient, FetchAgentsEntry } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useFetchQuery } from "@/data/query";
import { useHosts, useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useDirectoryDemand } from "@/hooks/use-directory-demand";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { isWeb } from "@/constants/platform";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { useWocConfig } from "./config";

export function WocSidebar({ active }: { active: boolean }) {
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId;
  if (!active || !serverId) return null;
  return <WocConversations serverId={serverId} />;
}
async function fetchHistory(client: DaemonClient) {
  const entries: FetchAgentsEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.fetchAgents({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200, cursor },
    });
    entries.push(...page.entries);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}
function WocConversations({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  useDirectoryDemand(serverId);
  const config = useWocConfig();
  const cache = useQueryClient();
  const isCompact = useIsCompactFormFactor();
  const [archived, setArchived] = useState(false);
  const [model, setModel] = useState("cliproxy/deepseek-flash");
  const history = useFetchQuery({
    queryKey: ["woc-conversations", serverId],
    dataShape: "list",
    staleTimeMs: 5000,
    enabled: !!client,
    refetchInterval: 10000,
    queryFn: () => {
      if (!client) throw new Error("Agent 服务未连接");
      return fetchHistory(client);
    },
  });
  const action = useMutation({
    mutationFn: async (run: () => Promise<void>) => run(),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["woc-conversations", serverId] }),
  });
  const { mutate } = action;
  const workspaceId = config.data?.workspaceId;
  const open = useCallback(
    (id: string) => {
      navigateToAgent({ serverId, agentId: id, workspaceId });
      if (isCompact) usePanelStore.getState().showMobileAgent();
    },
    [serverId, workspaceId, isCompact],
  );
  const create = useCallback(
    () =>
      mutate(async () => {
        if (!client || !workspaceId || !config.data) throw new Error("Agent 服务未就绪");
        const agent = await client.createAgent({
          workspaceId,
          cwd: config.data.workspacePath,
          provider: "pi",
          model,
        });
        setArchived(false);
        open(agent.id);
      }),
    [mutate, client, workspaceId, config.data, model, open],
  );
  const files = useCallback(() => {
    if (workspaceId)
      openExplorerSidebarView({
        isCompact,
        workspaceKey: `${serverId}:${workspaceId}`,
        view: "files",
      });
  }, [isCompact, serverId, workspaceId]);
  const showCurrent = useCallback(() => setArchived(false), []);
  const showArchived = useCallback(() => setArchived(true), []);
  const conversations = (history.data ?? []).filter(
    (entry) => entry.agent.workspaceId === workspaceId && !!entry.agent.archivedAt === archived,
  );
  const error = action.error ?? history.error ?? config.error;
  return (
    <View style={[styles.sidebar, isCompact && styles.overlay]}>
      <View style={styles.heading}>
        <Text style={styles.title}>AI 助手</Text>
        <Text style={styles.hint}>所有电脑 · 共享工作区</Text>
      </View>
      <View style={styles.controls}>
        <Button
          disabled={!workspaceId}
          loading={action.isPending}
          style={styles.primary}
          textStyle={styles.primaryText}
          onPress={create}
        >
          ＋ 新建会话
        </Button>
        <Text style={styles.hint}>新会话使用的模型</Text>
        <View style={styles.row}>
          {config.data?.models.map((value) => (
            <ModelChoice key={value} value={value} selected={model === value} onSelect={setModel} />
          ))}
        </View>
        <View style={styles.row}>
          <Button variant={archived ? "ghost" : "secondary"} size="sm" onPress={showCurrent}>
            会话
          </Button>
          <Button variant={archived ? "secondary" : "ghost"} size="sm" onPress={showArchived}>
            已归档
          </Button>
          <Button variant="ghost" size="sm" onPress={files}>
            文件
          </Button>
        </View>
      </View>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error.message}
        </Text>
      )}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {!conversations.length && (
          <Text style={styles.hint}>{history.isPending ? "正在读取会话…" : "这里还没有会话"}</Text>
        )}
        {client &&
          conversations.map(({ agent }) => (
            <Conversation
              key={agent.id}
              agent={agent}
              client={client}
              onOpen={open}
              run={action.mutate}
              busy={action.isPending}
            />
          ))}
      </ScrollView>
      <Text style={styles.footer}>可读取电脑状态；操作前会申请控制权。</Text>
    </View>
  );
}
interface ModelChoiceProps {
  value: string;
  selected: boolean;
  onSelect(value: string): void;
}
function ModelChoice({ value, selected, onSelect }: ModelChoiceProps) {
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button variant={selected ? "secondary" : "ghost"} size="xs" onPress={select}>
      {value.replace("cliproxy/", "")}
    </Button>
  );
}
interface ConversationProps {
  agent: FetchAgentsEntry["agent"];
  client: DaemonClient;
  onOpen(id: string): void;
  run(task: () => Promise<void>): void;
  busy: boolean;
}
function Conversation({ agent, client, onOpen, run, busy }: ConversationProps) {
  const open = useCallback(() => onOpen(agent.id), [onOpen, agent.id]);
  const archive = useCallback(
    () =>
      run(async () => {
        await client.archiveAgent(agent.id);
      }),
    [run, client, agent.id],
  );
  const restore = useCallback(
    () =>
      run(async () => {
        if (!agent.persistence) throw new Error("此会话没有可恢复的运行记录");
        // Restore by Paseo ID, matching the upstream Unarchive action. Resuming a
        // provider handle can create a second record with a different identity.
        await client.refreshAgent(agent.id);
        onOpen(agent.id);
      }),
    [run, client, agent.persistence, agent.id, onOpen],
  );
  const remove = useCallback(() => {
    if (isWeb && window.confirm("删除这个会话及其 Paseo 历史记录？工作区文件会保留。"))
      run(async () => {
        await client.deleteAgent(agent.id);
      });
  }, [run, client, agent.id]);
  return (
    <View style={styles.conversation}>
      <PressHighlight
        accessibilityRole="button"
        onPress={open}
        style={styles.open}
        highlightStyle={styles.selected}
      >
        <Text numberOfLines={2} style={styles.name}>
          {agent.title || "未命名会话"}
        </Text>
        <Text style={styles.hint}>
          {agent.status === "running" ? "正在处理" : "点击查看历史"} ·{" "}
          {new Date(agent.updatedAt).toLocaleDateString("zh-CN")}
        </Text>
      </PressHighlight>
      <View style={styles.row}>
        {!agent.archivedAt && (
          <Button disabled={busy} variant="ghost" size="xs" onPress={archive}>
            归档
          </Button>
        )}
        {!!agent.archivedAt && !!agent.persistence && (
          <Button disabled={busy} variant="ghost" size="xs" onPress={restore}>
            恢复
          </Button>
        )}
        <Button disabled={busy} variant="ghost" size="xs" onPress={remove}>
          删除
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  sidebar: {
    width: 280,
    flexShrink: 0,
    backgroundColor: theme.colors.background,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    height: "100%",
  },
  overlay: { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 100 },
  heading: { padding: 20, gap: 6 },
  title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "600" },
  hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
  label: { color: theme.colors.foreground, fontSize: 12 },
  controls: { paddingHorizontal: 14, gap: 12, paddingBottom: 14 },
  primary: { backgroundColor: "#497e50", borderRadius: 8, padding: 12, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  model: { padding: 7, borderRadius: 6 },
  selected: { backgroundColor: theme.colors.surface2 },
  tab: { padding: 9, borderRadius: 6 },
  list: { flex: 1 },
  listContent: { padding: 14, gap: 8 },
  conversation: { borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingBottom: 8 },
  open: { paddingVertical: 8, gap: 5 },
  name: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
  small: { padding: 5 },
  error: { color: "#b43d37", padding: 14, fontSize: 12 },
  footer: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 17, padding: 14 },
}));

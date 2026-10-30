import { WocMachineEntry, entryMachine, associate } from "./association";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
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
import { Archive, MessageSquare, MoreVertical } from "lucide-react-native";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { SidebarCloseButton } from "@/components/headers/sidebar-close-button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useWocConfig } from "./config";

const ArchiveIcon = withUnistyles(Archive);
const ChatsIcon = withUnistyles(MessageSquare);
const MoreIcon = withUnistyles(MoreVertical);
const moreIcon = <MoreIcon size={16} uniProps={mutedIconColorMapping} />;
const archiveIcon = <ArchiveIcon size={18} uniProps={mutedIconColorMapping} />;
const chatsIcon = <ChatsIcon size={18} uniProps={mutedIconColorMapping} />;

export function WocSidebar({ active }: { active: boolean }) {
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId;
  if (!serverId) return null;
  return (
    <>
      <WocMachineEntry serverId={serverId} />
      {active && <WocConversations serverId={serverId} />}
    </>
  );
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
          model: config.data.model,
        });
        if (entryMachine) {
          try {
            await associate(agent.id, entryMachine);
          } catch (error) {
            await client.deleteAgent(agent.id);
            throw error;
          }
        }
        setArchived(false);
        open(agent.id);
      }),
    [mutate, client, workspaceId, config.data, open],
  );
  const toggleArchived = useCallback(() => setArchived((value) => !value), []);
  const close = useCallback(() => usePanelStore.getState().showMobileAgent(), []);
  const conversations = (history.data ?? []).filter(
    (entry) => entry.agent.workspaceId === workspaceId && !!entry.agent.archivedAt === archived,
  );
  const error = action.error ?? history.error ?? config.error;
  return (
    <View testID="woc-conversations" style={[styles.sidebar, isCompact && styles.overlay]}>
      <View style={styles.heading}>
        <Text style={styles.title}>{archived ? "已归档" : "AI 助手"}</Text>
        {isCompact && (
          <SidebarCloseButton label="关闭会话列表" onPress={close} testID="woc-sidebar-close" />
        )}
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
      <View style={styles.footer}>
        <ToolbarButton
          label={archived ? "返回会话" : "已归档会话"}
          selected={archived}
          onPress={toggleArchived}
          testID="woc-archive-toggle"
        >
          {archived ? chatsIcon : archiveIcon}
        </ToolbarButton>
      </View>
    </View>
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
  const remove = useCallback(async () => {
    if (
      await confirmDialog({
        title: "删除会话",
        message: "删除这个会话及其历史记录？工作区文件会保留。",
        confirmLabel: "删除",
        cancelLabel: "取消",
        destructive: true,
      })
    )
      run(async () => {
        await client.deleteAgent(agent.id);
      });
  }, [run, client, agent.id]);
  return (
    <View style={styles.conversation} testID={`woc-conversation-${agent.id}`}>
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={agent.title || "未命名会话"}
        onPress={open}
        style={styles.open}
        highlightStyle={styles.selected}
      >
        <Text numberOfLines={1} style={styles.name}>
          {agent.title || "未命名会话"}
        </Text>
        <Text style={styles.hint}>
          {new Date(agent.updatedAt).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </PressHighlight>
      <DropdownMenu>
        <ToolbarButton kind="menu" label="会话操作" testID={`woc-conversation-menu-${agent.id}`}>
          {moreIcon}
        </ToolbarButton>
        <DropdownMenuContent align="end" width={160}>
          {!agent.archivedAt && (
            <DropdownMenuItem disabled={busy} onSelect={archive}>
              归档
            </DropdownMenuItem>
          )}
          {!!agent.archivedAt && !!agent.persistence && (
            <DropdownMenuItem disabled={busy} onSelect={restore}>
              恢复
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={busy} destructive onSelect={remove}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  heading: {
    padding: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 18 },
  controls: { paddingHorizontal: theme.spacing[3], paddingBottom: theme.spacing[3] },
  primary: { backgroundColor: "#497e50", borderRadius: theme.borderRadius.md },
  primaryText: { color: "#fff", fontWeight: theme.fontWeight.medium },
  selected: { backgroundColor: theme.colors.interactionHighlight },
  list: { flex: 1 },
  listContent: { padding: theme.spacing[2], gap: theme.spacing[1] },
  conversation: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  open: {
    flex: 1,
    minWidth: 0,
    padding: theme.spacing[2],
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.base, lineHeight: 20 },
  error: {
    color: theme.colors.destructive,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  footer: { padding: theme.spacing[3], alignItems: "flex-start" },
}));

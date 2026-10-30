import { useCallback } from "react";
import { FolderOpen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import {
  hideExplorerSidebar,
  openExplorerSidebarView,
  useIsExplorerSidebarOpen,
} from "@/workspace-tabs/explorer-sidebar";

const FolderIcon = withUnistyles(FolderOpen);
const folderIcon = <FolderIcon size={18} uniProps={mutedIconColorMapping} />;

export function WocFilesToggle({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const workspaceKey = `${serverId}:${workspaceId}`;
  const opened = useIsExplorerSidebarOpen({ isCompact: false, workspaceKey });
  const toggle = useCallback(() => {
    if (opened) hideExplorerSidebar({ isCompact: false, workspaceKey });
    else openExplorerSidebarView({ isCompact: false, workspaceKey, view: "files" });
  }, [opened, workspaceKey]);
  return (
    <ToolbarButton
      label={opened ? "收起文件" : "文件"}
      selected={opened}
      onPress={toggle}
      testID="woc-files-toggle"
    >
      {folderIcon}
    </ToolbarButton>
  );
}

import { Redirect } from "expo-router";
import { Text } from "react-native";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useWocConfig } from "./config";
export function WocHostIndex({ serverId }: { serverId: string }) {
  const config = useWocConfig();
  if (config.error) return <Text>{config.error.message}</Text>;
  if (!config.data) return <StartupSplashScreen />;
  return <Redirect href={buildHostWorkspaceRoute(serverId, config.data.workspaceId)} />;
}

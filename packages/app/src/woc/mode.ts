import { isWeb } from "@/constants/platform";

function embeddedMode(): boolean {
  if (!isWeb || typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get("woc");
  if (value === "1" || value === "0") window.sessionStorage.setItem("woc-mode", value);
  return window.sessionStorage.getItem("woc-mode") === "1";
}
export const isWocEmbedded = embeddedMode();

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function setContentProtection(on: boolean): Promise<boolean> {
  if (!inTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("set_content_protection", { on });
}

export interface AppInfo { version: string; os: string; content_protection_supported: boolean }

export async function appInfo(): Promise<AppInfo> {
  if (!inTauri()) return { version: "dev (browser)", os: "browser", content_protection_supported: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppInfo>("app_info");
}

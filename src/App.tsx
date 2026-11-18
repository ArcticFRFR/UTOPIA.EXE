import { useEffect, useState } from "react";
import { ChartPage } from "./chart/ChartPage";
import { CopyPage } from "./copy/CopyPage";
import { DEFAULT_SETTINGS, type ProviderSettings } from "./data/provider";
import { JournalPage } from "./journal/JournalPage";
import { loadSetting, saveSetting } from "./lib/store";
import { appInfo, setContentProtection, type AppInfo } from "./lib/tauri";
import { SettingsPage } from "./settings/SettingsPage";
import { VaultPage } from "./vault/VaultPage";

type View = "chart" | "journal" | "vault" | "copy" | "settings";

const NAV: Array<{ id: View; kanji: string; label: string }> = [
  { id: "chart", kanji: "図", label: "Chart" },
  { id: "journal", kanji: "記", label: "Journal" },
  { id: "vault", kanji: "封", label: "Vault" },
  { id: "copy", kanji: "写", label: "Copy" },
];

export function App() {
  const [view, setView] = useState<View>("chart");
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [shield, setShield] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void (async () => {
      const i = await appInfo();
      setInfo(i);
      const saved = await loadSetting<ProviderSettings | null>("provider", null);
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved });
      else setSettings({ ...DEFAULT_SETTINGS, provider: i.databento_builtin ? "databento" : "demo" });
    })();
    void loadSetting<boolean>("shield", false).then(setShield);
  }, []);

  // The capture block: the vault forces it on; elsewhere it follows the user's setting.
  useEffect(() => {
    void setContentProtection(view === "vault" || shield);
  }, [view, shield]);

  const updateSettings = (s: ProviderSettings) => { setSettings(s); void saveSetting("provider", s); };
  const updateShield = (on: boolean) => { setShield(on); void saveSetting("shield", on); };

  if (!settings) return null;

  return (
    <div className="app">
      <nav className="rail">
        <div className="mark" title="Utopia" />
        {NAV.map((n) => (
          <button key={n.id} className={view === n.id ? "active" : ""} title={n.label} onClick={() => setView(n.id)}>
            <span className="k">{n.kanji}</span>
          </button>
        ))}
        <div className="spacer" />
        <div className={`rec ${view === "vault" || shield ? "" : "off"}`} title={view === "vault" || shield ? "Screen capture blocked" : "Screen capture allowed"} />
        <button className={view === "settings" ? "active" : ""} title="Settings" onClick={() => setView("settings")}>⚙</button>
      </nav>
      {view === "chart" && <ChartPage settings={settings} />}
      {view === "journal" && <JournalPage />}
      {view === "vault" && <VaultPage supported={info?.content_protection_supported ?? false} />}
      {view === "copy" && <CopyPage />}
      {view === "settings" && (
        <SettingsPage settings={settings} onChange={updateSettings} shield={shield} onShield={updateShield} info={info} />
      )}
    </div>
  );
}

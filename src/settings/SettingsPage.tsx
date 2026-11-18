import { PROJECTX_HOSTS, type ProviderId, type ProviderSettings } from "@/data/provider";
import type { AppInfo } from "@/lib/tauri";

interface Props {
  settings: ProviderSettings;
  onChange: (s: ProviderSettings) => void;
  shield: boolean;
  onShield: (on: boolean) => void;
  info: AppInfo | null;
}

export function SettingsPage({ settings, onChange, shield, onShield, info }: Props) {
  const set = <K extends keyof ProviderSettings>(k: K, v: ProviderSettings[K]) => onChange({ ...settings, [k]: v });
  const tv = settings.tradovate, px = settings.projectx, rt = settings.rithmic, db = settings.databento;

  return (
    <section className="view page">
      <h1>Settings</h1>
      <p className="lead">Pick where the chart gets its data. Credentials stay on this computer in the app's settings file; nothing is sent anywhere except to the broker you choose.</p>

      <div className="card">
        <h2>Data source</h2>
        <div className="field">
          <label>Provider</label>
          <select value={settings.provider} onChange={(e) => set("provider", e.target.value as ProviderId)}>
            <option value="demo">Demo (offline random walk)</option>
            <option value="databento">Databento (licensed CME feed)</option>
            <option value="tradovate">Tradovate</option>
            <option value="projectx">ProjectX (TopstepX, Alpha Futures, Bulenox)</option>
            <option value="rithmic">Rithmic (not wired yet)</option>
          </select>
        </div>

        {settings.provider === "databento" && (
          <>
            <div className="field"><label>API key</label><input type="password" value={db.apiKey} onChange={(e) => set("databento", { ...db, apiKey: e.target.value })} placeholder="db-..." /></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <button className={`toggle ${db.live ? "on" : ""}`} onClick={() => set("databento", { ...db, live: !db.live })} aria-label="Live stream" />
              <span className="hint">Live stream (needs a Databento CME plan; history alone works on pay-as-you-go credit)</span>
            </div>
            <p className="hint">Keys: databento.com → Portal → API keys. Dataset GLBX.MDP3. "NQ" charts the front month; a dated symbol like NQZ6 is used as-is.</p>
          </>
        )}

        {settings.provider === "tradovate" && (
          <>
            <div className="row2">
              <div className="field"><label>Environment</label>
                <select value={tv.environment} onChange={(e) => set("tradovate", { ...tv, environment: e.target.value as "demo" | "live" })}>
                  <option value="demo">Demo</option><option value="live">Live</option>
                </select>
              </div>
              <div className="field"><label>Username</label><input value={tv.username} onChange={(e) => set("tradovate", { ...tv, username: e.target.value })} /></div>
            </div>
            <div className="field"><label>Password</label><input type="password" value={tv.password} onChange={(e) => set("tradovate", { ...tv, password: e.target.value })} /></div>
            <div className="row2">
              <div className="field"><label>API cid</label><input value={tv.cid} onChange={(e) => set("tradovate", { ...tv, cid: e.target.value })} /></div>
              <div className="field"><label>API secret</label><input type="password" value={tv.secret} onChange={(e) => set("tradovate", { ...tv, secret: e.target.value })} /></div>
            </div>
            <p className="hint">Tradovate: Settings → API Access → add an application; the cid and secret are shown there. Market data needs the account's data subscription.</p>
          </>
        )}

        {settings.provider === "projectx" && (
          <>
            <div className="row2">
              <div className="field"><label>Firm</label>
                <select value={px.firm} onChange={(e) => set("projectx", { ...px, firm: e.target.value as ProviderSettings["projectx"]["firm"] })}>
                  {Object.entries(PROJECTX_HOSTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Username</label><input value={px.username} onChange={(e) => set("projectx", { ...px, username: e.target.value })} /></div>
            </div>
            <div className="field"><label>API key</label><input type="password" value={px.apiKey} onChange={(e) => set("projectx", { ...px, apiKey: e.target.value })} /></div>
            <p className="hint">Created in the firm's dashboard under API access (a paid add-on at most firms). Symbols: NQ, NQZ6, ENQ.</p>
          </>
        )}

        {settings.provider === "rithmic" && (
          <>
            <div className="row2">
              <div className="field"><label>System</label><input value={rt.system} onChange={(e) => set("rithmic", { ...rt, system: e.target.value })} /></div>
              <div className="field"><label>Username</label><input value={rt.username} onChange={(e) => set("rithmic", { ...rt, username: e.target.value })} /></div>
            </div>
            <div className="field"><label>Password</label><input type="password" value={rt.password} onChange={(e) => set("rithmic", { ...rt, password: e.target.value })} /></div>
            <p className="hint">Rithmic's R|Protocol API needs their developer agreement and conformance test before credentials work. Until then use Tradovate or ProjectX.</p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Screen capture block</h2>
        <p>Blacks this window out in OBS, Xbox Game Bar, Teams, Discord streams and other software recorders. Always on inside the Vault; here you choose for the chart.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button className={`toggle ${shield ? "on" : ""}`} onClick={() => onShield(!shield)} aria-label="Block capture everywhere" />
          <span className="hint">Block capture on every screen, not just the Vault</span>
        </div>
        {info && !info.content_protection_supported && <p className="hint" style={{ marginTop: 8 }}>Not available on {info.os}. Works on Windows 10 2004+ and macOS.</p>}
      </div>

      <div className="card">
        <h2>About</h2>
        <p>Utopia {info?.version ?? ""}. Education only; nothing here is advice or a performance claim.</p>
      </div>
    </section>
  );
}

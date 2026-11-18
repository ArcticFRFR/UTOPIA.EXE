import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderSettings } from "@/data/provider";
import { computeAll, makeScheduler, REGISTRY, byId, type Results } from "@/indicators/engine";
import { defaultParams, type IndicatorInstance } from "@/indicators/types";
import { loadSetting, saveSetting } from "@/lib/store";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { ChartView } from "./ChartView";
import { useMarket } from "./useMarket";

const DEFAULT_INSTANCES: IndicatorInstance[] = [
  { key: "sealed-1", defId: "sealed", params: defaultParams(byId("sealed")!), enabled: true },
  { key: "ema-1", defId: "ema", params: { len: 21 }, enabled: true },
  { key: "vwap-1", defId: "vwap", params: {}, enabled: true },
];

export function ChartPage({ settings }: { settings: ProviderSettings }) {
  const [symbol, setSymbol] = useState("NQZ6");
  const [draft, setDraft] = useState(symbol);
  const [tf, setTf] = useState<Timeframe>("5m");
  const [instances, setInstances] = useState<IndicatorInstance[]>(DEFAULT_INSTANCES);
  const [results, setResults] = useState<Results>(new Map());
  const [sideOpen, setSideOpen] = useState(true);

  useEffect(() => {
    void loadSetting<{ symbol: string; tf: Timeframe; instances: IndicatorInstance[] }>("chart", { symbol, tf, instances }).then((c) => {
      setSymbol(c.symbol); setDraft(c.symbol); setTf(c.tf); setInstances(c.instances);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void saveSetting("chart", { symbol, tf, instances }); }, [symbol, tf, instances]);

  const market = useMarket(settings, symbol, tf);

  // Recompute indicators on history load and on every live bar change, coalesced.
  const recompute = useMemo(() => makeScheduler(async () => {
    const r = await computeAll(instances, market.bars.current);
    setResults(r);
  }), [instances, market.bars]);
  useEffect(() => { void recompute(); }, [recompute, market.version, market.lastBar]);

  const toggle = useCallback((key: string) => setInstances((xs) => xs.map((x) => (x.key === key ? { ...x, enabled: !x.enabled } : x))), []);
  const setParam = useCallback((key: string, p: string, v: number) => setInstances((xs) => xs.map((x) => (x.key === key ? { ...x, params: { ...x.params, [p]: v } } : x))), []);
  const add = (defId: string) => {
    const def = byId(defId)!;
    const n = instances.filter((i) => i.defId === defId).length + 1;
    setInstances((xs) => [...xs, { key: `${defId}-${n}-${Date.now().toString(36)}`, defId, params: defaultParams(def), enabled: true }]);
  };
  const remove = (key: string) => setInstances((xs) => xs.filter((x) => x.key !== key));

  return (
    <section className="view">
      <div className="toolbar">
        <form onSubmit={(e) => { e.preventDefault(); setSymbol(draft.trim().toUpperCase() || "NQ"); }}>
          <input className="sym" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label="Symbol" />
        </form>
        <div className="seg" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t} className={t === tf ? "active" : ""} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
        <span className="status">
          <span className={`dot ${market.state === "live" ? "live" : market.state === "demo" ? "demo" : market.state === "error" ? "err" : ""}`} />
          {market.providerLabel}{market.contract ? ` · ${market.contract.symbol}` : ""} · {market.state.toUpperCase()}
        </span>
        <div className="grow" />
        <button className="pill" onClick={() => void market.reload()}>Reload</button>
        <button className={`pill ${sideOpen ? "on" : ""}`} onClick={() => setSideOpen((o) => !o)}>Indicators</button>
      </div>
      {market.error && <div className="err" style={{ padding: "8px 12px", background: "var(--dusk)", borderBottom: "1px solid var(--line)" }}>{market.error}</div>}
      <div className="split">
        <ChartView bars={market.bars} version={market.version} lastBar={market.lastBar} instances={instances} results={results} tickSize={market.contract?.tickSize ?? 0.25} />
        {sideOpen && (
          <aside className="side">
            <h3>Indicators</h3>
            <div className="list">
              {instances.map((inst) => {
                const def = byId(inst.defId);
                if (!def) return null;
                return (
                  <div className="ind-card" key={inst.key}>
                    <div className="name">
                      <span className="sw" style={{ background: def.plots[0].color }} />
                      {def.name}
                      {def.sealed && <span className="seal" title="Sealed">封</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button className={`toggle ${inst.enabled ? "on" : ""}`} onClick={() => toggle(inst.key)} aria-label="Enable" />
                      {!def.sealed && <button className="pill" onClick={() => remove(inst.key)} title="Remove">×</button>}
                    </div>
                    <div className="desc">{def.description}</div>
                    {def.params.length > 0 && (
                      <div className="params">
                        {def.params.map((p) => (
                          <label key={p.key}>{p.label}
                            <input type="number" value={inst.params[p.key] ?? p.default} min={p.min} max={p.max} step={p.step}
                              onChange={(e) => setParam(inst.key, p.key, Number(e.target.value))} />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 2px" }}>
                {REGISTRY.filter((d) => !d.sealed).map((d) => (
                  <button key={d.id} className="pill" onClick={() => add(d.id)}>+ {d.name}</button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

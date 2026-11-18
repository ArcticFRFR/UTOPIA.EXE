import { useCallback, useEffect, useRef, useState } from "react";
import { createProvider } from "@/data";
import { applyTick, resample } from "@/data/aggregate";
import type { MarketDataProvider, ProviderSettings } from "@/data/provider";
import type { Bar, ContractInfo, FeedState, Timeframe } from "@/lib/types";

const HISTORY = 1500;
const CTX_HOURS = 1200; // ~10 trading weeks of 1-hour bars for daily/weekly context

/**
 * Owns the provider, the bar array for the current symbol/timeframe and the live tick stream.
 * Bars are kept in a ref (mutated in place by ticks) and `version` bumps so React re-renders cheaply.
 */
export function useMarket(settings: ProviderSettings, symbol: string, tf: Timeframe) {
  const providerRef = useRef<MarketDataProvider | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const ctxRef = useRef<Bar[]>([]);
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [state, setState] = useState<FeedState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [lastBar, setLastBar] = useState<Bar | null>(null);

  // (Re)create the provider when its settings change.
  useEffect(() => {
    providerRef.current?.disconnect().catch(() => {});
    providerRef.current = createProvider(settings);
    setVersion((v) => v + 1);
    return () => { providerRef.current?.disconnect().catch(() => {}); };
  }, [settings]);

  const reload = useCallback(async () => {
    const p = providerRef.current;
    if (!p) return;
    setState("connecting"); setError(null);
    try {
      await p.connect();
      const c = await p.resolve(symbol);
      setContract(c);
      // Ask for 1m when the provider can serve it and we need to resample; providers already resample daily.
      const bars = await p.history(c, tf, HISTORY);
      barsRef.current = tf === "1d" ? bars : resample(bars, tf);
      ctxRef.current = tf === "1h" ? barsRef.current.slice() : await p.history(c, "1h", CTX_HOURS);
      setLastBar(barsRef.current[barsRef.current.length - 1] ?? null);
      setState(p.id === "demo" ? "demo" : "live");
      setVersion((v) => v + 1);
    } catch (e) {
      const err = e as Error & { hint?: string };
      setError(err.hint ? `${err.message}\n${err.hint}` : err.message);
      setState("error");
    }
  }, [symbol, tf]);

  useEffect(() => { void reload(); }, [reload, settings]);

  // Live ticks for the resolved contract.
  useEffect(() => {
    const p = providerRef.current;
    if (!p || !contract || state === "error" || state === "connecting") return;
    let off: (() => void) | null = null;
    let cancelled = false;
    p.subscribeTicks(contract, (t) => {
      const b = applyTick(barsRef.current, t, tf);
      applyTick(ctxRef.current, t, "1h");
      setLastBar({ ...b });
    }).then((u) => { if (cancelled) u(); else off = u; }).catch((e) => setError(String(e)));
    return () => { cancelled = true; off?.(); };
  }, [contract, state, tf]);

  return { bars: barsRef, ctx: ctxRef, version, lastBar, contract, state, error, reload, providerLabel: providerRef.current?.label ?? "" };
}

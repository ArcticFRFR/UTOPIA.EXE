import { BUILTINS } from "./builtins";
import { SEALED } from "./sealed";
import type { ComputeInput, IndicatorDef, IndicatorInstance, IndicatorResult } from "./types";

export const REGISTRY: IndicatorDef[] = [SEALED, ...BUILTINS];
export const byId = (id: string) => REGISTRY.find((d) => d.id === id);

export type Results = Map<string, IndicatorResult>; // instance key -> result

/** Compute every enabled instance. Async because the sealed one crosses into Rust. */
export async function computeAll(instances: IndicatorInstance[], input: ComputeInput): Promise<Results> {
  const out: Results = new Map();
  await Promise.all(
    instances.filter((i) => i.enabled).map(async (i) => {
      const def = byId(i.defId);
      if (!def) return;
      try {
        out.set(i.key, await def.compute(input, i.params));
      } catch (e) {
        console.error(`indicator ${def.id} failed`, e);
      }
    }),
  );
  return out;
}

/** Collapse bursts of recomputes (every tick) into at most one in flight plus one queued. */
export function makeScheduler(run: () => Promise<void>) {
  let busy = false, queued = false;
  const kick = async () => {
    if (busy) { queued = true; return; }
    busy = true;
    try { await run(); } finally {
      busy = false;
      if (queued) { queued = false; void kick(); }
    }
  };
  return kick;
}

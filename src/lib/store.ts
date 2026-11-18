/** Small persisted key/value store: tauri-plugin-store inside the app, localStorage in a plain browser. */
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StoreLike = { get<T>(k: string): Promise<T | undefined>; set(k: string, v: unknown): Promise<void>; save(): Promise<void> };
let storeP: Promise<StoreLike> | null = null;

async function store(): Promise<StoreLike> {
  if (!storeP) {
    storeP = inTauri()
      ? import("@tauri-apps/plugin-store").then(async (m) => {
          const s = await m.load("utopia.settings.json", { autoSave: true });
          return { get: (k) => s.get(k), set: (k, v) => s.set(k, v), save: () => s.save() } as StoreLike;
        })
      : Promise.resolve<StoreLike>({
          async get<T>(k: string) { const v = localStorage.getItem(`utopia:${k}`); return v ? (JSON.parse(v) as T) : undefined; },
          async set(k, v) { localStorage.setItem(`utopia:${k}`, JSON.stringify(v)); },
          async save() {},
        });
  }
  return storeP;
}

export async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  const v = await (await store()).get<T>(key);
  return v === undefined ? fallback : v;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const s = await store();
  await s.set(key, value);
  await s.save();
}

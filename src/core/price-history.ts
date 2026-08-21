import type { PlatformId, RankedCandidate } from "./types.ts";

export interface PriceObservation {
  key: string;
  name: string;
  platform: PlatformId;
  price: number;
  query: string;
  timestamp: string;
}

export interface PriceStats {
  key: string;
  name: string;
  current: number;
  min: number;
  max: number;
  avg: number;
  observations: number;
  runs: number;
  firstSeen: string;
  lastSeen: string;
  daysTracked: number;
  position: number;
  trend: "falling" | "rising" | "stable";
}

let kvInstance: Deno.Kv | null = null;
let kvUnavailable = false;

async function getKv(): Promise<Deno.Kv | null> {
  if (kvUnavailable) return null;
  if (kvInstance) return kvInstance;
  try {
    kvInstance = await Deno.openKv();
    return kvInstance;
  } catch {
    kvUnavailable = true;
    return null;
  }
}

export async function savePrices(
  ranked: RankedCandidate[],
  query: string,
): Promise<number> {
  const kv = await getKv();
  if (!kv) return 0;

  const now = new Date().toISOString();
  let written = 0;

  for (const c of ranked) {
    for (const offer of c.offers) {
      const obs: PriceObservation = {
        key: c.key,
        name: c.modelName,
        platform: offer.platform,
        price: offer.price,
        query,
        timestamp: now,
      };
      try {
        await kv.set(["prices", c.key, offer.platform, now], obs);
        written++;
      } catch {
        // ignored
      }
    }
  }
  return written;
}

async function readObservations(key: string): Promise<PriceObservation[]> {
  const kv = await getKv();
  if (!kv) return [];
  const out: PriceObservation[] = [];
  for await (
    const entry of kv.list<PriceObservation>({ prefix: ["prices", key] })
  ) {
    if (entry.value) out.push(entry.value);
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function summarise(key: string, obs: PriceObservation[]): PriceStats | null {
  if (obs.length === 0) return null;
  const prices = obs.map((o) => o.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const current = prices[prices.length - 1];
  const first = obs[0].timestamp;
  const last = obs[obs.length - 1].timestamp;
  const days = Math.max(
    0,
    Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000),
  );

  const earlier = prices.slice(0, -1);
  const prevAvg = earlier.length
    ? earlier.reduce((a, b) => a + b, 0) / earlier.length
    : current;
  const delta = (current - prevAvg) / (prevAvg || 1);

  return {
    key,
    name: obs[obs.length - 1].name,
    current,
    min,
    max,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    observations: obs.length,
    runs: new Set(obs.map((o) => o.timestamp)).size,
    firstSeen: first,
    lastSeen: last,
    daysTracked: days,
    position: max === min ? 0 : (current - min) / (max - min),
    trend: delta > 0.02 ? "rising" : delta < -0.02 ? "falling" : "stable",
  };
}

export async function getStats(key: string): Promise<PriceStats | null> {
  return summarise(key, await readObservations(key));
}

export interface PricePoint {
  t: string;
  p: number;
}

/** The observation series for one product, oldest first, capped. */
export async function getSeries(key: string, cap = 24): Promise<PricePoint[]> {
  const obs = await readObservations(key);
  const tail = obs.slice(-cap);
  // One point per run: the cheapest offer seen at that moment.
  const byRun = new Map<string, number>();
  for (const o of tail) {
    const prev = byRun.get(o.timestamp);
    if (prev === undefined || o.price < prev) byRun.set(o.timestamp, o.price);
  }
  return [...byRun.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, p]) => ({ t, p }));
}

export async function getStatsFor(
  keys: string[],
): Promise<Map<string, PriceStats>> {
  const out = new Map<string, PriceStats>();
  for (const key of keys) {
    const stats = await getStats(key);
    if (stats) out.set(key, stats);
  }
  return out;
}

export async function listTracked(limit = 50): Promise<PriceStats[]> {
  const kv = await getKv();
  if (!kv) return [];

  const byKey = new Map<string, PriceObservation[]>();
  for await (const entry of kv.list<PriceObservation>({ prefix: ["prices"] })) {
    if (!entry.value) continue;
    const arr = byKey.get(entry.value.key);
    if (arr) arr.push(entry.value);
    else byKey.set(entry.value.key, [entry.value]);
  }

  return [...byKey.entries()]
    .map(([key, obs]) =>
      summarise(key, obs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)))
    )
    .filter((s): s is PriceStats => s !== null)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, limit);
}

export async function isAvailable(): Promise<boolean> {
  return (await getKv()) !== null;
}

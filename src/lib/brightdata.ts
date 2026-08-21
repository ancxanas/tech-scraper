const BASE_URL = "https://api.brightdata.com";

export let _fetch: typeof globalThis.fetch = globalThis.fetch;

export function setFetchFn(fn: typeof globalThis.fetch) {
  _fetch = fn;
}

function getApiKey(): string {
  const key = Deno.env.get("BRIGHTDATA_API_KEY");
  if (!key) {
    throw new Error(
      "BRIGHTDATA_API_KEY not set. Run: export BRIGHTDATA_API_KEY=your_key",
    );
  }
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

export async function bdFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await _fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers as Record<string, string> },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bright Data API ${res.status}: ${body}`);
  }

  const text = await res.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length > 0) {
      const parsed: unknown[] = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // ignored
        }
      }
      if (parsed.length > 0) return parsed as T;
    }
    throw new Error("Empty response from Bright Data API");
  }
}

export async function pollUntil<T>(
  checkFn: () => Promise<T | null>,
  intervalMs: number,
  maxAttempts: number,
  label: string,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await checkFn();
    if (result !== null) return result;
    if (i % 10 === 0 && i > 0) {
      console.error(`    ${label}: waiting... (${i})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${label}: timed out after ${maxAttempts} attempts`);
}

export async function checkCollector(
  collectorId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bdFetch<unknown>(
      `/dca/collectors/${collectorId}`,
      { method: "GET" },
    );
    return { ok: !!res };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) {
      return { ok: true, error: "collector exists (404 on status check)" };
    }
    return { ok: false, error: msg };
  }
}

export async function bdFetchText(
  path: string,
  options: RequestInit = {},
): Promise<string> {
  const res = await _fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers as Record<string, string> },
  });
  if (!res.ok) {
    throw new Error(`Bright Data API ${res.status}: ${await res.text()}`);
  }
  return await res.text();
}

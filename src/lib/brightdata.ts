const BASE_URL = "https://api.brightdata.com";

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
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers as Record<string, string> },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bright Data API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
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
      console.log(`    ${label}: waiting... (${i})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${label}: timed out after ${maxAttempts} attempts`);
}

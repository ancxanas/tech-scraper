import { bdFetch } from "./brightdata.ts";

/**
 * Fetch a page directly, with no proxy and no credit cost.
 *
 * Marketplaces block datacenter IPs aggressively (Flipkart returns 403 from
 * any cloud host), but a residential connection in-country often sails
 * through. Since this is free, it is always worth trying before spending a Web
 * Unlocker request — and Web Unlocker requires business KYC, which not every
 * account has.
 */
export async function fetchDirect(
  url: string,
  timeoutMs = 15_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Harvest text nodes out of the JSON state blob embedded in the page.
 *
 * Flipkart ships the full specification table inside `__INITIAL_STATE__` as
 * {"label_0":{"value":{"text":"Display Type"}},"label_1":{"value":{"text":
 * ["HD+ 120Hz Display"]}}} — so stripping <script> tags, which is what a naive
 * html-to-text does, throws away the richest data on the page. The visible
 * markup only carries the marketing highlights.
 *
 * Rather than parse that structure (deeply nested and liable to change), this
 * harvests every "text" node and concatenates the distinct values. Order is
 * lost, which is fine: extraction is regex over key:value fragments such as
 * "Refresh Rate:120Hz" and "5160 mAh".
 */
export function jsonStateText(html: string, cap = 20_000): string {
  const out: string[] = [];
  const re =
    /"text"\s*:\s*(?:"((?:[^"\\]|\\.){1,300})"|\[\s*"((?:[^"\\]|\\.){1,300})")/g;
  for (const m of html.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? "";
    const v = raw
      .replace(/\\"/g, '"')
      .replace(/\\u[\dA-Fa-f]{4}/g, " ")
      .replace(/\\n/g, " ")
      .trim();
    if (v.length > 1) out.push(v);
  }
  return [...new Set(out)].join(" | ").slice(0, cap);
}

/** Visible text plus the embedded JSON spec table. */
export function pageToText(html: string): string {
  return `${htmlToText(html)} | ${jsonStateText(html)}`;
}

/** Crude HTML -> text. Enough for regex spec extraction; no DOM needed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface UnlockResponse {
  status_code?: number;
  headers?: Record<string, string>;
  body?: string;
}

function getUnlockerZone(): string {
  const zone = Deno.env.get("UNLOCKER_ZONE");
  if (!zone) {
    throw new Error(
      "UNLOCKER_ZONE not set. Create a Web Unlocker zone at https://brightdata.com/cp/web_access/new",
    );
  }
  return zone;
}

export async function fetchPageHtml(
  url: string,
  country = "in",
): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country,
    }),
  });

  if (res.status_code && res.status_code >= 400) {
    throw new Error(
      `Web Unlocker returned ${res.status_code} for ${url}`,
    );
  }

  return res.body || "";
}

export async function fetchPageMarkdown(
  url: string,
  country = "in",
): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country,
      data_format: "markdown",
    }),
  });

  return res.body || "";
}

export async function takeScreenshot(
  url: string,
  country = "in",
): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country,
      data_format: "screenshot",
    }),
  });

  return res.body || "";
}

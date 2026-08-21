import { bdFetch, bdFetchText } from "./brightdata.ts";

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

export function jsonLdSummary(html: string): string {
  const out: string[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]{2,20000}?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let node: unknown;
    try {
      node = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(node) ? node : [node];
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      const offers = it?.offers as Record<string, unknown> | undefined;
      // Only a single Offer describes the buy box. An AggregateOffer's
      // lowPrice is the cheapest seller on the listing, which on Flipkart is
      // routinely one that has sold out - that is how a dead 12,951 kept
      // beating the live 19,474.
      const isAggregate =
        String(offers?.["@type"] ?? "").toLowerCase().includes("aggregate") ||
        offers?.lowPrice !== undefined && offers?.price === undefined;
      const price = Number(offers?.price ?? NaN);
      if (isAggregate || !Number.isFinite(price) || price <= 0) {
        if (offers?.lowPrice !== undefined) {
          out.push(`LD_LOW=${Math.round(Number(offers.lowPrice))}`);
        }
        continue;
      }
      out.push(`LD_PRICE=${Math.round(price)}`);
      if (typeof it.sku === "string") out.push(`LD_SKU=${it.sku}`);
      const avail = String(offers?.availability ?? "");
      if (avail) out.push(`LD_STOCK=${avail.split("/").pop()}`);
      const seller = (offers?.seller as Record<string, unknown> | undefined)
        ?.name;
      if (typeof seller === "string") out.push(`LD_SELLER=${seller}`);
      return out.join(" ");
    }
  }
  return "";
}

export function pageToText(html: string): string {
  return `${htmlToText(html)} | ${jsonStateText(html)} | ${
    jsonLdSummary(html)
  }`;
}

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

function unwrap(text: string): string {
  try {
    const parsed = JSON.parse(text) as UnlockResponse;
    if (typeof parsed?.body === "string") return parsed.body;
  } catch {
    // format: "raw" returns the page itself, which is the common case.
  }
  return text;
}

export async function fetchPageHtml(
  url: string,
  country = "in",
): Promise<string> {
  const zone = getUnlockerZone();
  const raw = await bdFetchText("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country,
    }),
  });
  const html = unwrap(raw);
  if (!html) throw new Error(`Web Unlocker returned an empty body for ${url}`);
  return html;
}

export async function fetchPageMarkdown(
  url: string,
  country = "in",
): Promise<string> {
  const zone = getUnlockerZone();
  const raw = await bdFetchText("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country,
      data_format: "markdown",
    }),
  });
  return unwrap(raw);
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

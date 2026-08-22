import { matchSocDetailed } from "../knowledge/soc.ts";
import { fetchDirect, fetchPageHtml, pageToText } from "../lib/fetch-page.ts";

export type FetchMode = "auto" | "direct" | "unlocker" | "cache";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The two ways a spec page can be fetched, injectable for tests. */
export interface Transport {
  direct(url: string): Promise<string>;
  unlocker(url: string): Promise<string>;
}

export const httpTransport: Transport = {
  direct: async (url) => pageToText(await fetchDirect(url)),
  unlocker: async (url) => pageToText(await fetchPageHtml(url)),
};

/** The pid that identifies the product a URL was meant to show. */
export function pidOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get("pid");
  } catch {
    return null;
  }
}

export function extractSpecSection(text: string): string {
  const lower = text.toLowerCase();
  const anchors = [
    "product highlights",
    "specifications",
    "technical details",
    "product details",
    "key features",
    "highlights",
  ];
  let start = -1;
  for (const a of anchors) {
    const i = lower.indexOf(a);
    if (i !== -1 && (start === -1 || i < start)) start = i;
  }
  if (start === -1) return text.slice(0, 24_000);
  const head = start > 0 ? `${text.slice(0, Math.min(start, 4_000))} ` : "";
  return `${head}${text.slice(start)}`.slice(0, 24_000);
}

/**
 * How many ranking-critical spec families the section actually names:
 * chipset, battery, display panel, camera resolution, RAM/storage. A page
 * scoring under 2 is a shell - nav and marketing copy with no spec table.
 */
export function specRichness(section: string): number {
  let score = 0;
  if (matchSocDetailed(section)) score++;
  if (/([\d,]{3,5})\s*mAh/i.test(section)) score++;
  if (/\b(P-?OLED|AMOLED|SUPER\s*AMOLED|IPS|PLS|TFT|LCD)\b/i.test(section)) {
    score++;
  }
  if (/(\d{2,3})\s*MP/i.test(section)) score++;
  if (
    /(\d+)\s*GB\s*(RAM|\+|\/|\))/i.test(section) ||
    /RAM[\s:|]*(\d+)/i.test(section)
  ) {
    score++;
  }
  return score;
}

export async function fetchPage(
  url: string,
  mode: FetchMode,
  allowPaid: boolean,
  t: Transport = httpTransport,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const text = await t.direct(url);
      if (text.length > 2000) return { text, via: "direct" };
      errors.push(`direct: ${text.length} chars (likely blocked)`);
    } catch (err) {
      errors.push(`direct: ${err instanceof Error ? err.message : err}`);
    }
  }

  if ((mode === "auto" || mode === "unlocker") && allowPaid) {
    try {
      return { text: await t.unlocker(url), via: "unlocker" };
    } catch (err) {
      errors.push(`unlocker: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(errors.join(" | ") || "no transport available");
}

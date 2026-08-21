/**
 * Spec resolution — run BEFORE ranking, not after.
 *
 * The old flow ranked first and enriched the top N. That is circular: a phone
 * ranks low *because* its specs are unknown, so it never gets enriched, so it
 * stays low. The ranking was deciding what it was allowed to learn.
 *
 * This resolves every candidate it can, then ranks on the result. It is
 * affordable because:
 *   - specs never change, so a persistent cache makes repeat runs free;
 *   - the free direct transport covers Flipkart, which is most of the catalogue;
 *   - paid transports stay opt-in and bounded.
 */

import { colors } from "@cliffy/ansi/colors";
import { fetchDirect, fetchPageMarkdown, pageToText } from "../lib/unlock.ts";
import { type CheckoutInfo, hasCheckoutInfo, parseCheckout } from "./offers.ts";
import { SpecStore } from "./specstore.ts";
import { matchSocDetailed } from "../knowledge/soc.ts";
import type { Candidate } from "./types.ts";

export type FetchMode = "auto" | "direct" | "unlocker" | "cache-only";

export interface ResolveOptions {
  mode?: FetchMode;
  /** Hard ceiling on network fetches. Cache hits never count against it. */
  limit?: number;
  concurrency?: number;
  /** Allow transports that cost money (Web Unlocker). */
  allowPaid?: boolean;
  store?: SpecStore;
  verbose?: boolean;
}

export interface SpecConflict {
  product: string;
  field: string;
  knowledgeBase: string;
  productPage: string;
  /** The page used an abbreviation, so this needs a human, not an overwrite. */
  ambiguous: boolean;
}

export interface ResolveResult {
  text: Map<string, string>;
  checkout: Map<string, CheckoutInfo>;
  fromCache: number;
  fetchedDirect: number;
  fetchedPaid: number;
  failed: number;
  skippedComplete: number;
  skippedPaid: number;
  /** Where the knowledge base disagrees with the actual product page. */
  conflicts: SpecConflict[];
  errors: string[];
}

/** Trim a page to the part that actually contains specifications. */
function extractSpecSection(text: string): string {
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
  const slice = start === -1 ? text : text.slice(start);
  return slice.slice(0, 24_000);
}

/** Paid transports are only reached when explicitly allowed. */
async function fetchPage(
  url: string,
  mode: FetchMode,
  allowPaid: boolean,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const text = pageToText(await fetchDirect(url));
      // A block page is short and specless; treat it as a failure so we can
      // fall through rather than caching junk.
      if (text.length > 2000) return { text, via: "direct" };
      errors.push(`direct: ${text.length} chars (likely blocked)`);
    } catch (err) {
      errors.push(`direct: ${err instanceof Error ? err.message : err}`);
    }
  }

  if ((mode === "auto" || mode === "unlocker") && allowPaid) {
    try {
      return { text: await fetchPageMarkdown(url), via: "unlocker" };
    } catch (err) {
      errors.push(`unlocker: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(errors.join(" | ") || "no transport available");
}

/**
 * Does the product page contradict what the knowledge base claims?
 *
 * Now that every candidate is fetched, this comes almost free — and it is the
 * only mechanism that can catch a KB entry being *wrong* rather than merely
 * missing. Hand-entered data is exactly the kind that drifts.
 */
function detectConflicts(c: Candidate, pageText: string): SpecConflict[] {
  const out: SpecConflict[] = [];
  const claimed = c.specs.socName;
  const fromSource = c.specSources.socName;
  if (claimed && (fromSource === "kb" || fromSource === "inferred")) {
    const found = matchSocDetailed(pageText);
    if (found && found.soc.name !== claimed) {
      out.push({
        product: c.modelName,
        field: "chipset",
        knowledgeBase: claimed,
        productPage: found.soc.name,
        ambiguous: found.ambiguous,
      });
    }
  }
  return out;
}

/** True when there is nothing left worth fetching for this product. */
function isFullySpecced(c: Candidate): boolean {
  return c.specCompleteness >= 0.95 && c.kbConfidence === "high" &&
    c.checkout !== undefined;
}

export async function resolveSpecs(
  candidates: Candidate[],
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const mode = opts.mode ?? "auto";
  const allowPaid = opts.allowPaid ?? false;
  const store = opts.store ?? new SpecStore();
  await store.load();

  const result: ResolveResult = {
    text: new Map(),
    checkout: new Map(),
    fromCache: 0,
    fetchedDirect: 0,
    fetchedPaid: 0,
    failed: 0,
    skippedComplete: 0,
    skippedPaid: 0,
    conflicts: [],
    errors: [],
  };

  // Everything gets resolved, because ranking must not decide what it is
  // allowed to learn. Order still matters for the fetch budget: least-known
  // first, so a truncated run buys the most information.
  const queue = candidates
    .filter((c) => {
      if (isFullySpecced(c)) {
        result.skippedComplete++;
        return false;
      }
      return Boolean(c.best.url);
    })
    .sort((a, b) => a.specCompleteness - b.specCompleteness);

  let budget = opts.limit ?? Number.POSITIVE_INFINITY;

  const apply = (c: Candidate, text: string) => {
    const section = extractSpecSection(text);
    for (const l of c.listings) result.text.set(l.id, section);
    const checkout = parseCheckout(text);
    if (hasCheckoutInfo(checkout)) {
      for (const l of c.listings) result.checkout.set(l.id, checkout);
    }
    result.conflicts.push(...detectConflicts(c, section));
  };

  // Cache pass first — free, instant, and it shrinks the fetch queue.
  const needsFetch: Candidate[] = [];
  for (const c of queue) {
    const cached = store.get(c.best.url);
    if (cached) {
      apply(c, cached);
      result.fromCache++;
    } else {
      needsFetch.push(c);
    }
  }

  if (mode === "cache-only") return result;

  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const pending = [...needsFetch];

  const worker = async () => {
    while (pending.length) {
      if (budget <= 0) return;
      const c = pending.shift();
      if (!c) return;
      budget--;
      try {
        const { text, via } = await fetchPage(c.best.url, mode, allowPaid);
        apply(c, text);
        store.set(c.best.url, extractSpecSection(text), via);
        if (via === "direct") result.fetchedDirect++;
        else result.fetchedPaid++;
        if (opts.verbose) {
          console.error(colors.dim(`    ${via}: ${c.modelName}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/no transport|unlocker/.test(msg) && !allowPaid) {
          result.skippedPaid++;
        }
        result.failed++;
        if (result.errors.length < 3) {
          result.errors.push(`${c.modelName}: ${msg}`);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
  await store.save();
  return result;
}

export function reportResolution(r: ResolveResult): void {
  const parts: string[] = [];
  if (r.fromCache) parts.push(`${r.fromCache} cached`);
  if (r.fetchedDirect) parts.push(`${r.fetchedDirect} fetched free`);
  if (r.fetchedPaid) parts.push(`${r.fetchedPaid} via Web Unlocker`);
  if (r.skippedComplete) parts.push(`${r.skippedComplete} already complete`);
  if (r.failed) parts.push(`${r.failed} unavailable`);
  console.error(colors.dim(`  Specs: ${parts.join(", ") || "nothing to do"}`));

  if (r.conflicts.length) {
    console.error(
      colors.yellow(
        `  ${r.conflicts.length} knowledge-base conflict(s) — the product page disagrees:`,
      ),
    );
    for (const c of r.conflicts.slice(0, 5)) {
      console.error(
        colors.yellow(
          `    ${c.product}: KB says ${c.knowledgeBase}, page says ${c.productPage}${
            c.ambiguous
              ? colors.dim(" (page abbreviated — verify by hand)")
              : ""
          }`,
        ),
      );
    }
    console.error(
      colors.dim(
        "    Unambiguous page values win automatically; abbreviated ones are kept\n    as-is pending a correction to src/knowledge/models.ts.",
      ),
    );
  }
}

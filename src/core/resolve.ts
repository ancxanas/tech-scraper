import { colors } from "@cliffy/ansi/colors";
import { fetchDirect, fetchPageHtml, pageToText } from "../lib/fetch-page.ts";
import {
  type CheckoutInfo,
  hasCheckoutInfo,
  parseCheckout,
} from "./checkout.ts";
import { ageLabel, SpecStore } from "./spec-cache.ts";
import { canonicalUrl } from "./normalize.ts";
import {
  type ReviewSummary,
  reviewsUrlFor,
  summariseReviews,
} from "./reviews.ts";
import { matchSocDetailed, matchSocExact } from "../knowledge/soc.ts";
import {
  fetchSpecs as fetchExternalSpecs,
  loadIndex,
  RateLimited,
  resolveModel,
} from "../knowledge/gsmarena.ts";
import { fetchBeebom, type MarketPrice } from "../knowledge/beebom.ts";
import type { ExternalSpecs } from "../knowledge/spec-source.ts";
import type { Candidate, Specs } from "./types.ts";

export type FetchMode = "auto" | "direct" | "unlocker" | "cache";

export interface ResolveOptions {
  mode?: FetchMode;
  withReviews?: boolean;
  pace?: number;
  useExternal?: boolean;
  limit?: number;
  concurrency?: number;
  allowPaid?: boolean;
  /** Cap on paid re-fetches of spec-poor Flipkart pages per run. */
  maxSpecRescues?: number;
  store?: SpecStore;
  verbose?: boolean;
}

export interface SpecConflict {
  product: string;
  field: string;
  knowledgeBase: string;
  productPage: string;
  ambiguous: boolean;
  source: "merchant" | "spec-db";
}

export interface ResolveResult {
  text: Map<string, string>;
  checkout: Map<string, CheckoutInfo>;
  external: Map<string, Partial<Specs>>;
  reviews: Map<string, ReviewSummary>;
  reviewsFetched: number;
  gsmMatched: number;
  gsmUnmatched: number;
  beebomMatched: number;
  marketPrices: Map<string, MarketPrice>;
  gsmRateLimited: boolean;
  fromCache: number;
  fetchedDirect: number;
  fetchedPaid: number;
  failed: number;
  skippedComplete: number;
  skippedPaid: number;
  conflicts: SpecConflict[];
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function fetchPage(
  url: string,
  mode: FetchMode,
  allowPaid: boolean,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const text = pageToText(await fetchDirect(url));
      if (text.length > 2000) return { text, via: "direct" };
      errors.push(`direct: ${text.length} chars (likely blocked)`);
    } catch (err) {
      errors.push(`direct: ${err instanceof Error ? err.message : err}`);
    }
  }

  if ((mode === "auto" || mode === "unlocker") && allowPaid) {
    try {
      return { text: pageToText(await fetchPageHtml(url)), via: "unlocker" };
    } catch (err) {
      errors.push(`unlocker: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(errors.join(" | ") || "no transport available");
}

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
        source: "merchant",
      });
    }
  }
  return out;
}

export function toSpecs(g: ExternalSpecs): Partial<Specs> {
  const out: Partial<Specs> = {};
  const set = <K extends keyof Specs>(k: K, v: Specs[K] | null) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  if (g.socName) {
    const exact = matchSocExact(g.socName);
    const soc = exact ? { soc: exact } : matchSocDetailed(g.socName);
    set("socName", soc ? soc.soc.name : g.socName);
    set("antutu", soc?.soc.antutu ?? g.antutu ?? null);
  }
  set("batteryMah", g.batteryMah);
  set("chargingW", g.chargingW);
  set("panel", g.panel);
  set("displayInches", g.inches);
  set("refreshHz", g.refreshHz);
  set("resolution", g.resolution);
  set("mainCameraMp", g.mainCameraMp);
  set("ipRating", g.ipRating);
  set("nfc", g.nfc);
  if (g.ois) set("ois", true);
  return out;
}

function conflictsAgainstKb(c: Candidate, g: ExternalSpecs): SpecConflict[] {
  const out: SpecConflict[] = [];
  if (
    c.specs.socName && c.specSources.socName === "kb" && g.socName &&
    // Exact-match first: the value came from a structured field, so it needs
    // no context word to be believed.
    (matchSocExact(g.socName) ?? matchSocDetailed(g.socName)?.soc)?.name !==
      c.specs.socName
  ) {
    out.push({
      product: c.modelName,
      field: "chipset",
      knowledgeBase: c.specs.socName,
      productPage: g.socName,
      ambiguous: false,
      source: "spec-db",
    });
  }
  return out;
}

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
    external: new Map(),
    reviews: new Map(),
    reviewsFetched: 0,
    gsmMatched: 0,
    beebomMatched: 0,
    marketPrices: new Map(),
    gsmUnmatched: 0,
    gsmRateLimited: false,
    fromCache: 0,
    fetchedDirect: 0,
    fetchedPaid: 0,
    failed: 0,
    skippedComplete: 0,
    skippedPaid: 0,
    conflicts: [],
    errors: [],
  };

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

  const apply = (c: Candidate, text: string, sourceUrl: string) => {
    const section = extractSpecSection(text);
    for (const l of c.listings) result.text.set(l.id, section);
    const checkout = parseCheckout(text, pidOf(sourceUrl));
    if (hasCheckoutInfo(checkout)) {
      // A cached page was fetched some time ago; say when.
      checkout.sampledAt = store.fetchedAt(sourceUrl) ??
        new Date().toISOString();
      const want = canonicalUrl(sourceUrl);
      const from = c.listings.find((l) => canonicalUrl(l.url) === want) ??
        c.listings[0];
      result.checkout.set(from.id, checkout);
    }
    result.conflicts.push(...detectConflicts(c, section));
  };

  if (opts.useExternal !== false) {
    const index = await loadIndex();
    if (index.length > 0) {
      let fetchedThisRun = 0;
      for (const c of candidates) {
        const lookupName = c.key.split("|")[0].split("#")[0].trim();
        const hit = resolveModel(lookupName, c.brand, index);
        if (!hit) {
          result.gsmUnmatched++;
          continue;
        }
        try {
          const cacheKey = `gsm://${hit.slug}`;
          let g: ExternalSpecs | null = null;

          const cached = store.get(cacheKey);
          if (cached) {
            g = JSON.parse(cached) as ExternalSpecs;
          } else {
            if (fetchedThisRun > 0) await sleep(opts.pace ?? 1100);
            let via: "direct" | "unlocker" = "direct";
            g = await fetchExternalSpecs(hit, lookupName, async (u) => {
              try {
                return await fetchDirect(u, 15000);
              } catch (err) {
                if (!allowPaid) throw err;
                via = "unlocker";
                result.fetchedPaid++;
                return await fetchPageHtml(u);
              }
            });
            fetchedThisRun++;
            if (g) store.set(cacheKey, JSON.stringify(g), via);
          }

          if (!g) {
            result.gsmUnmatched++;
            continue;
          }
          const partial = toSpecs(g);
          for (const l of c.listings) result.external.set(l.id, partial);
          result.gsmMatched++;
          result.conflicts.push(...conflictsAgainstKb(c, g));
        } catch (err) {
          if (err instanceof RateLimited) {
            result.gsmRateLimited = true;
            break;
          }
          result.gsmUnmatched++;
        }
      }
    }
  }

  if (opts.useExternal !== false) {
    let fetchedThisRun = 0;
    for (const c of candidates) {
      if (c.listings.some((l) => result.external.has(l.id))) continue;
      if (c.specs.socName && c.specSources.socName === "gsmarena") continue;

      const lookupName = c.key.split("|")[0].split("#")[0].trim();
      const cacheKey = `beebom://${lookupName.toLowerCase()}`;
      try {
        let b: ExternalSpecs | null = null;
        const cached = store.get(cacheKey);
        if (cached) {
          b = JSON.parse(cached) as ExternalSpecs;
          const cm = store.get(`${cacheKey}#market`);
          if (cm) {
            const mp = JSON.parse(cm) as MarketPrice;
            for (const l of c.listings) result.marketPrices.set(l.id, mp);
          }
        } else {
          if (fetchedThisRun > 0) await sleep(opts.pace ?? 1100);
          const got = await fetchBeebom(lookupName, c.brand ?? undefined);
          b = got.specs;
          if (got.market) {
            for (const l of c.listings) {
              result.marketPrices.set(l.id, got.market);
            }
            store.set(
              `${cacheKey}#market`,
              JSON.stringify(got.market),
              "direct",
            );
          }
          fetchedThisRun++;
          if (b) store.set(cacheKey, JSON.stringify(b), "direct");
        }
        if (!b) continue;

        const partial = toSpecs(b);
        const kbDisagrees = c.kbConfidence === "high" &&
          c.specSources.socName === "kb" && c.specs.socName &&
          partial.socName &&
          partial.socName !== c.specs.socName;
        if (kbDisagrees) {
          delete partial.socName;
          delete partial.antutu;
        }
        for (const l of c.listings) result.external.set(l.id, partial);
        result.beebomMatched++;
        result.conflicts.push(...conflictsAgainstKb(c, b));
      } catch {
        // ignored
      }
    }
  }

  const needsFetch: Candidate[] = [];
  for (const c of queue) {
    // Same rule as the price refresh: fetch the product, not one seller's
    // listing. The card URL carries lid; the canonical URL does not.
    const url = canonicalUrl(c.best.url);
    const cached = store.get(url);
    if (cached) {
      apply(c, cached, url);
      result.fromCache++;
    } else {
      needsFetch.push(c);
    }
  }

  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const pending = mode === "cache" ? [] : [...needsFetch];
  let rescuesLeft = Math.max(0, opts.maxSpecRescues ?? 12);

  const worker = async () => {
    while (pending.length) {
      if (budget <= 0) return;
      const c = pending.shift();
      if (!c) return;
      budget--;
      const url = canonicalUrl(c.best.url);
      try {
        let { text, via } = await fetchPage(url, mode, allowPaid);
        // Flipkart serves its spec table through lazy loading, so a plain
        // fetch yields chipset for one phone in ten. When the section came
        // back spec-poor and paid fetching is on, pay once for the rendered
        // DOM and keep whichever read is richer. The winner is cached for
        // 30 days, so each phone costs at most one extra request ever.
        if (
          /flipkart\.com/.test(url) && via === "direct" && allowPaid &&
          rescuesLeft > 0 && specRichness(extractSpecSection(text)) < 2
        ) {
          rescuesLeft--;
          try {
            const rendered = await fetchPage(url, "unlocker", true);
            if (
              specRichness(extractSpecSection(rendered.text)) >
                specRichness(extractSpecSection(text))
            ) {
              text = rendered.text;
              via = "unlocker";
            }
          } catch {
            // The direct text stands; nothing to report.
          }
        }
        apply(c, text, url);
        store.set(url, extractSpecSection(text), via);
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

  const reviewMode: FetchMode = opts.mode ?? "auto";
  if (opts.withReviews !== false && reviewMode !== "unlocker") {
    for (const c of candidates) {
      const url = reviewsUrlFor(canonicalUrl(c.best.url));
      if (!url) continue;
      try {
        const key = `reviews://${url}`;
        let text = store.get(key);
        if (!text) {
          if (reviewMode === "cache") continue;
          text = pageToText(await fetchDirect(url, 15000));
          store.set(key, text.slice(0, 24_000), "direct");
          result.reviewsFetched++;
          await sleep(250);
        }
        const summary = summariseReviews(text);
        if (summary.sampled > 0 || summary.distribution) {
          for (const l of c.listings) result.reviews.set(l.id, summary);
        }
      } catch {
        // ignored
      }
    }
  }

  // Cache mode still serves what it already holds - reviews included -
  // it just never reaches for the network.
  if (mode === "cache") {
    await store.save();
    return result;
  }

  await store.save();
  return result;
}

export function reportResolution(r: ResolveResult): void {
  const parts: string[] = [];
  if (r.gsmMatched) parts.push(`${r.gsmMatched} from spec database`);
  if (r.gsmRateLimited) parts.push("spec DB throttled");
  if (r.beebomMatched) parts.push(`${r.beebomMatched} from secondary source`);
  if (r.fromCache) parts.push(`${r.fromCache} cached`);
  if (r.fetchedDirect) parts.push(`${r.fetchedDirect} fetched free`);
  if (r.fetchedPaid) parts.push(`${r.fetchedPaid} via Web Unlocker`);
  if (r.reviews.size) parts.push(`${r.reviews.size} review pages`);
  if (r.skippedComplete) parts.push(`${r.skippedComplete} already complete`);
  if (r.failed) parts.push(`${r.failed} unavailable`);
  console.error(colors.dim(`  Specs: ${parts.join(", ") || "nothing to do"}`));

  if (r.gsmRateLimited) {
    console.error(
      colors.yellow(
        "  The spec database rate-limited this IP. Resolved models are cached\n  permanently, so re-running later continues where this left off.",
      ),
    );
  }

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
    if (r.conflicts.length > 5) {
      console.error(
        colors.yellow(`    …and ${r.conflicts.length - 5} more`),
      );
    }
    console.error(
      colors.dim(
        "    A high-confidence knowledge-base entry wins and the page is ignored;\n    below that the page wins. Either way, correct the loser in\n    src/knowledge/models.ts.",
      ),
    );
  }
}

export interface RefreshResult {
  checkout: Map<string, CheckoutInfo>;
  fetched: number;
  cached: number;
  unpriced: number;
  failed: number;
  /** Pages we refused to spend a fetch on because we cannot read them. */
  skipped: number;
  changed: Array<
    { product: string; from: number; to: number; seller: string | null }
  >;
  stockChanged: Array<
    { product: string; inStock: boolean; seller: string | null }
  >;
  seen: Array<{
    product: string;
    card: number | null;
    page: number | null;
    inStock: boolean | null;
    seller: string | null;
    sampledAt?: string;
  }>;
}

export async function refreshPrices(
  candidates: Candidate[],
  opts: {
    limit?: number;
    allowPaid?: boolean;
    mode?: FetchMode;
    pace?: number;
    /** Asking to refresh means refetch; the cache is for the passive path. */
    useCache?: boolean;
  } = {},
): Promise<RefreshResult> {
  const out: RefreshResult = {
    checkout: new Map(),
    fetched: 0,
    cached: 0,
    unpriced: 0,
    failed: 0,
    skipped: 0,
    changed: [],
    stockChanged: [],
    seen: [],
  };
  const top = candidates.slice(0, opts.limit ?? 15);
  if (!top.length) return out;

  const store = new SpecStore();
  await store.load();
  let n = 0;

  for (const c of top) {
    // Canonical, not the card's URL. A Flipkart card carries `lid`, which
    // selects one SELLER's listing - the cheapest at scrape time, and often
    // the one that then sells out. Fetching it returns that seller's dead
    // offer; dropping it returns the buy box, which is what a buyer sees.
    // Asking to refresh means asking the network; "cache" as a transport
    // would make every fetch throw before it starts.
    const mode: FetchMode = opts.mode === "cache"
      ? "auto"
      : opts.mode ?? "auto";
    const url = canonicalUrl(c.best.url ?? "");
    if (!url) continue;
    // parseCheckout reads Flipkart's buy box; Amazon pages carry neither its
    // patterns nor ld+json, so a refetch there buys nothing and bills money.
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    if (!/(^|\.)flipkart\.com$/.test(host)) {
      out.skipped++;
      continue;
    }
    try {
      let sampledAt: string;
      let text = opts.useCache === true ? store.getPrice(url) : null;
      if (text) {
        out.cached++;
        sampledAt = store.priceFetchedAt(url) ?? new Date().toISOString();
      } else {
        if (n > 0) await sleep(opts.pace ?? 900);
        const got = await fetchPage(
          url,
          mode,
          opts.allowPaid ?? false,
        );
        // fetchPage already ran pageToText; converting again only adds noise.
        text = got.text;
        // Only keep a page we could actually read a price from. Caching an
        // unreadable one hides the failure behind a warm cache for an hour.
        if (parseCheckout(text, pidOf(url)).pagePrice !== null) {
          store.setPrice(url, text, got.via);
        }
        out.fetched++;
        n++;
        sampledAt = new Date().toISOString();
      }
      const checkout = parseCheckout(text, pidOf(url));
      checkout.sampledAt = sampledAt;
      if (checkout.pagePrice === null) out.unpriced++;
      out.seen.push({
        product: c.modelName,
        card: c.best.price,
        page: checkout.pagePrice,
        inStock: checkout.inStock,
        seller: checkout.seller,
        sampledAt,
      });
      if (!hasCheckoutInfo(checkout)) continue;

      // A phone the page says is unbuyable sinks to the bottom of the table,
      // which reorders everything above it. That is too large an effect to
      // apply without saying so.
      if (checkout.inStock === false && c.best.inStock !== false) {
        out.stockChanged.push({
          product: c.modelName,
          inStock: false,
          seller: checkout.seller,
        });
      }

      const from = c.best.price;
      for (const l of c.listings) {
        if (canonicalUrl(l.url) === canonicalUrl(url)) {
          out.checkout.set(l.id, checkout);
        }
      }
      if (
        checkout.pagePrice && from &&
        Math.abs(checkout.pagePrice - from) / from > 0.02
      ) {
        out.changed.push({
          product: c.modelName,
          from,
          to: checkout.pagePrice,
          seller: checkout.seller,
        });
      }
    } catch {
      out.failed++;
    }
  }

  await store.save();
  return out;
}

export function reportRefreshDetail(r: RefreshResult): void {
  for (const s of r.seen) {
    const age = s.sampledAt ? ageLabel(s.sampledAt) : null;
    console.error(
      colors.dim(
        `    ${s.product.padEnd(34).slice(0, 34)} card ${
          s.card ? `₹${s.card.toLocaleString("en-IN")}` : "—"
        } · page ${
          s.page ? `₹${s.page.toLocaleString("en-IN")}` : "no price"
        } · ${
          s.inStock === false
            ? "OUT OF STOCK"
            : s.inStock === true
            ? "in stock"
            : "stock unknown"
        }${s.seller ? ` · ${s.seller}` : ""}${
          age ? ` · sampled ${age} ago` : ""
        }`,
      ),
    );
  }
}

export function reportRefresh(r: RefreshResult): void {
  // A refresh that read nothing must still say so - silence reads as success.
  if (!r.fetched && !r.cached && !r.skipped && !r.failed) return;
  const parts = [`${r.fetched} refetched`];
  if (r.cached) parts.push(`${r.cached} still fresh`);
  if (r.skipped) parts.push(`${r.skipped} skipped (no Flipkart parser)`);
  if (r.unpriced) parts.push(`${r.unpriced} with no price on the page`);
  if (r.failed && !r.fetched) {
    parts.push(`${r.failed} unreachable — the table keeps its card prices`);
  } else if (r.failed) {
    parts.push(`${r.failed} unreadable`);
  }
  // Prices move between requests; a sample's age is part of the number.
  const ages = r.seen
    .map((s) => s.sampledAt ? Date.now() - Date.parse(s.sampledAt) : 0)
    .filter((ms) => ms > 10 * 60_000);
  console.error(colors.dim(`  Prices: ${parts.join(", ")}`));
  for (const s of r.stockChanged.slice(0, 8)) {
    console.error(
      colors.yellow(
        `    ${s.product}: the page says out of stock — demoted below every buyable phone`,
      ),
    );
  }
  for (const c of r.changed.slice(0, 8)) {
    const dir = c.to > c.from ? "up" : "down";
    console.error(
      colors.yellow(
        `    ${c.product}: listed ₹${c.from.toLocaleString("en-IN")}, now ₹${
          c.to.toLocaleString("en-IN")
        } (${dir}${c.seller ? ` — ${c.seller} holds the buy box` : ""})`,
      ),
    );
  }
  const oldest = Math.max(0, ...ages);
  if (oldest >= 10 * 60_000) {
    console.error(
      colors.yellow(
        `    oldest price sample is ${
          ageLabel(new Date(Date.now() - oldest).toISOString())
        } old — treat the table as a snapshot, not a live feed`,
      ),
    );
  }
}

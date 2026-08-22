import { colors } from "@cliffy/ansi/colors";
import { isoNow, now } from "./clock.ts";
import {
  type CheckoutInfo,
  hasCheckoutInfo,
  parseCheckout,
} from "./checkout.ts";
import { ageLabel, SpecStore } from "./spec-cache.ts";
import { canonicalUrl } from "./normalize.ts";
import type { Candidate } from "./types.ts";
import {
  type FetchMode,
  fetchPage,
  pidOf,
  sleep,
  type Transport,
} from "./page-text.ts";

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
    transport?: Transport;
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
        sampledAt = store.priceFetchedAt(url) ?? isoNow();
      } else {
        if (n > 0) await sleep(opts.pace ?? 900);
        const got = await fetchPage(
          url,
          mode,
          opts.allowPaid ?? false,
          opts.transport,
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
        sampledAt = isoNow();
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
    .map((s) => s.sampledAt ? now() - Date.parse(s.sampledAt) : 0)
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
          ageLabel(new Date(now() - oldest).toISOString())
        } old — treat the table as a snapshot, not a live feed`,
      ),
    );
  }
}

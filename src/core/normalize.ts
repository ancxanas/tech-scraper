/**
 * Raw marketplace record -> canonical `Listing`.
 *
 * The single most important job here is LOSS RECOVERY. Marketplace scrapers
 * routinely return cards where the title/price selector missed but the product
 * URL is intact (in the sample Flipkart run, 54 of 120 cards). Those cards used
 * to be silently dropped, which is how a "phones under 15000" search ended up
 * ranking ₹1,599 earphones: the good cards were thrown away and the junk that
 * happened to parse survived.
 */

import type { Listing, PlatformId } from "./types.ts";

const PLATFORM_NAMES: Record<PlatformId, string> = {
  flipkart: "Flipkart",
  amazon: "Amazon India",
  reliance: "Reliance Digital",
  tatacliq: "Tata CLiQ",
  unknown: "Unknown",
};

type Raw = Record<string, unknown>;

function firstString(raw: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Money arrives as a number, a string ("₹13,999", "13,999.00"), or an object
 * ({value, currency, symbol}). Normalise all three.
 */
export function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.]/g, "");
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof v === "object") {
    const o = v as Raw;
    return parseMoney(o.value ?? o.amount ?? o.price ?? o.raw);
  }
  return null;
}

function parsePercent(v: unknown): number | null {
  if (typeof v === "number") return v > 0 && v <= 100 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const m = v.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Math.round(Number.parseFloat(m[1]));
  return n > 0 && n <= 100 ? n : null;
}

/** BrightData emits some booleans as the strings "true"/"false". */
function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "1") return true;
    if (t === "false" || t === "no" || t === "0") return false;
  }
  return null;
}

function parseRating(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return null;
  // Some sources give a percentage or a 0..100 score.
  if (n > 5 && n <= 100) return Math.round((n / 20) * 10) / 10;
  return n > 0 && n <= 5 ? n : null;
}

function parseCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*(k|l|lakh|m)?/);
  if (!m) return null;
  let n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "k") n *= 1_000;
  else if (m[2] === "m") n *= 1_000_000;
  else if (m[2] === "l" || m[2] === "lakh") n *= 100_000;
  return Math.round(n);
}

/** Brand casing that title-casing would otherwise mangle. */
const BRAND_CASING: Record<string, string> = {
  poco: "POCO",
  iqoo: "iQOO",
  oneplus: "OnePlus",
  realme: "realme",
  redmi: "Redmi",
  xiaomi: "Xiaomi",
  vivo: "vivo",
  oppo: "OPPO",
  lava: "LAVA",
  itel: "itel",
  jbl: "JBL",
  boat: "boAt",
  hp: "HP",
  msi: "MSI",
  lg: "LG",
  tcl: "TCL",
  asus: "ASUS",
  gb: "GB",
  tb: "TB",
  mp: "MP",
  mah: "mAh",
  hz: "Hz",
  ips: "IPS",
  lcd: "LCD",
  amoled: "AMOLED",
  "5g": "5G",
  "4g": "4G",
  "ai": "Ai",
};

function titleCaseToken(tok: string): string {
  const lower = tok.toLowerCase();
  if (BRAND_CASING[lower]) return BRAND_CASING[lower];
  // Alphanumeric model codes like "c85x", "m7", "sc26" -> uppercase.
  if (/^[a-z]{1,3}\d+[a-z]?$/.test(lower)) return lower.toUpperCase();
  if (/^\d/.test(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Recover a product title from a marketplace URL slug.
 *
 *   /poco-c85x-sunset-gold-128-gb/p/itm5e9...  ->  "POCO C85X Sunset Gold 128 GB"
 *   /product/samsung-galaxy-m06-5g-black-lgm2 ->  "Samsung Galaxy M06 5G Black"
 */
export function titleFromUrl(url: string): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0];
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Flipkart: /<slug>/p/<itemid>. Reliance: /product/<slug>. Amazon: /<slug>/dp/<asin>.
  let slug = segments[0];
  const pIdx = segments.findIndex((s) => s === "p" || s === "dp");
  if (pIdx > 0) slug = segments[pIdx - 1];
  else if (segments[0] === "product" && segments[1]) slug = segments[1];
  else slug = segments[segments.length - 1];

  if (!slug || slug.length < 4) return null;
  // Drop trailing opaque ids ("lgm2lf", "itm5e970a19e6ad3", pure hashes).
  const tokens = slug
    .split(/[-_]/)
    .filter((t) => t.length > 0)
    .filter((t) => !/^itm[0-9a-f]{6,}$/i.test(t))
    .filter((t) => !/^[0-9a-f]{10,}$/i.test(t));

  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  // Reliance appends a 5-8 char alphanumeric SKU with no vowels/meaning.
  if (
    tokens.length > 2 && /^[a-z0-9]{5,8}$/i.test(last) &&
    !/^\d+(gb|tb|mp|mah|hz)?$/i.test(last)
  ) {
    tokens.pop();
  }

  const title = tokens.map(titleCaseToken).join(" ");
  return title.length >= 4 ? title : null;
}

function detectPlatform(raw: Raw, hint?: PlatformId): PlatformId {
  if (hint && hint !== "unknown") return hint;
  const label = String(raw.platform ?? "").toLowerCase();
  if (label.includes("flipkart")) return "flipkart";
  if (label.includes("amazon")) return "amazon";
  if (label.includes("reliance")) return "reliance";
  if (label.includes("cliq")) return "tatacliq";

  const url = String(
    raw.product_url ?? raw.product_page_url ?? raw.productUrl ?? raw.url ??
      raw.link ?? "",
  );
  if (url.includes("flipkart.")) return "flipkart";
  if (url.includes("amazon.")) return "amazon";
  if (url.includes("reliancedigital.")) return "reliance";
  if (url.includes("tatacliq.")) return "tatacliq";
  const input = raw.input as Raw | undefined;
  if (input?.url) return detectPlatform({ url: input.url });
  return "unknown";
}

function stableId(platform: string, url: string, title: string): string {
  const basis = url || title;
  let h = 0;
  for (let i = 0; i < basis.length; i++) {
    h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  }
  return `${platform}:${(h >>> 0).toString(36)}`;
}

/** Strip marketplace tracking noise so URLs dedupe cleanly. */
export function canonicalUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const keep = new URLSearchParams();
    for (const k of ["pid", "asin", "skuId", "productId"]) {
      const v = u.searchParams.get(k);
      if (v) keep.set(k, v);
    }
    u.search = keep.toString();
    u.hash = "";
    return u.toString();
  } catch {
    return url.split("?")[0];
  }
}

export interface NormalizeStats {
  rawCards: number;
  titleRecovered: number;
  dropped: number;
  /** Cards dropped because they carried an upstream scraper error. */
  errorCards: number;
}

/**
 * Normalise a batch of raw records from one platform.
 * Never throws; unusable records are counted, not silently swallowed.
 */
export function normalizeBatch(
  rawItems: unknown[],
  platformHint?: PlatformId,
  scrapedAt = new Date().toISOString(),
): { listings: Listing[]; stats: NormalizeStats } {
  const stats: NormalizeStats = {
    rawCards: rawItems.length,
    titleRecovered: 0,
    dropped: 0,
    errorCards: 0,
  };
  const listings: Listing[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      stats.dropped++;
      continue;
    }
    const raw = item as Raw;

    if (raw.error || raw.error_code) {
      stats.errorCards++;
      continue;
    }

    const platform = detectPlatform(raw, platformHint);
    const url = String(
      raw.product_url ?? raw.product_page_url ?? raw.productUrl ?? raw.url ??
        raw.link ?? "",
    );

    let title = firstString(raw, [
      "product_name",
      "product_title",
      "title",
      "name",
      "productName",
    ]);
    let titleSource: Listing["titleSource"] = title ? "field" : "unknown";

    if (!title) {
      const recovered = titleFromUrl(url);
      if (recovered) {
        title = recovered;
        titleSource = "slug";
        stats.titleRecovered++;
      }
    }

    if (!title) {
      stats.dropped++;
      continue;
    }

    const price = parseMoney(
      raw.selling_price ?? raw.final_price ?? raw.price ?? raw.current_price ??
        raw.offer_price ?? raw.discounted_price,
    );
    const mrpRaw = parseMoney(
      raw.original_price ?? raw.initial_price ?? raw.originalPrice ?? raw.mrp ??
        raw.list_price ?? raw.strike_price,
    );
    // An "MRP" below the selling price is a parse artefact, not a discount.
    // An MRP more than 5x the price is likewise bad data (one Amazon card
    // claimed ₹1,59,994 MRP on an ₹8,899 phone), so it is discarded rather
    // than rewarded with a 94% discount.
    let mrp = mrpRaw;
    if (mrp !== null && price !== null && (mrp <= price || mrp > price * 5)) {
      mrp = null;
    }

    let discountPct = parsePercent(
      raw.discount_percentage ?? raw.discount ?? raw.discount_text,
    );
    if (discountPct === null && price && mrp && mrp > price) {
      discountPct = Math.round(((mrp - price) / mrp) * 100);
    }

    const availability = firstString(raw, [
      "availability",
      "stock_status",
      "in_stock_text",
    ]);
    let inStock: boolean | null = null;
    const rawInStock = parseBool(raw.in_stock ?? raw.inStock);
    if (rawInStock !== null) inStock = rawInStock;
    else if (availability) {
      const a = availability.toLowerCase();
      if (/out of stock|sold out|unavailable|currently unavailable/.test(a)) {
        inStock = false;
      } else if (/in stock|available|pincode/.test(a)) {
        // "Please enter a pincode" is Reliance's default — unknown, not absent.
        inStock = /pincode/.test(a) ? null : true;
      }
    }

    const missing: string[] = [];
    if (price === null) missing.push("price");
    if (mrp === null) missing.push("mrp");
    if (raw.rating === undefined && raw.product_rating === undefined) {
      missing.push("rating");
    }
    if (titleSource === "slug") missing.push("title(recovered)");

    listings.push({
      id: stableId(platform, canonicalUrl(url), title),
      platform,
      platformName: PLATFORM_NAMES[platform],
      title,
      titleSource,
      url: url || "",
      imageUrl: firstString(raw, [
        "image_url",
        "image",
        "main_image",
        "imageUrl",
        "img",
      ]),
      price,
      mrp,
      discountPct,
      rating: parseRating(raw.rating ?? raw.product_rating ?? raw.stars),
      ratingCount: parseCount(
        raw.review_count ?? raw.reviews_count ?? raw.reviewsCount ??
          raw.num_ratings ?? raw.ratings_count ?? raw.reviews,
      ),
      availability,
      inStock,
      sponsored: parseBool(raw.sponsored) === true ||
        parseBool(raw.is_sponsored) === true,
      sourceRank: typeof raw.position === "number"
        ? raw.position
        : typeof raw.rank_on_page === "number"
        ? raw.rank_on_page
        : null,
      scrapedAt,
      missing,
      raw,
    });
  }

  return { listings, stats };
}

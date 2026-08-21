/**
 * Compare what the search card said against what the product page says.
 *
 * The 14:39 run priced the Galaxy M17 5G at ₹12,049 when every published
 * source puts it at ₹15–18k, yet it priced the Galaxy M06 5G at ₹10,249 which
 * is right. So "card prices are stale" cannot be the whole story, and the fix
 * depends on which of three things is actually happening:
 *
 *   TITLE MISMATCH  the collector paired one card's title with another card's
 *                   price. 54 of 120 cards in an earlier capture arrived with
 *                   no title at all, so its row extraction is known fragile.
 *   MRP MISMATCH    card and page are different sellers. Neither is stale; we
 *                   are quoting a marketplace offer that is not the buy box.
 *   PRICE ONLY      same listing, same MRP, different price — genuinely stale
 *                   or geography-dependent, and only then is fetching the page
 *                   before ranking the right fix.
 *
 * Reads a saved run, so it costs no BrightData credit. Flipkart serves this
 * sandbox a reCAPTCHA, so it has to run from your machine.
 *
 *   deno task verify-prices runs/<dir>                 first 6 cards
 *   deno task verify-prices runs/<dir> 12              first 12
 *   deno task verify-prices runs/<dir> 12 --use-unlocker   when blocked
 */

import {
  fetchDirect,
  fetchPageHtml,
  pageToText,
} from "../src/lib/fetch-page.ts";
import { parseCheckout } from "../src/core/checkout.ts";

const useUnlocker = Deno.args.includes("--use-unlocker");

interface Card {
  product_name?: string;
  product_url?: string;
  selling_price?: { value?: number };
  original_price?: { value?: number };
}

const dir = Deno.args[0];
const limit = Number(Deno.args[1]) || 6;
if (!dir) {
  console.error("usage: deno task verify-prices runs/<dir> [count]");
  Deno.exit(1);
}

const cards: Card[] = JSON.parse(
  await Deno.readTextFile(`${dir}/flipkart.json`),
);

/** Keep the pid: on Flipkart it selects the colour and memory being priced. */

/**
 * Pull title, price and MRP out of the page.
 *
 * Flipkart renders the real spec and price table into a JSON blob rather than
 * the visible HTML, and the visible highlights are sometimes wrong, so read
 * the structured data and fall back to the rupee glyph only if that fails.
 */
function parsePdp(html: string) {
  const text = pageToText(html);
  const checkout = parseCheckout(text);
  const title = html.match(/<title[^>]*>([^<]{3,160})</i)?.[1]?.trim() ??
    text.slice(0, 90);
  return {
    title,
    price: checkout.pagePrice,
    mrp: checkout.pageMrp,
    blocked: /recaptcha|are you a human/i.test(html),
  };
}

/** Compare loosely: "(Sapphire Black, 128 GB) (6 GB RAM)" vs page wording. */
function sameProduct(cardTitle: string, pageTitle: string): boolean {
  const key = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) =>
      w.length > 2 &&
      !["buy", "online", "the", "gb", "price", "best"].includes(w)
    );
  const a = key(cardTitle);
  const b = new Set(key(pageTitle));
  const hits = a.filter((w) => b.has(w)).length;
  return hits >= Math.min(3, a.length);
}

const withUrls = cards.filter((c) => c.product_url && c.selling_price?.value)
  .slice(0, limit);

console.log(`Checking ${withUrls.length} cards from ${dir}\n`);
let titleMismatch = 0, mrpMismatch = 0, priceOnly = 0, agreed = 0, failed = 0;

for (const c of withUrls) {
  if (!c.product_url) continue;
  const cardPrice = c.selling_price!.value!;
  const cardMrp = c.original_price?.value ?? null;

  let html = "";
  try {
    html = await fetchDirect(c.product_url!, 20_000);
    if (/recaptcha|are you a human/i.test(html)) throw new Error("captcha");
  } catch (err) {
    if (!useUnlocker) {
      console.log(
        `  ✗ ${(err as Error).message} (retry with --use-unlocker)\n`,
      );
      failed++;
      continue;
    }
    try {
      html = await fetchPageHtml(c.product_url!);
    } catch (e2) {
      console.log(`  ✗ both transports failed: ${(e2 as Error).message}\n`);
      failed++;
      continue;
    }
  }

  const page = parsePdp(html);
  console.log(`• ${c.product_name}`);
  console.log(
    `  card:  ₹${cardPrice.toLocaleString("en-IN")}${
      cardMrp ? ` (MRP ₹${cardMrp.toLocaleString("en-IN")})` : ""
    }`,
  );

  if (page.blocked) {
    console.log(
      `  page:  BLOCKED — captcha${
        useUnlocker ? "" : " (retry with --use-unlocker)"
      }\n`,
    );
    failed++;
  } else if (!page.price) {
    console.log(`  page:  could not parse a price (${html.length} bytes)\n`);
    failed++;
  } else {
    console.log(
      `  page:  ₹${page.price.toLocaleString("en-IN")}${
        page.mrp ? ` (MRP ₹${page.mrp.toLocaleString("en-IN")})` : ""
      }`,
    );
    console.log(`  title: ${page.title ?? "?"}`);

    const titlesAgree = page.title && c.product_name
      ? sameProduct(c.product_name, page.title)
      : true;
    const priceGap = Math.abs(page.price - cardPrice) / cardPrice;

    if (!titlesAgree) {
      console.log(
        "  → TITLE MISMATCH: the card's title and this page are different products",
      );
      titleMismatch++;
    } else if (cardMrp && page.mrp && Math.abs(cardMrp - page.mrp) > 1) {
      console.log("  → MRP MISMATCH: same phone, different seller/listing");
      mrpMismatch++;
    } else if (priceGap > 0.02) {
      console.log(
        `  → PRICE ONLY: same listing, ${(priceGap * 100).toFixed(0)}% apart`,
      );
      priceOnly++;
    } else {
      console.log("  → agrees");
      agreed++;
    }
    console.log();
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.log("─".repeat(60));
console.log(
  `agrees ${agreed} · title mismatch ${titleMismatch} · mrp mismatch ${mrpMismatch} · price only ${priceOnly} · unreadable ${failed}`,
);
console.log(`
Reading the result:
  title mismatch dominates  -> fix the collector's row extraction; the price
                               belongs to a different card than the title
  mrp mismatch dominates    -> we are quoting a non-buy-box seller; prefer the
                               page's buy box, or drop such offers
  price only dominates      -> card prices really are stale; verify the top N
                               product pages before ranking
  unreadable dominates      -> Flipkart is blocking direct fetches from here
                               too, and this needs the Web Unlocker instead`);

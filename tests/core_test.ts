/**
 * Tests for the v2 ranking core.
 *
 * The fixture in tests/fixtures/run-phones-15000 is a REAL captured run
 * ("best phones under 15000", Flipkart + Reliance + a failed Tata CLiQ crawl).
 * It contains every pathology we care about: 54 cards with no title or price,
 * a Reliance payload full of earphones, a carrier-locked SKU, four colour
 * variants of the same phone, and an upstream crawler error object.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
  assertRejects,
} from "@std/assert";
import {
  normalizeBatch,
  parseMoney,
  titleFromUrl,
} from "../src/core/normalize.ts";
import { categoryMatches, classify } from "../src/core/classify.ts";
import {
  analyze,
  deriveModelKey,
  detectQualifiers,
  specsFromText,
} from "../src/core/extract.ts";
import { groupListings } from "../src/core/group.ts";
import { rankCandidates } from "../src/core/rank.ts";
import { parseIntentRules, unsupportedReason } from "../src/core/intent.ts";
import { ALL_ENABLED, PLATFORMS } from "../src/config.ts";
import {
  beebomSlugs,
  nameMatches,
  parseBeebomPage,
} from "../src/knowledge/beebom.ts";
import { toSpecs } from "../src/core/resolve.ts";
import { loadRun } from "../src/core/replay.ts";
import { buildCandidates, runPipeline } from "../src/core/pipeline.ts";
import { matchSoc, matchSocDetailed, SOCS } from "../src/knowledge/soc.ts";
import { lookupModel, PHONE_MODELS } from "../src/knowledge/models.ts";
import { hasCheckoutInfo, parseCheckout } from "../src/core/checkout.ts";
import { SpecStore } from "../src/core/spec-cache.ts";
import { reviewsUrlFor, summariseReviews } from "../src/core/reviews.ts";
import { buildUrls, searchTerm } from "../src/core/collect.ts";
import { canonicalUrl } from "../src/core/normalize.ts";
import {
  htmlToText,
  jsonStateText,
  pageToText,
} from "../src/lib/fetch-page.ts";
import {
  fetchSpecs as fetchExternalSpecs,
  normaliseModel,
  parseSpecPage,
  RateLimited,
  resolveModel,
} from "../src/knowledge/gsmarena.ts";
import { buildPrompt, classifyFailure } from "../src/commands/heal.ts";

const FIXTURE = "tests/fixtures/run-phones-15000";

// ---------------------------------------------------------------- money

Deno.test("parseMoney handles numbers, strings and BrightData price objects", () => {
  assertEquals(parseMoney(13999), 13999);
  assertEquals(parseMoney("₹13,999"), 13999);
  assertEquals(
    parseMoney({ value: 10999, currency: "INR", symbol: "₹" }),
    10999,
  );
  assertEquals(parseMoney("13,999.00"), 13999);
  assertEquals(parseMoney(null), null);
  assertEquals(parseMoney(0), null);
  assertEquals(parseMoney("out of stock"), null);
});

// ------------------------------------------------------- title recovery

Deno.test("titleFromUrl recovers a product name from a Flipkart slug", () => {
  const url =
    "https://www.flipkart.com/poco-c85x-sunset-gold-128-gb/p/itm5e970a19e6ad3?pid=MOBHMGG5BR94DQRY";
  assertEquals(titleFromUrl(url), "POCO C85X Sunset Gold 128 GB");
});

Deno.test("titleFromUrl strips Reliance's opaque SKU suffix", () => {
  const url =
    "https://www.reliancedigital.in/product/samsung-galaxy-m06-5g-black-lgm2lf";
  assertEquals(titleFromUrl(url), "Samsung Galaxy M06 5G Black");
});

Deno.test("normalizeBatch recovers the cards the old parser silently dropped", async () => {
  const raw = JSON.parse(await Deno.readTextFile(`${FIXTURE}/flipkart.json`));
  const { listings, stats } = normalizeBatch(raw, "flipkart");

  // The old pipeline kept 66 of 120; every card has a usable URL, so all 120
  // must survive normalisation.
  assertEquals(stats.rawCards, 120);
  assertEquals(listings.length, 120);
  assert(
    stats.titleRecovered >= 50,
    `expected >=50 recovered, got ${stats.titleRecovered}`,
  );
  assert(listings.every((l) => l.title.length > 3));
});

Deno.test("normalizeBatch counts upstream crawler errors instead of parsing them", async () => {
  const raw = JSON.parse(await Deno.readTextFile(`${FIXTURE}/tatacliq.json`));
  const { listings, stats } = normalizeBatch(raw, "tatacliq");
  assertEquals(listings.length, 0);
  assertEquals(stats.errorCards, 1);
});

Deno.test("an MRP below the selling price is discarded, not shown as a discount", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "Test Phone",
      selling_price: 15000,
      original_price: 12000,
      product_url: "https://www.flipkart.com/test-phone/p/itm1",
    },
  ], "flipkart");
  assertEquals(listings[0].mrp, null);
  assertEquals(listings[0].discountPct, null);
});

// -------------------------------------------------------- classification

Deno.test("earphones are never classified as phones", () => {
  const cases = [
    "OnePlus Bullets Z2 Bluetooth Wireless in Ear Earphones with Mic",
    "Reconnect Dank Wireless Earphone with IPX4 Water Resistant, Up to 16 Hours of playtime",
    "boAt Airdopes 141 TWS Earbuds",
  ];
  for (const title of cases) {
    const c = classify(title);
    assert(
      c.category === "earbuds" || c.category === "headphone",
      `${title} -> ${c.category}`,
    );
    assertEquals(categoryMatches("phone", c.category), false);
  }
});

Deno.test("Indian phone listing cards are classified as phones", () => {
  const cases = [
    "POCO M7 5G (Ocean Blue, 128 GB) (8 GB RAM)",
    "Samsung Galaxy M07 (Black, 64 GB) (4 GB RAM)",
    "realme narzo 100 Lite 5G (Thunder Black, 4GB RAM, 64GB Storage)",
  ];
  for (const title of cases) {
    assertEquals(classify(title).category, "phone", title);
  }
});

Deno.test("phone accessories are rejected even when they name a phone", () => {
  const c = classify("Back Cover for Samsung Galaxy M07, Tempered Glass Combo");
  assert(c.category !== "phone", `got ${c.category}`);
});

// ------------------------------------------------------------- extraction

Deno.test("deriveModelKey collapses colour and config variants", () => {
  const variants = [
    "POCO M7 5G (Ocean Blue, 128 GB) (8 GB RAM)",
    "POCO M7 5G (Mint Green, 128 GB) (6 GB RAM)",
    "POCO M7 5G Satin Black 128 GB", // recovered from a URL slug
  ];
  const keys = new Set(variants.map(deriveModelKey));
  assertEquals(keys.size, 1, [...keys].join(" | "));
  assertEquals([...keys][0], "poco m7 5g");
});

Deno.test("carrier-locked SKUs stay separate from the unlocked phone", () => {
  const locked = deriveModelKey(
    "POCO M7 5G - Locked with Airtel Prepaid (Mint Green, 128 GB)",
  );
  const unlocked = deriveModelKey("POCO M7 5G (Mint Green, 128 GB) (6 GB RAM)");
  assert(locked !== unlocked);
  assert(locked.includes("#carrier-locked"));
  assertEquals(detectQualifiers("Refurbished iPhone 13"), ["refurbished"]);
});

Deno.test("specs are parsed out of a standard listing title", () => {
  const { specs } = specsFromText("POCO M7 5G (Ocean Blue, 128 GB) (8 GB RAM)");
  assertEquals(specs.ramGb, 8);
  assertEquals(specs.storageGb, 128);
  assertEquals(specs.has5g, true);
  assertEquals(specs.colour, "Ocean Blue");
});

Deno.test("SoC lookup resolves aliases and ignores near-misses", () => {
  assertEquals(
    matchSoc("Snapdragon 4s Gen 2 processor")?.name,
    "Snapdragon 4s Gen 2",
  );
  assertEquals(matchSoc("MediaTek Dimensity 7025")?.name, "Dimensity 7025");
  assertEquals(matchSoc("Helio G99 Ultra")?.name, "Helio G99");
  assertEquals(matchSoc("no chipset mentioned here"), null);
});

Deno.test("knowledge base fills specs the listing never mentions", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "POCO M7 Pro 5G (Olive Twilight, 128 GB) (6 GB RAM)",
      selling_price: 14999,
      product_url:
        "https://www.flipkart.com/poco-m7-pro-5g-olive-twilight-128-gb/p/itm1",
    },
  ], "flipkart");
  const a = analyze(listings[0]);
  assertEquals(a.specs.socName, "Dimensity 7025");
  assertEquals(a.specs.panel, "AMOLED");
  assertEquals(a.specs.ois, true);
  assertExists(a.specs.antutu);
  assertEquals(a.specSources.panel, "kb");
});

// -------------------------------------------------------------- grouping

Deno.test("colour variants collapse into one candidate with one offer list", () => {
  const raws = ["Ocean Blue", "Mint Green", "Satin Black"].map((colour, i) => ({
    product_name: `POCO M7 5G (${colour}, 128 GB) (6 GB RAM)`,
    selling_price: 12499 + i, // slight price noise between colours
    product_url: `https://www.flipkart.com/poco-m7-5g-${
      colour.toLowerCase().replace(" ", "-")
    }-128-gb/p/itm${i}`,
  }));
  const { listings } = normalizeBatch(raws, "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].best.price, 12499);
});

Deno.test("different memory configs remain distinct candidates", () => {
  const raws = [
    { ram: 6, price: 12499 },
    { ram: 8, price: 13499 },
  ].map((c, i) => ({
    product_name: `POCO M7 5G (Ocean Blue, 128 GB) (${c.ram} GB RAM)`,
    selling_price: c.price,
    product_url:
      `https://www.flipkart.com/poco-m7-5g-ocean-blue-128-gb/p/itm${i}`,
  }));
  const { listings } = normalizeBatch(raws, "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  assertEquals(candidates.length, 2);
  assert(candidates.every((c) => c.siblingConfigs.length === 1));
});

Deno.test("the same phone on two platforms becomes one candidate with two offers", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      selling_price: 12499,
      product_url:
        "https://www.flipkart.com/poco-m7-5g-ocean-blue-128-gb/p/itm1",
    },
    {
      product_name: "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      selling_price: 12999,
      product_url: "https://www.amazon.in/poco-m7-5g/dp/B0TEST",
    },
  ]);
  const candidates = groupListings(listings.map((l) => analyze(l)));
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].offers.length, 2);
  assertEquals(candidates[0].best.platform, "flipkart");
});

Deno.test("review counts are not summed across colour variants", () => {
  const raws = ["Blue", "Black"].map((colour, i) => ({
    product_name: `POCO M7 5G (${colour}, 128 GB) (6 GB RAM)`,
    selling_price: 12499,
    rating: 4.1,
    review_count: 78000,
    product_url:
      `https://www.flipkart.com/poco-m7-5g-${colour.toLowerCase()}-128-gb/p/itm${i}`,
  }));
  const { listings } = normalizeBatch(raws, "flipkart");
  const [c] = groupListings(listings.map((l) => analyze(l)));
  assertEquals(c.ratingCount, 78000);
});

// ---------------------------------------------------------------- intent

Deno.test("intent parsing extracts category, budget and priorities", () => {
  const i = parseIntentRules("best gaming phones under 15000");
  assertEquals(i.category, "phone");
  assertEquals(i.budgetMax, 15000);
  assertEquals(i.budgetOperator, "under");
  assert(i.priorities.includes("performance"));
});

Deno.test("intent parsing understands k-suffixes, ranges and around", () => {
  assertEquals(parseIntentRules("phones under 20k").budgetMax, 20000);
  const between = parseIntentRules("laptops between 40000 and 60000");
  assertEquals(between.budgetMin, 40000);
  assertEquals(between.budgetMax, 60000);
  const around = parseIntentRules("earbuds around 3000");
  assertEquals(around.budgetOperator, "around");
  assert(around.budgetMax! > 3000 && around.budgetMin! < 3000);
});

Deno.test("intent parsing picks up brands and 5G requirements", () => {
  const i = parseIntentRules("samsung 5g phone under 15000");
  assertEquals(i.brands, ["Samsung"]);
  assert(i.mustHave.includes("5g"));
});

// --------------------------------------------------------------- ranking

Deno.test("budget is a hard gate, not a penalty", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      selling_price: 12499,
      product_url: "https://www.flipkart.com/poco-m7-5g/p/itm1",
    },
    {
      product_name: "Samsung Galaxy M35 5G (Blue, 128 GB) (6 GB RAM)",
      selling_price: 19999,
      product_url: "https://www.flipkart.com/samsung-galaxy-m35-5g/p/itm2",
    },
  ], "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  const { ranked, rejected } = rankCandidates(
    candidates,
    parseIntentRules("phones under 15000"),
  );
  assertEquals(ranked.length, 1);
  assertEquals(rejected.length, 1);
  assert(rejected[0].reasons[0].includes("over budget"));
});

Deno.test("a 4.9-star product with 3 reviews cannot outrank 4.2 with 150k", () => {
  const mk = (name: string, rating: number, count: number) => ({
    product_name: `${name} (Black, 128 GB) (6 GB RAM)`,
    selling_price: 12000,
    rating,
    review_count: count,
    product_url: `https://www.flipkart.com/${
      name.toLowerCase().replace(/ /g, "-")
    }/p/itm${name}`,
  });
  const { listings } = normalizeBatch(
    [mk("Nomame Alpha", 4.9, 3), mk("POCO M7 5G", 4.2, 150000)],
    "flipkart",
  );
  const candidates = groupListings(listings.map((l) => analyze(l)));
  const { ranked } = rankCandidates(
    candidates,
    parseIntentRules("phones under 15000"),
  );
  assertEquals(ranked[0].modelName.includes("POCO"), true);
});

Deno.test("an inflated MRP is flagged rather than rewarded", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "Nomame Ultra (Black, 128 GB) (6 GB RAM)",
      selling_price: 9999,
      original_price: 29999, // 67% "off"
      product_url: "https://www.flipkart.com/nomame-ultra/p/itm1",
    },
    {
      product_name: "POCO M7 5G (Black, 128 GB) (6 GB RAM)",
      selling_price: 12499,
      original_price: 12999,
      rating: 4.2,
      review_count: 78000,
      product_url: "https://www.flipkart.com/poco-m7-5g/p/itm2",
    },
  ], "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  const { ranked } = rankCandidates(
    candidates,
    parseIntentRules("phones under 15000"),
  );
  const fake = ranked.find((r) => r.modelName.includes("Nomame"))!;
  assert(
    fake.cons.some((c) => c.includes("inflated MRP")),
    fake.cons.join(" / "),
  );
});

// -------------------------------------------------- end-to-end regression

Deno.test("REGRESSION: a phone query never returns earphones", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const result = runPipeline("best phones under 15000", intent, batches);

  assert(result.ranked.length > 10, `only ${result.ranked.length} ranked`);
  for (const r of result.ranked) {
    assertEquals(
      r.category,
      "phone",
      `${r.modelName} classified ${r.category}`,
    );
    assert(
      !/earphone|earbud|headphone|bullets/i.test(r.modelName),
      `audio product in phone results: ${r.modelName}`,
    );
    assert(
      r.best.price <= 15000,
      `${r.modelName} at ₹${r.best.price} exceeds budget`,
    );
  }
});

Deno.test("REGRESSION: the same phone does not occupy several top slots", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { ranked } = runPipeline("best phones under 15000", intent, batches);

  const top10 = ranked.slice(0, 10);
  const models = top10.map((r) => r.key.split("|")[0]);
  const unique = new Set(models);
  // POCO M7 5G legitimately appears twice (6/128 and 8/128) — but no model may
  // take more than two of the top ten.
  for (const m of unique) {
    const n = models.filter((x) => x === m).length;
    assert(n <= 2, `${m} occupies ${n} of the top 10`);
  }
});

Deno.test("REGRESSION: the winner is spec-justified, not just cheap", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { ranked } = runPipeline("best phones under 15000", intent, batches);

  const winner = ranked[0];
  const cheapest = [...ranked].sort((a, b) => a.best.price - b.best.price)[0];
  assert(
    winner.score.confidence >= 0.8,
    `winner confidence ${winner.score.confidence}`,
  );
  assertExists(winner.specs.socName);
  // The old ranker was ~90% price; the new one should be willing to pay more
  // for a materially better phone.
  assert(
    winner.best.price >= cheapest.best.price,
    "winner should not simply be the cheapest item",
  );
  assert(
    winner.score.specScore > 40,
    `winner specScore ${winner.score.specScore}`,
  );
});

Deno.test("scores stay inside 0..100 and rank order is monotonic", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { ranked } = runPipeline("best phones under 15000", intent, batches);

  for (const r of ranked) {
    for (const [k, v] of Object.entries(r.score)) {
      if (k === "confidence") {
        assert(v >= 0 && v <= 1, `${k}=${v}`);
      } else {
        assert(v >= 0 && v <= 100, `${k}=${v}`);
      }
    }
  }
  for (let i = 1; i < ranked.length; i++) {
    assert(
      ranked[i - 1].score.total >= ranked[i].score.total,
      "not sorted by score",
    );
    assertEquals(ranked[i].rank, i + 1);
  }
});

Deno.test("diagnostics account for every scraped card", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { diagnostics, stats } = runPipeline(
    "best phones under 15000",
    intent,
    batches,
  );

  const totalRaw = diagnostics.reduce((s, d) => s + d.rawCards, 0);
  assertEquals(totalRaw, stats.rawCards);

  const flipkart = diagnostics.find((d) => d.platform === "Flipkart")!;
  assertEquals(flipkart.rawCards, 120);
  assertEquals(flipkart.normalized, 120);
  assert(flipkart.titleRecovered >= 50);

  // Reliance returned a smartphones "collection" that is actually accessories.
  const reliance = diagnostics.find((d) => d.platform === "Reliance Digital")!;
  assertEquals(reliance.categoryMatched, 0);
  assertAlmostEquals(reliance.fieldFill, 0.6, 0.15);
});

// ------------------------------------------------- Amazon payload regressions
//
// Added after replaying a real BrightData Amazon snapshot
// (sd_mt2gj3m12b2l7r2jy9) for "phones under 15000". Amazon titles are long
// marketing strings — "<product> | <feature> | <feature>" — and they broke
// several assumptions that held fine for Flipkart's terse cards.

Deno.test('Amazon: booleans arrive as the strings "true"/"false"', () => {
  const { listings } = normalizeBatch([
    {
      name: "Peace SC26 5G 6GB/64GB Smartphone (Silver)",
      final_price: 8988,
      sponsored: "false",
      url: "https://www.amazon.in/Xifo-Peace-5G/dp/B0HC7NKZGV",
    },
    {
      name: "Some Sponsored Phone (Black, 128 GB) (6 GB RAM)",
      final_price: 9999,
      sponsored: "true",
      url: "https://www.amazon.in/x/dp/B0OTHER",
    },
  ], "amazon");
  assertEquals(listings[0].sponsored, false);
  assertEquals(listings[1].sponsored, true);
});

Deno.test("Amazon: an absurd MRP is treated as bad data, not a 94% discount", () => {
  const { listings } = normalizeBatch([
    {
      name: "Peace I-Ultra 6GB/64GB Smartphone (Orange)",
      final_price: 8899,
      initial_price: 159994, // real value from the snapshot
      url: "https://www.amazon.in/peace-i-ultra/dp/B0X",
    },
  ], "amazon");
  assertEquals(listings[0].mrp, null);
  assertEquals(listings[0].discountPct, null);
});

Deno.test("Amazon: feature text in the title tail must not veto the category", () => {
  // Every one of these was silently dropped as an "accessory" or "unknown".
  const titles = [
    'Itel Zeno 200 (Nightly Blue, 4 GB RAM, 128 GB Storage) | 6.75" HD+ Display | 120 Hz Refresh Rate | IP65 Dust & Water Resistance | 13 MP Camera | 5000 mAh Battery | Charger in Box',
    "Samsung Galaxy M06 5G Mobile (Sage Green, 4GB RAM, 128GB Storage) | MediaTek Dimensity 6300 | AnTuTu 623K+ | 25W Fast Charging | 4 Gen OS Upgrades | 50MP Camera | Without Charger",
    "realme NARZO 90x 5G (Aqua Blue 2026, 6GB+128GB) | 7000mAh + 60W Biggest Battery & Fastest Charging in the Segment* | 144Hz Bright Display | Sony 50MP AI Rear Camera | 400% Ultra Boom Speaker",
  ];
  for (const t of titles) {
    assertEquals(classify(t).category, "phone", t.slice(0, 50));
  }
});

Deno.test("a genuine accessory is still rejected after the veto change", () => {
  const titles = [
    "Silicone Case for Sony WH-1000XM5 Headphones, Xm5 Headband Cover & Ear Cups Protector - Navy Blue",
    "SOULWIT Ear Pads Cushions Replacement for Sony WH-1000XM4",
    "Back Cover for Samsung Galaxy M07 | Shockproof | Camera Protection",
  ];
  for (const t of titles) {
    assert(classify(t).category !== "phone", t.slice(0, 40));
    assert(classify(t).category !== "headphone", t.slice(0, 40));
  }
});

Deno.test("Amazon: a stated AnTuTu score in the title is used", () => {
  const { specs } = specsFromText(
    "Samsung Galaxy M06 5G Mobile (Sage Green, 4GB RAM, 128GB Storage) | MediaTek Dimensity 6300 | AnTuTu 623K+ | 25W Fast Charging",
  );
  assertEquals(specs.antutu, 623000);
  assertEquals(specs.chargingW, 25);
});

Deno.test("REGRESSION: every phone in the real Amazon snapshot is kept", async () => {
  const raw = JSON.parse(
    await Deno.readTextFile(`${FIXTURE}/amazon.json`),
  );
  const { listings } = normalizeBatch(raw, "amazon");
  assertEquals(listings.length, 16);
  const analyzed = listings.map((l) => analyze(l));
  const phones = analyzed.filter((a) => a.category === "phone");
  assertEquals(phones.length, 16, "all 16 Amazon cards are phones");
});

// ----------------------------------------------------- model-specific queries

Deno.test("model hints parse for alphanumeric part numbers", () => {
  assertEquals(parseIntentRules("sony wh-1000xm5").modelHint, "wh-1000xm5");
  assertEquals(parseIntentRules("best phones under 15000").modelHint, null);
  assertExists(parseIntentRules("redmi note 14 5g").modelHint);
});

Deno.test("recorded history sharpens the deal score", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const base = runPipeline("q", intent, batches);
  const top = base.ranked[0];

  // Same product, previously seen ~18% more expensive.
  const history = new Map([[top.key, {
    min: top.best.price,
    max: Math.round(top.best.price * 1.18),
    position: 0,
    trend: "stable" as const,
    observations: 3,
    runs: 3,
    daysTracked: 30,
  }]]);

  const withHistory = runPipeline("q", intent, batches, {
    priceHistory: history,
  });
  const same = withHistory.ranked.find((r) => r.key === top.key)!;

  assert(
    same.score.dealScore > top.score.dealScore,
    `deal ${same.score.dealScore} should beat ${top.score.dealScore}`,
  );
  assert(same.badges.includes("LOWEST YET"));
  assert(
    same.pros.some((p) => /lowest price in 30 day/.test(p)),
    same.pros.join(" | "),
  );
});

Deno.test("a price sitting at its recorded high is penalised and flagged", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const base = runPipeline("q", intent, batches);
  const top = base.ranked[0];

  const history = new Map([[top.key, {
    min: Math.round(top.best.price * 0.8),
    max: top.best.price,
    position: 1,
    trend: "rising" as const,
    observations: 5,
    runs: 5,
    daysTracked: 20,
  }]]);

  const withHistory = runPipeline("q", intent, batches, {
    priceHistory: history,
  });
  const same = withHistory.ranked.find((r) => r.key === top.key)!;
  assert(same.cons.some((c) => /recorded high/.test(c)), same.cons.join(" | "));
  assert(!same.badges.includes("LOWEST YET"));
});

Deno.test("a single observation is not treated as history", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const base = runPipeline("q", intent, batches);
  const top = base.ranked[0];

  const history = new Map([[top.key, {
    min: top.best.price,
    max: top.best.price,
    position: 0,
    trend: "stable" as const,
    observations: 1,
    runs: 1,
    daysTracked: 0,
  }]]);

  const withHistory = runPipeline("q", intent, batches, {
    priceHistory: history,
  });
  const same = withHistory.ranked.find((r) => r.key === top.key)!;
  assertEquals(same.score.dealScore, top.score.dealScore);
  assert(!same.badges.includes("LOWEST YET"));
});

Deno.test("one run's breadth is not price history", async () => {
  // Three marketplaces sampled once each in a single run write three
  // observations at one timestamp. That is coverage, not a trend, and it must
  // not earn LOWEST YET or the 20-point deal bonus.
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const base = runPipeline("q", intent, batches);
  const top = base.ranked[0];

  const sameRunBreadth = new Map([[top.key, {
    min: top.best.price,
    max: Math.round(top.best.price * 1.2),
    position: 0,
    trend: "stable" as const,
    observations: 3, // three offers…
    runs: 1, // …all from one run
    daysTracked: 0,
  }]]);

  const withBreadth = runPipeline("q", intent, batches, {
    priceHistory: sameRunBreadth,
  });
  const same = withBreadth.ranked.find((r) => r.key === top.key)!;
  assertEquals(same.score.dealScore, top.score.dealScore);
  assert(!same.badges.includes("LOWEST YET"));
});

Deno.test("superlative badges require a clear win, not a tie", async () => {
  // Two phones on the same chipset score identically; `reduce` would hand the
  // badge to whichever came first, which reads as a measured distinction.
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const result = runPipeline("q", intent, batches);

  for (
    const [badge, of] of [
      ["FASTEST", (r: typeof result.ranked[number]) => r.score.performance],
      ["BATTERY KING", (r: typeof result.ranked[number]) => r.score.battery],
    ] as const
  ) {
    const holder = result.ranked.find((r) => r.badges.includes(badge));
    if (!holder) continue;
    const runnerUp = Math.max(
      ...result.ranked.filter((r) => r !== holder).map(of),
    );
    assert(
      of(holder) > runnerUp,
      `${badge} went to a tie: ${of(holder)} vs runner-up ${runnerUp}`,
    );
  }
});

Deno.test("the set's fastest phone is never told it compromises on speed", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const result = runPipeline("q", intent, batches);

  const best = result.ranked
    .filter((r) => (r.specs.antutu ?? 0) > 0)
    .reduce<typeof result.ranked[number] | null>(
      (
        a,
        b,
      ) => (a === null || b.score.performance > a.score.performance ? b : a),
      null,
    );
  if (best) {
    assert(
      !best.verdict.includes("compromises on raw speed"),
      `fastest phone's verdict contradicts itself: ${best.verdict}`,
    );
  }
});

// ------------------------------------------------------------------ rendered links

Deno.test("a rendered product link is never truncated", () => {
  // Clipping to terminal width turned "?pid=MOBHGU9DYEBQW6NW" into
  // "?pid=MOBH". That is not a shorter link, it is a broken one, and on
  // Flipkart the pid selects the colour and memory variant being priced — so
  // a clipped link also lands on a different SKU than the row it came from.
  const url =
    "https://www.flipkart.com/samsung-galaxy-m17-5g-moonlight-silver-128-gb/p/itmc3b8f7b511eca" +
    "?pid=MOBHGU9DYEBQW6NW&lid=LSTMOBHGU9DYEBQW6NWIWMUZV&marketplace=FLIPKART" +
    "&q=phones+under+15000&srno=s_5_106&otracker=search&fm=organic";
  const shown = canonicalUrl(url);
  assert(shown.includes("pid=MOBHGU9DYEBQW6NW"), `pid was mangled: ${shown}`);
  assert(!shown.includes("…"));
  // The tracking tail is what made it overflow in the first place.
  assert(!shown.includes("otracker") && !shown.includes("lid="));
});

// ------------------------------------------------------------ platform defaults

Deno.test("the default platform set contains only marketplaces that return phones", () => {
  // Reliance returned 0 in-category products in every recorded run and Tata
  // CLiQ 1 usable product from 35 cards, both costing minutes of wall time
  // and BrightData credit. A coverage table claiming four platforms when two
  // return nothing is worse than claiming two.
  assertEquals(ALL_ENABLED.sort(), ["amazon", "flipkart"]);
  for (const p of ["reliance", "tatacliq"] as const) {
    assert(!PLATFORMS[p].enabled);
    assert(
      (PLATFORMS[p].disabledReason ?? "").length > 20,
      `${p} is disabled without saying why`,
    );
  }
});

Deno.test("asking for a disabled platform still runs it", () => {
  // `enabled` governs the default set only. Silently dropping a platform
  // someone named on the command line would be its own bug.
  const urls = buildUrls("reliance", parseIntentRules("phones under 15000"), 1);
  assert(urls.length === 1 && urls[0].includes("reliancedigital.in/search"));
});

// -------------------------------------------------------------- benchmark scale

Deno.test("every chip is on the same benchmark scale", () => {
  // A v10 figure among v11 ones is invisible by inspection and misranks every
  // comparison that crosses it. v11 puts even the slowest chip we track above
  // 100k and the fastest under 3M, so anything outside that is a version slip.
  for (const soc of SOCS) {
    assert(
      soc.antutu >= 100_000 && soc.antutu <= 3_000_000,
      `${soc.name} at ${soc.antutu} is outside the v11 range — wrong scale?`,
    );
  }
});

Deno.test("the benchmark table preserves known hardware ordering", () => {
  const at = (n: string) => SOCS.find((s) => s.name === n)!.antutu;
  // Independently known ordering. A calibration run that inverts any of these
  // has gone wrong, however plausible the individual numbers look.
  assert(at("Snapdragon 8 Gen 3") > at("Dimensity 8300"));
  assert(at("Dimensity 8300") > at("Dimensity 6300"));
  assert(at("Dimensity 6300") > at("Unisoc T7250"));
  assert(at("Unisoc T7250") > at("Unisoc SC9863A"));
  assert(at("Snapdragon 6s Gen 3") > at("Helio G85"));
});

Deno.test("every chipset named in the model KB exists in the chip table", () => {
  // Otherwise the phone silently scores as if its chipset were unknown — the
  // exact "SoC ?" outcome, but hidden behind a name that looks resolved.
  for (const m of PHONE_MODELS) {
    if (!m.soc) continue;
    assert(
      SOCS.some((s) => s.name === m.soc),
      `${m.display} names "${m.soc}", which is not in soc.ts`,
    );
  }
});

// ------------------------------------------------------- secondary spec source

Deno.test("the secondary spec source reads a full sheet and a real benchmark", async () => {
  const html = await Deno.readTextFile(
    "tests/fixtures/beebom/realme-narzo-90x.html",
  );
  const s = parseBeebomPage(html, "u", "realme-narzo-90x")!;
  assert(s !== null);
  assertEquals(s.socName, "MediaTek Dimensity 6300");
  // Published per-phone, so it beats our per-chip approximation.
  assertEquals(s.antutu, 560000);
  assertEquals(s.batteryMah, 7000);
  assertEquals(s.refreshHz, 144);
  assertEquals(s.panel, "LCD");
  assertEquals(s.nm, 6);
  assertEquals(s.resolution, "HD+");
  assertEquals(s.mainCameraMp, 50);
  assertEquals(s.ipRating, "IP65");
});

Deno.test("a spec sheet without a benchmark still resolves the chipset", () => {
  // Most budget phones are never benchmarked. Returning null for antutu and
  // letting soc.ts supply the per-chip figure is correct; returning null for
  // the whole page because one field is missing would not be.
  const html = Deno.readTextFileSync(
    "tests/fixtures/beebom/itel-zeno-200.html",
  );
  const s = parseBeebomPage(html, "u", "itel-zeno-200")!;
  assertEquals(s.socName, "Unisoc T7250");
  assertEquals(s.antutu, null);
  assertEquals(s.batteryMah, 5000);
});

Deno.test("slug candidates cope with how brands are actually written", () => {
  // Measured: "motorola-g45-5g" 404s, "moto-g45-5g" is the live page.
  assertEquals(
    beebomSlugs("Motorola G45 5G (8GB/128GB)", "Motorola")[0],
    "moto-g45-5g",
  );
  // The marketplace config suffix must never reach the URL.
  assert(
    !beebomSlugs("realme Narzo 90x 5G (8GB/128GB)", "realme")[0].includes(
      "8gb",
    ),
  );
  assertEquals(
    beebomSlugs("REDMI A7 Pro 4G (4GB/64GB)", "Xiaomi")[0],
    "redmi-a7-pro-4g",
  );
});

Deno.test("a near-miss page is rejected rather than mis-attributed", () => {
  // The audit caught this live: "Redmi Note 13 Pro+ 5G" slugged to
  // "redmi-note-13-pro-5g", which is a real page for a different phone with a
  // different chipset. A 200 is not a match.
  assertEquals(
    beebomSlugs("Redmi Note 13 Pro+ 5G", "Xiaomi")[0],
    "redmi-note-13-pro-plus-5g",
  );
  const wrongPhone =
    '<title>Redmi Note 13 Pro - Price in India</title>{"name":"Redmi Note 13 Pro"}';
  assertEquals(
    nameMatches("Redmi Note 13 Pro+ 5G", wrongPhone, "redmi-note-13-pro"),
    false,
  );
  const rightPhone = "<title>Redmi Note 13 Pro+ 5G - Price in India</title>";
  assertEquals(
    nameMatches(
      "Redmi Note 13 Pro+ 5G",
      rightPhone,
      "redmi-note-13-pro-plus-5g",
    ),
    true,
  );
});

Deno.test("phones on the same chipset score the same, resolved or not", () => {
  // The performance score is relative, and only some phones get a live
  // benchmark. If a measured figure outranked the per-chip table, two
  // identical handsets would separate purely on fetch luck.
  const chip = matchSocDetailed("Dimensity 6300")!.soc;
  const resolved = toSpecs({
    url: "u",
    matchedName: "m",
    socName: "MediaTek Dimensity 6300",
    antutu: 560000,
    nm: null,
    geekbench: null,
    batteryMah: null,
    chargingW: null,
    panel: null,
    inches: null,
    refreshHz: null,
    resolution: null,
    mainCameraMp: null,
    ois: false,
    nfc: null,
    ipRating: null,
    weightG: null,
  });
  assertEquals(resolved.antutu, chip.antutu);
});

Deno.test("a page value cannot silently correct a confident KB chipset", () => {
  // Measured live: the secondary source reports the Redmi 14C 5G with the 4G
  // model's Snapdragon 4 Gen 2. nanoreview and the KB both say 4s Gen 2.
  const kb = lookupModel("Redmi 14C 5G");
  assertEquals(kb?.soc, "Snapdragon 4s Gen 2");
  assertEquals(kb?.confidence, "high");
});

Deno.test("a page with no chipset yields nothing rather than a hollow record", () => {
  assertEquals(
    parseBeebomPage("<html><body>not a phone</body></html>", "u", "x"),
    null,
  );
});

// ------------------------------------------------------------ heal diagnosis

Deno.test("heal classifies the failure modes seen in real runs", () => {
  const base = {
    platform: "X",
    rawCards: 100,
    normalized: 100,
    titleRecovered: 0,
    priced: 90,
    categoryMatched: 90,
    inBudget: 50,
    survived: 50,
    fieldFill: 0.85,
    status: "ok" as const,
    rejectionReasons: {},
  };

  // Tata CLiQ: the crawler never reached the grid.
  assertEquals(
    classifyFailure({
      ...base,
      status: "error",
      error: "Crawler error: waiting for selector failed",
      rawCards: 0,
    }),
    "crawler_error",
  );
  // Collector runs, returns nothing.
  assertEquals(classifyFailure({ ...base, rawCards: 0, priced: 0 }), "empty");
  // Reliance: a phone query that returned earphones.
  assertEquals(
    classifyFailure({ ...base, categoryMatched: 0 }),
    "wrong_products",
  );
  // Flipkart: 54 of 120 cards had no title or price.
  assertEquals(
    classifyFailure({ ...base, rawCards: 120, priced: 66, fieldFill: 0.5 }),
    "fields_missing",
  );
  assertEquals(classifyFailure(base), "healthy");
});

Deno.test("heal prompts name the specific fault, not a generic ask", () => {
  const base = {
    platform: "Tata CLiQ",
    rawCards: 0,
    normalized: 0,
    titleRecovered: 0,
    priced: 0,
    categoryMatched: 0,
    inBudget: 0,
    survived: 0,
    fieldFill: 0,
    status: "error" as const,
    error: "Crawler error: wait_element_timeout",
    rejectionReasons: {},
  };
  const prompt = buildPrompt(base, "crawler_error");
  assert(prompt.includes("wait_element_timeout"));
  assert(/product_name|selling_price/.test(prompt));

  const missing = buildPrompt(
    {
      ...base,
      status: "ok",
      error: undefined,
      rawCards: 120,
      priced: 66,
      fieldFill: 0.5,
    },
    "fields_missing",
  );
  assert(missing.includes("120"));
  assert(missing.includes("66"));
});

// --------------------------------------------------- phones only, on purpose

Deno.test("non-phone queries are declined, not badly ranked", () => {
  for (
    const q of [
      "best earbuds under 2000",
      "sony wh-1000xm5 headphones",
      "best gaming laptop under 80000",
      "55 inch smart tv under 40000",
      "smartwatch under 5000",
    ]
  ) {
    const reason = unsupportedReason(parseIntentRules(q));
    assertExists(reason, `expected "${q}" to be declined`);
    assert(/ranks phones/.test(reason!));
  }
});

Deno.test("phone queries are accepted", () => {
  for (
    const q of [
      "best phones under 15000",
      "samsung 5g phone under 20000",
      "poco m7 pro 5g",
      "phones under 10k",
    ]
  ) {
    assertEquals(unsupportedReason(parseIntentRules(q)), null, q);
  }
});

Deno.test("a bare model query is not mistaken for another category", () => {
  // No category word at all — must not be declined on a guess.
  assertEquals(unsupportedReason(parseIntentRules("iqoo z10 lite 5g")), null);
});

Deno.test("model hints resolve to the model code, not marketing suffixes", () => {
  assertEquals(parseIntentRules("poco m7 pro 5g").modelHint, "m7");
  assertEquals(parseIntentRules("iqoo z10 lite 5g").modelHint, "z10");
  assertEquals(parseIntentRules("sony wh-1000xm5").modelHint, "wh-1000xm5");
  assertEquals(parseIntentRules("redmi note 14 5g").modelHint, "note 14");
  // A budget must never be read as a model.
  assertEquals(parseIntentRules("best phones under 15000").modelHint, null);
});

Deno.test("naming a phone model floats it above better-value alternatives", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("poco m7 pro");
  const { ranked } = runPipeline("poco m7 pro", intent, batches);

  assert(ranked.length > 1);
  assertEquals(ranked[0].matchesRequestedModel, true);
  assert(/m7 pro/i.test(ranked[0].modelName), ranked[0].modelName);
  assert(ranked.slice(1).some((r) => r.badges.includes("ALTERNATIVE")));
});

Deno.test("REGRESSION: audio payloads yield nothing for a phone query", async () => {
  // The saved headphone run, asked a phone question. Every card must be
  // filtered, and the funnel must say why.
  const batches = await loadRun(["tests/fixtures/run-sony-wh1000xm5"]);
  const result = runPipeline(
    "best phones under 15000",
    parseIntentRules("best phones under 15000"),
    batches,
  );
  assertEquals(result.ranked.length, 0);
  const reasons = Object.keys(
    result.diagnostics.reduce<Record<string, number>>(
      (acc, d) => ({ ...acc, ...d.rejectionReasons }),
      {},
    ),
  );
  assert(
    reasons.some((r) => /headphone|earbuds|accessory|unknown/.test(r)),
    reasons.join(", "),
  );
});

// -------------------------------------------------- knowledge base integrity
//
// The KB is hand-maintained data, and a wrong entry corrupts ranking silently
// (worse than a missing one, which just lowers confidence). These guard it.

Deno.test("KB: no duplicate model keys", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const m of PHONE_MODELS) {
    if (seen.has(m.key)) dupes.push(m.key);
    seen.add(m.key);
    for (const a of m.aliases ?? []) {
      if (seen.has(a)) dupes.push(a);
      seen.add(a);
    }
  }
  assertEquals(dupes, []);
});

Deno.test("KB: every declared chipset resolves in the SoC table", () => {
  const unresolved = PHONE_MODELS
    .filter((m) => m.soc && !matchSoc(m.soc))
    .map((m) => `${m.key} -> ${m.soc}`);
  assertEquals(unresolved, []);
});

Deno.test("KB: values are inside plausible ranges", () => {
  for (const m of PHONE_MODELS) {
    if (m.batteryMah !== undefined) {
      assert(m.batteryMah >= 2000 && m.batteryMah <= 8000, `${m.key} battery`);
    }
    if (m.chargingW !== undefined) {
      assert(m.chargingW >= 5 && m.chargingW <= 300, `${m.key} charging`);
    }
    if (m.refreshHz !== undefined) {
      assert([60, 90, 120, 144, 165].includes(m.refreshHz), `${m.key} refresh`);
    }
    if (m.inches !== undefined) {
      assert(m.inches >= 4 && m.inches <= 8, `${m.key} size`);
    }
    if (m.mainCameraMp !== undefined) {
      assert(m.mainCameraMp >= 5 && m.mainCameraMp <= 250, `${m.key} camera`);
    }
    if (m.osUpgrades !== undefined) {
      assert(m.osUpgrades >= 0 && m.osUpgrades <= 8, `${m.key} updates`);
    }
  }
});

Deno.test("KB: a Pro variant never resolves to its non-Pro sibling", () => {
  const pairs: Array<[string, string]> = [
    ["POCO X6 Pro 5G (Black, 256 GB) (8 GB RAM)", "poco x6 pro 5g"],
    ["POCO X6 5G (Blue, 128 GB) (8 GB RAM)", "poco x6 5g"],
    ["Redmi Note 13 Pro+ 5G (Fusion Purple, 256 GB)", "redmi note 13 pro+ 5g"],
    ["Redmi Note 13 5G (Arctic White, 128 GB)", "redmi note 13 5g"],
    ["POCO M7 Pro 5G (Olive Twilight, 128 GB)", "poco m7 pro 5g"],
    ["POCO M7 5G (Ocean Blue, 128 GB)", "poco m7 5g"],
  ];
  for (const [title, expected] of pairs) {
    assertEquals(lookupModel(title)?.key, expected, title);
  }
});

// ------------------------------------------------------- enrichment targeting

Deno.test("enrichment targets the least-known products, not the top of the table", () => {
  // Regression: the first implementation sliced the top N and *then* dropped
  // well-documented products, so a budget of 14 fetches was spent on rank 1-14
  // — almost all already in the KB — and never reached the unknown phones
  // below them. Measured effect of the fix on the real fixture: chipset
  // coverage 10/48 -> 24/48, average confidence 41% -> 63%.
  const mk = (
    key: string,
    confidence: number,
    completeness: number,
    kb: string,
  ) =>
    ({
      key,
      modelName: key,
      specCompleteness: completeness,
      kbConfidence: kb,
      score: { confidence },
      listings: [{
        id: key,
        url: `https://www.flipkart.com/${key}/p/itm${key}`,
      }],
      best: { url: `https://www.flipkart.com/${key}/p/itm${key}` },
      // deno-lint-ignore no-explicit-any
    }) as any;

  const ranked = [
    mk("well-known-1", 1.0, 0.95, "high"),
    mk("well-known-2", 1.0, 0.9, "high"),
    mk("mystery-phone", 0.2, 0.3, "none"),
    mk("half-known", 0.6, 0.6, "medium"),
  ];

  // Mirror the selection logic: skip fully-known, then least-confident first.
  const eligible = ranked.filter((r) =>
    !(r.specCompleteness >= 0.85 && r.kbConfidence === "high")
  );
  const ordered = [...eligible].sort((a, b) =>
    a.score.confidence - b.score.confidence
  );

  assertEquals(eligible.length, 2);
  assertEquals(ordered[0].key, "mystery-phone");
});

Deno.test("SoC matching survives Flipkart's space-stripped highlight strings", () => {
  // Stripping tags from a Flipkart PDP yields "Snapdragon6 | Octa Core" and
  // bare part numbers like "T7250".
  assertEquals(
    matchSoc("4 GB RAM | 128 GB ROM T7250 | Octa Core Processor")?.name,
    "Unisoc T7250",
  );
  assertEquals(
    matchSoc("Dimensity6300 | Octa Core Processor")?.name,
    "Dimensity 6300",
  );
  // Ambiguous vendor-only strings must stay unresolved rather than guess.
  assertEquals(matchSoc("Snapdragon6 | Octa Core Processor"), null);
});

// ------------------------------------------------------- badges as promises

Deno.test("BEST VALUE requires evidence, not just a good ratio", async () => {
  // Regression from a live run: Maplin SC26 5G — unknown chipset, zero
  // ratings, 55% confidence — was badged BEST VALUE purely because its
  // imputed spec sheet divided nicely by a low price. A badge is a
  // recommendation and needs a verified chipset plus real review volume.
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { ranked } = runPipeline("q", intent, batches);

  for (const r of ranked) {
    if (!r.badges.includes("BEST VALUE") && !r.badges.includes("FASTEST")) {
      continue;
    }
    assertExists(
      r.specs.socName,
      `${r.modelName} badged without a known chipset`,
    );
    assert(
      (r.ratingCount ?? 0) >= 100,
      `${r.modelName} badged on ${r.ratingCount ?? 0} reviews`,
    );
    assert(
      r.score.confidence >= 0.6,
      `${r.modelName} badged at ${r.score.confidence} confidence`,
    );
  }
});

Deno.test("CHEAPEST is still allowed on an unverified product", async () => {
  // It is a statement of fact about price, not a recommendation, so it must
  // not be gated behind the same evidence bar.
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(
    "q",
    parseIntentRules("best phones under 15000"),
    batches,
  );
  const cheapest = [...ranked].sort((a, b) => a.best.price - b.best.price)[0];
  assert(cheapest.badges.includes("CHEAPEST"), cheapest.badges.join(","));
});

// ------------------------------------------------------------ checkout price

Deno.test("checkout details are parsed from a real Flipkart offer block", () => {
  const text =
    "Protect Promise Fee Buy at ₹14,249 Apply offers for maximum savings ₹14,249 " +
    "Lowest price for you OR ₹662 x 24m Pay ₹15,875 Exchange offer Not available at " +
    "this Pincode Up to ₹10,700 Change pincode to exchange item Exchange offer Up to " +
    "₹10,700 Bank offers Bank offers ₹750 off View EMI offers No Cost EMI* | Unlock ₹1 lakh";

  const c = parseCheckout(text);
  assertEquals(c.buyAt, 14249);
  assertEquals(c.bankOffer, 750);
  assertEquals(c.exchangeUpTo, 10700);
  assertEquals(c.noCostEmi, true);
  assertEquals(c.pincodeBlocked, true);
});

Deno.test("checkout parsing degrades quietly on a page with no offers", () => {
  const c = parseCheckout("Some product page with no offer block at all");
  assertEquals(c.buyAt, null);
  assertEquals(c.bankOffer, null);
  assertEquals(hasCheckoutInfo(c), false);
});

Deno.test("the flat card discount does not reorder results", async () => {
  // Measured across nine brands, Flipkart's "bank offer" was exactly 5.0% of
  // the listed price every time. A uniform proportional discount cancels out
  // of the value ratio, so ranking on it would be theatre. This pins that we
  // rank on the listed price and treat checkout info as display-only.
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const plain = runPipeline("q", intent, batches);

  const checkout = new Map(
    plain.ranked.flatMap((r) =>
      r.listings.map((l) =>
        [l.id, {
          inStock: null,
          deliveryBy: null,
          buyAt: Math.round(r.best.price * 0.95),
          bankOffer: Math.round(r.best.price * 0.05),
          exchangeUpTo: null,
          noCostEmi: true,
          pincodeBlocked: false,
        }] as const
      )
    ),
  );

  const withOffers = runPipeline("q", intent, batches, {
    checkoutInfo: checkout,
  });
  assertEquals(
    withOffers.ranked.map((r) => r.key),
    plain.ranked.map((r) => r.key),
  );
  assertExists(withOffers.ranked[0].checkout);
});

// ------------------------------------------------- cross-platform grouping

Deno.test("the same phone groups across Flipkart and Amazon title styles", () => {
  // Amazon writes "<product> | <feature> | <feature>", Flipkart does not.
  // Those feature tokens were leaking into the model key, so the same handset
  // produced two different keys and never merged — which is why 0 of 48
  // ranked products had offers on more than one platform.
  const pairs: Array<[string, string]> = [
    [
      "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      "POCO M7 5G Smartphone (Ocean Blue, 6GB RAM, 128GB Storage) | Snapdragon 4s Gen 2",
    ],
    [
      "Samsung Galaxy M06 5G (Sage Green, 128 GB) (4 GB RAM)",
      "Samsung Galaxy M06 5G Mobile (Sage Green, 4GB RAM, 128GB Storage) | MediaTek Dimensity 6300 | AnTuTu 623K+",
    ],
    [
      "realme narzo 100 Lite 5G (Thunder Black, 64 GB) (4 GB RAM)",
      "realme narzo 100 Lite 5G (Thunder Black,4GB+64GB) | 7000mAh Titan Battery",
    ],
    [
      "iQOO Z10 Lite 5G (Cyber Green, 64 GB) (4 GB RAM)",
      "iQOO Z10 Lite 5G (Cyber Green 2026, 4GB RAM, 64GB Storage) | Dimensity 6300",
    ],
  ];
  for (const [flipkart, amazon] of pairs) {
    assertEquals(deriveModelKey(amazon), deriveModelKey(flipkart), flipkart);
  }
});

Deno.test("a cross-platform pair produces one candidate with the cheaper offer first", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      selling_price: 12499,
      product_url:
        "https://www.flipkart.com/poco-m7-5g-ocean-blue-128-gb/p/itm1",
    },
    {
      name:
        "POCO M7 5G Smartphone (Ocean Blue, 6GB RAM, 128GB Storage) | Snapdragon 4s Gen 2 | 5160mAh",
      final_price: 11999,
      url: "https://www.amazon.in/POCO-M7-5G/dp/B0TEST123",
    },
  ]);
  const candidates = groupListings(listings.map((l) => analyze(l)));
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].offers.length, 2);
  assertEquals(candidates[0].best.platform, "amazon");
  assertEquals(candidates[0].best.price, 11999);
});

// ------------------------------------------- specs resolved before ranking

Deno.test("SoC matches record whether the page named the vendor", () => {
  // Flipkart writes "128 GB ROM 4 Gen 2 5G | Octa Core Processor", dropping
  // "Snapdragon". That is real evidence but a weak identification, because
  // "4 Gen 2" and "4s Gen 2" are different silicon.
  const named = matchSocDetailed("Qualcomm Snapdragon 4 Gen 2 processor");
  assertEquals(named?.soc.name, "Snapdragon 4 Gen 2");
  assertEquals(named?.ambiguous, false);

  const abbreviated = matchSocDetailed(
    "6 GB RAM | 128 GB ROM 4 Gen 2 5G | Octa Core",
  );
  assertEquals(abbreviated?.soc.name, "Snapdragon 4 Gen 2");
  assertEquals(abbreviated?.ambiguous, true);

  assertEquals(matchSocDetailed("no chipset here"), null);
});

Deno.test("an abbreviated page value cannot overwrite a confident KB entry", () => {
  // The C75 5G really does run the 4s Gen 2. A Flipkart highlights blob that
  // drops the vendor word and says only "4 Gen 2" is an abbreviation, not a
  // correction — it must not silently downgrade the phone to a different chip.
  const { listings } = normalizeBatch([
    {
      product_name: "POCO C75 5G (Enchanted Green, 64 GB) (4 GB RAM)",
      selling_price: 7499,
      product_url:
        "https://www.flipkart.com/poco-c75-5g-enchanted-green-64-gb/p/itm1",
    },
  ], "flipkart");

  const enrichText = new Map([[
    listings[0].id,
    "Product highlights 4 GB RAM | 64 GB ROM 4 Gen 2 5G | Octa Core Processor | 2.2 GHz",
  ]]);
  const a = analyze(listings[0], { enrichText });

  assertEquals(a.specs.socName, "Snapdragon 4s Gen 2");
  assertEquals(a.specSources.socName, "kb");
});

Deno.test("an unambiguous page value does overwrite the KB", () => {
  const { listings } = normalizeBatch([
    {
      product_name: "POCO M7 5G (Ocean Blue, 128 GB) (6 GB RAM)",
      selling_price: 12499,
      product_url:
        "https://www.flipkart.com/poco-m7-5g-ocean-blue-128-gb/p/itm1",
    },
  ], "flipkart");

  const enrichText = new Map([[
    listings[0].id,
    "Specifications Processor Qualcomm Snapdragon 6 Gen 1 Octa Core",
  ]]);
  const a = analyze(listings[0], { enrichText });
  assertEquals(a.specs.socName, "Snapdragon 6 Gen 1");
  assertEquals(a.specSources.socName, "enrich");
});

Deno.test("buildCandidates groups without ranking, so specs can resolve first", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules("best phones under 15000");
  const { candidates, intent: resolved } = buildCandidates(intent, batches);
  assert(candidates.length > 40, `only ${candidates.length} candidates`);
  assertEquals(resolved.category, "phone");
  // Not yet scored — that is the point.
  assert(!("score" in candidates[0]));
});

Deno.test("the spec cache round-trips and reports hits", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  const url = "https://www.flipkart.com/x/p/itm1?pid=ABC&lid=noise&srno=junk";

  const a = new SpecStore(path);
  await a.load();
  assertEquals(a.get(url), null);
  assertEquals(a.stats.misses, 1);
  a.set(url, "Product highlights 8 GB RAM | 256 GB ROM", "direct");
  await a.save();

  // Tracking parameters must not fragment the cache key.
  const b = new SpecStore(path);
  await b.load();
  assertExists(b.get("https://www.flipkart.com/x/p/itm1?pid=ABC&other=1"));
  assertEquals(b.stats.hits, 1);

  await Deno.remove(path);
});

// ------------------------------------------- embedded JSON spec extraction

Deno.test("spec text is harvested from the embedded JSON, not just visible markup", () => {
  // Flipkart ships the real specification table inside __INITIAL_STATE__.
  // Stripping <script> tags — what a naive html-to-text does — discards it and
  // leaves only marketing highlights, which is why chargingW was missing on 36
  // of 48 products and resolution on 29.
  const html = `<html><body><div>Product highlights 6 GB RAM</div>
    <script>window.__INITIAL_STATE__ = {"a":{"label_0":{"value":{"text":"Display Type"}},
    "label_1":{"value":{"text":["HD+ 120Hz Display"]}},
    "label_2":{"value":{"text":["Refresh Rate:120Hz, 240Hz Touch Sampling Rate"]}},
    "label_3":{"value":{"text":["5160 mAh Battery"]}},
    "label_4":{"value":{"text":["33W Fast Charging"]}}}}</script></body></html>`;

  const visible = htmlToText(html);
  assert(
    !visible.includes("Refresh Rate"),
    "script content must be stripped from visible text",
  );

  const harvested = jsonStateText(html);
  assert(harvested.includes("Refresh Rate:120Hz"), harvested);
  assert(harvested.includes("5160 mAh"), harvested);

  const combined = pageToText(html);
  assert(combined.includes("Product highlights"), "keeps visible text");
  assert(combined.includes("33W Fast Charging"), "adds JSON text");

  // And the extractor must now find fields it previously could not.
  const { specs } = specsFromText(combined);
  assertEquals(specs.refreshHz, 120);
  assertEquals(specs.batteryMah, 5160);
  assertEquals(specs.chargingW, 33);
});

Deno.test("JSON harvesting is bounded and survives malformed input", () => {
  assertEquals(jsonStateText(""), "");
  assertEquals(jsonStateText("<html>no json here</html>"), "");
  const huge = `<script>${
    '{"text":"filler value here"},'.repeat(5000)
  }</script>`;
  assert(jsonStateText(huge, 5_000).length <= 5_000);
});

// ------------------------------------------------ external spec database

Deno.test("external spec pages parse into structured specs and benchmarks", async () => {
  const text = await Deno.readTextFile(
    "tests/fixtures/gsmarena/poco-m7-pro.txt",
  );
  const s = parseSpecPage(text, "https://example.test/poco.php")!;
  assertExists(s);
  assertEquals(s.socName, "Dimensity 7025 Ultra");
  assertEquals(s.nm, 6);
  assertEquals(s.antutu, 442015); // measured, not our approximation
  assertEquals(s.geekbench, 2452);
  assertEquals(s.batteryMah, 5110);
  assertEquals(s.chargingW, 45);
  assertEquals(s.panel, "AMOLED");
  assertEquals(s.inches, 6.67);
  assertEquals(s.refreshHz, 120);
  assertEquals(s.resolution, "FHD+");
  assertEquals(s.mainCameraMp, 50);
  assertEquals(s.ois, true);
  assertEquals(s.nfc, true);
  assertEquals(s.ipRating, "IP64");
});

Deno.test("model resolution refuses near-misses", () => {
  const index = [
    {
      name: "Redmi Note 14s",
      brand: "Xiaomi",
      slug: "xiaomi_redmi_note_14s-1.php",
    },
    {
      name: "Poco M7 Pro",
      brand: "Xiaomi",
      slug: "xiaomi_poco_m7_pro_5g-2.php",
    },
    { name: "Poco M7", brand: "Xiaomi", slug: "xiaomi_poco_m7-3.php" },
    { name: "Galaxy M07", brand: "Samsung", slug: "samsung_galaxy_m07-4.php" },
  ];

  // Exact matches resolve, including through the sub-brand mapping
  // (POCO and Redmi are indexed under Xiaomi).
  assertEquals(
    resolveModel("poco m7 pro 5g", "POCO", index)?.slug,
    "xiaomi_poco_m7_pro_5g-2.php",
  );
  assertEquals(
    resolveModel("poco m7", "POCO", index)?.slug,
    "xiaomi_poco_m7-3.php",
  );
  assertEquals(
    resolveModel("samsung galaxy m07", "Samsung", index)?.slug,
    "samsung_galaxy_m07-4.php",
  );

  // "Redmi Note 14 5G" is NOT "Redmi Note 14s" — one character apart, different
  // chipset. An earlier prefix-matching version accepted it. Never again.
  assertEquals(resolveModel("redmi note 14", "Xiaomi", index), null);
  assertEquals(resolveModel("nonexistent phone 9000", "Xiaomi", index), null);
});

Deno.test("model names are normalised across marketplace and database spellings", () => {
  // Flipkart writes "MOTOROLA g35 5G"; the database writes "Moto G35".
  assertEquals(normaliseModel("MOTOROLA g35 5G"), normaliseModel("Moto G35"));
  assertEquals(
    normaliseModel("Samsung Galaxy M07 5G"),
    normaliseModel("samsung galaxy m07"),
  );
});

// -------------------------------------------- chipset matching needs context

Deno.test("REGRESSION: a case brand name must not be read as a chipset", () => {
  // Real failure. An Amazon recommendation carousel on a Rs 8,988 handset's
  // page contained "Aulumu A17 for iPhone 17 Pro Max Magnetic Thermal Case".
  // The bare "a17" alias matched, the phone was credited with an Apple A17 Pro
  // and an AnTuTu of 1,600,000, and it ranked #1 at 80% confidence.
  const carousel =
    "P: null Rs 9,999.00 FREE delivery Wed, 26 Aug Feedback Aulumu A17 for " +
    "iPhone 17 Pro Max Magnetic Thermal Case | CoolHyper | with stand";
  assertEquals(matchSoc(carousel), null);

  // The genuine article still resolves.
  assertEquals(matchSoc("Chipset Apple A17 Pro (3 nm)")?.name, "Apple A17 Pro");
  assertEquals(
    matchSoc("A17 Bionic hexa-core processor")?.name,
    "Apple A17 Pro",
  );
});

Deno.test("vendor-less chipset aliases require processor context", () => {
  // Flipkart drops the vendor: "128 GB ROM T7250 | Octa Core Processor".
  assertEquals(
    matchSoc("4 GB RAM | 64 GB ROM T7250 | Octa Core Processor | 1.8 GHz")
      ?.name,
    "Unisoc T7250",
  );
  // The same token loose in unrelated copy must not count.
  assertEquals(matchSoc("Order reference T7250 shipped on Tuesday"), null);
  assertEquals(matchSoc("Model number G99 packaging box"), null);
  // With context, it does.
  assertEquals(matchSoc("Processor Helio G99 octa-core")?.name, "Helio G99");
});

// -------------------------------------------------- paid transport is a fallback

Deno.test("--allow-paid is permission to fall back, not to spend by default", async () => {
  // The first implementation routed every spec-database lookup through the
  // paid transport whenever the flag was set, billing for pages the free
  // transport serves perfectly well. Free must always be attempted first.
  let directCalls = 0;
  let paidCalls = 0;

  const entry = { name: "Poco M7 Pro", brand: "Xiaomi", slug: "x-1.php" };
  const page = await Deno.readTextFile(
    "tests/fixtures/gsmarena/poco-m7-pro.txt",
  );

  // Free transport healthy: the paid one must never be reached.
  const ok = await fetchExternalSpecs(entry, "poco m7 pro", (_u) => {
    directCalls++;
    return Promise.resolve(page);
  });
  assertExists(ok);
  assertEquals(directCalls, 1);
  assertEquals(paidCalls, 0);

  // Free transport failing, with permission: fall back exactly once.
  const viaFallback = await fetchExternalSpecs(
    entry,
    "poco m7 pro",
    async (_u) => {
      directCalls++;
      try {
        throw new Error("HTTP 403");
      } catch {
        paidCalls++;
        return await Promise.resolve(page);
      }
    },
  );
  assertExists(viaFallback);
  assertEquals(paidCalls, 1);
});

Deno.test("a 429 from the spec database is surfaced as a distinct, stoppable error", async () => {
  const entry = { name: "Poco M7 Pro", brand: "Xiaomi", slug: "x-1.php" };
  await assertRejects(
    () =>
      fetchExternalSpecs(
        entry,
        "poco m7 pro",
        () => Promise.reject(new Error("HTTP 429")),
      ),
    RateLimited,
  );
});

// ------------------------------------------------------- stock availability

Deno.test("availability is read from the selected variant, not the page at large", async () => {
  // Real page text. Flipkart states it as "Selected Color: <x> Out of stock",
  // and the status belongs to the exact variant the URL points at.
  const out = await Deno.readTextFile(
    "tests/fixtures/pages/maplin-sc26-5g.txt",
  );
  assertEquals(parseCheckout(out).inStock, false);

  const ok = await Deno.readTextFile("tests/fixtures/pages/poco-m7-pro-5g.txt");
  const c = parseCheckout(ok);
  assertEquals(c.inStock, true);
  assertExists(c.deliveryBy);
});

Deno.test("a carousel's stock status cannot leak onto the product", () => {
  // Same defensive shape as the Apple A17 incident: the phrase exists on the
  // page, but not attached to the selected variant.
  const carousel =
    "Buy now Similar products Aulumu Case Out of stock Feedback More like this";
  assertEquals(parseCheckout(carousel).inStock, null);
});

Deno.test("an out-of-stock product is flagged and never recommended", () => {
  const rows = [
    {
      product_name:
        "Ghost Phone (Black, 128 GB) (6 GB RAM) | 5000 mAh | 120Hz AMOLED | 50MP | 5G",
      selling_price: 9999,
      rating: 4.3,
      review_count: 40000,
      product_url: "https://www.flipkart.com/ghost-phone/p/itmghost",
    },
    {
      product_name:
        "Stocked Phone (Black, 128 GB) (6 GB RAM) | 5000 mAh | 120Hz AMOLED | 50MP | 5G",
      selling_price: 12999,
      rating: 4.3,
      review_count: 40000,
      product_url: "https://www.flipkart.com/stocked-phone/p/itmstocked",
    },
  ];
  const { listings } = normalizeBatch(rows, "flipkart");
  const analyzed = listings.map((l) => analyze(l));
  const candidates = groupListings(analyzed);

  // Mark the cheaper one unavailable, as the resolver would.
  const ghost = candidates.find((c) => /Ghost/.test(c.modelName))!;
  ghost.best.inStock = false;

  const { ranked } = rankCandidates(
    candidates,
    parseIntentRules("best phones under 15000"),
  );
  const g = ranked.find((r) => /Ghost/.test(r.modelName))!;

  assert(g.badges.includes("OUT OF STOCK"), g.badges.join(","));
  assert(g.cons.some((c) => /out of stock/i.test(c)), g.cons.join(" | "));
  // It may still be listed, but it must not be held up as a recommendation.
  assert(!g.badges.includes("BEST VALUE"));
  assert(!g.badges.includes("FASTEST"));
});

Deno.test("--in-stock-only removes unavailable products entirely", () => {
  const rows = [{
    product_name:
      "Ghost Phone (Black, 128 GB) (6 GB RAM) | 5000 mAh | 120Hz | 50MP | 5G",
    selling_price: 9999,
    product_url: "https://www.flipkart.com/ghost-phone/p/itmghost",
  }];
  const { listings } = normalizeBatch(rows, "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  candidates[0].best.inStock = false;

  const intent = parseIntentRules("best phones under 15000");
  assertEquals(rankCandidates(candidates, intent).ranked.length, 1);
  assertEquals(
    rankCandidates(candidates, intent, { inStockOnly: true }).ranked.length,
    0,
  );
});

// ---------------------------------------------------------- review mining

Deno.test("the ratings histogram is parsed", async () => {
  const t = await Deno.readTextFile("tests/fixtures/reviews/poco-m7-5g.txt");
  const s = summariseReviews(t);
  assertEquals(s.totalRatings, 18971);
  assertEquals(s.totalReviews, 1065);
  assertEquals(s.distribution, { 1: 1239, 2: 647, 3: 1515, 4: 4233, 5: 11337 });
  // 1-2 star share distinguishes a clean 4.2 from a polarised one.
  assertAlmostEquals(s.negativeShare!, 0.099, 0.005);
});

Deno.test("polarity is judged per clause, not per review", async () => {
  const t = await Deno.readTextFile("tests/fixtures/reviews/poco-m7-5g.txt");
  const s = summariseReviews(t);
  const by = (a: string) => s.aspects.find((x) => x.aspect === a);

  // "Phone speed just wow.. Camera not good." — one review, opposite verdicts.
  assert(
    (by("performance")?.positive ?? 0) > 0,
    JSON.stringify(by("performance")),
  );
  assert((by("camera")?.negative ?? 0) > 0, JSON.stringify(by("camera")));
});

Deno.test("negation flips polarity", () => {
  const withNot = summariseReviews(
    "5.0 • Title Camera not good at all. Verified Purchase · Jan, 2025",
  );
  assert(
    (withNot.aspects.find((a) => a.aspect === "camera")?.negative ?? 0) > 0,
  );

  const plain = summariseReviews(
    "5.0 • Title Camera is good. Verified Purchase · Jan, 2025",
  );
  assert((plain.aspects.find((a) => a.aspect === "camera")?.positive ?? 0) > 0);
});

Deno.test("heating counts as a complaint even when phrased neutrally", () => {
  const s = summariseReviews(
    "3.0 • Title Phone heats while gaming. Verified Purchase · Jan, 2025",
  );
  assert((s.aspects.find((a) => a.aspect === "heating")?.negative ?? 0) > 0);
});

Deno.test("variant boilerplate does not become a review of storage", () => {
  // "Review for: Color X • RAM 8 GB • Storage 128 GB" prefixes every review;
  // left in, every product would appear to have storage opinions.
  const s = summariseReviews(
    "4.0 • Nice Review for: Color Ocean Blue • RAM 8 GB • Storage 128 GB Good phone. Verified Purchase · Jan, 2025",
  );
  assertEquals(s.sampled, 1);
  assert(
    !/Storage 128 GB/.test(s.aspects.map((a) => a.example ?? "").join(" ")),
  );
});

Deno.test("a single grumble is not reported as a pattern", () => {
  const s = summariseReviews(
    "3.0 • Meh Battery is bad. Verified Purchase · Jan, 2025",
  );
  // Mentioned, but not decisive enough to surface as a complaint.
  assert((s.aspects.find((a) => a.aspect === "battery")?.negative ?? 0) > 0);
  assertEquals(s.complained.length, 0);
});

Deno.test("reviews URL keeps the pid, without which Flipkart serves nothing", () => {
  assertEquals(
    reviewsUrlFor(
      "https://www.flipkart.com/poco-m7-5g/p/itm7c4?pid=MOBH9H&lid=x",
    ),
    "https://www.flipkart.com/poco-m7-5g/product-reviews/itm7c4?pid=MOBH9H",
  );
  // Other marketplaces block their review pages entirely.
  assertEquals(reviewsUrlFor("https://www.amazon.in/x/dp/B0TEST"), null);
});

// ------------------------------------------------------------ search depth

Deno.test("collector seeds are strided so extra requests buy new products", () => {
  // A single collector seed walks ~5 result pages by itself (measured: seeding
  // page=1 returned cards from result pages 1-5). Seeding 1,2,3 would re-fetch
  // most of the same catalogue, so seeds step by the observed stride and three
  // requests cover result pages 1-15 rather than 1-7.
  const intent = parseIntentRules("best phones under 15000");
  const urls = buildUrls("flipkart", intent, 3);
  assertEquals(urls.length, 3);
  assertEquals(new Set(urls).size, 3);
  assert(urls[0].includes("page=1"), urls[0]);
  assert(urls[1].includes("page=6"), urls[1]);
  assert(urls[2].includes("page=11"), urls[2]);

  // Amazon's dataset paginates literally, so its pages must stay consecutive.
  const az = buildUrls("amazon", intent, 3);
  assert(az[1].includes("page=2"), az[1]);
});

Deno.test("the budget filter is applied at the source, not just in ranking", () => {
  const intent = parseIntentRules("best phones under 15000");
  for (const p of ["flipkart", "tatacliq"] as const) {
    const url = buildUrls(p, intent, 1)[0];
    assert(/15000/.test(url), `${p} did not carry the budget: ${url}`);
  }
});

// ------------------------------------------- live-run regressions (round 14)

Deno.test("REGRESSION: the marketplace query keeps the user's words", () => {
  // It used to send a bare category word — "best phones under 15000" became
  // "mobile phone" — and marketplace relevance is driven by the phrase. A live
  // run returned keypad phones and white-label listings while Redmi, realme,
  // POCO and iQOO never appeared at all.
  assertEquals(
    searchTerm(parseIntentRules("best phones under 15000")),
    "phones under 15000",
  );
  assertEquals(
    searchTerm(parseIntentRules("best gaming phone under 30000")),
    "gaming phone under 30000",
  );
  // The brand is already in the words; it must not be duplicated.
  assertEquals(
    searchTerm(parseIntentRules("redmi phones under 15000")),
    "redmi phones under 15000",
  );
});

Deno.test("REGRESSION: keypad phones are not smartphones", () => {
  // A Rs 2,699 Nokia 150 reached #4 with a BATTERY KING badge.
  for (
    const t of [
      "Nokia 150 Dual SIM Premium Keypad Mobile Phone with MP3 Player, Wireless FM Radio",
      "Motorola A100 Keypad Mobile Phone with 2.4 inch display",
      "Lava Hero Shakti 2026 Dual Sim Keypad Phone 1200mAh",
    ]
  ) {
    assertEquals(classify(t).category, "featurephone", t.slice(0, 40));
    assertEquals(categoryMatches("phone", classify(t).category), false);
  }
  // Real smartphones are unaffected.
  assertEquals(
    classify("POCO M7 Pro 5G (Olive Twilight, 128 GB) (6 GB RAM)").category,
    "phone",
  );
});

Deno.test("REGRESSION: impossible specs are rejected, not recorded", () => {
  // The same Nokia was credited with 20,000 mAh, 8/128GB, 50MP OIS and 5G,
  // all harvested from a "Similar products" carousel.
  const contaminated =
    "Nokia 150 Keypad Phone | 2.4 inch display | 1000 mAh | Similar products " +
    "20000 mAh Power Bank 8GB 128GB 50MP OIS 120Hz 5G";
  const { specs } = specsFromText(contaminated);
  assertEquals(specs.batteryMah, undefined, "20000 mAh is a power bank");
  assertEquals(
    specs.displayInches,
    undefined,
    "2.4in is not a smartphone panel",
  );
  assertEquals(
    specs.refreshHz,
    undefined,
    "dropped along with the tiny screen",
  );
  assertEquals(specs.has5g, undefined);
  assertEquals(specs.ois, undefined);

  // A genuine listing keeps everything.
  const real = specsFromText(
    "POCO M7 Pro 5G (Olive Twilight, 128 GB) (6 GB RAM) | 6.67 inch AMOLED 120Hz | 5110 mAh | 45W | 50MP OIS | 5G",
  ).specs;
  assertEquals(real.batteryMah, 5110);
  assertEquals(real.refreshHz, 120);
  assertEquals(real.displayInches, 6.67);
  assertEquals(real.has5g, true);
});

Deno.test("implausible refresh rates are dropped rather than believed", () => {
  // "240Hz" on a Flipkart page is the touch sampling rate.
  assertEquals(
    specsFromText("6.7 inch display 240Hz touch sampling").specs.refreshHz,
    undefined,
  );
  assertEquals(
    specsFromText("6.7 inch 120Hz AMOLED display").specs.refreshHz,
    120,
  );
});

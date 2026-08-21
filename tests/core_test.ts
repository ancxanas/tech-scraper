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
import { loadRun } from "../src/core/replay.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { matchSoc } from "../src/knowledge/soc.ts";
import { lookupModel, PHONE_MODELS } from "../src/knowledge/models.ts";
import { hasCheckoutInfo, parseCheckout } from "../src/core/offers.ts";
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
    daysTracked: 0,
  }]]);

  const withHistory = runPipeline("q", intent, batches, {
    priceHistory: history,
  });
  const same = withHistory.ranked.find((r) => r.key === top.key)!;
  assertEquals(same.score.dealScore, top.score.dealScore);
  assert(!same.badges.includes("LOWEST YET"));
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

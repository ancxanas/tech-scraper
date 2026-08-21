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
import { parseIntentRules } from "../src/core/intent.ts";
import { loadRun } from "../src/core/replay.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { matchSoc } from "../src/knowledge/soc.ts";
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

Deno.test("naming a model puts that model first, alternatives after", async () => {
  const batches = await loadRun([
    "tests/fixtures/run-sony-wh1000xm5/amazon.json",
    "tests/fixtures/run-sony-wh1000xm5/flipkart.json",
  ]);
  const intent = parseIntentRules("sony wh-1000xm5");
  const { ranked } = runPipeline("sony wh-1000xm5", intent, batches);

  assert(ranked.length > 1);
  assert(
    /1000xm5/i.test(ranked[0].modelName),
    `expected the XM5 first, got ${ranked[0].modelName}`,
  );
  assertEquals(ranked[0].matchesRequestedModel, true);
  assert(ranked.slice(1).some((r) => r.badges.includes("ALTERNATIVE")));
});

Deno.test("category is inferred from results when the query omits it", async () => {
  const batches = await loadRun([
    "tests/fixtures/run-sony-wh1000xm5/amazon.json",
  ]);
  const intent = parseIntentRules("sony wh-1000xm5");
  assertEquals(intent.category, "unknown");
  const result = runPipeline("sony wh-1000xm5", intent, batches);
  assertEquals(result.intent.category, "headphone");
});

Deno.test("headphones are scored on audio dimensions, never on NaN", async () => {
  const batches = await loadRun([
    "tests/fixtures/run-sony-wh1000xm5/amazon.json",
  ]);
  const intent = parseIntentRules("sony wh-1000xm5 headphones");
  const { ranked } = runPipeline("sony wh-1000xm5 headphones", intent, batches);

  for (const r of ranked) {
    assert(
      Number.isFinite(r.score.total),
      `${r.modelName} total=${r.score.total}`,
    );
    assert(Number.isFinite(r.score.specScore));
  }
  // The XM5 has the best spec sheet in this set; it must out-spec the CH520
  // even though the CH520 is far better value.
  const xm5 = ranked.find((r) => /1000xm5/i.test(r.modelName))!;
  const ch520 = ranked.find((r) => /ch520/i.test(r.modelName))!;
  assertExists(xm5);
  assertExists(ch520);
  assert(
    xm5.score.specScore > ch520.score.specScore,
    `XM5 spec ${xm5.score.specScore} should beat CH520 ${ch520.score.specScore}`,
  );
  assert(ch520.score.valueScore > xm5.score.valueScore);
});

Deno.test("audio specs come from the audio knowledge base", async () => {
  const batches = await loadRun([
    "tests/fixtures/run-sony-wh1000xm5/amazon.json",
  ]);
  const intent = parseIntentRules("sony wh-1000xm5 headphones");
  const { ranked } = runPipeline("sony wh-1000xm5 headphones", intent, batches);
  const xm5 = ranked.find((r) => /1000xm5/i.test(r.modelName))!;
  assertEquals(xm5.specs.ancType, "hybrid-anc");
  assertEquals(xm5.specs.batteryHours, 30);
  assert(xm5.specs.codecs?.includes("LDAC"));
  assertEquals(xm5.specs.formFactor, "over-ear");
});

// ------------------------------------------------------ price history in rank

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

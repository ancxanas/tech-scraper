import { assert, assertEquals, assertExists } from "@std/assert";
import { loadRun } from "../src/core/replay.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { parseIntentRules } from "../src/core/intent.ts";
import { normalizeBatch } from "../src/core/normalize.ts";
import { analyze } from "../src/core/extract.ts";
import { groupListings } from "../src/core/group.ts";
import { rankCandidates } from "../src/core/rank.ts";
import type { RankedCandidate } from "../src/core/types.ts";

const FIXTURE = "tests/fixtures/run-phones-15000";
const QUERY = "best phones under 15000";

const SPEC_FIELDS = [
  "socName",
  "ramGb",
  "storageGb",
  "batteryMah",
  "chargingW",
  "displayInches",
  "refreshHz",
  "panel",
  "resolution",
  "mainCameraMp",
  "has5g",
] as const;

function knownFields(r: RankedCandidate): number {
  return SPEC_FIELDS.filter((f) => r.specs[f] !== null).length;
}

function rankSynthetic(
  rows: Array<Record<string, unknown>>,
  query = QUERY,
): RankedCandidate[] {
  const { listings } = normalizeBatch(rows, "flipkart");
  const candidates = groupListings(listings.map((l) => analyze(l)));
  return rankCandidates(candidates, parseIntentRules(query)).ranked;
}

function phone(
  name: string,
  price: number,
  over: Partial<{
    ram: number;
    storage: number;
    battery: number;
    charge: number;
    hz: number;
    panel: string;
    mp: number;
    rating: number;
    reviews: number;
  }> = {},
): Record<string, unknown> {
  const o = {
    ram: 6,
    storage: 128,
    battery: 5000,
    charge: 33,
    hz: 120,
    panel: "AMOLED",
    mp: 50,
    rating: 4.2,
    reviews: 20000,
    ...over,
  };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    product_name:
      `${name} (Black, ${o.storage} GB) (${o.ram} GB RAM) | Snapdragon 6 Gen 1 | ` +
      `${o.battery} mAh | ${o.charge}W | ${o.hz}Hz ${o.panel} FHD+ | ${o.mp}MP | 5G`,
    selling_price: price,
    rating: o.rating,
    review_count: o.reviews,
    product_url: `https://www.flipkart.com/${slug}/p/itm${slug}`,
  };
}

Deno.test("golden/invariant: ranking is deterministic", async () => {
  const batches = await loadRun([FIXTURE]);
  const intent = parseIntentRules(QUERY);
  const a = runPipeline(QUERY, intent, batches).ranked;
  const b = runPipeline(QUERY, intent, batches).ranked;

  assertEquals(a.map((r) => r.key), b.map((r) => r.key));
  assertEquals(a.map((r) => r.score.total), b.map((r) => r.score.total));
});

Deno.test("golden/invariant: the same phone cheaper never ranks worse", () => {
  const dearer = rankSynthetic([
    phone("Alpha One", 14000),
    phone("Beta Two", 12000),
    phone("Gamma Three", 10000),
  ]);
  const cheaper = rankSynthetic([
    phone("Alpha One", 9000),
    phone("Beta Two", 12000),
    phone("Gamma Three", 10000),
  ]);

  const before = dearer.findIndex((r) => r.modelName.includes("Alpha"));
  const after = cheaper.findIndex((r) => r.modelName.includes("Alpha"));
  assert(
    after <= before,
    `dropping the price moved Alpha from #${before + 1} to #${after + 1}`,
  );
});

Deno.test("golden/invariant: a Pareto-dominant phone outranks the one it dominates", () => {
  const ranked = rankSynthetic([
    phone("Dominant", 12000, {
      ram: 8,
      storage: 256,
      battery: 6000,
      charge: 67,
      hz: 120,
      panel: "AMOLED",
      mp: 108,
      rating: 4.4,
      reviews: 50000,
    }),
    phone("Dominated", 12000, {
      ram: 4,
      storage: 64,
      battery: 4500,
      charge: 18,
      hz: 60,
      panel: "IPS LCD",
      mp: 13,
      rating: 3.9,
      reviews: 50000,
    }),
  ]);
  assertEquals(
    ranked[0].modelName.includes("Dominant"),
    true,
    ranked.map((r) => r.modelName).join(" > "),
  );
});

Deno.test("golden/invariant: more memory at the same price never ranks worse", () => {
  const ranked = rankSynthetic([
    phone("Twin A", 12000, { ram: 8, storage: 256 }),
    phone("Twin B", 12000, { ram: 4, storage: 64 }),
  ]);
  assert(
    ranked[0].modelName.includes("Twin A"),
    ranked.map((r) => r.modelName).join(" > "),
  );
});

Deno.test("golden/gate: nothing over budget is ever shown", async () => {
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(QUERY, parseIntentRules(QUERY), batches);
  assert(ranked.length > 10);
  for (const r of ranked) {
    assert(r.best.price <= 15000, `${r.modelName} at ${r.best.price}`);
  }
});

Deno.test("golden/gate: every ranked item is a phone", async () => {
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(QUERY, parseIntentRules(QUERY), batches);
  for (const r of ranked) {
    assertEquals(r.category, "phone", r.modelName);
    assert(
      !/earphone|earbud|headphone|case|cover|charger|tempered/i.test(
        r.modelName,
      ),
      `accessory in results: ${r.modelName}`,
    );
  }
});

Deno.test("golden/gate: confidence reflects how much is actually known", async () => {
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(QUERY, parseIntentRules(QUERY), batches);
  for (const r of ranked) {
    const known = knownFields(r);
    if (known <= 3) {
      assert(
        r.score.confidence < 0.6,
        `${r.modelName}: ${known}/11 fields but ${r.score.confidence} confidence`,
      );
    }
    if (known === SPEC_FIELDS.length && r.rating !== null) {
      assert(
        r.score.confidence >= 0.7,
        `${r.modelName}: fully specced but only ${r.score.confidence}`,
      );
    }
  }
});

Deno.test("golden/gate: scores are bounded and strictly ordered", async () => {
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(QUERY, parseIntentRules(QUERY), batches);
  for (const r of ranked) {
    assert(r.score.total >= 0 && r.score.total <= 100, `${r.modelName}`);
    assert(r.score.confidence >= 0 && r.score.confidence <= 1);
  }
  for (let i = 1; i < ranked.length; i++) {
    assert(
      ranked[i - 1].score.total >= ranked[i].score.total,
      `out of order at #${i + 1}`,
    );
  }
});

Deno.test("golden/anchor: an unverifiable bargain cannot beat a verified phone", () => {
  const ranked = rankSynthetic([
    phone("Verified Phone", 13000, { rating: 4.3, reviews: 80000 }),
    {
      product_name: "Nomame Ultra Max Smartphone",
      selling_price: 6499,
      original_price: 24999,
      product_url: "https://www.flipkart.com/nomame-ultra/p/itmnomame",
    },
  ]);
  assert(
    ranked[0].modelName.includes("Verified"),
    `unverifiable product led: ${ranked.map((r) => r.modelName).join(" > ")}`,
  );
});

Deno.test("golden/anchor: an inflated MRP does not buy a top placement", () => {
  const ranked = rankSynthetic([
    phone("Honest Phone", 12000, { rating: 4.3, reviews: 60000 }),
    {
      ...phone("Fake Discount", 12000, { rating: 4.3, reviews: 60000 }),
      original_price: 39999,
    },
  ]);
  assertEquals(
    ranked[0].modelName.includes("Honest"),
    true,
    ranked.map((r) => r.modelName).join(" > "),
  );
});

Deno.test("golden/anchor: the best-specced phone in the fixture reaches the top 3", async () => {
  const batches = await loadRun([FIXTURE]);
  const { ranked } = runPipeline(QUERY, parseIntentRules(QUERY), batches);
  const idx = ranked.findIndex((r) => /m7 pro/i.test(r.modelName));
  assert(idx >= 0 && idx < 3, `POCO M7 Pro 5G ranked #${idx + 1}`);
});

Deno.test("golden/anchor: a gaming query lifts the faster chip", () => {
  const neutral = rankSynthetic([
    phone("Fast Chip", 13000) as Record<string, unknown>,
    phone("Big Battery", 13000, { battery: 7000, charge: 15 }),
  ]);
  const gaming = rankSynthetic(
    [
      {
        ...phone("Fast Chip", 13000),
        product_name: (phone("Fast Chip", 13000).product_name as string)
          .replace("Snapdragon 6 Gen 1", "Snapdragon 7s Gen 3"),
      },
      phone("Big Battery", 13000, { battery: 7000, charge: 15 }),
    ],
    "best gaming phone under 15000",
  );
  assertExists(neutral[0]);
  assert(
    gaming[0].modelName.includes("Fast Chip"),
    `gaming query led with ${gaming[0].modelName}`,
  );
});

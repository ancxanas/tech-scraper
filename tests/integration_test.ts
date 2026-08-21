import { assertEquals } from "@std/assert/equals";
import { setFetchFn } from "../src/lib/brightdata.ts";
import { parseCustomProducts } from "../src/tools/scraper.ts";
import { deduplicate, scoreAndRank } from "../src/score.ts";
import type { Product } from "../src/types.ts";

const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname;

function loadFixture(name: string): Promise<unknown[]> {
  const path = `${FIXTURES_DIR}/${name}`;
  return Deno.readTextFile(path).then((text) => JSON.parse(text));
}

function validateProduct(p: Product): string[] {
  const errors: string[] = [];
  if (!p.id) errors.push("missing id");
  if (!p.name || p.name === "Unknown") errors.push("missing name");
  if (typeof p.price !== "number" || p.price <= 0) {
    errors.push(`bad price: ${p.price}`);
  }
  if (!p.currency) errors.push("missing currency");
  if (!p.platform) errors.push("missing platform");
  if (!p.scrapedAt) errors.push("missing scrapedAt");
  if (p.id && !p.id.includes(":")) {
    errors.push(`id missing platform prefix: ${p.id}`);
  }
  return errors;
}

function fieldFillRate(products: Product[], field: keyof Product): number {
  if (products.length === 0) return 0;
  const filled = products.filter((p) => {
    const v = p[field];
    return v !== undefined && v !== null && v !== "" && v !== "Unknown";
  }).length;
  return Math.round((filled / products.length) * 100);
}

// ─── parseCustomProducts × fixtures ───

Deno.test("integration: parseCustomProducts Flipkart fixture", async () => {
  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "flipkart");

  assertEquals(products.length, 14, "should parse 14 non-error items from 15");

  for (const p of products) {
    const errors = validateProduct(p);
    assertEquals(errors.length, 0, `${p.name}: ${errors.join(", ")}`);
  }

  const ids = products.map((p) => p.id);
  const uniqueIds = new Set(ids);
  assertEquals(
    ids.length,
    uniqueIds.size,
    "all IDs must be unique within platform",
  );
});

Deno.test("integration: parseCustomProducts Reliance fixture", async () => {
  const raw = await loadFixture("reliance_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "reliance");

  assertEquals(products.length, 10);

  for (const p of products) {
    const errors = validateProduct(p);
    assertEquals(errors.length, 0, `${p.name}: ${errors.join(", ")}`);
  }
});

Deno.test("integration: parseCustomProducts Tata CLiQ fixture", async () => {
  const raw = await loadFixture("tatacliq_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "tatacliq");

  assertEquals(products.length, 10);

  for (const p of products) {
    const errors = validateProduct(p);
    assertEquals(errors.length, 0, `${p.name}: ${errors.join(", ")}`);
  }
});

Deno.test("integration: parseCustomProducts Amazon fixture", async () => {
  const raw = await loadFixture("amazon_raw.json") as Record<string, unknown>[];
  const products = parseCustomProducts(raw as never[], "amazon");

  assertEquals(products.length, 12);

  for (const p of products) {
    const errors = validateProduct(p);
    assertEquals(errors.length, 0, `${p.name}: ${errors.join(", ")}`);
  }

  const withAsin = products.filter((p) => p.id.includes(":B0"));
  assertEquals(
    withAsin.length >= 10,
    true,
    "most Amazon products should have ASIN-based IDs",
  );
});

// ─── field fill rates ───

Deno.test("integration: Flipkart field fill rates", async () => {
  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "flipkart");

  assertEquals(fieldFillRate(products, "name") >= 95, true);
  assertEquals(fieldFillRate(products, "price") >= 95, true, "price fill rate");
  assertEquals(
    fieldFillRate(products, "productUrl") >= 95,
    true,
    "productUrl fill rate",
  );
  assertEquals(
    fieldFillRate(products, "currency") >= 95,
    true,
    "currency fill rate",
  );
  assertEquals(fieldFillRate(products, "brand") >= 80, true, "brand fill rate");
  assertEquals(
    fieldFillRate(products, "rating") >= 80,
    true,
    "rating fill rate",
  );
  assertEquals(
    fieldFillRate(products, "reviewsCount") >= 80,
    true,
    "reviewsCount fill rate",
  );
});

Deno.test("integration: Amazon field fill rates", async () => {
  const raw = await loadFixture("amazon_raw.json") as Record<string, unknown>[];
  const products = parseCustomProducts(raw as never[], "amazon");

  assertEquals(fieldFillRate(products, "name") >= 95, true);
  assertEquals(fieldFillRate(products, "price") >= 95, true, "price fill rate");
  assertEquals(
    fieldFillRate(products, "productUrl") >= 95,
    true,
    "productUrl fill rate",
  );
  assertEquals(fieldFillRate(products, "brand") >= 90, true, "brand fill rate");
  assertEquals(
    fieldFillRate(products, "rating") >= 80,
    true,
    "rating fill rate",
  );
  assertEquals(
    fieldFillRate(products, "reviewsCount") >= 80,
    true,
    "reviewsCount fill rate",
  );
  assertEquals(
    fieldFillRate(products, "seller") >= 80,
    true,
    "seller fill rate",
  );
});

// ─── scrapeProducts with mocked fetch ───

function mockFetchForTrigger(triggerResponse: unknown, pollData: unknown[]) {
  setFetchFn(
    (
      url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const urlStr = typeof url === "string"
        ? url
        : url instanceof URL
        ? url.href
        : url.url;

      if (urlStr.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify(triggerResponse), { status: 200 }),
        );
      }

      if (urlStr.includes("/dca/get_result")) {
        return Promise.resolve(
          new Response(JSON.stringify(pollData), { status: 200 }),
        );
      }

      if (urlStr.includes("/dca/dataset")) {
        return Promise.resolve(
          new Response(JSON.stringify(pollData), { status: 200 }),
        );
      }

      if (urlStr.includes("/datasets/v3/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify(triggerResponse), { status: 200 }),
        );
      }

      if (urlStr.includes("/datasets/v3/progress")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: "ready" }),
            { status: 200 },
          ),
        );
      }

      if (urlStr.includes("/datasets/v3/snapshot")) {
        return Promise.resolve(
          new Response(JSON.stringify(pollData), { status: 200 }),
        );
      }

      return Promise.resolve(
        new Response("Not found", { status: 404 }),
      );
    },
  );
}

Deno.test("integration: scrapeProducts with mocked Flipkart data", async () => {
  const { scrapeProducts } = await import("../src/scraper.ts");

  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const filtered = raw.filter(
    (item: Record<string, unknown>) => !item.error,
  );

  mockFetchForTrigger(
    { collection_id: "mock-collection-123" },
    filtered,
  );

  Deno.env.set("BRIGHTDATA_API_KEY", "test-key-mock");

  const results = await scrapeProducts("sony wh-1000xm5", ["flipkart"], {
    pages: 1,
    noHeal: true,
    enrichCount: 0,
  });

  assertEquals(results.length, 1);
  assertEquals(results[0].status, "ok");
  assertEquals(results[0].parsedCount, 3);
  assertEquals(results[0].products.length, 3);

  for (const p of results[0].products) {
    const errors = validateProduct(p);
    assertEquals(errors.length, 0, `${p.name}: ${errors.join(", ")}`);
  }
});

Deno.test("integration: scrapeProducts with mocked Amazon prebuilt", async () => {
  const { scrapeProducts } = await import("../src/scraper.ts");

  const raw = await loadFixture("amazon_raw.json") as Record<string, unknown>[];

  mockFetchForTrigger(
    { snapshot_id: "mock-snapshot-456" },
    raw,
  );

  Deno.env.set("BRIGHTDATA_API_KEY", "test-key-mock");

  const results = await scrapeProducts("sony wh-1000xm5", ["amazon"], {
    pages: 1,
    noHeal: true,
    enrichCount: 0,
  });

  assertEquals(results.length, 1);
  assertEquals(results[0].status, "ok");
  assertEquals(
    results[0].parsedCount >= 10,
    true,
    `expected >= 10, got ${results[0].parsedCount}`,
  );
});

// ─── full pipeline: parse → score → dedup ───

Deno.test("integration: scoreAndRank with parsed fixture data", async () => {
  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "flipkart");

  const scored = scoreAndRank(products, "sony wh-1000xm5");

  assertEquals(scored.length > 0, true);

  for (let i = 1; i < scored.length; i++) {
    assertEquals(
      scored[i].score <= scored[i - 1].score,
      true,
      `scores should be descending: ${scored[i - 1].score} < ${
        scored[i].score
      }`,
    );
  }

  const sonyProducts = scored.filter((p) =>
    p.name.toLowerCase().includes("sony")
  );
  assertEquals(
    sonyProducts.length >= 2,
    true,
    "should have multiple Sony products",
  );
});

Deno.test("integration: deduplicate keeps cross-platform rows", async () => {
  const flipkartRaw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const amazonRaw = await loadFixture("amazon_raw.json") as Record<
    string,
    unknown
  >[];

  const flipkartProducts = parseCustomProducts(
    flipkartRaw as never[],
    "flipkart",
  );
  const amazonProducts = parseCustomProducts(amazonRaw as never[], "amazon");

  const combined = [...flipkartProducts, ...amazonProducts];
  const deduped = deduplicate(combined);

  const platforms = new Set(deduped.map((p) => p.platform));
  assertEquals(
    platforms.size >= 2,
    true,
    `dedup should keep cross-platform: ${[...platforms].join(", ")}`,
  );

  const flipkartCount = deduped.filter((p) => p.platform === "Flipkart").length;
  const amazonCount =
    deduped.filter((p) => p.platform === "Amazon India").length;

  assertEquals(flipkartCount >= 10, true, `Flipkart rows: ${flipkartCount}`);
  assertEquals(amazonCount >= 8, true, `Amazon rows: ${amazonCount}`);
});

// ─── INR price parsing through pipeline ───

Deno.test("integration: INR string prices parse correctly through pipeline", async () => {
  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "flipkart");

  const withInrStrings = products.filter((p) => {
    const orig = raw.find(
      (r: Record<string, unknown>) =>
        (r.product_title as string)?.includes(p.name.split(" ")[0]),
    );
    return orig && typeof orig.selling_price === "string";
  });

  for (const p of withInrStrings) {
    assertEquals(
      typeof p.price === "number" && p.price > 0,
      true,
      `INR string product "${p.name}" should parse to positive number, got ${p.price}`,
    );
  }
});

// ─── discount computation ───

Deno.test("integration: discount computed correctly from MRP and price", async () => {
  const raw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(raw as never[], "flipkart");

  const withDiscount = products.filter((p) => p.discount > 0);
  assertEquals(
    withDiscount.length >= 10,
    true,
    "most products should have discounts",
  );

  for (const p of withDiscount) {
    assertEquals(
      p.originalPrice > p.price,
      true,
      `discount product "${p.name}": originalPrice(${p.originalPrice}) should > price(${p.price})`,
    );
  }
});

// ─── error items filtered ───

Deno.test("integration: error items filtered out from fixtures", async () => {
  const flipkartRaw = await loadFixture("flipkart_raw.json") as Record<
    string,
    unknown
  >[];
  const products = parseCustomProducts(flipkartRaw as never[], "flipkart");

  const errorProducts = products.filter((p) =>
    p.name.includes("Failed") || p.name.includes("Error")
  );
  assertEquals(errorProducts.length, 0, "error items should be filtered");
});

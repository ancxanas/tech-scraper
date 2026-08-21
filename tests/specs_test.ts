import { assertEquals } from "@std/assert/equals";
import { assertExists } from "@std/assert/exists";
import { extractSpecs } from "../src/lib/specs.ts";
import type { Product } from "../src/types.ts";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "test:1",
    name: "Test Product",
    price: 10000,
    originalPrice: 12000,
    discount: 17,
    currency: "INR",
    productUrl: "https://example.com",
    imageUrl: "https://example.com/img.jpg",
    platform: "Test",
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("extractSpecs parses phone specs from name", () => {
  const product = makeProduct({
    name: "Samsung Galaxy M34 5G (6GB RAM, 128GB Storage, 6000mAh)",
  });
  const specs = extractSpecs(product, "phone");
  assertEquals(specs.category, "phone");
  assertEquals(specs.specs.ram_gb, 6);
  assertEquals(specs.specs.storage_gb, 128);
  assertEquals(specs.specs.battery_mah, 6000);
  assertEquals(specs.specs.is_5g, 1);
});

Deno.test("extractSpecs parses headphone specs from name", () => {
  const product = makeProduct({
    name: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
  });
  const specs = extractSpecs(product, "headphone");
  assertEquals(specs.category, "headphone");
  assertEquals(specs.specs.anc, "yes");
  assertExists(specs.benchmarkScore);
  assertEquals(specs.benchmarkScore, 95);
});

Deno.test("extractSpecs parses earbuds specs from name", () => {
  const product = makeProduct({
    name: "Sony WF-C700N True Wireless ANC Earbuds",
  });
  const specs = extractSpecs(product, "earbuds");
  assertEquals(specs.category, "earbuds");
  assertEquals(specs.specs.anc, "yes");
});

Deno.test("extractSpecs returns benchmark score for known models", () => {
  const product = makeProduct({
    name: "Samsung Galaxy M34 5G",
  });
  const specs = extractSpecs(product, "phone");
  assertEquals(specs.benchmarkScore, 78);
});

Deno.test("extractSpecs returns null benchmark for unknown models", () => {
  const product = makeProduct({
    name: "Some Random Phone 5G (8GB, 256GB)",
  });
  const specs = extractSpecs(product, "phone");
  assertEquals(specs.benchmarkScore, null);
});

Deno.test("extractSpecs handles no ANC gracefully", () => {
  const product = makeProduct({
    name: "BoAt Rockerz 450 Bluetooth Headphones",
  });
  const specs = extractSpecs(product, "headphone");
  assertEquals(specs.specs.anc, "no");
});

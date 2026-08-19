import { assertEquals } from "@std/assert/equals";
import { deduplicate, scoreAndRank } from "../src/score.ts";
import type { Product } from "../src/types.ts";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "test:1",
    name: "Test Product",
    price: 1000,
    originalPrice: 2000,
    discount: 50,
    currency: "INR",
    productUrl: "https://example.com/product",
    imageUrl: "https://example.com/img.jpg",
    platform: "TestPlatform",
    scrapedAt: new Date().toISOString(),
    brand: "TestBrand",
    availability: "In Stock",
    rating: 4.0,
    ...overrides,
  };
}

Deno.test("scoreAndRank filters products with price 0", () => {
  const products = [
    makeProduct({ name: "Cheap Item", price: 0 }),
    makeProduct({ name: "Real Item", price: 500 }),
  ];
  const result = scoreAndRank(products, "item");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Real Item");
});

Deno.test("scoreAndRank filters products with negative price", () => {
  const products = [
    makeProduct({ name: "Negative Widget", price: -100 }),
    makeProduct({ name: "Positive Widget", price: 200 }),
  ];
  const result = scoreAndRank(products, "widget");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Positive Widget");
});

Deno.test("scoreAndRank returns empty for all zero prices", () => {
  const products = [
    makeProduct({ name: "A", price: 0 }),
    makeProduct({ name: "B", price: 0 }),
  ];
  const result = scoreAndRank(products, "test");
  assertEquals(result.length, 0);
});

Deno.test("scoreAndRank ranks lowest price first", () => {
  const products = [
    makeProduct({ name: "Expensive Widget", price: 2000, discount: 0 }),
    makeProduct({ name: "Cheap Widget", price: 500, discount: 75 }),
  ];
  const result = scoreAndRank(products, "widget");
  assertEquals(result[0].name, "Cheap Widget");
});

Deno.test("scoreAndRank boosts rated products", () => {
  const products = [
    makeProduct({ name: "Unrated Widget", price: 1000, rating: undefined }),
    makeProduct({ name: "Rated Widget", price: 1000, rating: 4.5 }),
  ];
  const result = scoreAndRank(products, "widget");
  assertEquals(result[0].name, "Rated Widget");
});

Deno.test("scoreAndRank applies relevance multiplier", () => {
  const products = [
    makeProduct({ name: "Sony WH-1000XM5 Headphones", price: 20000 }),
    makeProduct({ name: "Random Kitchen Mixer", price: 100 }),
  ];
  const result = scoreAndRank(products, "sony headphones");
  assertEquals(result[0].name, "Sony WH-1000XM5 Headphones");
});

Deno.test("deduplicate preserves different variants", () => {
  const products = [
    makeProduct({ id: "fk:1", name: "iPhone 15 128GB Blue", price: 79900 }),
    makeProduct({ id: "fk:2", name: "iPhone 15 256GB Black", price: 89900 }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 2);
});

Deno.test("deduplicate keeps cheapest of same product by ID", () => {
  const products = [
    makeProduct({ id: "fk:1", name: "Sony WH-1000XM5", price: 25000 }),
    makeProduct({ id: "fk:1", name: "Sony WH-1000XM5", price: 22000 }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 1);
  assertEquals(result[0].price, 22000);
});

Deno.test("deduplicate keeps different-ID products (cross-platform)", () => {
  const products = [
    makeProduct({
      id: "fk:1",
      name: "Sony WH-1000XM5",
      price: 25000,
      platform: "Flipkart",
    }),
    makeProduct({
      id: "amz:1",
      name: "Sony WH-1000XM5",
      price: 22000,
      platform: "Amazon India",
    }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 2);
});

Deno.test("deduplicate preserves different brands with same model words", () => {
  const products = [
    makeProduct({ id: "fk:1", name: "boAt Rockerz 450", price: 1499 }),
    makeProduct({ id: "amz:1", name: "JBL Tune 450", price: 2999 }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 2);
});

Deno.test("scoreAndRank filters unrelated products below relevance threshold", () => {
  const products = [
    makeProduct({ id: "fk:1", name: "Apple iPhone 15 128GB", price: 79900 }),
    makeProduct({
      id: "fk:2",
      name: "Samsung Galaxy S24 Ultra",
      price: 129999,
    }),
    makeProduct({ id: "fk:3", name: "USB Cable Type C 2m", price: 199 }),
  ];
  const result = scoreAndRank(products, "iphone 15");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Apple iPhone 15 128GB");
});

Deno.test("scoreAndRank filters accessories with short names", () => {
  const products = [
    makeProduct({
      id: "fk:1",
      name: "Sony WH-1000XM5 Headphones",
      price: 24990,
    }),
    makeProduct({ id: "fk:2", name: "Headphone Case", price: 299 }),
  ];
  const result = scoreAndRank(products, "sony headphones");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Sony WH-1000XM5 Headphones");
});

Deno.test("scoreAndRank keeps cross-platform rows by default", () => {
  const products = [
    makeProduct({
      id: "fk:1",
      name: "Sony WH-1000XM5",
      price: 24990,
      platform: "Flipkart",
    }),
    makeProduct({
      id: "amz:1",
      name: "Sony WH-1000XM5",
      price: 25990,
      platform: "Amazon India",
    }),
  ];
  const result = scoreAndRank(products, "sony wh-1000xm5");
  assertEquals(result.length, 2);
});

Deno.test("scoreAndRank dedupCheapest keeps only cheapest", () => {
  const products = [
    makeProduct({
      id: "fk:1",
      name: "Sony WH-1000XM5",
      price: 24990,
      platform: "Flipkart",
    }),
    makeProduct({
      id: "amz:1",
      name: "Sony WH-1000XM5",
      price: 25990,
      platform: "Amazon India",
    }),
  ];
  const result = scoreAndRank(products, "sony wh-1000xm5", {
    dedupCheapest: true,
  });
  assertEquals(result.length, 1);
  assertEquals(result[0].platform, "Flipkart");
});

Deno.test("scoreAndRank inStockOnly filters out-of-stock", () => {
  const products = [
    makeProduct({
      id: "fk:1",
      name: "Widget A",
      price: 1000,
      availability: "In Stock",
    }),
    makeProduct({
      id: "fk:2",
      name: "Widget B",
      price: 800,
      availability: "Out of Stock",
    }),
  ];
  const result = scoreAndRank(products, "widget", { inStockOnly: true });
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Widget A");
});

Deno.test("scoreAndRank does not filter accessories when query contains that word", () => {
  const products = [
    makeProduct({ id: "fk:1", name: "Phone Case for iPhone 15", price: 299 }),
    makeProduct({ id: "fk:2", name: "iPhone 15 Screen Protector", price: 199 }),
  ];
  const result = scoreAndRank(products, "phone case");
  assertEquals(result.length >= 1, true);
});

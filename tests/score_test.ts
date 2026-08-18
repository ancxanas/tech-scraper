import { assertEquals } from "@std/assert/equals";
import { deduplicate, scoreAndRank } from "../src/score.ts";
import type { Product } from "../src/types.ts";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    name: "Test Product",
    price: 1000,
    originalPrice: 2000,
    discount: 50,
    brand: "TestBrand",
    availability: "In Stock",
    imageUrl: "https://example.com/img.jpg",
    productUrl: "https://example.com/product",
    platform: "TestPlatform",
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
    makeProduct({ name: "Negative", price: -100 }),
    makeProduct({ name: "Positive", price: 200 }),
  ];
  const result = scoreAndRank(products, "test");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Positive");
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
    makeProduct({
      name: "iPhone 15 128GB Blue",
      price: 79900,
      brand: "Apple",
    }),
    makeProduct({
      name: "iPhone 15 256GB Black",
      price: 89900,
      brand: "Apple",
    }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 2);
});

Deno.test("deduplicate keeps cheapest of same product", () => {
  const products = [
    makeProduct({ name: "Sony WH-1000XM5", price: 25000, brand: "Sony" }),
    makeProduct({ name: "Sony WH-1000XM5", price: 22000, brand: "Sony" }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 1);
  assertEquals(result[0].price, 22000);
});

Deno.test("deduplicate preserves different brands with same model words", () => {
  const products = [
    makeProduct({ name: "boAt Rockerz 450", price: 1499, brand: "boAt" }),
    makeProduct({ name: "JBL Tune 450", price: 2999, brand: "JBL" }),
  ];
  const result = deduplicate(products);
  assertEquals(result.length, 2);
});

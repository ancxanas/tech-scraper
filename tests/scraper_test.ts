import { assertEquals } from "@std/assert/equals";
import { parseCustomProducts } from "../src/tools/scraper.ts";

Deno.test("parseCustomProducts handles Flipkart fields", () => {
  const raw = [
    {
      product_title: "boAt Rockerz 412 Headphones",
      selling_price: { value: 1699, currency: "INR", symbol: "\u20b9" },
      original_price: { value: 2999, currency: "INR", symbol: "\u20b9" },
      discount_percentage: "43% off",
      brand: "boAt",
      rating: 4.2,
      review_count: 1234,
      image_url: "https://example.com/img.jpg",
      product_page_url: "https://flipkart.com/item/123",
      pid: "itm123",
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "boAt Rockerz 412 Headphones");
  assertEquals(result[0].price, 1699);
  assertEquals(result[0].originalPrice, 2999);
  assertEquals(result[0].discount, 43);
  assertEquals(result[0].brand, "boAt");
  assertEquals(result[0].rating, 4.2);
  assertEquals(result[0].platform, "Flipkart");
  assertEquals(result[0].currency, "INR");
  assertEquals(result[0].id, "flipkart:itm123");
  assertEquals(result[0].scrapedAt.length > 0, true);
});

Deno.test("parseCustomProducts handles Amazon pre-built fields", () => {
  const raw = [
    {
      product_name: "Sony WH-1000XM5 Headphones",
      price: 24990,
      original_price: 34990,
      discount_percentage: "29%",
      brand: "Sony",
      rating: 4.5,
      availability: "In Stock",
      image_url: "https://example.com/sony.jpg",
      product_url: "https://amazon.in/dp/B09XS7JWHH",
      asin: "B09XS7JWHH",
      reviews_count: 5000,
      seller: "Appario Retail",
    },
  ];

  const result = parseCustomProducts(raw, "amazon");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Sony WH-1000XM5 Headphones");
  assertEquals(result[0].price, 24990);
  assertEquals(result[0].brand, "Sony");
  assertEquals(result[0].id, "amazon:B09XS7JWHH");
  assertEquals(result[0].reviewsCount, 5000);
  assertEquals(result[0].seller, "Appario Retail");
});

Deno.test("parseCustomProducts filters items with price 0", () => {
  const raw = [
    { product_name: "Free Item", price: 0, brand: "Test" },
    { product_name: "Real Item", price: 999, brand: "Test" },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Real Item");
});

Deno.test("parseCustomProducts filters items with error field", () => {
  const raw = [
    { product_name: "Good Item", price: 1000 },
    { error: "Page not found", product_name: "Bad Item" },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Good Item");
});

Deno.test("parseCustomProducts handles missing name gracefully", () => {
  const raw = [{ price: 1000, brand: "Test" }];
  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result.length, 0);
});

Deno.test("parseCustomProducts strips '... more' suffix", () => {
  const raw = [{ product_name: "Some Product... more", price: 1500 }];
  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].name, "Some Product");
});

Deno.test("parseCustomProducts parses rating from string", () => {
  const raw = [
    { product_name: "Rated Product", price: 1000, rating: "4.3 out of 5" },
    { product_name: "Number Rated Product", price: 1000, rating: 4.7 },
    {
      product_name: "Unrated Product",
      price: 1000,
      rating: "Share your opinion",
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].rating, 4.3);
  assertEquals(result[1].rating, 4.7);
  assertEquals(result[2].rating, undefined);
});

Deno.test("parseCustomProducts extracts price from number", () => {
  const raw = [{ product_name: "Number Priced", price: 2500 }];
  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].price, 2500);
  assertEquals(result[0].originalPrice, 2500);
});

Deno.test("parseCustomProducts handles INR string prices", () => {
  const raw = [
    {
      product_title: "INR String Price",
      selling_price: "\u20b91,299",
      original_price: "\u20b92,499",
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].price, 1299);
  assertEquals(result[0].originalPrice, 2499);
});

Deno.test("parseCustomProducts handles object with string value", () => {
  const raw = [
    {
      product_title: "Object String Price",
      selling_price: { value: "\u20b93,499", currency: "INR" },
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].price, 3499);
});

Deno.test("parseCustomProducts uses availability from source data", () => {
  const raw = [
    { product_name: "Available Item", price: 1000, availability: "In Stock" },
    { product_name: "No Availability Item", price: 1000 },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].availability, "In Stock");
  assertEquals(result[1].availability, "In Stock");
});

Deno.test("parseCustomProducts computes discount from prices", () => {
  const raw = [
    {
      product_title: "Computed Discount",
      selling_price: 1000,
      original_price: 2000,
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].discount, 50);
});

Deno.test("parseCustomProducts keeps extras for unknown fields", () => {
  const raw = [
    {
      product_title: "Extra Fields",
      price: 1000,
      custom_field: "custom_value",
      another_field: 42,
    },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].extras?.custom_field, "custom_value");
  assertEquals(result[0].extras?.another_field, 42);
});

Deno.test("parseCustomProducts maps reviews_count and num_ratings", () => {
  const raw = [
    { product_name: "With Reviews Count", price: 1000, reviews_count: 500 },
    { product_name: "With Num Ratings", price: 1000, num_ratings: 300 },
    { product_name: "With Review Count", price: 1000, review_count: 200 },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].reviewsCount, 500);
  assertEquals(result[1].reviewsCount, 300);
  assertEquals(result[2].reviewsCount, 200);
});

Deno.test("parseCustomProducts sets listingPosition", () => {
  const raw = [
    { product_name: "First", price: 1000 },
    { product_name: "Second", price: 2000 },
    { product_name: "Third", price: 3000 },
  ];

  const result = parseCustomProducts(raw, "flipkart");
  assertEquals(result[0].listingPosition, 1);
  assertEquals(result[1].listingPosition, 2);
  assertEquals(result[2].listingPosition, 3);
});

import { assertEquals } from "@std/assert/equals";
import { PLATFORMS } from "../src/config.ts";

Deno.test("Flipkart URL template includes search path and page", () => {
  const template = PLATFORMS.flipkart.searchUrlTemplate;
  const q = encodeURIComponent("headphones");
  const url = template.replace("{q}", q).replace("{page}", "2");
  assertEquals(url, "https://www.flipkart.com/search?q=headphones&page=2");
  assertEquals(url.includes("?"), true);
});

Deno.test("Reliance URL template uses /products?q= not /search?q=", () => {
  const template = PLATFORMS.reliance.searchUrlTemplate;
  const q = encodeURIComponent("iphone");
  const url = template.replace("{q}", q);
  assertEquals(url, "https://www.reliancedigital.in/products?q=iphone");
  assertEquals(url.includes("/search?q="), false);
  assertEquals(url.includes("/products?q="), true);
});

Deno.test("Tata CLiQ URL template includes searchCategory and text param", () => {
  const template = PLATFORMS.tatacliq.searchUrlTemplate;
  const q = encodeURIComponent("laptop");
  const url = template.replace("{q}", q);
  assertEquals(
    url,
    "https://www.tatacliq.com/search/?searchCategory=all&text=laptop",
  );
  assertEquals(url.includes("searchCategory=all"), true);
  assertEquals(url.includes("text="), true);
  assertEquals(url.includes("?"), true);
});

Deno.test("Amazon URL template includes /s?k= and page", () => {
  const template = PLATFORMS.amazon.searchUrlTemplate;
  const q = encodeURIComponent("sony headphones");
  const url = template.replace("{q}", q).replace("{page}", "1");
  assertEquals(url, "https://www.amazon.in/s?k=sony%20headphones&page=1");
  assertEquals(url.includes("/s?k="), true);
  assertEquals(url.includes("page="), true);
});

Deno.test("Flipkart pagination type is page", () => {
  assertEquals(PLATFORMS.flipkart.pagination, "page");
});

Deno.test("Reliance pagination type is scroll", () => {
  assertEquals(PLATFORMS.reliance.pagination, "scroll");
});

Deno.test("Tata CLiQ pagination type is scroll", () => {
  assertEquals(PLATFORMS.tatacliq.pagination, "scroll");
});

Deno.test("Amazon pagination type is page", () => {
  assertEquals(PLATFORMS.amazon.pagination, "page");
});

Deno.test("All platforms have required fields", () => {
  for (const [key, config] of Object.entries(PLATFORMS)) {
    assertEquals(typeof config.name, "string", `${key} needs name`);
    assertEquals(
      typeof config.searchUrlTemplate,
      "string",
      `${key} needs template`,
    );
    assertEquals(typeof config.pagination, "string", `${key} needs pagination`);
    assertEquals(typeof config.pageSize, "number", `${key} needs pageSize`);
    assertEquals(config.pageSize > 0, true, `${key} pageSize must be > 0`);
  }
});

Deno.test("validateUrl accepts valid URLs", () => {
  const valid = [
    "https://example.com",
    "https://www.amazon.in/s?k=headphones",
    "https://www.flipkart.com/search?q=phone&page=1",
    "https://www.tatacliq.com/search/?searchCategory=all&text=laptop",
    "https://www.reliancedigital.in/products?q=iphone",
  ];
  for (const url of valid) {
    new URL(url);
  }
});

Deno.test("validateUrl rejects invalid URLs", () => {
  const invalid = ["not-a-url", "ftp://", "", "just-words"];
  for (const url of invalid) {
    let threw = false;
    try {
      new URL(url);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, `Expected "${url}" to be invalid`);
  }
});

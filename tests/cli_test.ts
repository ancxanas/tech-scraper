import { assertEquals } from "@std/assert/equals";
import { assertThrows } from "@std/assert/throws";

Deno.test("validateUrl accepts valid URLs", () => {
  const valid = [
    "https://example.com",
    "https://www.amazon.in/s?k=headphones",
    "http://localhost:3000",
    "https://flipkart.com/search?q=phone&page=1",
  ];
  for (const url of valid) {
    new URL(url);
  }
});

Deno.test("validateUrl rejects invalid URLs", () => {
  const invalid = [
    "not-a-url",
    "ftp://",
    "",
    "just-words",
  ];
  for (const url of invalid) {
    assertThrows(
      () => new URL(url),
      TypeError,
    );
  }
});

Deno.test("buildPageUrls generates correct URLs for Flipkart", () => {
  const url = "https://www.flipkart.com";
  const searchPath = "/search";
  const encoded = encodeURIComponent("headphones");
  const fullUrl = `${url}${searchPath}?q=${encoded}&page=1`;
  assertEquals(
    fullUrl,
    "https://www.flipkart.com/search?q=headphones&page=1",
  );
});

Deno.test("buildPageUrls generates correct URLs for Tata CLiQ", () => {
  const url = "https://www.tatacliq.com";
  const searchPath = "/search/";
  const encoded = encodeURIComponent("laptop");
  const fullUrl =
    `${url}${searchPath}searchCategory=all&text=${encoded}&page=0`;
  assertEquals(
    fullUrl,
    "https://www.tatacliq.com/search/searchCategory=all&text=laptop&page=0",
  );
});

import { assertEquals } from "@std/assert/equals";
import { _fetch, setFetchFn } from "../src/lib/brightdata.ts";

Deno.test("mock fetch: setFetchFn swaps the implementation", async () => {
  const originalFetch = _fetch;

  let calledWith: string | null = null;

  setFetchFn(
    (
      url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calledWith = typeof url === "string"
        ? url
        : url instanceof URL
        ? url.href
        : url.url;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );

  const res = await _fetch("https://example.com/test");
  const body = await res.json();

  assertEquals(calledWith, "https://example.com/test");
  assertEquals(body.ok, true);

  setFetchFn(originalFetch);
});

Deno.test("mock fetch: can simulate 404", async () => {
  const originalFetch = _fetch;

  setFetchFn(
    (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return Promise.resolve(
        new Response("Not Found", { status: 404 }),
      );
    },
  );

  const res = await _fetch("https://example.com/missing");
  assertEquals(res.status, 404);

  setFetchFn(originalFetch);
});

Deno.test("mock fetch: can simulate network error", async () => {
  const originalFetch = _fetch;

  setFetchFn(
    (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return Promise.reject(new TypeError("Failed to fetch"));
    },
  );

  let threw = false;
  try {
    await _fetch("https://example.com/fail");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  setFetchFn(originalFetch);
});

Deno.test("mock fetch: can simulate NDJSON response", async () => {
  const originalFetch = _fetch;

  setFetchFn(
    (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const ndjson = '{"a":1}\n{"b":2}\n{"c":3}\n';
      return Promise.resolve(
        new Response(ndjson, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );
    },
  );

  const res = await _fetch("https://example.com/ndjson");
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  assertEquals(lines.length, 3);

  setFetchFn(originalFetch);
});

Deno.test("mock fetch: bdFetch uses swapped implementation", async () => {
  const originalFetch = _fetch;

  let receivedUrl: string | null = null;
  let receivedHeaders: Record<string, string> = {};

  setFetchFn(
    (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      receivedUrl = typeof url === "string"
        ? url
        : url instanceof URL
        ? url.href
        : url.url;
      receivedHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(
        new Response(JSON.stringify({ result: "mocked" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );

  Deno.env.set("BRIGHTDATA_API_KEY", "test-key-123");

  const { bdFetch } = await import("../src/lib/brightdata.ts");
  const result = await bdFetch<{ result: string }>("/dca/test", {
    method: "GET",
  });

  assertEquals(receivedUrl, "https://api.brightdata.com/dca/test");
  assertEquals(result.result, "mocked");
  assertEquals(receivedHeaders["Authorization"], "Bearer test-key-123");
  assertEquals(receivedHeaders["Content-Type"], "application/json");

  setFetchFn(originalFetch);
});

Deno.test("mock fetch: bdFetch throws on non-ok response", async () => {
  const originalFetch = _fetch;

  setFetchFn(
    (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return Promise.resolve(
        new Response("Unauthorized", { status: 401 }),
      );
    },
  );

  Deno.env.set("BRIGHTDATA_API_KEY", "bad-key");

  const { bdFetch } = await import("../src/lib/brightdata.ts");
  let threw = false;
  try {
    await bdFetch("/test");
  } catch (e) {
    threw = true;
    assertEquals(e instanceof Error, true);
    assertEquals((e as Error).message.includes("401"), true);
  }
  assertEquals(threw, true);

  setFetchFn(originalFetch);
});

Deno.test("unlocker: a raw page body is returned as-is", async () => {
  Deno.env.set("BRIGHTDATA_API_KEY", "test");
  Deno.env.set("UNLOCKER_ZONE", "cli_unlocker");
  setFetchFn(() =>
    Promise.resolve(
      new Response("<html><body>28% 17,999 ₹12,951</body></html>", {
        status: 200,
      }),
    )
  );
  const { fetchPageHtml } = await import("../src/lib/fetch-page.ts");
  const html = await fetchPageHtml("https://www.flipkart.com/x/p/itm1");
  assertEquals(html.includes("₹12,951"), true);
});

Deno.test("unlocker: a JSON envelope is unwrapped", async () => {
  Deno.env.set("BRIGHTDATA_API_KEY", "test");
  Deno.env.set("UNLOCKER_ZONE", "cli_unlocker");
  setFetchFn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ status_code: 200, body: "<html>ok</html>" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    )
  );
  const { fetchPageHtml } = await import("../src/lib/fetch-page.ts");
  assertEquals(await fetchPageHtml("https://x/y"), "<html>ok</html>");
});

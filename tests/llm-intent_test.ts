import { assertEquals, assertExists } from "@std/assert";
import { describeIntent, parseIntent } from "../src/lib/llm-intent.ts";
import type { ParsedIntent } from "../src/lib/llm-intent.ts";

const MOCK_INTENT: ParsedIntent = {
  category: "phone",
  brand: "samsung",
  model: null,
  budget: 15000,
  budgetOperator: "under",
  temporal: { before: "2026-09", urgency: "asap" },
  useCase: ["photography"],
  preferences: ["lightweight"],
  comparisonProduct: null,
  excludeBrands: [],
  superlative: "best",
  searchQueries: ["samsung phone under 15000"],
  rawQuery: "best samsung phone under 15000 before sep 2026",
};

function mockGeminiResponse(intent: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(intent) }],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return originalFetch(input, _init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("describeIntent formats category + budget", () => {
  const desc = describeIntent(MOCK_INTENT);
  assertEquals(desc.includes("phone"), true);
  assertEquals(desc.includes("samsung"), true);
  assertEquals(desc.includes("under"), true);
  assertEquals(desc.includes("15"), true);
});

Deno.test("describeIntent formats use case", () => {
  const desc = describeIntent(MOCK_INTENT);
  assertEquals(desc.includes("photography"), true);
});

Deno.test("describeIntent formats temporal", () => {
  const desc = describeIntent(MOCK_INTENT);
  assertEquals(desc.includes("before 2026-09"), true);
});

Deno.test("describeIntent handles minimal intent", () => {
  const minimal: ParsedIntent = {
    category: "generic",
    brand: null,
    model: null,
    budget: null,
    budgetOperator: "under",
    temporal: null,
    useCase: [],
    preferences: [],
    comparisonProduct: null,
    excludeBrands: [],
    superlative: null,
    searchQueries: ["headphones"],
    rawQuery: "headphones",
  };
  const desc = describeIntent(minimal);
  assertEquals(desc, "headphones");
});

Deno.test("describeIntent formats comparison", () => {
  const intent: ParsedIntent = {
    ...MOCK_INTENT,
    comparisonProduct: "iPhone 15",
  };
  const desc = describeIntent(intent);
  assertEquals(desc.includes("vs iPhone 15"), true);
});

Deno.test("parseIntent calls Gemini and parses response", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  const restore = mockGeminiResponse({
    category: "headphone",
    brand: "sony",
    model: "wh-1000xm5",
    budget: 25000,
    budgetOperator: "under",
    temporal: null,
    useCase: ["music"],
    preferences: ["noise cancelling"],
    comparisonProduct: null,
    excludeBrands: [],
    superlative: null,
    searchQueries: ["sony wh-1000xm5"],
  });
  try {
    const intent = await parseIntent("sony wh-1000xm5 under 25000");
    assertEquals(intent.category, "headphone");
    assertEquals(intent.brand, "sony");
    assertEquals(intent.model, "wh-1000xm5");
    assertEquals(intent.budget, 25000);
    assertEquals(intent.useCase, ["music"]);
    assertEquals(intent.searchQueries.length >= 1, true);
    assertEquals(intent.rawQuery, "sony wh-1000xm5 under 25000");
  } finally {
    restore();
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("parseIntent throws when GEMINI_API_KEY is missing", async () => {
  Deno.env.delete("GEMINI_API_KEY");
  try {
    await parseIntent("test");
    throw new Error("Should have thrown");
  } catch (err) {
    assertExists(err);
    assertEquals(
      (err as Error).message.includes("GEMINI_API_KEY not set"),
      true,
    );
  }
});

Deno.test("parseIntent handles Gemini API errors with retry", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 500,
                message: "Internal error",
                status: "INTERNAL",
              },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{
                    text: JSON.stringify({
                      category: "generic",
                      searchQueries: ["test"],
                    }),
                  }],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return originalFetch(input, _init);
  };
  try {
    const intent = await parseIntent("test");
    assertEquals(intent.category, "generic");
    assertEquals(callCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("parseIntent handles invalid JSON from Gemini", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "not valid json" }],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return originalFetch(input, _init);
  };
  try {
    await parseIntent("test");
    throw new Error("Should have thrown");
  } catch (err) {
    assertEquals(
      (err as Error).message.includes("Intent parsing failed"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

Deno.test("parseIntent handles empty candidates", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ candidates: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return originalFetch(input, _init);
  };
  try {
    await parseIntent("test");
    throw new Error("Should have thrown");
  } catch (err) {
    assertEquals(
      (err as Error).message.includes("Intent parsing failed"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("GEMINI_API_KEY");
  }
});

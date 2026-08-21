/**
 * These types were the v1 intent contract. The deterministic parser in
 * src/core/intent.ts is the source of truth now; this shape survives only as
 * the wire format of the optional Gemini call.
 */
export type ProductCategory =
  | "phone"
  | "headphone"
  | "earbuds"
  | "laptop"
  | "tablet"
  | "watch"
  | "camera"
  | "tv"
  | "generic";

export interface ParsedIntent {
  category: ProductCategory;
  brand: string | null;
  model: string | null;
  budget: number | null;
  budgetOperator: "under" | "around" | "exactly";
  temporal: { before?: string; urgency?: "asap" | "flexible" } | null;
  useCase: string[];
  preferences: string[];
  comparisonProduct: string | null;
  excludeBrands: string[];
  superlative: string | null;
  searchQueries: string[];
  rawQuery: string;
}

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [
        "phone",
        "headphone",
        "earbuds",
        "laptop",
        "tablet",
        "watch",
        "camera",
        "tv",
        "generic",
      ],
      description: "Product category. Use 'generic' if unclear.",
    },
    brand: {
      type: "string",
      nullable: true,
      description:
        "Brand name only if user explicitly mentions one. Lowercase.",
    },
    model: {
      type: "string",
      nullable: true,
      description:
        "Specific product model only if user names one. E.g. 'wh-1000xm5'.",
    },
    budget: {
      type: "number",
      nullable: true,
      description:
        "Maximum price in INR. '15000' or '15k' = 15000. '1.5 lakh' = 150000.",
    },
    budgetOperator: {
      type: "string",
      enum: ["under", "around", "exactly"],
      description:
        "'under' = user wants below price. 'around' = approximate. 'exactly' = specific.",
    },
    temporal: {
      type: "object",
      nullable: true,
      properties: {
        before: {
          type: "string",
          description: "Deadline in YYYY-MM format. E.g. '2026-09'.",
        },
        urgency: {
          type: "string",
          enum: ["asap", "flexible"],
        },
      },
      required: ["before", "urgency"],
    },
    useCase: {
      type: "array",
      items: { type: "string" },
      description:
        "What the product is for. E.g. ['photography'], ['gym'], ['coding']. Empty array if unclear.",
    },
    preferences: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific requirements. E.g. ['lightweight', '5g', 'linux']. Empty array if none.",
    },
    comparisonProduct: {
      type: "string",
      nullable: true,
      description:
        "Product being compared against. E.g. 'iPhone 15'. Null if not comparing.",
    },
    excludeBrands: {
      type: "array",
      items: { type: "string" },
      description:
        "Brands user wants to exclude. E.g. ['samsung']. Empty if none.",
    },
    superlative: {
      type: "string",
      nullable: true,
      description:
        "'best', 'cheapest', 'most affordable', 'premium'. Null if not stated.",
    },
    searchQueries: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
      description:
        "1-3 optimal search queries in Indian English. Clean, short. E.g. 'phone under 15000', 'wireless earbuds gym'.",
    },
  },
  required: [
    "category",
    "budget",
    "budgetOperator",
    "useCase",
    "preferences",
    "searchQueries",
  ],
};

const SYSTEM_PROMPT =
  `You are a product search intent parser for an Indian tech deal finder.
Convert the user's natural language query into structured JSON.

Rules:
- category: phone, headphone, earbuds, laptop, tablet, watch, camera, tv, or generic
- budget: maximum price in INR (number, no commas). "15000" or "15k" = 15000. "1.5 lakh" = 150000
- budgetOperator: "under" if user wants below price, "around" if approximate, "exactly" if specific
- temporal: extract time constraints. "before sep 2026" = {before: "2026-09"}. "by december" = {before: "2026-12"}. "asap" = urgency: "asap"
- useCase: what the product is for. ["photography"], ["gaming"], ["gym"], ["coding"], ["music"]
- preferences: specific requirements. ["lightweight"], ["5g"], ["linux"], ["good bass"]
- brand: only if user explicitly names a brand
- model: only if user names a specific product model
- comparisonProduct: if comparing ("iPhone 15 vs Samsung S24")
- excludeBrands: if user says "not Samsung"
- superlative: "best", "cheapest", "most affordable", "premium"
- searchQueries: generate 1-3 optimal search queries in Indian English for e-commerce sites. Keep them short (2-4 words each).

Current date: ${
    new Date().toISOString().split("T")[0]
  }. Use this for temporal reasoning.

Return ONLY valid JSON. No explanation.`;

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

function calculateBackoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  const jitter = base * Math.random() * 0.5;
  return Math.floor(base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIntent(
  rawQuery: string,
  raw: Record<string, unknown>,
): ParsedIntent {
  const validCategories: ProductCategory[] = [
    "phone",
    "headphone",
    "earbuds",
    "laptop",
    "tablet",
    "watch",
    "camera",
    "tv",
    "generic",
  ];
  const category = validCategories.includes(raw.category as ProductCategory)
    ? (raw.category as ProductCategory)
    : "generic";

  const searchQueries = Array.isArray(raw.searchQueries)
    ? raw.searchQueries.filter((q): q is string =>
      typeof q === "string" && q.length > 0
    )
    : [rawQuery];

  if (searchQueries.length === 0) {
    searchQueries.push(rawQuery);
  }

  return {
    category,
    brand: typeof raw.brand === "string" ? raw.brand.toLowerCase() : null,
    model: typeof raw.model === "string" ? raw.model.toLowerCase() : null,
    budget: typeof raw.budget === "number" && raw.budget > 0
      ? raw.budget
      : null,
    budgetOperator:
      ["under", "around", "exactly"].includes(raw.budgetOperator as string)
        ? (raw.budgetOperator as "under" | "around" | "exactly")
        : "under",
    temporal: raw.temporal && typeof raw.temporal === "object"
      ? {
        before:
          typeof (raw.temporal as Record<string, unknown>).before === "string"
            ? (raw.temporal as Record<string, unknown>).before as string
            : undefined,
        urgency: ["asap", "flexible"].includes(
            (raw.temporal as Record<string, unknown>).urgency as string,
          )
          ? ((raw.temporal as Record<string, unknown>).urgency as
            | "asap"
            | "flexible")
          : "flexible",
      }
      : null,
    useCase: Array.isArray(raw.useCase)
      ? raw.useCase.filter((u): u is string => typeof u === "string")
      : [],
    preferences: Array.isArray(raw.preferences)
      ? raw.preferences.filter((p): p is string => typeof p === "string")
      : [],
    comparisonProduct: typeof raw.comparisonProduct === "string"
      ? raw.comparisonProduct
      : null,
    excludeBrands: Array.isArray(raw.excludeBrands)
      ? raw.excludeBrands.filter((b): b is string => typeof b === "string")
      : [],
    superlative: typeof raw.superlative === "string" ? raw.superlative : null,
    searchQueries,
    rawQuery,
  };
}

async function callGemini(query: string): Promise<ParsedIntent> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY not set.\n\n" +
        "Set your Gemini API key (free tier, 1000 queries/day):\n" +
        "  export GEMINI_API_KEY=your_key_here\n\n" +
        "Get a free key at: https://aistudio.google.com/apikey",
    );
  }

  const requestBody = {
    contents: [{
      parts: [{ text: SYSTEM_PROMPT + "\n\nUser query: " + query }],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: INTENT_SCHEMA,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const json: GeminiResponse = await response.json();

      if (json.error) {
        const { code, status, message } = json.error;
        const err = new Error(
          `Gemini API error ${code} (${status}): ${message}`,
        );
        if ([429, 500, 503].includes(code) && attempt < MAX_RETRIES) {
          const delay = calculateBackoff(attempt);
          console.error(
            `  Gemini ${status} (attempt ${attempt + 1}/${
              MAX_RETRIES + 1
            }). Retrying in ${delay}ms...`,
          );
          await sleep(delay);
          lastError = err;
          continue;
        }
        throw err;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(
          "No text in Gemini response. " +
            `finishReason: ${json.candidates?.[0]?.finishReason}`,
        );
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;
      return buildIntent(query, parsed);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        const err2 = new Error(
          `Gemini request timed out after ${TIMEOUT_MS}ms`,
        );
        if (attempt < MAX_RETRIES) {
          console.error(
            `  Gemini timeout (attempt ${attempt + 1}/${
              MAX_RETRIES + 1
            }). Retrying...`,
          );
          await sleep(calculateBackoff(attempt));
          lastError = err2;
          continue;
        }
        throw err2;
      }

      if (
        err instanceof TypeError &&
        err.message.includes("failed to fetch")
      ) {
        if (attempt < MAX_RETRIES) {
          const delay = calculateBackoff(attempt);
          console.error(
            `  Network error (attempt ${attempt + 1}/${
              MAX_RETRIES + 1
            }). Retrying in ${delay}ms...`,
          );
          await sleep(delay);
          lastError = err;
          continue;
        }
      }

      throw err;
    }
  }

  throw lastError ?? new Error("All Gemini retries exhausted");
}

export async function parseIntent(rawQuery: string): Promise<ParsedIntent> {
  try {
    return await callGemini(rawQuery.trim());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("GEMINI_API_KEY not set")) {
      throw err;
    }
    console.error(`  LLM intent parse failed: ${msg}`);
    throw new Error(
      "Intent parsing failed. Check your GEMINI_API_KEY and try again.\n" +
        `Error: ${msg}`,
    );
  }
}

export function describeIntent(intent: ParsedIntent): string {
  const parts: string[] = [];

  if (intent.category !== "generic") {
    parts.push(intent.category);
  }

  if (intent.brand) {
    parts.push(intent.brand);
  }

  if (intent.model) {
    parts.push(intent.model);
  }

  if (intent.budget) {
    const op = intent.budgetOperator === "under"
      ? "under"
      : intent.budgetOperator === "around"
      ? "around"
      : "";
    parts.push(`${op} ₹${intent.budget.toLocaleString("en-IN")}`);
  }

  if (intent.useCase.length > 0) {
    parts.push(`for ${intent.useCase.join(", ")}`);
  }

  if (intent.preferences.length > 0) {
    parts.push(`(${intent.preferences.join(", ")})`);
  }

  if (intent.temporal?.before) {
    parts.push(`before ${intent.temporal.before}`);
  }

  if (intent.comparisonProduct) {
    parts.push(`vs ${intent.comparisonProduct}`);
  }

  return parts.length > 0 ? parts.join(" ") : intent.rawQuery;
}

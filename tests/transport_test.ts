import { assertEquals } from "@std/assert";
import {
  type ResolveOptions,
  resolveSpecs,
  type Transport,
} from "../src/core/resolve.ts";
import { SpecStore } from "../src/core/spec-cache.ts";
import type { AnalyzedListing, Candidate } from "../src/core/types.ts";

function listing(id: string): AnalyzedListing {
  return {
    id,
    url: `https://www.flipkart.com/test-phone-x1/p?pid=${id}`,
    platform: "flipkart" as const,
    price: 10000,
    mrp: 12000,
    inStock: true,
    seller: "s",
    title: "Test Phone X1",
    category: "phone" as const,
    categoryConfidence: 1,
    brand: "test",
    modelKey: "test x1",
    modelName: "Test Phone X1",
    configKey: "test x1|8|128",
    specs: {},
    specSources: {},
    specCompleteness: 0,
    kbConfidence: "none",
    rejected: [],
  } as unknown as AnalyzedListing;
}

function phone(): Candidate {
  const l = listing("t1");
  return {
    id: "t1",
    key: "test x1",
    modelName: "Test Phone X1",
    brand: "test",
    category: "phone" as const,
    specs: {},
    specSources: {},
    specCompleteness: 0,
    kbConfidence: "none",
    best: {
      id: "t1",
      url: l.url,
      platform: "flipkart" as const,
      price: 10000,
      mrp: 12000,
      inStock: true,
      seller: "s",
    },
    offers: [l],
    siblingConfigs: [],
    rating: 4.2,
    ratingCount: 100,
    imageUrl: null,
    listings: [l],
  } as unknown as Candidate;
}

const PAGE = `x`.repeat(3000) + `
General
Chipset Snapdragon 7 Gen 3
Display 6.7 inches
Battery 5000 mAh
`;

async function freshStore(): Promise<SpecStore> {
  const dir = await Deno.makeTempDir();
  return new SpecStore(`${dir}/specs.json`);
}

Deno.test("resolveSpecs uses the injected transport instead of the network", async () => {
  let directCalls = 0;
  let unlockerCalls = 0;
  const t: Transport = {
    direct: () => {
      directCalls++;
      return Promise.resolve(PAGE);
    },
    unlocker: () => {
      unlockerCalls++;
      return Promise.reject(new Error("must not pay"));
    },
  };

  const c = [phone()];
  await resolveSpecs(c, {
    transport: t,
    mode: "auto",
    allowPaid: false,
    store: await freshStore(),
  });

  assertEquals(directCalls, 1);
  assertEquals(unlockerCalls, 0);
});

Deno.test("transport errors surface as failures, not crashes", async () => {
  const t: Transport = {
    direct: () => Promise.reject(new Error("blocked")),
    unlocker: () => Promise.reject(new Error("paid off")),
  };
  const c = [phone()];
  const r = await resolveSpecs(c, {
    transport: t,
    mode: "auto",
    allowPaid: false,
    store: await freshStore(),
  } as ResolveOptions);
  assertEquals(r.failed, 1);
});

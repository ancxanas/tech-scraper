import { assertEquals } from "@std/assert";
import { shiftClock } from "../src/core/clock.ts";
import { SpecStore } from "../src/core/spec-cache.ts";

const URL = "https://www.flipkart.com/x/p?pid=CLK1";

Deno.test("spec entries expire after 30 days on the shifted clock", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/specs.json`;
  const store = new SpecStore(path);
  await store.load();
  store.set(URL, "<html>spec page</html>", "direct");
  await store.save();
  assertEquals(store.get(URL), "<html>spec page</html>");

  // Jump past the 30-day spec TTL; a fresh instance must drop the entry.
  shiftClock(31 * 24 * 60 * 60 * 1000);
  try {
    const later = new SpecStore(path);
    await later.load();
    assertEquals(later.get(URL), null);
    assertEquals(later.stats.misses, 1);
  } finally {
    shiftClock(0);
  }
});

Deno.test("price entries use their own, shorter TTL", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/specs.json`;
  const store = new SpecStore(path);
  await store.load();
  store.setPrice(URL, "<html>buy box</html>", "direct");

  // Half an hour old: inside the 1-hour price TTL.
  shiftClock(30 * 60 * 1000);
  try {
    assertEquals(store.getPrice(URL), "<html>buy box</html>");
  } finally {
    shiftClock(0);
  }
});

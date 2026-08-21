# Test fixtures

Real captured data, kept verbatim. Several of these files are _wrong_ in
interesting ways, and that is deliberate — the pathologies are what the
regression tests exist to catch. Do not tidy them.

Each `run-*` directory has a `manifest.json` recording where the data came from,
when, and what is broken about it.

## Scrape runs — whole marketplace payloads

| directory             | query                   | why it is kept                                                                                                                                                                                                                       |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run-phones-15000/`   | best phones under 15000 | The original failing run that motivated the v2 rewrite: it ranked four ₹1,599 earphones above every phone. 54 of 120 Flipkart cards have no title or price, Reliance returned audio accessories, Tata CLiQ returned a crawler error. |
| `run-sony-wh1000xm5/` | sony wh-1000xm5         | A negative fixture. Proves a phone query returns nothing from an audio catalogue, and that cases and ear pads are rejected rather than ranked.                                                                                       |

Provenance for `run-phones-15000` (originally uploaded as `data(N).json`):

| file            | was                                         | records          |
| --------------- | ------------------------------------------- | ---------------- |
| `flipkart.json` | `data(5).json`                              | 120              |
| `reliance.json` | `data(4).json`                              | 22               |
| `tatacliq.json` | `data(3).json`                              | 1 (error object) |
| `amazon.json`   | BrightData snapshot `sd_mt2gj3m12b2l7r2jy9` | 16               |

## Product pages — single-product HTML, reduced to text

`pages/` holds the text of individual product pages, used to test spec
extraction offline. Named after the product, one file each. They include the
awkward cases on purpose: `maplin-sc26-5g.txt` and `motorola-g35-5g.txt` are out
of stock, `poco-m7-5g-carrier-locked.txt` is a carrier-locked SKU that must not
merge with the unlocked phone.

`reviews/` holds reviews-page text — the ratings histogram and buyer comments
that aspect mining runs against.

`gsmarena/` holds an external spec-database page, used to test that measured
AnTuTu and GeekBench figures are parsed correctly.

## Refreshing

These are snapshots, not live data; prices and stock are as of the capture date.
Regenerating them means spending scraping credit, so prefer adding a new fixture
over replacing one — tests reference specific pathologies by file.

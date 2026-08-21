# Beebom spec-source fixtures

Trimmed captures of `gadgets.beebom.com/mobile/<slug>`, taken 2026-08-21. Only
the spec payload is kept — the live pages are ~300KB of which the parser reads
one region, and committing that in full would bloat the repo.

| file                    | why it is here                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `realme-narzo-90x.html` | The good case: chipset, a **per-phone AnTuTu figure** (560000) carried inside the chipset string, panel, refresh rate, battery and charging all present. This is the phone that ranked #3 in the live run showing `SoC ?`.     |
| `itel-zeno-200.html`    | The common budget case: full spec sheet but **no published benchmark**, so `antutu` is null and the ranker falls back to the per-chip figure in `soc.ts`. Guards against a parser that only works when every field is present. |

Each file is two slices of the live page joined together — the head, which
carries the JSON-LD product summary (battery, cameras), and the expanded spec
table (chipset, AnTuTu, panel, refresh rate). The ~240KB of layout and carousels
in between is dropped because the parser never reads it. Charging wattage sits
in a third region and is therefore absent here; it parses correctly against the
live page.

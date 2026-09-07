# Shipping rates — provenance & refresh

The `shipping` model's `destBase`, `dutyRate` and `vatRate` tables hold **indicative
RoRo car-shipping and import figures** for shipping **one standard passenger car from
the Port of Rotterdam**. They are a **dated snapshot baked in on purpose** — the model
never calls a live API at runtime, so a pricing API disappearing can't break the app.

**Captured: 2026-09-07.** Rates are volatile (fuel, capacity, FX, tariff policy) and
public figures are ranges — the values below are midpoints, treat as indicative and
confirm live at booking.

> We tried the Freightos calculator (`ship.freightos.com/api/shippingCalculator`) but
> it (a) blocks automated access behind Cloudflare (HTTP 1015 / "Access denied") and
> (b) only quotes FCL/LCL container + air, **not RoRo**. So these figures come from RoRo
> car-shipping carriers/brokers and official customs sources instead (cited below).

## `destBase` — RoRo (or, for landlocked CH, enclosed road) freight, EUR / car

| Dest | EUR | ~Transit | Basis |
|---|---|---|---|
| nl  | 150  | 1 d  | Domestic road delivery (not RoRo) — Nobel Transport |
| uk  | 375  | ~3 d | Europoort → Hull/Harwich short-sea + handling — DirectFerries/Stena |
| usa | 1750 | ~22 d | Rotterdam → US East Coast RoRo — CFR Classic / BR Logistics |
| uae | 1200 | ~21 d | Rotterdam → Jebel Ali RoRo — Autoshippers (NW-Europe proxy) |
| ch  | 1300 | ~3 d | Landlocked → enclosed single-car road transport — EsyLoads/Clicktrans |
| sg  | 1450 | ~30 d | Rotterdam → Singapore RoRo — Autoshippers |
| hk  | 1450 | ~30 d | Rotterdam → Hong Kong RoRo — Autoshippers |
| jp  | 1750 | ~35 d | Rotterdam → Japan RoRo (scarce westbound — rough) — Autoshippers |

`methodFactor`: collect 0 · **roro 1 (base)** · container 1.4 · express (air) 4.
`weightSurcharge`: EUR 0.9 per kg over 1,800 kg kerb weight.

## `dutyRate` / `vatRate` — customs & excise on import (% of value / CIF+duty)

| Dest | Duty / excise | Import VAT / GST | Source |
|---|---|---|---|
| nl  | 0%   | 0%   | EU free circulation (no import charge; BPM/road tax are separate) |
| uk  | 10%  | 20%  | HS 8703 MFN default (0% with proven EU origin) — gov.uk |
| usa | 15%  | 0%   | 2026 EU-US framework all-in tariff on EU-origin cars (was 2.5% MFN); no federal VAT |
| uae | 5%   | 5%   | GCC customs duty on CIF + UAE VAT — Dubai Customs |
| ch  | 4%   | 8.1% | Swiss automobile tax 4% + VAT 8.1% (weight duty ~0% with EUR.1) — BAZG |
| sg  | 20%  | 9%   | Excise duty 20% + GST 9% — Singapore Customs (excludes ARF/COE) |
| hk  | 0%   | 0%   | Free port (First-Registration Tax is a registration levy, not border) |
| jp  | 0%   | 10%  | 0% MFN passenger-car duty + 10% consumption tax — Japan Customs |

**Out of scope** (registration levies, not border charges): Singapore COE/ARF, Hong
Kong First-Registration Tax, NL BPM, Swiss road tax. These often dwarf the shipping
cost but are not "customs & excise on import".

## Live refresh (no redeploy) — the `roro-shipping` rate card
`destBase`, `dutyRate` and `vatRate` are tagged `"source": "roro-shipping"`, so they are
**live-sourced**: the browser overlays values from `GET /api/rates/roro-shipping` onto these
tables before assemble (see `web/live-tables.mjs` + `web/store.mjs applyLiveTables`). The
baked maps here remain the **fallback** — if the API is absent/slow/partial/out-of-bounds,
each table degrades to the baked value, so the app never breaks. `methodFactor` is NOT
tagged, so it stays purely baked.

Update the live figures without a redeploy (authorised with the SEPARATE `RATES_TOKEN`,
not the models/journeys `PUBLISH_TOKEN`):

```
curl -X PUT https://quote.rowblaa.com/api/rates/roro-shipping \
  -H "authorization: Bearer $RATES_TOKEN" -H "content-type: application/json" \
  -d '{ "asOf": "2026-10-01", "source": "Q4 broker refresh",
        "tables": { "destBase": { "map": { "uk": 410, "usa": 1820 } } } }'
```

Only keys already present in the baked map are overlaid (partial payloads are fine — unlisted
keys keep their baked value), each checked against the table's `bounds`. `DELETE` the key to
revert to the baked snapshot. Seeded to KV as an exact mirror of the baked maps by
`scripts/seed-kv.mjs` (key `rates:roro-shipping`).

## To refresh the BAKED snapshot
Re-run the research (or pull fresh broker/customs quotes) and edit the three tables in
`data-model.json`; bump the model `version` and update the date above. Full sourcing
is in the session's `roro-shipping-rates` workflow output.

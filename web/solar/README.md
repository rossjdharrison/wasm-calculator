# Solar array — panel imagery + copy

Source of truth for the **three** panel choices in the Solar array model
(`web/models/solar-array/`, field `panelType`). For each panel: a ready-to-paste
**Midjourney prompt** and a short **buyer-facing description**.

The showroom references images by relative path from the presentation model
(each `panelType` option's `image`, e.g. `solar/panel-standard.png`). Generate the
image, save it under the matching filename below, and it renders on the stage +
cards; until then the showroom falls back to built-in silhouettes.

| Panel | Option `id` | File | Output · price/panel |
|---|---|---|---|
| Standard | `standard` | `solar/panel-standard.png` | 400 W · €190 |
| Premium | `premium` | `solar/panel-premium.png` | 440 W · €260 |
| All-black | `allBlack` | `solar/panel-all-black.png` | 415 W · €230 |

### House style (already baked into each prompt)

Every prompt is a single module at the **same three-quarter hero angle** on a
**seamless cool light-grey studio sweep**, soft bright daylight from upper left,
with a faint strip of blue sky + cloud reflected across the glass so it reads as
solar — so the three sit together on the stage. Faithful cell texture and frame
colour, no people or props, colour-accurate, landscape framing. Parameters:
`--ar 16:9 --style raw --v 7`.

- **Landscape (`--ar 16:9`)** suits the stage; the card crops to a thumbnail.
- **Want them installed instead?** Swap the sweep line for *"mounted flush on a
  clean contemporary rooftop under a deep blue Dutch sky, low sun, crisp
  shadows"* — keep every other cue so the three stay consistent.
- If the glass renders too mirror-like, keep `--style raw`; drop it for a softer,
  more brochure-like finish.

---

## 1. Standard · 400 W · `solar/panel-standard.png`

**Midjourney**

```
A single monocrystalline solar panel photographed at a three-quarter hero angle, sixty half-cut dark blue-black silicon cells with fine silver busbars and gridlines, silver anodised aluminium frame, white backsheet showing as a crisp white grid between the cells, matte anti-reflective glass with a faint strip of blue sky and soft cloud reflected across it, floating on a seamless cool light-grey studio sweep, soft bright daylight from upper left, gentle contact shadow, product catalogue photography, colour-accurate, ultra-detailed, sharp focus, 50mm --ar 16:9 --style raw --v 7
```

**Description**

The dependable workhorse. Proven half-cut monocrystalline cells in a silver frame
deliver 400 watts at the keenest price per panel — the sensible default for a roof
where value does the talking. The classic silver-and-white look every installer
knows, sized to fill the most square metres for the least outlay.

---

## 2. Premium · 440 W · `solar/panel-premium.png`

**Midjourney**

```
A single high-efficiency monocrystalline solar panel photographed at a three-quarter hero angle, large-format module with densely packed uniform jet-black cells and near-invisible busbars, slim silver anodised aluminium frame, black backsheet, subtle high-performance sheen on the anti-reflective glass with a faint strip of blue sky and cloud reflected across it, floating on a seamless cool light-grey studio sweep, soft bright daylight from upper left, gentle contact shadow, precise engineering, premium product catalogue photography, colour-accurate, ultra-detailed, sharp focus, 50mm --ar 16:9 --style raw --v 7
```

**Description**

The most watts per panel. High-efficiency cells push each module to 440 watts, so
a tight or shaded roof reaches its target with fewer panels and fewer fixings.
Denser, near-seamless black cells behind a slim silver frame — the flagship choice
when generation matters more than up-front cost.

---

## 3. All-black · 415 W · `solar/panel-all-black.png`

**Midjourney**

```
A single all-black monocrystalline solar panel photographed at a three-quarter hero angle, monolithic uniform matte jet-black cells with no visible gridlines, black anodised aluminium frame and black backsheet, smooth low-glare glass with a faint strip of pale blue sky and cloud reflected across it, floating on a seamless cool light-grey studio sweep, soft bright daylight from upper left, gentle contact shadow, minimalist design-led product photography, colour-accurate, ultra-detailed, sharp focus, 50mm --ar 16:9 --style raw --v 7
```

**Description**

The design choice. Black cells, black frame, black backsheet — a single matte
plane that disappears into a dark roof instead of announcing itself. At 415 watts
it gives up almost nothing to premium, and is the panel to specify when the
building's looks come first.

---

### Wiring the images into the app — DONE

The three renders are wired in (all steps below are complete); regenerate a panel
by dropping a new PNG here under the matching filename above.

1. ✅ Each `panelType` option in `web/models/solar-array/presentation-model.json`
   carries its `image` key (mirrors how `vehicles` references `cars/…`).
2. ✅ `'solar'` is in the per-model image-copy loop in `scripts/build-site.mjs`,
   so the PNGs ship to `dist/solar/` on build.
3. ✅ The three PNGs live in this folder under the filenames above, and
   `web/solar/*.{png,jpg,jpeg,webp,avif}` is gitignored like `cars`/`antiques`
   (served locally in dev; shipped via `dist/` on deploy, R2 in production).

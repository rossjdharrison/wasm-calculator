# Art & Antiques — imagery + copy

Source of truth for the **eight** lots in the Art & Antiques model
(`web/models/antiques/`). For each piece: a ready-to-paste **Midjourney prompt**
and a **collector-facing description**.

The showroom references images by relative path from the presentation model
(each `piece` option's `image`, e.g. `antiques/ming-vase.png`). Generate the
image, save it under the matching filename below, and it renders on the stage +
cards; until then the showroom falls back to built-in silhouettes.

| Piece | File | Guide price (documented–museum) |
|---|---|---|
| Ming Dynasty Vase | `antiques/ming-vase.png` | £18,000 – £32,000 |
| Baroque Giltwood Console | `antiques/baroque-console.png` | £12,000 – £21,000 |
| Impressionist Oil, c.1890 | `antiques/impressionist-oil.png` | £145,000 – £240,000 |
| Turner Watercolour Study | `antiques/turner-watercolour.png` | £42,000 – £72,000 |
| Art Deco Mantel Clock | `antiques/art-deco-clock.png` | £6,500 – £12,000 |
| Bronze, School of Rodin | `antiques/rodin-bronze.png` | £88,000 – £155,000 |
| Antique Persian Rug | `antiques/persian-rug.png` | £9,500 – £17,000 |
| Murano Glass Chandelier | `antiques/murano-chandelier.png` | £14,000 – £24,500 |

### House style (already baked into each prompt)

Every prompt stages the lot like an auction-house / museum plate so the eight
sit together on the stage: seamless warm-greige backdrop, soft diffused gallery
lighting, faithful materials and patina, no people or props, colour-accurate,
landscape framing. Parameters used: `--ar 16:9 --style raw --v 7`.

- **Landscape (`--ar 16:9`)** suits the stage; the card crops to a thumbnail.
- For the chandelier you may prefer a taller crop — swap in `--ar 4:5` or `3:4`.
- If a version renders too "shiny", keep `--style raw`; drop it for a softer,
  more painterly look.

---

## 1. Ming Dynasty Vase · `antiques/ming-vase.png`

**Midjourney**

```
A Ming dynasty Chinese porcelain vase, tall baluster form 45cm high, luminous white body painted in cobalt-blue underglaze with scrolling lotus and a coiling dragon, glassy glaze with faint age-crackle, six-character reign mark, standing on a low black lacquer plinth, centred on a seamless warm-greige studio backdrop, soft diffused gallery light from upper left, delicate floor shadow, museum acquisition photography, generous negative space, ultra-detailed, colour-accurate, sharp focus, 85mm --ar 16:9 --style raw --v 7
```

**Description**

Five centuries of imperial taste, held in a single silhouette. This baluster
vase carries the unmistakable cobalt palette of the Ming kilns — lotus scrolls
and a coiling dragon drawn with a brush-confidence that later centuries only
imitated. The glaze has settled into a soft, glassy depth no reproduction
achieves, and the reign mark beneath rewards the eye that knows to look. At 45
centimetres it commands a room without raising its voice: a scholar's object,
equally at home on a Belgravia console or behind museum glass. Supplied with
full provenance.

---

## 2. Baroque Giltwood Console · `antiques/baroque-console.png`

**Midjourney**

```
An 18th-century Italian Baroque giltwood console table, richly hand-carved and water-gilded frame with acanthus scrolls, shells and a central cartouche, serpentine brèche-violette marble top, cabriole legs joined by a scrolled stretcher, 132cm wide and 88cm high, set against a seamless warm-greige studio backdrop, soft raking gallery light revealing carved relief and gently worn gold leaf, three-quarter view, gentle floor shadow, auction-house lot photography, ultra-detailed, photorealistic --ar 16:9 --style raw --v 7
```

**Description**

A pier table conceived for a palazzo, from a century when gilding was a language
of power. Every acanthus leaf and scallop is carved by hand and finished in
water-gilt gold, the leaf now warmed and softly worn to a honeyed tone only time
can give. Above sits a serpentine slab of brèche-violette marble, its violet
veining chosen to answer the gold. Broad at 132 centimetres, it anchors a hall or
sets a mirror to advantage. This is a foundation piece — sculptural,
architectural, unrepeatable — the sort an interior is built around rather than
merely furnished with.

---

## 3. Impressionist Oil, c.1890 · `antiques/impressionist-oil.png`

**Midjourney**

```
A French Impressionist oil painting circa 1890, sunlit garden with dappled foliage and a figure in white beneath trees, broken brushwork and vibrating complementary colour, visible impasto and canvas weave, in a restrained antique gold gallery frame, hung on a soft pale-grey gallery wall, even museum lighting with faint frame shadow, gentle craquelure and mellowed varnish, fine-art documentation photography, ultra-detailed, colour-accurate --ar 16:9 --style raw --v 7
```

**Description**

The high Impressionist decade, at its most generous. Painted around 1890 en
plein air, this garden scene is built from broken colour — strokes of violet and
gold that resolve, at the right distance, into pure light falling through leaves.
The impasto stands proud of the weave, the varnish has mellowed to a warm bloom,
and a figure in white anchors the shimmer. Works of this ambition and date rarely
leave private hands. For the collector it is both a daily pleasure and a
blue-chip position — a picture that has already outlived every fashion since the
brush left the canvas.

---

## 4. Turner Watercolour Study · `antiques/turner-watercolour.png`

**Midjourney**

```
A luminous watercolour study in the manner of J.M.W. Turner, a hazy coastal sunrise over calm water with distant sailing vessels dissolving into golden light, translucent washes of amber, rose and pale blue, minimal underdrawing, atmospheric and loosely worked on toned laid paper, conservation window-mount, photographed flat under even soft light, subtle deckle edge and age-toning, fine-art archival photography, ultra-detailed --ar 16:9 --style raw --v 7
```

**Description**

Turner's genius was to paint light itself, and this study is almost nothing but
light — an amber sunrise breathed onto paper in a handful of translucent washes,
ships barely more than a suggestion in the glow. Studies like this were the
laboratory of the master's imagination, worked wet and fast, and they are prized
precisely for that immediacy: you watch the mind moving. Modest at 54
centimetres, it carries the atmosphere of a far larger work. Framed behind museum
glass it becomes the quiet centre of a room — a scholar's picture, and a rare
survival.

---

## 5. Art Deco Mantel Clock · `antiques/art-deco-clock.png`

**Midjourney**

```
A 1930s French Art Deco mantel clock, bold stepped geometric case in black Belgian marble and honey onyx with polished chrome accents, silvered dial with sleek baton numerals, symmetrical architectural form 32cm high, centred on a seamless warm-greige backdrop, soft directional gallery lighting with crisp reflections on chrome and stone, gentle floor shadow, luxury product photography, ultra-detailed, sharp focus --ar 16:9 --style raw --v 7
```

**Description**

The Jazz Age in miniature: architecture you can set on a mantelpiece. This clock
distils the confidence of 1930s Paris into stepped planes of black marble and
honey onyx, the whole cooled by bright chrome and a silvered dial of pure
geometry. It is machine-age optimism made tactile — the vocabulary of the great
ocean liners and cinema façades, shrunk to the intimate. An ideal first
acquisition for the collector drawn to Deco, or a precise accent for an interior
that prizes line over ornament. Compact, characterful, and unmistakably of its
moment.

---

## 6. Bronze, School of Rodin · `antiques/rodin-bronze.png`

**Midjourney** *(moderation-safe — framed as an inanimate object, not a nude person; see note below)*

```
A cast bronze sculpture of a fragmentary human torso, headless and without arms, unmistakably an inanimate art object, in a dynamic twisting pose, richly modelled metal surface preserving the sculptor's tool-marks, deep brown patina shot with green verdigris, in the manner of Auguste Rodin, mounted on a dark marble plinth, 52cm tall, displayed as a museum gallery lot, seamless warm-greige backdrop, dramatic soft side-lighting sculpting the form, subtle floor shadow, fine-art object photography, ultra-detailed --ar 16:9 --style raw --v 7
```

> **Why this wording:** Midjourney's filter read the original's `nude` + `torso` + `caught mid-movement` + `photorealistic` as a real naked person. Leading with "*a cast bronze sculpture of*", making it a **headless/armless fragment**, repeating the metal cues, and dropping `nude`/`photorealistic` all say *art object* louder than *body*.
>
> **If it still flags**, swap the subject for one with no bare-skin read at all — both are quintessentially Rodin:
> - *A cast bronze sculpture of two intertwined hands rising from a rough-cast base, in the manner of Auguste Rodin, richly modelled patinated metal, deep brown and green patina, on a dark marble plinth, 52cm tall, seamless warm-greige backdrop, dramatic soft side-lighting, subtle floor shadow, museum sculpture photography, ultra-detailed --ar 16:9 --style raw --v 7*
> - *A cast bronze statue of a seated draped figure lost in thought, wrapped in flowing robes, in the manner of Auguste Rodin, patinated brown-green metal surface, on a dark marble plinth, 52cm tall, seamless warm-greige backdrop, soft gallery lighting, subtle floor shadow, museum sculpture photography, ultra-detailed --ar 16:9 --style raw --v 7*

**Description**

Rodin freed sculpture from polish and let the hand show — and this bronze, from
his circle, speaks that language fluently. The surface is alive with modelling:
every press of the thumb survives in the cast, catching light along a torso held
between tension and repose. The patina has deepened to a bronze-brown shot with
green, the mark of an early, well-kept cast. At just over half a metre it is a
true collector's sculpture — intimate enough to live with, serious enough to hold
its own beside a museum label. A piece to be walked around, and never quite
finished with.

---

## 7. Antique Persian Rug · `antiques/persian-rug.png`

**Midjourney**

```
An antique hand-knotted Persian Tabriz rug, late 19th century, intricate central medallion over a dense arabesque field, madder-red ground with indigo and ivory borders, fine wool pile with soft natural-dye abrash and gentle age patina, laid flat and photographed from directly overhead, 340 by 240cm, on a smooth pale concrete floor, even soft daylight, slight organic unevenness at the edges, fine textile documentation photography, ultra-detailed, colour-accurate --ar 16:9 --style raw --v 7
```

**Description**

A garden of wool and patience. Hand-knotted in Tabriz in the closing years of the
nineteenth century, this carpet sets a classical medallion adrift on a field of
arabesques, its madder reds and deep indigos drawn from natural dyes that have
aged into a subtle, living range no synthetic can match. More than three metres
long, it was built to be lived on — its pile softened, not worn, by a century of
careful use. A great Persian rug is the one antique that anchors an entire room
while asking nothing in return, and quietly appreciates beneath your feet.

---

## 8. Murano Glass Chandelier · `antiques/murano-chandelier.png`

**Midjourney**

```
An ornate Murano glass chandelier in the Ca' Rezzonico style, hand-blown Venetian cristallo with scrolling arms, delicate glass flowers and curling leaves in soft rose, amber and clear glass, gilt-metal armature, twelve candle-lights aglow, 110cm high, suspended against a softly lit pale interior with a hint of a grand painted ceiling, warm glow through the glass, elegant symmetry, luxury interior photography, ultra-detailed, photorealistic --ar 16:9 --style raw --v 7
```

**Description**

Venice has blown glass on Murano for seven centuries, and this chandelier is the
island showing off. Every scrolling arm, every blossom and curling leaf is worked
by hand from cristallo, tinted in soft rose and amber that come alive the moment
the lights are lit. In the exuberant Ca' Rezzonico manner, it is less a fixture
than a suspended sculpture — a centrepiece that turns a stairwell or dining room
into an occasion. Weight, provenance and sheer craft set it apart from the
reproductions: this is the real Venetian article, ready to be hung and admired
for another lifetime.

---

### Wiring the images into the app (optional follow-up)

1. Add an `image` key to each `piece` option in
   `web/models/antiques/presentation-model.json`, e.g.
   `"image": "antiques/ming-vase.png"` (mirrors how `vehicles` references
   `cars/…`).
2. Generalise the asset copy in `scripts/build-site.mjs` — it currently
   hard-copies only `web/cars/` to `dist/cars/`; add the same for
   `web/antiques/` so the PNGs ship on build.

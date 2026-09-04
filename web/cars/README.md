# Car images

The showroom configurator references these by relative path from the model
(`presentation-model.json` → each `model` option's `image`). Drop the matching
image files here (JPG/PNG/WebP) and they render on the turntable + cards; until
then the showroom falls back to built-in silhouettes.

Expected files (from the current model):

| Model option | File |
|---|---|
| Hot Hatchback | `hot-hatchback.png` |
| Sleek Estate | `sleek-estate.png` |
| GT Coupe | `gt-coupe.png` |
| Rugged Off-roader | `rugged-offroader.png` |
| Luxury Pickup | `luxury-pickup.png` |
| Flagship SUV | `flagship-suv.png` |
| Mid-engine Supercar | `mid-engine-supercar.png` |
| Hyper-car | `hypercar.png` |

`scripts/build-site.mjs` copies everything here to `dist/cars/` on build.
Landscape images look best on the stage; the card crops to a small thumbnail.

# wasm-calculator — a quote machine powered by WebAssembly

A configurable **quote machine**: the user enters order details and, as they
type, both the **prices** and the **available options** update live. All of that
logic — pricing tables, discounts, validation, and which options are allowed —
lives in a **WebAssembly module compiled from [AssemblyScript]** (a
TypeScript-like language). The browser front-end is deliberately thin: it just
feeds inputs to the WASM engine and paints whatever comes back.

The example domain is a **custom-apparel print quote** (screen print / DTG /
embroidery), chosen because it has rich conditional logic. Swap it for your own
domain by editing one file — see [Adapting the logic](#adapting-the-logic).

```mermaid
flowchart LR
  U["User edits form"] -->|input event| A["app.js"]
  A -->|compute(numbers)| W["quote.wasm<br/>(AssemblyScript)"]
  W -->|prices + option flags| A
  A -->|paint values| V["Live quote"]
  A -->|enable / disable / clamp| O["Option controls"]
```

## Why WebAssembly here?

- **One source of truth for logic.** Pricing rules live in `assembly/quote.ts`
  and run identically wherever the `.wasm` is loaded (browser today, a Node
  service or another host tomorrow).
- **Instant recalculation.** The engine runs in microseconds, so it's fine to
  recompute on every keystroke — that's what makes options feel reactive.
- **Portable & sealed.** The rules ship as a single `.wasm` artifact with a
  pure-numeric interface — no framework lock-in.

## Project structure

```
assembly/
  quote.ts          # THE LOGIC — pricing, discounts, option rules (→ WASM)
  tsconfig.json     # AssemblyScript editor config
build/              # compiled wasm output (git-ignored; run `npm run asbuild`)
  quote.wasm        #   release build used by the app + tests
  quote.debug.wasm  #   debug build
  quote.wat         #   human-readable WebAssembly text (handy for inspection)
web/                # authored front-end (paths are relative, e.g. app.js)
  index.html        # the form + live quote panel
  app.js            # thin glue: read form → call WASM → paint results & options
  styles.css        # theme-aware styling (light + dark)
dist/               # DEPLOYABLE site (git-ignored; run `npm run build`)
                    #   flat: index.html, app.js, styles.css, quote.wasm
scripts/
  build-site.mjs    # assembles web/ + build/quote.wasm → dist/
test/
  quote.test.mjs    # node:test suite that loads the WASM and checks the maths
server.mjs          # zero-dep dev server (serves web/ + build/ with prod URLs)
asconfig.json       # AssemblyScript build targets (debug / release)
wrangler.jsonc      # Cloudflare Pages project config
.nvmrc              # Node version for the Cloudflare build
package.json
```

## Getting started

```bash
npm install          # installs the AssemblyScript compiler (dev dependency)
npm start            # builds quote.wasm, then serves http://localhost:8080/
```

The dev server serves `web/` and `build/` together using the **same flat URLs
as production** (`/`, `/app.js`, `/quote.wasm`), so what you see locally matches
what Cloudflare serves.

Other scripts:

```bash
npm run asbuild      # compile assembly/quote.ts → build/*.wasm (debug + release)
npm run build        # compile release wasm + assemble the deployable dist/
npm test             # build the release wasm, then run the test suite
npm run serve        # serve web/ + build/ without rebuilding
npm run preview      # build, then serve dist/ via the Cloudflare Pages emulator
npm run deploy       # build, then deploy dist/ to Cloudflare Pages (wrangler)
```

> `build/` and `dist/` are git-ignored (build outputs). After cloning, run
> `npm start` (dev) or `npm run build` (deploy) once to generate them.

## Deploy to Cloudflare Pages

The site is a **built artifact**: `dist/` is assembled from `assembly/quote.ts`
(→ `build/quote.wasm`) plus `web/`. Nothing binary is committed — `dist/` is
produced by the build. Two ways to ship it:

### Option A — Git integration (auto-deploy on push, recommended)

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
Git**, pick this repo, then set:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | pinned by `.nvmrc` (22) — or set `NODE_VERSION=22` |

Every push to `main` builds the wasm from source and publishes `dist/`.
(`wrangler.jsonc` already declares `pages_build_output_dir`, so the output dir
is taken from the repo.)

### Option B — Wrangler CLI (manual / one-off)

```bash
npx wrangler login          # once, to authenticate
npm run deploy              # builds dist/, then `wrangler pages deploy dist`
```

The first deploy creates a Pages project named `wasm-calculator` (from
`wrangler.jsonc`) and prints the live `*.pages.dev` URL.

> Cloudflare Pages serves `.wasm` with the correct `application/wasm` type, and
> the app instantiates from an `ArrayBuffer`, so it works regardless.

### Custom domain — `quote.rowblaa.com`

The site is served at **https://quote.rowblaa.com** (a subdomain of the
Cloudflare-managed zone `rowblaa.com`). Because the zone is in the same
Cloudflare account, the DNS record and TLS certificate are created
automatically — there is no manual DNS step.

1. Deploy at least once (Option A or B) so the `wasm-calculator` Pages project
   exists.
2. Dashboard → **Workers & Pages → `wasm-calculator` → Custom domains → Set up a
   domain** → enter `quote.rowblaa.com` → **Activate domain**.
3. Cloudflare adds the proxied `CNAME quote → wasm-calculator.pages.dev` in the
   `rowblaa.com` zone and issues the certificate. Live within a few minutes.

No repo changes are needed for the custom domain; it's Cloudflare-side config.

## The WASM boundary (contract)

The interface is **pure-numeric** — numbers in, numbers out — so there's no
memory marshalling. `compute(...)` runs all the rules and stashes results; the
front-end then reads them back via getters.

```ts
// inputs (booleans are passed as 0 / 1)
compute(quantity, tier, method, locations, colors, rush, member): void

// numeric results
getUnitPrice()  getSubtotal()  getDiscountRate()  getDiscountAmount()
getRushFee()    getTax()       getTotal()

// option availability + dynamic limits
getFlags()          // bitfield: which options are currently allowed
getMaxColors()      // colour cap for the current method
getMaxLocations()   // location cap for the current method
getValidation()     // 0 = ok, else an error code
```

`getFlags()` is a bitfield the UI uses to enable/disable/clamp controls:

| bit | flag | meaning |
| --- | --- | --- |
| 1  | `SCREEN_AVAILABLE`     | screen print allowed (needs ≥ 12 units) |
| 2  | `DTG_AVAILABLE`        | DTG allowed |
| 4  | `EMBROIDERY_AVAILABLE` | embroidery allowed |
| 8  | `COLORS_APPLICABLE`    | ink-colour input is relevant |
| 16 | `RUSH_AVAILABLE`       | rush turnaround allowed |
| 32 | `MEMBERSHIP_APPLIED`   | member discount applied |

These constants are defined in `assembly/quote.ts` and mirrored in `web/app.js`
and `test/quote.test.mjs` — **keep the three in sync** if you change them.

## How "options change as you type"

`web/app.js` doesn't decide anything itself. On every change it calls the WASM
engine and then obeys the flags:

- Quantity below 12 → `SCREEN_AVAILABLE` clears → the *Screen print* radio is
  disabled (and selection falls back to DTG).
- Method = embroidery → `getMaxLocations()` returns 2 → the locations input is
  capped, and `RUSH_AVAILABLE` clears → the rush checkbox is disabled.
- Method = screen → `COLORS_APPLICABLE` sets → the ink-colours field appears,
  capped to `getMaxColors()`.

## Adapting the logic

1. Edit **`assembly/quote.ts`**: change the enums, the pricing tables
   (`garmentBase`, `printCost`, `volumeDiscount`), and the rules in `compute`.
   Add getters for any new outputs.
2. If you add/rename enums or flags, mirror them in **`web/app.js`** and
   **`test/quote.test.mjs`**.
3. Update **`web/index.html`** for any new inputs/outputs.
4. `npm test` to check the maths, `npm start` to see it live.

## License

[MIT](LICENSE) © rossjdharrison

[AssemblyScript]: https://www.assemblyscript.org/

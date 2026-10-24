# ASAP — brand assets

Everything in this folder is generated, not stock. The two photographic backgrounds come from the
image model below; **all typography is composed in HTML and screenshotted with headless Chrome**, so
text is pixel-exact and never model-garbled.

## Files

| File | Size (px) | Bytes | Used for |
|---|---|---|---|
| `og.png` | 1200 × 630 | 148 KB | `og:image` / `twitter:image` link preview on X, LinkedIn, Discord, Telegram |
| `social-square.png` | 1080 × 1080 | 237 KB | Square post / feed thumbnail on X, LinkedIn, Instagram |
| `logo-mark.png` | 512 × 512 | 198 KB | App icon, favicon source, PWA icon 512; transparent outside the rounded square |
| `logo-mark@2x.png` | 1024 × 1024 | 581 KB | Retina app icon, 1024 PWA icon, store listing |
| `logo-lockup.png` | 1600 × 400 | 48 KB | Header/footer lockup, README banner, slide title bar; transparent background |
| `hero-smoke.webp` | 1600 × 900 | 23.8 KB | Landing page background behind hero copy (dark, pre-vignetted) |
| `hero-plume.webp` | 1600 × 750 | 13.9 KB | Wide hero plate: thin smoke over blackened peat, ember glow low right, left half quiet for the headline |
| `last-mile.webp` | 1600 × 900 | 41.3 KB | "The detection layer exists, the last mile does not" — dirt track at dusk toward an orange smoke horizon |

All PNG cards are 256-colour with Floyd–Steinberg dither to keep the link preview under 400 KB while
leaving the type crisp — a truecolour 1200 × 630 render of the same layout is 492 KB.

### Lockup on light backgrounds

`logo-lockup.png` and the two marks carry white type/an orange-free palette intended for dark UI. On a
light page, place the lockup on a `#0b0a0f` panel rather than recolouring it.

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| canvas | `#0b0a0f` | base background, scrims, card field |
| panel | `#12101a` | raised surfaces |
| hairline | `#241f33` | 1 px separators, input borders |
| violet (primary) | `#836ef9` | mark tile, links, focus, Monad brand |
| violet deep | `#5b45dd` → `#4632b8` | gradient tail on the mark tile |
| violet light | `#8f7bfa` | gradient head on the mark tile |
| ember | `#f5a524` | bounty/live accents, numerals, the "·" in the URL line |
| ember soft | `rgba(245,165,36,.16–.20)` | warm screen wash over imagery |
| success | `#3dd68c` | paid / verified states |
| text primary | `#ffffff` | display type |
| text secondary | `#c9c3de` / `#c2bcd8` | second headline line (og / square) |
| text muted | `#8d86a4` · `#9d96b2` · `#8b84a3` | mono metadata, lockup subtitle |
| kicker | `#7d7695` | uppercase mono eyebrow |

## Type

- **Inter** 800, letter-spacing `-0.03em` on display, `0.18–0.2em` on the wordmark.
- **JetBrains Mono** 400/500 for URLs, addresses, and metadata.
- Both loaded from Google Fonts inside the compose pages; the screenshot only fires after
  `document.fonts.ready` resolves and `document.fonts.check('800 62px Inter')` returns true.

## Generated imagery

Model: `openai/gpt-image-2.5-flare` via Replicate. Native output 1024 × 1024, so landscape crops were
taken from the square and Lanczos-upscaled (`og`: 1024 × 538 → 1200 × 630, 1.17×; `hero`: 1024 × 576 →
1600 × 900, 1.56×). Prompts asked for **no text, letters or logos** — all words are added afterwards.

**`og.png`, `hero-smoke.webp`** — from `smoke-a`, prompt:

> Cinematic wide photograph of thick dark smoke drifting low across a blackened field at night, faint
> orange ember sparks suspended inside the haze on the right side, enormous empty near-black negative
> space on the left, single distant warm light source rim-lighting the smoke plume, deep crushed
> shadows, high contrast editorial documentary photography, 35mm film grain, shallow depth of field,
> no people, no text, no letters, no logos, desaturated teal-black shadows with warm orange highlights

**`social-square.png`** — from `smoke-b`, prompt:

> Cinematic overhead photograph of grey smouldering smoke rising from scorched earth at night, fine
> orange embers glowing faintly through the haze, near-black surround, dramatic single hard light
> raking from the lower right, extreme contrast, editorial documentary photography, subtle film grain,
> moody desaturated palette of charcoal and ember orange with deep violet-black shadows, abstract and
> atmospheric, no people, no vehicles, no text, no letters, no logos

Post-processing on the chosen frames: darkening scrims and vignette applied in CSS at compose time;
the standalone `hero-smoke.webp` additionally got `eq=gamma=1.16:contrast=1.10:saturation=0.86` plus
`vignette=angle=PI/5.6`, then `cwebp -q 78 -m 6 -sharp_yuv`.

## Hero plates (`hero-plume`, `last-mile`)

Same model, same palette, same rule: **no people, no vehicles, no text**. Both are landscape bands cut out of
the square 1024 × 1024 output, so each prompt asked for the subject to sit in a horizontal band across the
middle of the frame with disposable darkness above and below. Neither image is upscaled more than 1.56×.

| File | Real pixels (`sips`) | Bytes | Band cropped from the 1024² source |
|---|---|---|---|
| `hero-plume.webp` | 1600 × 750 | 14,178 | 1024 × 480 at y=272 → 1.56× |
| `last-mile.webp` | 1600 × 900 | 42,326 | 1024 × 576 at y=210 → 1.56× |

### `hero-plume.webp` — 1600 × 750, 13.9 KB

Source `hero-a`, prompt:

> Cinematic wide photograph of a blackened peat field at night in Indonesia, thin dark smoke drifting low and
> slow across the scorched bare ground, a faint ember glow with a few dim orange embers low on the right side
> just below the centre of the frame, the entire left two-thirds almost pure black and silent with no detail at
> all, the subject concentrated in one horizontal band across the middle of the frame with generous empty
> darkness at the top and bottom edges, deep crushed shadows, single distant warm light source rim-lighting the
> haze, high contrast editorial documentary photography, 35mm film grain, shallow depth of field, desaturated
> teal-black shadows with warm ember orange highlights, no people, no vehicles, no text, no letters, no numbers,
> no logos, no user interface

```bash
# 1024 × 480 band from the middle of the square → 1600 × 750 (1.56×, Lanczos)
ffmpeg -i hero-a.webp -vf "crop=1024:480:0:272,scale=1600:750:flags=lanczos,\
eq=gamma=1.05:contrast=1.09:saturation=0.92,vignette=angle=PI/6" hero-final.png
cwebp -q 80 -m 6 -sharp_yuv hero-final.png -o hero-plume.webp
```

**Why 1600 × 750 and not 1920 × 900.** The native frame is 1024 wide. A 1920 px plate is a 1.88× upscale,
which goes soft and mottled in the darks no matter the filter. 1600 × 750 is a 1.56× upscale — identical to
the existing `hero-smoke.webp` — and stayed crisp at 1:1. A strict ≤1.35× ceiling would mean 1382 × 648; that
is the fallback if the hero ever has to be full-bleed on a 1440p display.

### `last-mile.webp` — 1600 × 900, 41.3 KB

Source `last-a`, prompt:

> Cinematic documentary photograph of an empty rutted dirt track at dusk curving away toward a distant low
> horizon where a haze of orange smoke rises and fades into cold grey, deep teal-black shadowed foreground, no
> people and no vehicles anywhere, the horizon sits slightly above the centre of the frame with the track
> leading the eye from the lower middle, dark quiet negative space at the top and bottom edges, cold blue-teal
> shadow against warm ember orange haze, high contrast, editorial documentary photography, 35mm film grain,
> shallow depth of field, atmospheric smoke particles, no text, no letters, no numbers, no logos, no user
> interface

```bash
# 1024 × 576 band → 1600 × 900 (1.56×, Lanczos), then deepen for overlaid copy
ffmpeg -i last-a.webp -vf "crop=1024:576:0:210,scale=1600:900:flags=lanczos,\
eq=contrast=1.06:saturation=0.96:gamma=0.97,vignette=angle=PI/5.2" last-v2.png
cwebp -q 78 -m 6 -sharp_yuv last-v2.png -o last-mile.webp
```

### Rejected / spare generations

- `hero-b` (spare, not shipped): "blackened peat field at night after the fire has passed, thin low horizontal
  ribbons of grey smoke…, one very faint distant ember glow far off to the right". Beautifully empty and the
  closest literal reading of the brief, but at 1600 px it reads as a near-black rectangle with a faint smear —
  too little signal to earn the space. Kept in `workspace-research/marketing/brand/raw/` if a quieter plate is
  ever wanted.
- The first grade of `last-mile` (no vignette, `gamma=1.06`) lost the teal-black weight in the foreground and
  the track stopped carrying the eye. The shipped version adds `gamma=0.97` + `vignette=angle=PI/5.2`.

Both plates are background-only: no vignette or scrim is baked in beyond the above, so the page can layer
`rgba(11,10,15,.55–.75)` on top and keep the type contrast it needs.

## Reproducing

The compose pages and full-colour masters live outside this repo, in
`workspace-research/marketing/brand/` (`build/*.html`, `raw/*.png`) — research scaffolding is kept out
of the submission. Each card is a `file://` page screenshotted at its exact viewport:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --window-size=1200,630 \
  --screenshot=og.png og.html
```

Transparent variants add `--default-background-color=00000000`.

## Logo geometry (do not fork)

The mark is a thin-stroke flame, stroke `#fff`, `stroke-width 2`, no fill, no line-cap override
(butt caps are what make it read as a flame rather than a droplet):

```html
<svg viewBox="0 0 24 24">
  <path d="M12 3c0 4-4 4.5-4 8a4 4 0 0 0 8 0c0-1.5-1-2.5-1-2.5S16 10 16 12a4 4 0 1 1-8 0"/>
  <path d="M4 20h16" opacity=".4"/>
</svg>
```

Tile: `radial-gradient(95% 70% at 20% 10%, rgba(188,168,255,.38), transparent 60%)` over
`linear-gradient(150deg,#8f7bfa,#836ef9 38%,#5b45dd 76%,#4632b8)`, corner radius `22.6%` of the tile,
inset hairline `inset 0 0 0 .8px rgba(255,255,255,.16)`.

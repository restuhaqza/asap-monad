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

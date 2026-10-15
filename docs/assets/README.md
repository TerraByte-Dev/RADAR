# README brand assets

| File | Used by | How it's made |
|---|---|---|
| `radar-wordmark.png` | README hero | Generated: `openai/gpt-image-2.5-sunburst` through OpenRouter, 2304×768, quality high. Prompt below. |
| `social-preview.png` | Repo **Settings → General → Social preview** | Generated: same model, 1280×640, quality high. **Not** referenced by the README; upload it by hand. |
| `terrabyte-logo.png` | "brought to you by" and the footer | The existing TerraByte Solutions mark. Never generated. |

Brand tokens: phosphor green `#00FF88` (the app's `--acc` in `src/renderer/src/styles/tokens.css`),
bright core `#C8FFE0`, dim ink `#1F8F55`, background `#000000`.

The screenshots are not generated: see [`../screenshots/README.md`](../screenshots/README.md).

## Image-gen prompt — `radar-wordmark.png`

> Wide banner logotype reading "RADAR" in a single line. Blocky pixelated bitmap typeface — chunky, low-resolution pixel letterforms like the VT323 / classic CRT-terminal / DOS-BIOS font, monospaced, uppercase, slightly wide letter-spacing. The letters glow in phosphor green (#00FF88) with a brighter #C8FFE0 core and a soft outer bloom/halo, like illuminated text on an old CRT monitor. Pure black (#000000) background. Subtle horizontal CRT scanlines across the whole image, very faint screen vignette in the corners, and a slight red/cyan chromatic-aberration fringe on the letter edges. Crisp, legible, centered, with generous padding around the word. Retro-futuristic terminal aesthetic, flat 2D (no 3D bevel, no perspective), no reflections, no extra text or icons. Aspect ratio 3:1 (wide). High resolution. Spell the single word exactly, letter for letter: R-A-D-A-R.

## Image-gen prompt — `social-preview.png`

> A 1280×640 social card on a pure black (#000000) CRT screen. Centered, the blocky pixelated bitmap-font logotype "RADAR" glowing in phosphor green (#00FF88) with a brighter #C8FFE0 core and soft bloom. Below it, in a smaller thin monospaced terminal font in dim green (#1F8F55), one short tagline line reading exactly: "PICK UP WHERE YOU LEFT OFF". Faint horizontal CRT scanlines, subtle corner vignette, slight red/cyan chromatic aberration on edges. Lots of negative space, balanced composition, flat 2D retro-terminal aesthetic, no other text, no logos, no icons. Spell the title exactly: R-A-D-A-R.

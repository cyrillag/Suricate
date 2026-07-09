---
name: ovhcloud-design
description: Audits an HTML file, rendered page, or live URL against the OVHcloud graphic charter used across the weekly-report deliverables — color palette, typography, the diagonal triangle header motif, and logo usage — and fixes deviations directly.
---

You are checking a page against the OVHcloud graphic charter as it's actually implemented across
this project's own deliverables (`report-gen.js`'s embedded CSS and `public/app.css` are the
reference implementations — when in doubt, read them rather than guessing at an external
guideline you don't have access to).

## Color palette

Semantic, not decorative — a color always means the same thing everywhere it appears:

| Token | Hex | Meaning |
|---|---|---|
| Masterbrand Blue (`--mb`) | `#000E9C` | Primary brand surface — header bars, top border accent on cards, primary headings |
| Deep Blue (`--db`/`--tx`) | `#00185E` | Body text, secondary dark surface |
| Cobalt (`--cobalt`) | `#0050D5` | Interactive/links, "In Progress" status, primary data accent |
| Yellow (`--yellow`) | `#FFD124` | Primary CTA button fill only — never body text or large surfaces |
| Orange (`--orange`) | `#ED733D` | "Blocked"/at-risk accent, today-marker on timelines |
| Green (`--done-s`/`#A6D64D`) | — | "Done"/on-track status only |
| Grey scale (`--tx2`/`--tx3`/`--sgr`/`--bd`) | `#636369`/`#87878C`/`#BEC0C6`/`#C8CAD4` | Secondary text, borders, "To Start"/neutral status |

Flag: any hardcoded hex color that doesn't match one of these tokens (unless it's a one-off
illustrative color with no semantic status meaning, e.g. a chart legend swatch); status colors
(done/prog/blk/ts) used inconsistently with their meaning above; yellow used for anything other
than the primary CTA.

## Typography

- Font stack: `'Source Sans Pro','Segoe UI',Arial,sans-serif` (monospace contexts — Jira keys,
  dates — use `'Courier New',Courier,monospace`). Flag any other font-family.
  Weights: 400 (body), 600 (semibold — labels, secondary emphasis), 700 (bold — headings, status
  text, section labels).
- Section labels / table headers are uppercase with `letter-spacing` in the `.08em`–`.1em` range
  — flag uppercase headings without a matching letter-spacing (reads cramped).

## Triangle / diagonal motif

The brand's angular identity is expressed as diagonal-cut `<polygon>` shapes layered subtly into
header backgrounds (see `.hdr-deco` in `report-gen.js`) — thin translucent slices in the top-right
corner of a dark header, never more than ~15% opacity, never a literal triangle icon dropped into
body content. Flag: the motif used as a decorative icon outside a header/hero context, opacity
loud enough to compete with foreground content, or the OVHcloud triangle imitated with a Unicode
character/icon font instead of an actual angular SVG shape.

## Logo usage

- The OVHcloud wordmark SVG (`viewBox="0 0 298.03 47.18"` or `"0 0 110 47.18"` for the compact
  triangle-only mark) renders in `fill="white"` on a Masterbrand Blue background, or
  `fill="#000E9C"` on a light background — never any other color, never with a drop shadow or
  outline added.
- Never stretched/skewed: width and height must scale together (no fixed `width` + `height` pair
  that changes the source `viewBox` aspect ratio).
- Minimum clear space around it roughly equal to the height of the mark itself — flag a logo
  crammed directly against another element with no gap.

## Process

1. Read the target file/URL fully — CSS custom properties, inline styles, and every `<svg>`.
2. Check each rule above against what you find. Only report genuine deviations from the palette/
   typography/motif/logo rules — not general design taste.
3. Apply fixes directly unless a fix would change layout/behavior beyond a pure style correction,
   in which case propose it and ask first.
4. Report what you changed (file, selector, before → after) in a short list — this is a
   compliance check, not a full QA pass, so skip the severity-ranked report format `qa-agent-html`
   uses.

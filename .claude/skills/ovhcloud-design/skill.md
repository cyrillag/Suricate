---
name: ovhcloud-design
description: "Use this skill any time HTML, CSS, slides, or any visual deliverable must follow OVHcloud's visual identity. Covers brand color palette (Masterbrand Blue, secondary accents, functional blue shades), typography (Source Sans Pro), logo usage rules, the triangle shape motif, imagery hierarchy (hero/illustration/icon/photo), and concrete styling conventions for charts, tables, and org charts derived from the OVHcloud PPT toolbox. Trigger whenever the user mentions OVHcloud branding, OVHcloud guidelines, or asks to review/build a page, deck, or component against OVHcloud's design system."
---

# OVHcloud Design Guidelines

Source: OVHcloud Visual Identity Guidelines (VLONG, July 2023) + PPT Toolbox template.
Use this as the single reference for any HTML/UI work that must respect OVHcloud branding.

## 1. Color Palette

### Masterbrand (primary)
| Name | Hex | Usage |
|---|---|---|
| Masterbrand Blue | `#000E9C` | Dominant color everywhere: backgrounds, slide titles, font color, color blocks |
| White | `#FFFFFF` | Heavy use as background; write Masterbrand Blue text on it |

Masterbrand Blue must be the predominant color. White is the second pillar (backgrounds, cards, text-on-color-block).

### Secondary (accents — use sparingly)
| Name | Hex | Usage |
|---|---|---|
| Sky Blue | `#73E3FF` | CTA accents, highlights |
| Green | `#A6D64D` | Accent |
| Yellow | `#FFD124` | Accent, CTA buttons, links |
| Orange | `#ED733D` | Accent, warnings/highlights |

Rule: secondary colors are accents only (CTA buttons, links, highlighted text, form focus states) — never as a dominant surface color.

### Shades of Blue (functional — data viz, secondary text/blocks)
| Name | Hex |
|---|---|
| Dark Blue | `#00185E` |
| Cobalt Blue | `#0050D5` |
| Royal Blue | `#147DE8` |
| Light Blue | `#4AB0F5` |

### Extended ramps (data visualization / illustrations only)
Neon: Neon Blue `#00FBFC`, Neon Green `#CAFA50`, Neon Yellow `#F0F551`, Electric Blue `#1009FB`
Tints/Shades: Dark/Light variants of Sky `#2BCFFA`/`#BFF0FF`, Green `#7BB73C`/`#BDE475`, Yellow `#FFBB22`/`#FFE16D`, Orange `#D85639`/`#F4A17D`
Greys: Dark Grey `#636369`, Grey `#87878C`, Soft Grey `#BEC0C6`, Light Grey `#E5E7ED`

### Do / Don't
- Do use Masterbrand Blue as the dominant brand color across every screen.
- Do use secondary colors only for accents/CTAs — never as a large fill.
- Don't default to generic blue gradients unrelated to the palette above.
- Don't use beige/cream backgrounds.

## 2. Typography

**Typeface: Source Sans Pro** (open-source). Do not use any other typeface.

| Weight | Use case |
|---|---|
| Black | Strong statements, hero numbers |
| Bold | Headlines, slide titles |
| SemiBold | Subheaders |
| Regular | Body copy |
| Light | Captions, side notes, sources, low-importance text |
| Italic / SemiBold Italic / Light Italic | Emphasis (preferred over ALL CAPS) |

Rules:
- Sentence or Title case — avoid setting body copy in ALL CAPS.
- Left-justify text whenever possible (don't center body copy).
- Use bold/italic for emphasis rather than uppercase.

CSS fallback stack (Source Sans Pro is on Google Fonts):
```css
font-family: "Source Sans Pro", Arial, Helvetica, sans-serif;
```

## 3. Logo

- Primary logo: horizontal lockup (Emblem + Wordmark). Always use both pieces together; never separate, recolor, skew, or recreate them.
- Stacked (vertical) logo only for tight/square formats where horizontal doesn't fit.
- Minimum clear space around the logo = x-height of the wordmark (height of lowercase letters).
- Minimum size: 120px wide digital / 2.5cm print.
- White ("knockout") version for dark/blue backgrounds.
- Never: change logo color, add taglines/shadows/effects to it, place it on a low-contrast background, or use "Innovation for freedom" as a locked-up tagline (it's a motto, used only in running text).

## 4. Shape Language

**The triangle is the master shape** — present throughout backgrounds, dividers, illustrations, and decorative elements.

Usage modes: solid, outline ("line"), and transparent/gradient fade. Can be used as full-bleed backgrounds, image frames, or small decorative accents layered/combined into new compound shapes.

UI translation: favor triangular accent shapes (e.g. small corner triangles, angled section dividers, play-button-style icons) over the generic rounded rectangles/blobs common in other design systems. Avoid colored bar/stripe accents (not part of this identity — that's a different brand's anti-pattern, but stay consistent: triangles are the one recurring motif here, don't introduce competing shapes).

## 5. Imagery Hierarchy

1. **Hero visuals** — bespoke, detailed illustrations/photo-composites for headers, banners, key visuals, main slide covers. Highest visual investment.
2. **Illustrations** — simpler, flat/semi-flat graphics for secondary content (infographics, text-block embellishment, email graphics). Skip if they don't add clarity.
3. **Iconography** — small, simple line or gradient icons for key figures/labels. Two styles: flat (UI, small spaces) and layered/gradient (section headers, larger spaces). Never use third-party/internet icons (copyright); never invent new icon styles.
4. **Photography** — real people/datacenters/offices to add warmth; favor active, diverse, "full of people" photography that conveys movement.

## 6. Data Graphics (charts) — from PPT Toolbox

Observed conventions across toolbox chart slides:

- **Color sequence for series**: Dark Blue (`#00185E`) → Cobalt/Masterbrand Blue (`#000E9C`/`#0050D5`) → Royal/Light Blue (`#147DE8`/`#4AB0F5`), darkest-to-lightest left to right. Avoid mixing in secondary accent colors (yellow/orange/green) unless one series specifically needs emphasis.
- **Bar charts**: value labels printed directly above each bar (not inside, not via tooltip-only); category labels (years, etc.) in bold grey below the axis; thin light-grey horizontal rule separates the "Chart Title" label from the chart area; legend centered below the chart, small square swatches.
- **Highlight variant**: when one category/period should stand out (e.g. "this year" vs history), render all non-highlighted series/segments in flat grey tones and only the highlighted one in brand blue — this is the standard way to draw attention without adding new colors.
- **Donut/pie charts**: white center hole, segments in the same dark-to-light blue sequence, value labels placed just outside each segment, legend below with small square swatches.
- **Trend/growth charts**: paired bar series with a diagonal arrow + circular callout bubble (e.g. "+XX%") overlaid to call out a growth trend; negative values render as orange (`#ED733D`) bars below the baseline, contrasted against blue positive bars above.
- **No 3D effects, no drop shadows, no gradients on chart bars** — flat fills only. Gridlines are minimal-to-absent; rely on value labels instead of a Y-axis scale where possible.

## 7. Tables — from PPT Toolbox

- **Header row**: solid Masterbrand Blue (`#000E9C`) or Dark Blue fill, white bold uppercase or capitalized column labels.
- **Body rows**: alternating zebra striping in very light grey (`#F2F3F7`-ish) / white for readability — no heavy borders between rows.
- **Emphasis column** (e.g. a "current period" or key date column): light blue tinted background (lighter blue cells), sometimes with a vertical gradient of blue intensity per row to indicate sequence/progress.
- **Row labels** (leftmost column) are bold; data cells are regular weight, right- or center-aligned for numeric data.
- **Annotation pattern**: financial/comparison tables pair each data row with an outdented callout to the right (bold heading + bullet sub-points), connected via a thin leader line to a specific cell — used to narrate "why this number matters."
- **No vertical gridlines**; only horizontal hairlines or pure whitespace separate rows.

## 8. Org Charts / Hierarchy Diagrams — from PPT Toolbox

- Top node: solid Dark Blue rounded rectangle, white text, with a circular avatar/person icon inset.
- Second tier (department heads): solid bright blue (Royal/Cobalt) pill-shaped labels.
- Connectors: dotted grey lines (not solid), right-angled, never diagonal.
- Person nodes below department level: circular blue avatar icon (person silhouette) with name + role as plain text underneath, regular weight, centered.

## 9. General Layout Principles

- **Simplicity**: minimal asset set, lots of whitespace, content kept clean and uncluttered ("less is more").
- **Movement**: convey motion via gradients, layered/angled triangles, and diagonal compositions rather than static centered layouts.
- **Freedom within rules**: creative combination of the core shapes/colors is encouraged, but never outside the defined palette, typeface, or logo rules.
- Slide/page header pattern: small grey breadcrumb-style label (e.g. "Visual Identity") above a larger bold title (e.g. "Color") — replicate as a section-label + H1 pairing in HTML.
- Footer pattern: logo (small, left-aligned) + thin vertical divider + secondary text (e.g. document name), page number bottom-right.

## 10. Quick Reference Checklist (for UI review)

- [ ] Background/dominant surface uses Masterbrand Blue `#000E9C` or White, not an arbitrary blue
- [ ] Body text is Source Sans Pro Regular, left-aligned, sentence case
- [ ] Headlines are Source Sans Pro Bold/Black
- [ ] Accent colors (yellow/orange/green/sky blue) used only on CTAs, links, or single highlighted data points
- [ ] Charts use the dark→light blue sequence, flat fills, no 3D/gradient bars, labels above bars/outside segments
- [ ] Tables have a solid blue header row, zebra-striped body, no vertical gridlines
- [ ] Triangle motif present somewhere in decorative elements, not a competing shape (circles-as-accent, stripes, etc.)
- [ ] Logo (if present) has correct clear space, isn't recolored/skewed, uses white version on dark backgrounds

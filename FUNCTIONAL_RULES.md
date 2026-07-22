# Functional rules — OVHcloud project reports

Living document. These are business/product rules agreed with the project owner over the course
of development — not derivable from the code alone, and easy to silently regress during a
refactor. The QA agent reads this file as part of its audit: a behavior that contradicts a rule
below is a real bug even if the code is internally consistent by its own logic.

When a new functional rule is agreed with the user, add it here in the same change.

## Inherited from project-report (legacy static app)

project-reports-app is a full rewrite (dynamic multi-project app vs. a hand-maintained static
`index.html`) — there is no git history to merge, so rules already settled on project-report had
to be re-applied here by hand rather than resolved by merging code:

- No "no jira" badge/indicator next to a workstream's status. project-report dropped this
  between its early iterations and its current state; the matrix shows the status alone.
- Report typography follows project-report's sizes, not whatever project-reports-app started
  with — project-report's font-sizes were a deliberate, later adjustment (mostly a size increase
  over the initial pass) and are the reference. Elements that only exist in project-reports-app
  (e.g. the in-report back-link/week-nav header, the "No dates yet" Planning label) have no
  project-report equivalent to match and keep their own sizing.

## Data sources — matrix vs. Planning

- The **Deliverable matrix** comes exclusively from the project's Confluence page, "Deliverables
  status" section. It must stay strictly 1:1 with that table's rows — never split or duplicate a
  row (e.g. because a cell references more than one Jira epic).
- If a workstream's "Jira" cell embeds more than one `{jira}` macro (a workstream backed by
  several epics), every one of them drives that single row's status — never just the first, and
  never split into extra rows. The roll-up uses the same precedence as the deliverable-level
  roll-up: Done only if *all* its epics are Done, otherwise Blocked if any is Blocked, otherwise
  In Progress if any is In Progress, otherwise To Start. Example: 4 epics Done + 1 In Progress ⇒
  the workstream shows In Progress, not Done.
- A workstream with no Jira epic at all gets its status from a manually-set Confluence status
  lozenge in the same "Jira" cell instead (a PM types the status by hand when there's nothing to
  link to Jira for). The lozenge's colour is decorative only — only its title text is the status
  ("done"/"ongoing"/"to do" observed in practice; "ongoing" maps to In Progress alongside the
  usual "progress"/"review"/"dev" synonyms). Never let the lozenge's colour parameter leak into
  the extracted text — it will silently break the exact-match status lookup.
- The **Executive summary** must preserve a PM's manual bold/italic/underline emphasis from the
  Confluence page — it is not flattened to plain text like the rest of the parsed content. Any
  other Confluence-sourced formatting/markup is still discarded; only these three inline styles
  survive, and only via an escape-then-restore path (see confluence.js's stripTagsKeepEmphasis /
  report-gen.js's escKeepEmphasis) — never by trusting raw HTML from Confluence directly.
- The **Planning / Gantt** section must show the exhaustive set of **epics** (never tasks) under
  the project's root LVL2 epic, whether or not each one is listed on the Confluence page. This is
  computed via a recursive portfolio JQL (`portfolioChildrenOf`) that walks the Advanced
  Roadmaps/BigPicture hierarchy at arbitrary depth — not a fixed number of levels.
- A project can pin extra Jira keys (`extra_epics` field, Edit page) that always appear in
  Planning even though they belong to a different LVL2 program entirely and have no automatic
  hierarchy link back to this project's root epic.
- **A cancelled epic (Jira status "Cancelled" or "Canceled" — this instance's workflows use both
  spellings depending on the project) never appears in Planning.** Filtered against the raw Jira
  status, not the done/prog/blk/ts bucket `mapStatus` produces — once mapped, a cancelled epic is
  indistinguishable from a plain "To Start" and silently passes through as one. This exact bug
  shipped once (a stale, dead `status !== 'cancel'` check in report-gen.js compared against a
  bucket value `mapStatus` can never produce).
- If an epic has no Start/End date filled in (Jira "Start date"/"End date" fields), it is left
  with no date — never a fabricated fallback (no fallback to duedate, created, resolutiondate, or
  baseline dates). It still gets a row in Planning (name, team, status) so it stays visible and
  "exhaustive" holds — it just has no bar drawn on the Gantt timeline, since there's nothing to
  plot without real dates.
- A sync (Confluence or Jira) must reconcile the workstream/epic list, not just add/update: any
  row the current parse/query no longer produces is deleted. An upsert-only sync would let stale
  rows outlive whatever created them (e.g. a since-fixed parser bug, or an epic removed from a
  team's plan) and silently reappear or linger in the matrix/Planning.
- Planning epics are ordered purely chronologically by end date (ascending), across all teams —
  never grouped by team first, never alphabetical/key order. Epics with no end date sort last.
  A timeline view must read top-to-bottom as earliest-to-latest.

## Report export

- There is no PDF export. A "⬇ Export PDF" button existed, using the browser's native
  print-to-PDF (`window.print()` driven by `@page`/`@media print` CSS on the report document) —
  removed because the rendered output wasn't good enough to keep. If this comes back as a request,
  don't just re-add the same print-CSS approach without addressing why it looked bad first; a
  server-side renderer (headless Chromium) is the likely alternative, at the cost of that dependency
  shipping in the production image.

## Risks

- A risk whose Confluence Status is **Closed** must never appear in the report — by definition the
  issue is already resolved, so it has nothing to report on for the current week.
- Risk level (High/Medium/Low) is read from the status-macro title in the "Score" column.

## Project health badge (On Track / At Risk / Delayed)

- **At Risk and Delayed are not the same thing and must not be merged.** At Risk is a projection —
  workstream progress (any Blocked workstream, or more than 60% still "To Start") or the risk
  register (any risk at level `high`) suggesting the target date *might* slip. Delayed is a fact —
  the root epic's End date has *already* moved later than the previous existing report's own
  frozen date. A confirmed slip is strictly more informative than a risk signal, so **Delayed takes
  precedence over At Risk** when both would otherwise apply; it is never downgraded to "At Risk"
  just because that's also true. The date moving *earlier* has no effect either way — only a slip
  counts, and it never produces "On Track" either (a project isn't back on schedule just because a
  later date happened to arrive before an even-later one).
- The delayed-date check is frozen into the report at generation time (`reports.eta_delayed`,
  compared against the nearest earlier existing report's `eta_snapshot`, both raw ISO dates — not
  the display-formatted `projects.eta`), same reasoning as the workstream/epic snapshots: a report
  must render the same way on every future view, not re-derive a verdict from whatever the epic's
  date happens to be by the time someone looks at it. A row with no earlier report to compare
  against, or no End date on either side, is never delayed — there's nothing to have slipped from.
- The **displayed** "Target ETA" value on a report is the report's own frozen `eta_snapshot`, never
  the live `projects.eta` — the same freezing reasoning as the delayed check itself, but this was
  missed once: `projects.eta` gets overwritten on every generate, so rendering it directly made
  every past week's report silently show today's current date instead of the target that actually
  applied back when that week was generated. A legacy row from before `eta_snapshot` existed shows
  "TBD" rather than falling back to the live value, which would just reintroduce the same bug.
- Whenever the badge reads Delayed, the report also shows a small "⚠ Previous date: {{previous
  date}}" note under Target ETA — the badge itself already says "Delayed", so the note states the
  prior date as a fact rather than repeating "delayed" a second time; without it the note would
  look like an unexplained black box.
- Delayed renders as a filled pill (reusing the `risk-badge.high` treatment), not the plain
  dot+text the other two states use — visually more definite, on purpose, without inventing a new
  color.

## Report generation

- The root epic's End date (`projects.eta`) is re-read from Jira on every generate/regenerate, not
  only on project creation/edit — the week-over-week delay check above needs it to actually track
  the source on its own schedule, same as workstreams/epics already do on every generate.

- A weekly report is never edited by hand. Its entire content (exec summary, achievements/
  blockers/clarify, risks, epic/workstream statuses) is pulled from Confluence and Jira, but only
  at the moment it's generated or explicitly regenerated — never recomputed from live data on a
  plain view.
- **A generated report is a frozen snapshot, permanently.** The full resolved workstream matrix
  (with status) and Planning epic list are captured into the report row at generation time
  (`workstreams_snapshot_json`/`epics_snapshot_json`) and read back as-is on every later view.
  Viewing an old week must never reflect a workstream added afterward, a status that changed
  since, or an epic removed later — only regenerating that specific week is allowed to refresh it.
  This was a real, shipped bug once: the matrix/Planning were being rebuilt from the live
  `workstreams`/`epics_cache` tables on *every* view regardless of week, so a workstream added (or
  a status changing) today silently changed how *every past report* rendered too. A handful of
  legacy rows generated before this existed have no snapshot (`workstreams_snapshot_json IS
  NULL`) — those still fall back to live data seeded with whatever their old
  `workstream_statuses_json` override map covers, because there is no way to reconstruct their
  true historical state after the fact.
- Navigating to or generating a report for a future ISO week is always blocked.
- **Only the current ISO week can be regenerated.** The action is labelled "↻ Refresh" (renamed
  from "Regenerate" — clearer, and matches the term users already expect from other tools) and
  appears in two places for the current week's owner: the per-week row on the project's report
  list, and the report document's own header (next to "Export PDF"). A past week that already has
  a report is permanently locked — neither button renders for it (on the report page, the check is
  `isOwner && isCurrentWeek`, not just `isOwner`), and the route rejects the request server-side too
  if reached another way (the editable week field on the "Generate" form, for instance). This is a
  deliberate reversal of the earlier "fix at the source, then regenerate" rule: that correction path
  is gone for anything but the current week, in exchange for past reports never being silently
  rewritable by anyone, ever. A past week that has *no* report yet can still be generated for the
  first time (backfilling a missed week) — there's
  no frozen state to protect there.

## Project onboarding & editing

- A Confluence page is mandatory at project creation and must match the required structure
  ("Deliverables status", "Week summary", "Risk matrix" sections with their expected tables). A
  format mismatch produces an explicit, actionable error — never a silently empty project.
- Any common Confluence URL shape is accepted (`/display/SPACE/Title`, or a `pageId=` link).
- A project's target ETA always comes from its root Jira epic's "End date" field — it is never
  typed in manually, at creation, on edit, or on generate/regenerate (see Report generation).
- Editing a project (name, root epic, Confluence page, extra epics) does not itself resync
  workstreams — the "Generate report"/"↻ Refresh" action on the project page does that (it
  refreshes the Confluence-backed matrix and Jira/Planning epics, then generates the report, all
  in one click — there are no separate Sync Jira/Sync Confluence buttons; a version that had them
  existed briefly but they had no visible effect on the page and read as broken).
- Renaming a project never changes its slug (the stable URL identifier).
- The New project form keeps each step label short and puts the longer explanation (what the field
  is for, which Jira/Confluence field feeds it) behind a "?" tooltip (`.hint`/`.hint-btn`/
  `.hint-bubble`) rather than an always-visible paragraph — the page should read as four short
  steps at a glance, not a wall of text. The "template page" warning stays visible (it's a
  necessary caveat, not background detail). A large animated Suricate mascot sits next to the form
  on desktop (hidden below 900px, and respects `prefers-reduced-motion`) — purely decorative, first
  impression for a new project manager.

## Visibility & permissions

There is no roles/admin system, and none is planned for the POC phase — deliberately, to keep the
access model trivial to reason about. There is exactly one distinction: **the creator of a project
(`projects.user_id`) vs. everyone else.**

- Every authenticated user can see every project: the dashboard (`/`) lists all projects org-wide,
  not just the current user's own, and a project's report-history page (`/projects/:slug`) opens
  for anyone, matching the already-existing rule that the report view itself
  (`/projects/:slug/:yearweek`) has no ownership check (see Security, shared-link rule below). A
  weekly report is routinely shared by link with people who don't own the project — hiding the
  page that lists the *other* weeks, or the dashboard entry that leads there, behind ownership
  produced a broken-feeling dead end for exactly those people while the report itself was already
  world-viewable to any logged-in user.
- Only the creator can mutate a project: edit its settings, delete it, or generate/regenerate a
  report. Every mutation route re-checks `user_id` itself (not just the UI) — hiding a button for a
  non-owner is a courtesy, not the actual guard. A non-owner is shown the project's owner name
  (`owner_name`, joined from `users`) instead of edit/generate/delete controls, so they know who to
  ask for a change.
- This intentionally does not distinguish "admin" from "user" — every account created via login is
  equally privileged, scoped only by what it created. Introducing real roles is out of scope until
  after the POC is validated.

## Error handling

- No raw technical error (HTTP status, JSON payload, stack trace, auth/token detail) is ever shown
  to a user. Every caught error is classified (`AppError` + a stable code) and translated into an
  actionable sentence in the user's language; anything unclassified falls back to a generic
  apologetic message. The raw error is still logged server-side.

## Internationalization

- French is the default language; an FR/EN toggle persists the choice via a cookie.
- The site name ("Suricate") and its tagline ("OVHcloud project reports") are never translated —
  identical in both languages. The tagline appears alongside the name on the login page; elsewhere
  (nav, browser tab titles) only "Suricate" is shown, to keep tight spaces (the nav bar, a browser
  tab) uncluttered.
- Content sourced from Jira/Confluence (ticket text, summaries, mitigation notes, etc.) is not
  translated — only the app's own interface (labels, buttons, instructions, application error
  messages) is.

## Navigation

- **One `.app-nav` bar, used identically on every authenticated page** — dashboard, project
  detail/edit/new, and the weekly report. It always carries the same things in the same place: the
  logo (linking home, the standard "click the logo" convention) separated from the "Suricate" name +
  "OVHcloud project reports" tagline by a thin `.brand-divider` line, the FR/EN language switch, and
  Logout — no "Projects" link, since the logo already goes home and a dedicated nav item for it
  added nothing. The weekly report used to render its own separate header (different height, a
  bigger logo with no home link, no brand/tagline, no language switch, no logout) — that drift is
  exactly what made the two headers inconsistent, so the report page now links `/app.css` and
  reuses the same nav/page-header classes instead of maintaining a parallel implementation,
  including the same `.app-body` width/padding (it used to be wider, `.doc-body` at 1100px vs.
  `.app-body`'s 1000px, which is exactly the kind of drift a shared class prevents).
- `.brand-divider` is a shape-only class (a 1px line stretching to the row's height) — its color is
  set by context: translucent white in `.nav-brand` (navy background), `var(--bd)` in `.auth-brand`
  (white background). It hides below 700px width so the header doesn't crowd on mobile.
- Page-specific "back" breadcrumbs (e.g. "← Projects" on project detail, "← {{project name}}" on
  the edit form, "← All reports" on a report) live in the body's `.page-header`, styled with the
  shared `.back-link` class — not inside `.app-nav` itself. Different pages legitimately go back to
  different places (dashboard vs. the specific project), so the destination/label varies, but the
  visual treatment (arrow glyph, color, position above the page title) must not.
- The login page is the one intentional exception: it has no `.app-nav` (there's no session yet, so
  logout/username don't apply) and no Projects link either, just a standalone language switch — but
  it shares the same logo/divider/name/tagline lockup (`.auth-brand`), sized larger, since this is
  the first screen a new project manager sees and it's meant to read as a landing page, not a bare
  form.

## Responsive / mobile

- Below 700px, `.app-nav` drops the tagline and the username (not essential — the brand name alone
  still identifies the app, and a logged-in user already knows who they are) rather than letting
  `.app-nav`'s `overflow:hidden` silently crop whatever full-width content didn't fit.
- The Planning/Gantt section is desktop/tablet-only: below 700px it's replaced by a note pointing
  the reader to view the report on a larger screen, rather than trying to make a many-month
  timeline usable at phone width (attempted via its existing horizontal scroll container, but
  scrolling a chart sideways inside a page that also scrolls vertically is a poor mobile
  experience) or hiding it behind an expand toggle (a collapsed Gantt still isn't usable once
  opened on a phone, so there's nothing gained by making it reachable).
- The exec summary is truncated to 4 lines with a "Read more" toggle below 700px, but only when it
  exceeds 240 characters — a short summary is shown in full with no button, since there's nothing
  to truncate and an inert "Read more" that expands nothing would just be confusing.

## Security

- Login only accepts an *exact* email match against Jira — no fuzzy-search fallback to an
  arbitrary result.
- No hardcoded session secret: the app refuses to start if `SESSION_SECRET` is unset.
- Any Jira/Confluence-sourced content injected into client-side HTML (e.g. the Gantt) is escaped
  before insertion.
- **A shared report link must land a logged-out visitor back on that exact link after login** —
  never a hardcoded redirect to `/`. Report links are meant to be shared with colleagues who don't
  own the project (the report route itself has no ownership check, by design), so the login round
  trip is often someone's very first visit; dumping them on their own dashboard afterward (empty,
  if they've never created a project) reads as "I don't have access" even though nothing was ever
  actually blocked. `requireAuth` passes the original URL as `?returnTo=`, carried through the
  login form and back out on success — `safeReturnTo()` only ever accepts an internal path (never
  an absolute or protocol-relative URL) so this can't become an open redirect.

## Accessibility

Target: WCAG 2.2 Level AA. Concrete, checkable thresholds — not "make it accessible" in the
abstract — so a QA pass can actually verify pass/fail instead of eyeballing it.

- **Text contrast (1.4.3)**: at least 4.5:1 for normal text; 3:1 is only acceptable for large text
  (≥18pt/24px, or ≥14pt/18.66px if bold).
- **Non-text contrast (1.4.11)**: at least 3:1 for UI component boundaries/states (button fills
  and borders, form field borders, icons that carry meaning) against their *adjacent* colors — not
  just the text/glyph sitting on top of them. A translucent-white overlay at low opacity (e.g.
  ~.18-.28) on a dark background often still passes a quick glance but computes under 3:1 and
  reads as "invisible" in practice. This exact failure mode has shipped three times now — the PDF
  export button and week-nav arrows were both under ~1.5:1 against the (then-navy) report header;
  later the `.nav-link` hover/active fill in `.app-nav` at .1 opacity had the same problem; then,
  after the week-nav arrows moved to the light page-header, their border was left at `var(--bd)`
  (#C8CAD4), which computes under 1.7:1 against white — a *light* border on a *light* background is
  the same underlying mistake as a translucent fill on a dark one. Compute the actual ratio before
  shipping any border/fill treatment; don't eyeball it, and don't assume a value that passed once
  in one context (dark bg) still passes after the surrounding context changes (light bg).
  - Prefer reusing an established, already-legible pattern over inventing a new translucent one:
    the yellow CTA fill (`var(--yellow)` background, `var(--db)` text) used for every primary
    action elsewhere in this app computes at ~10.9:1 and is the brand's own reserved "primary CTA"
    color — reach for it before designing a new low-contrast variant.
- **Focus indicators (2.4.7 Focus Visible / 2.4.11 Focus Appearance)**: every focusable element
  (link, button, form field) needs a visible focus indicator, and that indicator itself needs
  ≥3:1 contrast against whatever it sits next to. Never `outline:none`/`:focus{outline:0}` without
  a replacement indicator of equivalent visibility.
- **Focus not obscured (2.4.11 in 2.2)**: a focused element must not be entirely hidden behind the
  sticky nav bar or any other overlay — relevant here since `.app-nav` is `position:sticky`.
- **Target size (2.5.8, new in WCAG 2.2)**: interactive targets should be at least 24×24 CSS px.
  Directly relevant to this app's icon-only buttons (🗑 delete, ✎ edit, the FR/EN language links) —
  check their actual clickable box, not just the glyph's visual size.
- **Labels, not placeholders**: every form input needs a real associated `<label>` (or
  `aria-label`) — a placeholder alone is not an accessible name and disappears the moment the user
  types.
- **Keyboard operability**: every action reachable with a mouse must also be reachable via
  keyboard alone, in a logical tab order, with no keyboard trap.
- **Color is never the only signal**: a status (Done/Blocked/In Progress/To Start, On Track/At
  Risk) must keep its text label alongside its color — already the pattern in this app's
  matrix/health badge; don't regress it by ever rendering status as a bare color swatch.

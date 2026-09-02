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
- A deliverable spanning several workstreams merges its leading cell with `rowspan` in Confluence's
  table, which then omits that cell entirely from every row after the first. `parseDeliverables`
  (confluence.js) detects "this row starts a new deliverable" by comparing the row's cell count to
  the header row's — a full-width row carries the deliverable name, a one-cell-short row continues
  the previous deliverable — rather than assuming the deliverable cell is a `<th>` (some pages still
  format it that way and are checked as a fallback, but many don't). Getting this wrong either
  merges every deliverable into one, or — if the header row itself isn't correctly skipped —
  inserts a fake workstream from the header's own column labels ("Workstream"/"Team owner") at the
  top of the matrix.
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
- **A paused Jira epic status maps to In Progress, not To Start.** `mapStatus` (jira.js) buckets
  any status containing "pause" into `prog`. Work that has started and been paused is not the same
  as work that hasn't started; the default fall-through bucket (`ts`) would misreport it.
- **An "On Hold" Jira epic status maps to Blocked, not In Progress.** Unlike "Paused", "On Hold"
  reads as stalled/waiting-on-something rather than a work-in-progress pause, so `mapStatus` buckets
  any status containing "hold" into `blk` alongside "Blocked"/"Impediment".
- The **Deliverable matrix** shows each workstream's **End Date**, taken from its backing epic's
  Jira "End date" field — same source as everything else date-related in this app, never typed in
  manually. A workstream backed by several epics (see the multi-epic rule above) shows the
  *farthest* (latest) End date among them — it isn't actually finished until the last one is, so
  that's the one date worth surfacing on that row. A workstream with no Jira epic, or whose epic(s)
  have no End date set, shows "No date" — never a fabricated fallback, same "no date beats a wrong
  date" rule the Planning/Gantt epics already follow.
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

- **PDF export (re-added) renders the exact live report page server-side, never a separate
  print-CSS template.** The first "⬇ Export PDF" attempt used the browser's native print-to-PDF
  (`window.print()` + `@page`/`@media print` CSS) and was removed — a print stylesheet is a
  *second* layout to keep in sync with the real one, and it drifted (broken page breaks, a
  half-drawn donut chart). The current approach: `GET /projects/:slug/:yearweek/pdf` (server.js)
  launches a headless Chromium (`puppeteer-core`) and navigates it, over loopback, to the app's own
  live report URL — carrying the requesting user's session cookie so that internal request still
  goes through the same `requireAuth`/visibility rules as any other view — then calls `page.pdf()`.
  Because it's the same route and the same `buildReportHtml()` the browser renders, the PDF cannot
  structurally drift from the on-screen report the way a parallel print template could.
- Available to any viewer, not just the project owner — exporting is a read, same visibility rule
  as viewing the report itself (see "Visibility & permissions"). Not available for a week with no
  report row at all (404) — there's nothing to export, and it deliberately doesn't trigger a
  generate-on-demand the way visiting the HTML report page does.
- The donut chart and the Planning/Gantt timeline both draw themselves via a page-load `<script>`
  (canvas + a `requestAnimationFrame` sweep-in animation) — `page.goto`'s `networkidle0` fires
  before that animation settles, so the PDF route waits an extra fixed delay after navigation
  before calling `page.pdf()`, or it would capture a half-drawn chart.
- **Known fidelity gap: fonts.** `report-gen.js`'s `@font-face` rules use `local('Source Sans
  Pro')` — they only resolve to the true typeface if it happens to be installed on the *viewing*
  machine, falling back to `'Segoe UI', Arial, sans-serif` otherwise (true for most viewers
  already, since Source Sans Pro isn't a common OS-bundled font). Alpine's headless Chromium (see
  Dockerfile: `chromium` + `ttf-freefont`/`font-noto` packages, no glibc/Puppeteer-bundled
  Chromium — that binary doesn't run on this musl-based image) has neither Source Sans Pro nor
  Segoe UI available, so it falls back one level further to a generic Linux sans-serif. The PDF is
  therefore not always byte-identical in typeface to what a given viewer sees on their own screen
  — layout/content fidelity is exact, font *substitution* can differ slightly. Self-hosting actual
  Source Sans Pro font files (instead of relying on `local()`) would close this gap for the live
  page too, not just PDF export, but is a separate change, not bundled into this one.

## Risks

- A risk whose Confluence Status is **Closed** must never appear in the report — by definition the
  issue is already resolved, so it has nothing to report on for the current week.
- Risk level (Extreme/High/Medium/Low) is read from the status-macro title in the "Score" column.
  **Extreme is its own level, not folded into High** — Confluence's risk matrix scores on a
  Yellow/Orange/Red scale where Red = Extreme is a step above Orange/Yellow = High, and collapsing
  them would understate the report's most severe risks as merely "High" like everything else. It
  gets a visually distinct filled badge (report-gen.js `.risk-badge.extreme`) for the same reason
  Delayed gets a filled badge instead of reusing At Risk's — a more severe/definite state should
  look more severe, not identical to the tier below it.

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
  first time (backfilling a missed week) — there's no frozen state to protect there.
- **A past week with no report is never generated by mere navigation.** Only the *current* week's
  first-time generation happens automatically on visit (accurate, since it reflects today's data
  for today's week). Visiting a past week that was never generated (e.g. 3 weeks skipped over a
  vacation) instead shows a purely informational "No report for this week" page — no generate
  button there, by design, so landing on it via a week-nav arrow can never itself trigger a
  backfill. This used to auto-generate silently, which was actively misleading: the matrix, risk
  register and ETA delay check are never versioned per week (see the frozen-snapshot rule above and
  the health-badge rule below) — the live state and the risk register only ever reflect *today*, so
  a report auto-created weeks late looked identical to the current week instead of to whatever was
  actually true back then, with nothing on the page hinting it wasn't a real point-in-time record.
  Backfilling that week is still possible, but only as a deliberate action elsewhere: typing its
  week number into the "Generate report" field on the project's report list (owner-only).
- **Any report generated for an already-past week carries a permanent "backfilled" notice**
  (`reports.backfilled`, set once at that row's first INSERT and never touched again — a past week
  can never be regenerated, so there's nothing to re-evaluate later). The notice is baked into the
  report itself (report-gen.js), not just shown as a one-time warning on the generate button, so
  anyone reading it later — even as a standalone export or screenshot — knows it's an after-the-fact
  reconstruction from whatever Confluence/Jira looked like on the generation date, not a genuine
  record of that week. The project's report list also tags a backfilled row so the gap-fill is
  visible in the history, not just on the report itself.
- The project's report list shows every ISO week between the earliest existing report and the
  current week, not only weeks that actually have one — a skipped week renders as a muted "No
  report" row instead of silently vanishing from the list. Weeks before the project's first report
  are not back-filled with "No report" rows; there's nothing missing there, the project simply
  didn't exist yet.

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
- **A Confluence 404 with `"authorized":false` in its own response body gets a distinct,
  retry-first message (`confluence_auth_blip`), not the generic "check your URL/rights"
  (`confluence_not_found`).** Confluence returns 404 — not 401/403 — when the service token isn't
  authorized to even see a space/page exists, a security-through-obscurity choice on Confluence's
  side. Observed in production (Managed Backup for VMware, 2026-08-31) as a burst of ~14 identical
  failures within a 90-second window that then fully resolved on its own — a short-lived
  auth/session blip, not a wrong or moved page. Telling the PM to go re-check their project's
  Confluence URL over what's usually transient sent them chasing a non-problem; the message now
  says to just retry, and only suggests checking access rights if it keeps happening.

## Cleanup (tracking-quality check)

- **Cleanup checks the same epic data that feeds Planning, on purpose.** It reads live from
  `epics_cache`, which only holds real Jira "Start date"/"End date" (no baseline/duedate
  fallback — see Report generation's Planning rule) and is only as fresh as the last
  "↻ Refresh"/Generate action (`refreshFullEpicTree`, i.e. `getPortfolioEpics` — the same
  exhaustive, arbitrary-depth portfolio walk Planning uses, already excluding
  Cancelled/Canceled epics). Fixing what Cleanup flags therefore also fixes what Planning
  and the Deliverable matrix show — that's the whole point of putting it here rather than as
  a separate standalone tool.
- **No separate sync button.** Same reasoning as the Sync Jira/Sync Confluence buttons that
  were removed project-wide (see Project onboarding & editing) — Cleanup reuses the existing
  Generate/Refresh form as-is (shown on the Cleanup page too when the viewer is the owner)
  instead of introducing its own refresh action.
- **Three severity tiers**, mirroring the sibling "JIRA Cleanup" Webex bot
  (jira-hygiene-report): 🔴 High priority (overdue; not started despite a past start date;
  inconsistent dates — actual tracking problems, always listed individually) is distinct
  from 📅 Upcoming deadlines (due within 14 days — not a problem, a perfectly healthy epic
  can land here purely because it's closing soon; kept in its own section so it never reads
  as something broken) and from 🟡 Remaining (missing assignee/start/end date — real hygiene
  debt, but not urgent, so it's collapsed to a per-team count + a live Jira JQL link rather
  than listed epic-by-epic).
- **Missing-metadata checks (🟡) are skipped once an epic's `mapStatus` bucket is `done`** —
  closed work doesn't need its dates or assignee backfilled. This reuses `jira.mapStatus`'s
  own done/in-progress/blocked/to-start buckets (the same ones driving the Deliverable
  matrix and health badge) rather than Jira's raw status, so paused/on-hold epics keep this
  app's already-agreed semantics instead of a generically re-derived one.
- **The "responsible" contact shown is the assignee, falling back to the reporter** when the
  assignee is empty — but the "no assignee" finding itself always fires on a genuinely empty
  assignee, regardless of that display fallback (a reporter existing does not hide the
  finding — the fallback is only about who to show as a contact, not whether the epic has an
  anomaly).
- **Visible to every authenticated user, no ownership check** — same rule as the
  project-detail and report-view pages (see Visibility & permissions): it's read-only, and a
  weekly report is routinely shared with people who don't own the project.

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
- **Week navigation (`.week-nav`: previous/current/next) always sits in the same spot — the
  top-right of `.page-header`, next to the back-link — on every week-scoped page**, whether it's an
  actual report or the "No report for this week" page. Both pages link the same shared
  `.week-nav`/`.week-arrow`/`.ref-week` rules from `app.css` rather than each defining or
  positioning its own copy, specifically so a PM clicking through consecutive weeks doesn't have the
  control jump to a different spot depending on whether that particular week happens to have a
  report or not.

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

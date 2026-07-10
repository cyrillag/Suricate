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

## Report export (PDF)

- PDF export is the browser's native print-to-PDF (a "⬇ Export PDF" button calling
  `window.print()`), driven by `@page`/`@media print` CSS on the report document — not a
  server-side renderer. Deliberate: a headless-Chromium dependency would have to ship inside the
  production image just for this one feature, for something every browser already does reliably.
  Don't reach for a server-side PDF library without a concrete reason the print path can't solve.
- Anything animated (the status donut) must render its finished state on a `beforeprint` listener,
  not just on its own timer — printing can be triggered before the animation starts or finishes
  (the button, or a plain Ctrl+P), and a PDF must never capture a half-drawn or blank chart.

## Risks

- A risk whose Confluence Status is **Closed** must never appear in the report — by definition the
  issue is already resolved, so it has nothing to report on for the current week.
- Risk level (High/Medium/Low) is read from the status-macro title in the "Score" column.

## Project health badge (On Track / At Risk)

- The badge must reflect **both** workstream progress (any Blocked workstream, or more than 60%
  still "To Start") **and** the risk register: any risk at level `high` also forces the badge to
  At Risk. A project with an open High risk can never show "On Track", regardless of how far along
  its workstreams are.

## Report generation

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
- **Only the current ISO week can be regenerated.** A past week that already has a report is
  permanently locked — the "↻ Regenerate" button doesn't even render for it, and the route
  rejects the request server-side too if reached another way (the editable week field on the
  "Generate" form, for instance). This is a deliberate reversal of the earlier "fix at the source,
  then regenerate" rule: that correction path is gone for anything but the current week, in
  exchange for past reports never being silently rewritable by anyone, ever. A past week that has
  *no* report yet can still be generated for the first time (backfilling a missed week) — there's
  no frozen state to protect there.

## Project onboarding & editing

- A Confluence page is mandatory at project creation and must match the required structure
  ("Deliverables status", "Week summary", "Risk matrix" sections with their expected tables). A
  format mismatch produces an explicit, actionable error — never a silently empty project.
- Any common Confluence URL shape is accepted (`/display/SPACE/Title`, or a `pageId=` link).
- A project's target ETA always comes from its root Jira epic's "End date" field — it is never
  typed in manually, at creation or on edit.
- Editing a project (name, root epic, Confluence page, extra epics) does not itself resync
  workstreams — the "Generate report"/"↻ Regenerate" action on the project page does that (it
  refreshes the Confluence-backed matrix and Jira/Planning epics, then generates the report, all
  in one click — there are no separate Sync Jira/Sync Confluence buttons; a version that had them
  existed briefly but they had no visible effect on the page and read as broken).
- Renaming a project never changes its slug (the stable URL identifier).

## Error handling

- No raw technical error (HTTP status, JSON payload, stack trace, auth/token detail) is ever shown
  to a user. Every caught error is classified (`AppError` + a stable code) and translated into an
  actionable sentence in the user's language; anything unclassified falls back to a generic
  apologetic message. The raw error is still logged server-side.

## Internationalization

- French is the default language; an FR/EN toggle persists the choice via a cookie.
- The site name ("OVHcloud project reports") is never translated — identical in both languages.
- Content sourced from Jira/Confluence (ticket text, summaries, mitigation notes, etc.) is not
  translated — only the app's own interface (labels, buttons, instructions, application error
  messages) is.

## Security

- Login only accepts an *exact* email match against Jira — no fuzzy-search fallback to an
  arbitrary result.
- No hardcoded session secret: the app refuses to start if `SESSION_SECRET` is unset.
- Any Jira/Confluence-sourced content injected into client-side HTML (e.g. the Gantt) is escaped
  before insertion.

## Accessibility

- Any interactive element (button, link, arrow) placed on a colored surface (the navy header,
  brand-colored cards) must have a real, computed contrast ratio for its own visible
  boundary/fill — not just for the text/icon sitting on top of it. A translucent-white overlay at
  low opacity (e.g. ~.18-.28) on a dark background often still passes a quick glance but computes
  under WCAG 1.4.11's 3:1 non-text minimum and reads as "invisible" in practice (this exact bug
  shipped once — the PDF export button and week-nav arrows were both under ~1.5:1 against the
  report header). Compute the actual ratio (or push opacity clearly past ~.3 fill / .5 border)
  rather than eyeballing it.
- Prefer reusing an established, already-legible pattern over inventing a new translucent
  treatment: the yellow CTA fill (`var(--yellow)` background, `var(--db)` text) used for every
  primary action elsewhere in this app computes at ~10.9:1 and is the brand's own reserved
  "primary CTA" color — reach for it before designing a new low-contrast variant.

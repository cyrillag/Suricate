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
- **Paused is a status of its own (`paus`, "Paused")**: work that started, then stopped for lack of
  input or because it was deprioritized — Jira's **"Waiting"** status. `mapStatus` (jira.js) maps
  any status containing "wait" or "pause" to it (so a Confluence lozenge typed "paused" works too),
  checked before the In Progress synonyms so "Waiting for review" isn't read as In Progress.
  **Exception: "Waiting for release" / "Waiting for deploy" maps to In Progress** — the work is
  done and only awaits going live, which isn't a pause (agreed with the PMs, 2026-09-29; it used to
  fall through to To Start, which was wrong too). It used
  to be folded into In Progress, which overstated activity; it isn't To Start either (it did start),
  nor Blocked (deprioritizing is a choice, not a problem) — so **it doesn't flip the health badge to
  At Risk**, only Blocked workstreams and High/Extreme risks do.
  - **Roll-up (one shared rule, `status.js`'s `rollupStatus`, for workstreams, deliverables and
    Planning Light parents alike):** Done only if every child is Done, otherwise Blocked > In
    Progress > Paused > To Start. A deliverable with one paused and one active workstream is still
    In Progress; one with a paused and a not-yet-started workstream is Paused.
  - Shown as light blue (OVHcloud Light Blue `#4AB0F5`), striped with a Royal Blue edge on Gantt
    bars — a variant of the In Progress blue — with `#1A6FB0` for the text label (5.3:1 on white).
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
- **Exception to "exhaustive": an epic that already ended more than 6 months ago is dropped from
  Planning entirely** (`report-gen.js`) — long-finished history clutters a weekly status view
  without helping anyone judge what's happening *now*, and it was also dragging the Gantt's own
  start date (and so its whole header) further into the past the older a project got. Evaluated
  against *today*, at view time — same read-time framing as the "Today" marker itself, not frozen
  to the report's own week, so an old report viewed later declutters the same way a fresh one does.
  Never filters on Start date alone: an epic with no End date stays regardless of how long ago it
  started, since without an End date it isn't finished, so it isn't "history" yet either.
- **Retired**: a project could pin extra Jira keys (`extra_epics` field, Edit page) that always
  appeared in Planning even though they belonged to a different LVL2 program entirely and had no
  automatic hierarchy link back to this project's root epic. Removed (field, column, and the JQL
  `extraKeys` plumbing in `jira.getPortfolioEpics`) once it became clear it was a manual workaround
  for the same problem a planned future change addresses properly: reading Planning's scope
  directly from the project's own BigPicture box scope definition (already configured by the team
  there, e.g. `.../softwareplant-bigpicture/#/box/<BOX-KEY>/settings/tasks/scope-definition`) rather
  than the current JQL portfolio walk — not yet implemented, but a manual pin list would only get
  more redundant once it is.
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
- **An epic with only ONE of Start/End set** (seen in practice: an End date filled in with no
  Start date) still sorts correctly — the ordering rule above is keyed on End date alone, and this
  epic has one. It gets a fixed-width bar anchored on that one known date, fading to transparent
  toward the unknown side (`.gantt-bar.fade-left`/`.fade-right`, a `mask-image` over the normal
  status color) — colored by status like a normal bar, hover for which date is actually known. A
  point/diamond marker was tried first and rejected: it reads as "a milestone at one precise date
  (1-day duration)", which overclaims — we don't know the epic is one day long, we just don't know
  where the other end is, and a fade communicates "open-ended in this direction" instead. This is
  different from having *no* date at all, which still shows the plain "No dates yet" text with no
  bar. A real bug shipped here once: both cases showed identical "No dates yet" text, making an
  End-dated-but-no-Start epic look like it had no dates at all even though it was correctly sorted
  by the date it did have — confusing to read even though the sort itself was correct.
- **`.gantt-bar` must define a color for all four status buckets** (done/prog/blk/ts) — `blk`
  (Blocked) had no color rule for a while, making a blocked epic's bar invisible (browser default =
  transparent) even though its row/label still showed normally.
- A sync (Confluence or Jira) must reconcile the workstream/epic list, not just add/update: any
  row the current parse/query no longer produces is deleted. An upsert-only sync would let stale
  rows outlive whatever created them (e.g. a since-fixed parser bug, or an epic removed from a
  team's plan) and silently reappear or linger in the matrix/Planning.
- Planning epics are ordered purely chronologically by end date (ascending), across all teams —
  never grouped by team first, never alphabetical/key order. Epics with no end date sort last.
  A timeline view must read top-to-bottom as earliest-to-latest.

## Milestones

Some projects (not all) have distinct phases with their own target dates — typically Alpha / Beta /
GA. Project Identity can show one end date per phase a project actually has.

- **Manually configured, never auto-discovered.** A project optionally names up to 3 fixed LVL2
  issues — at OVHcloud these are **New Features** (LVL2 issue type), not epics, and the UI says so —
  `milestone_alpha`/`milestone_beta`/`milestone_ga` (Edit page, "Project milestones") — each a
  single Jira key, all independently optional since not every project has all three phases (or any
  of them). A first version tried auto-discovering an arbitrary-named, arbitrary-count set of
  milestones from the Jira epic hierarchy (a non-Epic "New Feature" child of the root epic) or a
  Confluence `<h2>` heading convention, and used that to also group the Deliverable matrix by
  milestone. **Retired**: tested against a real project (BGP), the Jira hierarchy it relied on
  didn't actually separate the phases a PM has in mind — nearly every epic sat under a single
  "beta"-named parent regardless of which real phase it belonged to — so the auto-detected grouping
  was unreliable, and no project had adopted the Confluence heading convention it would have needed
  instead. Three fixed, explicitly-named fields are simpler and don't depend on a Jira hierarchy
  shape that doesn't reliably hold.
- The Edit page field for each accepts either the bare key (`LVL2-9493`) or a full Jira issue URL
  pasted straight from the browser's address bar (`parseMilestoneEpic` in server.js strips it down
  to the trailing key) — same convenience the Confluence page URL field already offers.
- Each milestone's own End date is read from Jira (same `getRootEpicMeta` call the root epic's own
  Target ETA already uses) and **frozen into the report row at generation time**
  (`reports.milestone_alpha_end`/`_beta_end`/`_ga_end`), exactly like `eta_snapshot` — a past week's
  report must never silently change because one of these dates moved in Jira after the fact. A
  report generated before these columns existed just has NULL in all three, so it shows the plain
  Target ETA instead, same as a project with no milestones configured at all.
- **Milestones replace the Target ETA display, they don't sit alongside it.** When a project has
  any milestone set, the "Target ETA" identity-cell shows one line per phase (`Alpha — 28 Nov 2025`,
  in the exact same `.f-value` styling the single date used — plain text, no background/border) in
  place of the single date; a project with none shows the single date exactly as before. An earlier
  version showed the single date AND a separate row of bordered/shaded chips underneath it — this
  was rejected as visual noise duplicating the same information twice in two different styles for
  no reason. The `eta-delayed-note`/health-dot underneath are unaffected either way — they track the
  *root epic's own* End date (`eta_snapshot`/`eta_delayed`), a separate concern from which phase
  dates are being displayed above them.
- A milestone line is shown only for a field the project actually set (`proj.milestone_alpha` etc.
  non-null) — the ones left blank never appear, not even as "TBD". If the field is set but Jira had
  no End date on that epic (or the read failed), the line still shows with "TBD" — same "no
  fabricated fallback, but don't hide something the PM explicitly configured" logic as the rest of
  this app. One edge case accepted as-is: a PM changing or clearing one of these 3 fields changes
  which lines appear on *every* past report too, not just future ones (whether a line appears at
  all is read live from `projects`, only the date shown per line is frozen) — unlike the rest of
  this app's frozen-snapshot fields, since which phases a project tracks is closer to a project
  identity fact than a weekly status.
- **A milestone whose date has passed AND whose epic is actually Done shows "DONE" instead of the
  now-stale-looking past date** — a completed Alpha showing e.g. "28 Nov 2025" months later reads
  as an overdue warning rather than a finished phase. Both the raw Jira status (`milestone_*_status`
  columns) and the date are frozen per report like everything else here, but "is the date in the
  past" is evaluated against *today* (real time, at view time) rather than the report's own week —
  the same read-time framing the Gantt's own "Today" marker already uses, not a frozen fact about
  that week. A milestone that's Done but whose date is still in the future (an unusual/inconsistent
  data state) keeps showing the date, not "DONE" — both conditions are required.
- The Deliverable matrix is always flat, never grouped by milestone — the retired auto-grouping
  attempt tried this and it's not part of the current design; regrouping it around these 3 fixed
  fields wouldn't actually solve the problem that got the old mechanism retired (see above), since
  the underlying Jira hierarchy still doesn't separate the phases either way.

## Planning Light (BigPicture-scoped planning)

A project can opt in (`projects.bigpicture_box_id`, Edit page — a separate field from
`jira_root_epic`, since a BigPicture box ID isn't always shaped like a Jira key) to a hierarchical,
2-column (Summary, Status) planning view that **replaces** the classic flat Planning/Gantt section
entirely for that project — never shown alongside it. A project with no box ID configured is
completely unaffected: same flat epic-list Gantt as before, same `jira.getPortfolioEpics` code
path (`refreshFullEpicTree`).

- **Scope comes from BigPicture, not a second, divergent source of truth.** The whole point of this
  feature is that a PM has already configured which Jira sources populate their BigPicture "box" —
  Planning Light reads that configuration (`bigpicture.js`'s `getScopeDefinition`) and runs it
  through this app's own plain Jira search (`jira.js`'s `searchByJql`), rather than re-deriving
  scope from a fixed root epic the way the classic Gantt does. This is also what replaced the
  retired `extra_epics` manual-pin field (see "Milestones" above's Planning/Gantt section) — the
  problem `extra_epics` was a workaround for (an epic belonging outside the root epic's own
  hierarchy) is what BigPicture's own scope config already solves properly.
  - **A non-empty `narrowingQuery` (a raw JQL string) IS the box's actual configured scope, full
    stop — when present, it's used on its own, never OR'd together with `scopeDefinitionElements`.**
    Verified against two real boxes, which disagreed enough to matter: `HYBR-95` had
    `narrowingQuery: ""` and its whole ~250-issue scope came from one `JIRA_FILTER` element instead
    (so that's the fallback when there's no `narrowingQuery`) — but `HYBR-89` had both a real,
    specific `narrowingQuery` (itself a `portfolioChildrenOf` walk) **and** nine
    `scopeDefinitionElements` naming entire connected Jira projects (IPAM, NCC, MANAGER, CLDAPI,
    LVL2...). Those elements are the projects the box is *allowed to pull from*, not literal
    scope-additive elements — OR'ing their raw `project = <id>` clauses in on top of the
    `narrowingQuery` would have pulled every issue in every one of those projects (thousands) instead
    of the ~500-issue portfolio the `narrowingQuery` alone correctly resolves to (confirmed by
    running both against Jira directly before shipping this). Each `scopeDefinitionElements` type
    maps to its own JQL clause when it IS used (`JIRA_FILTER` → `filter = <id>`, `JIRA_PROJECT` →
    `project = <id>`, `JIRA_AGILE_BOARD` → `board = <id>`, the last one unverified end-to-end
    against a real board-scoped box). The scope-definition endpoint's actual payload also sits under
    an undocumented `cargo` wrapper (`{currentVersion, latestVersion, cargo: {...}}`), not the
    response root — the first implementation missed this and every box appeared to have zero scope
    until it was caught.
  - **A box's scope is not epic-only.** On that same real box, 246 issues were in scope but only 31
    were Epics — the rest (mostly Task/Bug) report into their parent Epic via the classic "Epic
    Link" field (`customfield_10000`), not the portfolio-parent field Epic-and-above levels use
    (see hierarchy note below). See "granular work items" below for how these are handled.
- **BigPicture's REST API uses a different base path and a different auth scheme from the rest of
  this app's Jira calls** — `Authorization: APIToken <token>` (env `BIGPICTURE_API_TOKEN`), not the
  `Bearer ${JIRA_TOKEN}` used everywhere else — hence its own module (`bigpicture.js`), same
  reasoning as `confluence.js` being separate from `jira.js` despite both being Atlassian-adjacent.
  Self-hosted installs before ~8.32 use a different URL path
  (`/rest/softwareplant-bigpicture/1.0` vs `/rest/bigpicture/1.0`) — `bpFetch` tries the new one
  first and falls back to the old one on a 404, since neither this app nor whoever configures a
  project's box ID necessarily knows which version the instance is on.
- **Hierarchy is derived from Jira's own parent fields/links, not from any BigPicture box-to-box
  endpoint.** BigPicture's own dedicated "list tasks in a box" endpoint only returns bare IDs and is
  Cloud-only (confirmed unavailable for this on-premise instance) — reusing Jira's own hierarchy
  mechanisms against the BigPicture-scoped issue set was the only viable path, and it also means
  Planning Light didn't need to learn BigPicture's own internal task model at all. **Three different
  mechanisms are checked, in priority order, since which one is populated depends on the issue's own
  level and on how a given PM built their hierarchy**:
  1. a plain Jira issue link of type **"Parent-Child"** (`issuelinks`, checked on its *inward* side
     only — "is child of" — never the outward "is parent of" side, which would read backwards).
     BGP Service was deliberately restructured as **Epic LPM > Phase > Deliverable > New Feature >
     Epic (NCC, PSM, NSA…)** entirely through these links, so a link is the PM's explicit, current
     statement of the hierarchy and wins over the custom fields below — many of the same issues
     still carry a `cf[16100]` left over from the older Advanced Roadmaps structure (e.g. a New
     Feature pointing straight at the Epic LPM root), which would attach them to the wrong level.
     (It used to be the last-resort fallback, back when it only wired a box's top level.);
  2. the portfolio-parent field (`cf[16100]`/`customfield_16100` — the field the classic tree-walk
     already uses) for Epic-and-above levels;
  3. the classic "Epic Link" field (`customfield_10000`) for Task/Bug/Story-level issues pointing at
     their parent Epic — on one real box, only 37 of 246 issues had `customfield_16100` set at all,
     the other 209 all used `customfield_10000` instead.

  All three land in a single `parentKey` per issue (`jira.js`'s `searchByJql`) so the
  hierarchy/rollup pass (`buildPlanningTree`) doesn't need to know which one applies for a given
  issue. Because the priority order is fixed, a PM who wires the *same* relationship two different
  ways always gets a consistent result rather than one that depends on fetch order. The scope search
  is paginated — a box can exceed one 500-issue page (BGP's is about that size), and a silently
  truncated page would drop arbitrary nodes.
- **On a Phase/Deliverable-structured box, only those two levels get a row** (plus synthetic
  groups). A box counts as structured when at least one **Phase is linked ("is child of") directly
  under the project's root epic** (`jira_root_epic`) — not merely when a Phase/Deliverable issue
  appears somewhere in scope: Encryption at Rest's box (HYBR-95) carries one stray Deliverable in an
  otherwise Epic-based tree, and a presence check (shipped briefly on preview) collapsed its ~35
  rows down to 2. The flag is computed in `buildPlanningTree` and frozen on every node of the
  snapshot (`structured`), so a past week keeps rendering the way it was generated. The Epic LPM
  root above, and the New Features/delivery-team Epics/Tasks below, are still fetched and still
  feed the rollup — they just aren't drawn. Indentation counts displayed ancestors only (Phase at
  depth 0, Deliverable at depth 1, whatever the raw Jira depth), and a Deliverable gets no collapse
  caret since nothing renders under it. Any other box keeps the Epic-level rule below, and none of
  the Phase/Deliverable date/status rules further down apply to it either.
- **Granular work items (Task/Bug/Story/Sub-task/Improvement) still count toward their parent
  Epic's rolled-up dates, but never get their own row.** A box's configured scope commonly includes
  hundreds of these (see above) — rendering every one of them would be the exact opposite of
  "light". `report-gen.js`'s `flattenPlanningTree` fetches and keeps them in the tree (so the
  rollup pass in `buildPlanningTree` still sees them) but skips emitting a row for any node whose
  Jira issue type is in a fixed `GRANULAR_TYPES` set (on a Phase/Deliverable-structured box, the
  Phase/Deliverable rule above applies instead).
- **A parent's own Jira Start/End dates win; they're only computed from its children when missing**
  — each field independently, recursively, bottom-up (`buildPlanningTree`'s `rollup`), at every
  level (epic, New Feature, Phase, Deliverable…). A computed date is the MIN start / MAX end of the
  children's *effective* dates (own-or-computed), so a parent with no dates of its own inherits from
  below. A leaf keeps its own Jira dates.
  - **This was the reverse until 2026-09-30** ("a parent's dates are never read from Jira, always
    computed"), with an exception for Phases/Deliverables only. It broke as soon as a box's scope
    included the epics' Tasks/Stories, which are almost never dated: on Private boot M1 (box
    HYBR-97), 32 epics with real Jira dates showed "No dates yet" — e.g. PUBM-53549, 14/09 → 24/09
    in Jira, with 4 undated Tasks — and 5 more showed computed dates that weren't the ones in Jira.
    PMs plan by typing dates on the epic; that's what the Planning must show.
  - The Phase/Deliverable case that first motivated the exception still holds under the general
    rule (BGP: Technical delivery set to 01/12/25 → 03/11/26 in Jira, while its children only covered
    02/03/26 → 15/09/26 — Jira's dates are shown).
  - **Their status, however, is always computed from below** (same worst-of rule as a group: Done
    only if every child is, then Blocked > In Progress > To Start) — their Jira workflow status is a
    placeholder ("Request" on every BGP Phase/Deliverable), which would otherwise show everything as
    To Start. A Phase/Deliverable with no child in scope keeps its own mapped status.
  - **On a Phase/Deliverable-structured box, the hierarchy follows "Parent-Child" links only** — the
    `cf[16100]`/Epic Link fallbacks are ignored (`searchByJql`'s `linkParentKey`). Verified on BGP:
    old NETDC epics still attached to the ALPHA phase via Parent Link only (no link) pushed its end
    from Dec 2025 to Jul 2026. An issue in the box's scope but with no link parent simply becomes a
    non-displayed root, contributing to nothing. Conversely, an issue linked into the tree but
    outside the BigPicture box's scope is not fetched at all — the scope still comes from the box
    (BGP: 7 link-only issues such as XDEP-202/203 aren't reached by a `portfolioChildrenOf` walk of
    LVL2-3688); adding them is a box-configuration fix, not a Suricate one.
- **No local overrides (the "Manage" mode is retired).** Planning Light used to let the owner
  hide, rename and group rows in Suricate itself (`planning_overrides`/`planning_groups`, four
  `/planning/*` routes, a CSS-only Manage toggle). Removed at the PM's request once the Jira
  structure itself (Phase > Deliverable via links) gave the report the right rows and labels: the
  planning now shows exactly what Jira says, and fixing the plan means fixing Jira. Both tables are
  kept in the schema with their existing rows, just no longer read or written. A report frozen
  while the mode existed can still carry hidden rows (left out, as they were) or synthetic
  `GROUP:<id>` nodes (still rendered) in its snapshot. Nothing was ever written back to Jira;
  bi-directional Start/End date sync remains a separate, later topic.
- **The whole resolved tree (scope + hierarchy + rollup dates) is frozen per report row**
  (`reports.planning_snapshot_json`), same reasoning as every other snapshot column here — a past
  week's report must not change because Jira changes afterward. `null` for a project that hasn't opted in, or for a legacy row predating this
  column — the renderer falls back to the classic flat Gantt only when `planningTree` itself is
  `null`; an opted-in project whose BigPicture box resolves to zero items still gets the Planning
  Light section (with a "No items in the configured scope" message), never a silent fallback to the
  old view, since falling back there would mask a real misconfiguration.
- **Same fiscal-quarter month axis as the classic Gantt (`buildGanttMonths`), but its own window:
  from 3 months before today (not the classic Gantt's 6) to the end of the month of the latest date
  shown, at least 3 months ahead** — no fixed end date (the old hardcoded 30/11/2026 already clipped
  HYBR-95 and HYBR-122). An item that ended before the window gets a "◂ Ended <date>" label instead
  of a clamped sliver on the left edge. Unlike the classic Gantt, the timeline bars here are
  rendered server-side as plain HTML (not built from a JSON blob by client-side JS); only
  collapse/expand needs any client JS.
- **Only the timeline scrolls horizontally; the Summary/Status column stays fixed.** Each month has
  a fixed width (`PLANNING_MONTH_PX`), stretched to the full width when the plan is short. The PDF
  export can't scroll, so its print CSS squeezes the whole timeline into the page width instead.
- **Rows are sorted chronologically at every level** (siblings only — the hierarchy is kept), on
  effective dates (own or rolled up): by end date, or by start when there's no end, then by start;
  undated items last. Jira's search order meant nothing here (BGP's GA phase appeared above
  ALPHA/BETA). Applies to every Planning Light box.
- **Collapse/expand is client-side only and deliberately not persisted** — it resets on reload;
  it's just a reading convenience for the person currently looking at the page.

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
  any Blocked workstream, or the risk register carrying a risk at level `high` **or `extreme`**,
  suggesting the target date *might* slip. (Extreme used to be left out — only `high` was checked —
  although it ranks above High; fixed 2026-09-29.) One rule, `computeHealth` in server.js, shared
  by the report and the project page's weekly history so they can never disagree. (A "more than 60% of workstreams still To Start" rule used to also
  trigger At Risk — dropped: too many projects are legitimately mostly-not-started early on
  without that meaning anything is actually at risk, and it fired with an empty risk register and
  nothing blocked, which read as unexplained.) Delayed is a fact —
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

## Project page — weekly health history

- **The project page's reports table doubles as a health history**, one row per week (most recent
  first, gap weeks kept as empty rows), modelled on the PMs' Confluence "Flash reports history"
  page (Date, Météo, Tendance, Alpha, Beta, GA, open risks, points to clarify) so they can stop
  maintaining it by hand. Columns: **health** (the report's own badge and wording, untranslated like
  the report itself, with a weather icon: ☀️ On Track, ⛅ At Risk, 🌧️ Delayed), **trend**,
  **Alpha/Beta/GA end dates** (only the milestones the project configured; the single ETA when
  none is), **% of workstreams Done**, **open risks** and **points to clarify**. A week with no
  report says "Pas de rapport généré" / "No report generated" right after the week (it used to
  sit at the far right, where it went unnoticed). To keep the table from scrolling sideways, the
  trend arrow sits in the health cell (no column of its own) and the row actions (view / regenerate /
  delete) are icon-only buttons — 28×28 targets, label as title + aria-label.
- **Every figure comes from that week's own frozen report** (`reportHistory` in server.js: its
  snapshot columns — workstreams, risks, highlights, milestone ends, `eta_snapshot`), never from live
  data: a past week shows what that week's report said, same rule as the report itself. A legacy
  row without a workstreams snapshot shows "—" for health, trend and Done rather than
  guessing.
- **Each row is compared with the previous *existing* report** (a gap week is skipped, not treated
  as a reset). A date that moved shows the shift in days next to it — ▲ +N d (later, red) or ▼ −N d
  (earlier, green), the previous date on hover. The **trend** degrades (↘) when the health got
  worse *or* any date slipped later, improves (↗) when the health got better, and is stable (→)
  otherwise; the oldest report has none. A deterministic rule on purpose — the Confluence page's
  hand-picked "Tendance" can't be reproduced, but a slip or a worse badge is what a reader means by
  "getting worse".
- Alert red in this table is `#C0472E` (5:1 on white, 4.57:1 on the row hover), not the app's
  `--blk` `#D85639`, which only reaches 3.95:1 — too low for small text (see Accessibility).

## What's new (release notes)

- **One source, two channels.** Every user-facing change gets an entry in `whats-new/entries.json`
  (id, date, audience `all`/`creators`, FR/EN title, one-line `short` and longer `body`, optional
  link and screenshot),
  **added in the same change as the feature itself** — same convention as this file. Both the in-app
  page and the Webex digest read from it, so nothing is written twice and they can't drift. Write
  entries for what a PM notices and does differently, not for internal refactors. The file order is
  the editorial order (most important first): the digest keeps it, the page shows newest first.
- **In-app: a "Nouveautés / What's new" page, not a guided tour.** A permanent nav link, with a
  badge carrying the unread count when there is any, shown only to report creators (users owning at least one project) — readers care less about
  functional news and never see it; the page itself stays viewable by anyone logged in. Opening the
  page marks everything as seen (`users.whats_new_seen_at`); a creator who never opened it only
  counts the last 30 days as new. A guided tour was considered and dropped: each step is pinned to a
  screen element and breaks whenever the layout moves (weekly, currently), and people tend to skip it.
- **Screenshots are captured from the running app**, not by hand: `scripts/capture-whats-new.js`
  (the PDF export's headless Chromium, 2× resolution, one element per entry via a CSS selector),
  then committed under `whats-new/img/`. Served behind login (`/whats-new/img/*`), unlike `public/`
  assets, since they show real project data. Only add one when it actually shows the change (a
  "Paused: 0" donut was dropped for that reason).
- **Webex digest, on demand, never on a schedule** — a fixed cadence would often land after people
  already noticed the changes. `scripts/send-digest.js` posts every entry not sent yet
  (`digest_sent`) to the Project Manager Community space, **deliberately terse** (the PMs found a
  first, fuller version too verbose): **one post per entry** — its screenshot, its title in bold
  and its one-line `short` description, in French — the first post headed "✨ Quoi de neuf dans
  Suricate" with the only link, to the in-app What's new page (per-entry "see in Suricate" links
  were dropped as noise). Settled after trying the alternatives, all rejected: one message with every entry
  and the screenshots as thread replies (text and captures disconnected); all screenshots stacked
  in one image (a montage of isolated pieces); every entry as a block inside one image (too dense,
  lots of zooming); a single Webex Adaptive Card interleaving images and text — impossible here:
  Webex's cloud fetches a card's images itself at post time and can't reach this internal server
  (it rejected a probe card with "Unable to retrieve content"), and publishing screenshots of real
  projects on the internet to work around it isn't acceptable. The in-app page keeps the longer
  `body`. Screenshots are uploaded to Webex as the post's attachment, which keeps them off any
  public URL. Dry run by default, `--send` to post,
  `--mark-sent` to record entries announced another way. `--test <space>` posts the real message to another space (typically your 1:1 with the bot) without marking anything as sent — to check the rendering in Webex before the real send. A space given as a bare UUID is looked up among the bot's own spaces: the API id is region-specific (ours is EU, `urn:TEAM:eu-central-1_k`), so it can't be derived from the UUID reliably. It uses its own dedicated bot
  (`DIGEST_WEBEX_BOT_TOKEN`, `DIGEST_WEBEX_ROOM_ID` — the API id, or the UUID of a
  `webexteams://im?space=…` link), not the app's other Webex bot, which serves another purpose.

## Highlights formatting

- **The Risk register follows the same rule** (since 2026-10-01): each risk's description and
  mitigation keep the PM's formatting through the same allowlist (`desc_html` / `mitigation_html`
  next to the plain `desc` / `mitigation`), mitigation bullets one per line instead of joined with
  "; ". Risks frozen in an older report render as plain text, as before.

- **The Highlights (Achievements / Blockers / Clarify) keep the PM's Confluence formatting** — bold,
  italics, underline, strikethrough, superscript/subscript, text and highlight colours, links,
  links to other Confluence pages, Jira issue macros (rendered as a link to the issue), status
  lozenges (their title), dates. They used to be reduced to plain text, losing e.g. a bullet a PM
  had put in bold to make it stand out, or the grey a PM uses to dim an older item.
- **Strict allowlist, not a blocklist** (`confluence-format.js`, `toSafeInlineHtml`), since the
  result goes into the report as HTML: the fragment is tokenised; any tag outside
  strong/em/u/s/sup/sub/code/span/a/br is dropped with its text kept; attributes are rebuilt from
  scratch, never copied; links must be http(s) or mailto (anything else becomes plain text) and open
  in a new tab; styles keep only explicit colour values (`#hex`/`rgb()`), bold, italic and
  underline/line-through — no `url()`, no expressions, no other property. Text stays as Confluence
  escaped it, with stray `<`/`>` re-escaped. Tested against script tags, `javascript:` links,
  event-handler attributes, CSS `url()`/`expression()` and attribute break-out attempts.
- Atlassian writes colours as design tokens with a fallback (`var(--ds-text-subtle,#626f86)`): the
  explicit fallback is kept. Its **default body text colour (`#172b4d`) is dropped**, so plain text
  inherits the report's own text colour instead of a slightly different navy. A style set on the
  bullet itself (`<li style="color:…;font-weight:bold">`) is applied to the whole item; bold
  inherits the surrounding colour (a grey-and-bold bullet stays grey).
- Bullets are split nesting-aware (`topLevelItems`): a bullet with sub-bullets stays one item, its
  sub-bullets on their own lines, instead of being cut at the first `</li>`.
- Each item stores both `text` (plain — counts in the health history, anything non-HTML) and `html`
  in the frozen `highlights_json`. A report generated before this has no `html` and renders its text
  exactly as before — past weeks don't change.
- Colours are the PM's choice and shown as-is, even when low-contrast (Confluence's grey is ~3.2:1
  on white): respecting their emphasis was the point. The Jira key chip after an item is unchanged.

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
- **Precise codes in the logs, ~10 message templates on screen.** Each failure keeps a precise code
  (`errors.js` + each service module: `jira_issue_not_found`, `confluence_timeout`…) for diagnosis,
  but what a PM reads is one of a handful of templates filled with the service and the object
  involved (`userMessage` in server.js, `detail.msg_*` in i18n.js). There used to be 41 near-duplicate
  messages, the same sentence repeated per service (rationalised 2026-10-02). Every template still
  says what happened, where, and what to do — retrying only helps for the temporary one:
  - **token not recognised** — `{service}`, naming the exact `.env` variable (`JIRA_SERVICE_TOKEN`,
    `CONFLUENCE_SERVICE_TOKEN`, `BIGPICTURE_API_TOKEN`); **token missing** (BigPicture box set, no token);
    detected even without a 401 (Jira runs an expired token as anonymous → 400 "…anonymous users";
    Confluence → 404 `"authorized":false`) — both seen for real on 2026-09-28/29;
  - **CAPTCHA lock** (Jira 403 + `X-Authentication-Denied-Reason`);
  - **no access to {object}** — some Jira tickets, a Confluence space, a page with a read restriction;
  - **{object} not found** — root epic, Jira ticket, Confluence page, BigPicture box;
  - **search query rejected** — Jira's own `errorMessages` passed through (typically a box's JQL);
  - **{service} temporarily unavailable** — rate limit, timeout, network, 5xx, and Confluence's
    temporary denial (below); "retry in a few minutes";
  - **unexpected error from {service}**; **Confluence page off-format** (table missing / empty);
  - a BigPicture failure also says the report's Planning section couldn't be built from it.
  App-level messages (invalid / future / locked week, login, forms, PDF) keep their own wording.
- **Confluence's `"authorized":false` 404 is diagnosed in steps, not guessed.** It's retried once
  after 2 s (a transient burst happened on 2026-08-31). Then: token served as anonymous
  (`/rest/api/user/current`) → **token not recognised**; token fine and the space itself visible
  (`/rest/api/space/{key}`) → **no access to the page** (read restriction); token fine but the space
  unreachable → **temporarily unavailable**, "if it persists, check the service account still has
  access to space X". That last case used to say "no access to the space" outright — wrong on
  2026-10-02, when Confluence answered "No space with key: CPO" for ~7 minutes on a space the account
  has always read (every other CPO page worked before and after), and sent the PM chasing rights
  they already had. A genuine loss of access looks the same from the API, hence the two-step wording.
- **The banner is labelled with the service that actually failed** (`AppError.source`, derived
  from the code's prefix) — it used to say "Confluence sync failed" for every error, Jira ones
  included. Non-service notices (past week locked, future week...) carry no service label.
- **A Planning Light failure is no longer silent.** The report is still generated (the Planning
  section falls back as before), but the cause comes back from `generateReportRow` and is shown as
  a banner on top of the freshly generated report. More generally, when the report itself was
  generated but something failed on the way (the pre-sync, Planning Light), Generate/Refresh now
  lands on that report with the banner instead of bouncing back to the project page.
- **Login checks the Jira service token before saying an email doesn't exist** — with an expired
  token, Jira's user search runs as anonymous and finds nobody, which used to read as "email not
  found in Jira".

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
- **Epics only — never a Task/Story/Bug, even though `epics_cache` isn't epic-exclusive.**
  Two of its writers legitimately cache non-Epic rows: a Confluence-sourced workstream's Jira
  cell can embed a Task/Story/Bug directly (`getEpicsByKeys`), and Planning Light's
  BigPicture-scoped search resolves a box's own narrowing query, not an epic hierarchy walk
  (`searchByJql` — verified against a real box: 246 issues, only 31 Epics). Both are correct
  for the Deliverable matrix/Planning, which care about status regardless of type, but a
  real bug (2026-10, user-reported on a project using Planning Light): Cleanup had no type
  filter of its own and was checking those Task/Story/Bug rows as if they were epics. Fixed
  with an `issuetype` column on `epics_cache`, populated by every writer, filtered to `=
  'Epic'` in Cleanup's own query — a row cached before this column existed has it NULL and
  is excluded too (not assumed to be an Epic) until its next refresh repopulates it.
- **Two groups, not a severity ladder** (reworked 2026-10 from an earlier 4-tier
  high/this-week/upcoming/medium split, after the user pushed back: collapsing missing
  start/end dates into a lesser, count-only tier made them read as less important than an
  overdue epic, which isn't true from a PM's point of view — a project you can't even date
  is just as much a planning problem).
  - **⚠️ Incohérences de suivi / Tracking inconsistencies**: overdue (end date passed, status
    still active); not started despite a past start date; inconsistent dates (start after
    end); missing assignee; missing start date; missing end date. All six listed
    individually, in one table, with equal visual weight — no rule is demoted to a count.
    Each row leads with a short, coloured badge naming the rule itself (e.g. "En retard",
    "Sans start date") before any detail sentence — added 2026-10, direct feedback that a
    full sentence per row wasn't something you could scan, you had to read it. Two badge
    colours, not a severity scale: red (`tag-alert`) for a status/date contradiction
    (overdue, not started, inconsistent dates), neutral (`tag-info`) for a missing field
    (assignee, start, end) — same size/weight for both, since neither cluster is "worse".
    A missing-field row has no further detail sentence (the badge already says everything);
    a contradiction row keeps its sentence underneath, since that one carries information
    the badge can't (the actual day count, date and current status).
  - **📅 Vigilance planning / Planning watch**: 🟠 due this week (end date within 7 days) and
    an unlabelled "next 2 weeks" group (end date 8–14 days out). Explicitly **not** an
    anomaly — a perfectly healthy epic lands here purely because it's closing soon. Kept in
    its own card, with its own hint text, so it never reads as something to fix. "This week"
    was split out from the 14-day window specifically so a PM scanning before a status check
    can see what needs acting on *now* without picking it out of everything closing in the
    next two weeks.
- **Findings are stated directly, naming the actual contradiction** — "End date dépassée
  depuis {{days}}j, statut toujours « {{status}} »", not just the date delta with the status
  left for the reader to cross-reference from elsewhere on the row (direct user feedback,
  2026-10: the original wording wasn't explicit enough).
- **Team and Assignee are real, filterable columns/attributes — not a row-grouping scheme.**
  An earlier version (2026-10, briefly) grouped rows under a per-team sub-header; replaced by
  a plain "Team" column plus a `<select>` filter (vanilla JS, toggles `tr[data-team]`
  visibility) after direct feedback — a column you can filter on serves the same scanning
  need without ever hiding a row from someone who isn't reading top-to-bottom. The Assignee
  filter works the same way and combines with the Team one (both must match), and **"no
  assignee at all" is its own selectable value** (`data-assignee=""`, a dedicated "(vide —
  sans assignee)" option) — not just a list of real names, so a PM can isolate exactly the
  unassigned epics in one click.
- **Missing-assignee/start/end-date checks are skipped once an epic's `mapStatus` bucket is
  `done`** — closed work doesn't need its ownership or dates backfilled. This reuses
  `jira.mapStatus`'s own done/in-progress/paused/blocked/to-start buckets (the same ones
  driving the Deliverable matrix and health badge) rather than Jira's raw status, so
  paused/on-hold epics keep this app's already-agreed semantics instead of a generically
  re-derived one.
- **A Cancelled or Rejected epic is skipped from every check, not just the missing-metadata
  ones** — same treatment as a Done epic (no overdue/not-started/inconsistent-dates/
  missing-metadata findings). `mapStatus` has no bucket for "irrelevant, stop checking" (it
  falls through to `ts`, the same bucket as a genuinely not-yet-started epic), so this is
  checked against Jira's raw status text directly instead — same idea as the Cancelled
  exclusion Planning already applies, extended here to also cover Rejected. Without this, a
  cancelled epic with a stale past end date read as an active, overdue tracking problem (seen
  in production: NCC-2865 and CLDAPI-2009, both Cancelled, both flagged as overdue/not-started).
- **Missing-assignee is back as an anomaly** (reinstated 2026-10, the same week it was
  dropped — direct user feedback after trying the redesigned page: a missing assignee *is*
  worth flagging). The sibling Webex bot (jira-hygiene-report) does **not** have this rule —
  the two tools previously stayed in sync on this exact point and now diverge; revisit there
  too if this sticks.
- **The Contact column shows only the real assignee, or "Sans assignee"** — a reporter
  fallback name used to be displayed there ("{{name}} (reporter, pas d'assignee)"); dropped
  2026-10, direct feedback that it was redundant once the row's own badge already says "Sans
  assignee" and cost horizontal width for no benefit. Display-only and independent of the
  Assignee filter above, which still reads the real `epic.assignee` field — filtering to
  "(vide)" shows exactly the rows whose Contact column reads "Sans assignee", no reporter name
  ever appears there anymore (on either the Incohérences or the Vigilance planning table).
- **A third filter, by problem/rule type, combines with Team and Assignee** (added 2026-10,
  direct feedback) — populated from whichever rules are actually present (`result.rules`,
  already in the fixed contradiction-then-missing-field order), reusing the same `rule_*`
  labels as the badges so the filter's wording matches what's on screen. It only ever applies
  to the Incohérences table (`data-rule` is only set on anomaly rows) — Vigilance planning
  rows have no rule to filter by and are deliberately left untouched by it, consistent with
  that section always being visible regardless of filter state (see below).
- **The Epic column is widened (420px) and its summary clamped to 2 lines**
  (`-webkit-line-clamp`), not cropped to a hard character count — short summaries don't pad
  the row, long ones never overflow into the next column. The full summary is always
  reachable via a native `title=""` tooltip on hover, HTML-escaped, so a truncated row never
  loses information (2026-10, direct feedback after widening the column alone still left it
  cramped for the longest real summaries).
- **📅 Vigilance planning always renders, even at 0/0** — it used to disappear entirely when
  nothing was due soon, which read as "the page is broken" rather than "nothing to watch this
  time" (2026-10, direct user feedback: "laisse toujours les vigilances planning quitte à ce
  que le compteur soit à 0"). Each of "this week" / "next 2 weeks" shows its own small
  "Nothing this week"/"Nothing in the next 2 weeks" message in place of an empty table when
  its count is 0, rather than hiding the subsection.
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
- **The link to a project's settings (Edit page) is a bare gear icon (⚙, `.btn-icon`)**, not a
  labelled button — a settings/configure action is common enough across software that the icon
  alone reads clearly, and it matters here specifically because the report page's header is already
  crowded (Export PDF, this, Refresh, week-nav all compete for the same row). Still owner-gated like
  Refresh, and still carries `title`/`aria-label="Configure"` for anyone who needs the text. Present
  on both the project detail page and the report page itself — added to the latter so a PM
  reviewing their own report doesn't have to navigate back to project detail first to fix something.
- **Week navigation (`.week-nav`: previous/current/next) always sits in the same spot — the
  top-right of `.page-header`, next to the back-link — on every week-scoped page**, whether it's an
  actual report or the "No report for this week" page. Both pages link the same shared
  `.week-nav`/`.week-arrow`/`.ref-week` rules from `app.css` rather than each defining or
  positioning its own copy, specifically so a PM clicking through consecutive weeks doesn't have the
  control jump to a different spot depending on whether that particular week happens to have a
  report or not.

## Contributors & environments

- **Contributors propose, the maintainer merges and deploys.** A contributor works on a `feature/…`
  branch, tests on their own preview, opens a PR; the maintainer reviews (agent `suricate-reviewer`),
  merges and deploys prod as before. `master` never receives a direct push from a contributor: the
  repo's pre-push hook refuses it (`.githooks/pre-push`, enabled with `git config core.hooksPath
  .githooks`; the maintainer's clone opts out with `git config suricate.maintainer true`). The
  personal GitHub plan has no server-side branch protection on a private repo — this hook plus the
  fact that prod only ever changes when the maintainer deploys it are the safeguards.
- **One preview per person, each deploying itself from `preview/<slug>`** (`ops/previews.json`: Cyril
  31622, Aurélien 31625 — the maintainer's preview works the same way as a contributor's, one
  mechanism for everyone): a cron job per preview on the host (`ops/autodeploy.sh`) polls GitHub every minute, rebuilds on a new commit and reports the
  result as a GitHub commit status and on `/version` (state + build log tail); a commit that fails to
  start is rolled back to the last working image, so the preview (and its failure log) stays reachable. Pull-based on purpose:
  the host has no sudo (no separate Unix account possible) and sharing the maintainer's SSH account
  was ruled out, and GitHub can't reach the internal host to push webhooks. Ports, mounts and
  secrets come from files outside the checkout, so a branch can't change them. One preview per person
  rather than a shared one: two people testing at once on a shared preview overwrite each other's
  deploys. A new person = one line in `ops/previews.json` + `ops/new-preview.sh <slug>` on the host.
  Details and isolation limits: `ops/README.md`; contributor guide: `CONTRIBUTING.md`.
- **Claude Code is the expected tool on both sides**: `CLAUDE.md` (loaded automatically) carries the
  conventions; skills `suricate-preview` / `suricate-ship` drive testing and PRs; the existing QA
  hooks and agents apply to contributors too.
- **The onboarding guide lives in the app, at `/contribuer`** (any logged-in user), not only in an
  external page: a Claude artifact can't be shared across Claude organisations (the maintainer and the
  first contributor are in different ones), while every PM can open Suricate. Its preview table is
  rendered from `ops/previews.json`. French only, as an exception to the FR+EN rule: it's addressed to
  the French-speaking PM community contributing to the code; `CONTRIBUTING.md` is its text version.
- `/version` (unauthenticated) returns the environment, preview name and deployed commit — no data.
  The Preview badge shows `Preview · <Name> · màj <dd/mm hh:mm>` — the time of the last successful
  deploy, which a person can match against when they pushed (a commit hash, tried first, meant
  nothing to PMs); the change's message and hash are in its tooltip.

## Environment badge

Prod (`:31621`) and preview (`:31622`) run identical code on the same host, told apart on the
outside only by a port number — easy to lose track of, especially with both open in different
browser tabs.

- Driven by `APP_ENV=preview`, read once at boot into a module-level `IS_PREVIEW` in `server.js`
  and exposed to every page as `res.locals.isPreview` (EJS views) / a `genReport()` param (the
  report page, which builds its own HTML rather than using EJS).
- **Set only as a local, uncommitted addition to the preview host's own `docker-compose.yml`** —
  never in the tracked file, and never via `.env` either (the two hosts' `.env` files are already
  identical copies by design, see the lab-deployment reference). This is the same pattern already
  used for that file's port number: a permanent local diff that a normal `git checkout`/`git pull`
  never touches because no branch's tracked version of that file differs from what's already
  there. This is deliberate: it means there is no code path by which merging any branch to master
  could make the badge appear on prod.
- When on, every authenticated page's `.app-nav` recolors (`.is-preview`, a warm
  amber/near-brown instead of the brand navy, plus a diagonal hazard-stripe bottom edge) and gets a
  small "PREVIEW" text badge next to the brand name — recolor for an instant glance, text for
  anyone relying on it rather than color alone. The login page (which has no `.app-nav`) gets the
  same text badge next to its `.auth-brand` lockup instead. Every page's `<title>` also gets a
  `[PREVIEW] ` prefix — the most useful cue of all once two tabs are open side by side, since it's
  the one part still visible when a tab isn't focused.
- **Deliberately NOT hidden in the PDF export's `@media print` rule**, unlike the interactive-only
  controls that are (Export PDF button, Refresh, week-nav arrows, Confluence link) — if a
  preview-sourced PDF ever gets shared further, the mark should travel with it rather than making a
  preview export indistinguishable from a real prod one.

- **The badge code lives on `master`, and the flag in each environment's `.env`.** It first shipped
  only on its feature branch, never merged — so it disappeared from the preview every time another
  branch was deployed there (noticed 2026-09-30). Now: the code is on `master`, hence on every
  branch; `docker-compose.yml` reads `APP_ENV` and the host port (`HOST_PORT`, default 31621)
  from the checkout's own `.env`; only the preview's `.env` sets `APP_ENV=preview` and
  `HOST_PORT=31622`. The tracked compose file is identical on both, so a deploy no longer has to
  preserve a local modification (it used to hold the port and the flag, stashed and restored by hand
  on every deploy).

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
- **The Gantt's month-header row and quarter gridlines are generated dynamically from the same
  `tstart`/`tend` the bar/marker positions (`pct()`) are computed from** (`buildGanttMonths()` in
  `report-gen.js`), never a fixed list. This was a real, shipped bug once: the header was a
  hardcoded 15-column list always assumed to span Sep 2025→Nov 2026, while `tstart` actually floors
  at the *earliest epic start date* if any epic starts before Sep 2025 — so for a project with an
  epic starting e.g. March 2025, the header silently desynced from the true coordinate space and
  the "Today" marker (and every bar) rendered under the wrong month label. Quarter labels/gridlines
  follow OVHcloud's fiscal year (starts September; "FYxx" = 2-digit year in which August of that FY
  falls) computed from the calendar month, not hardcoded dates either.
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

# Functional rules — OVHcloud project reports

Living document. These are business/product rules agreed with the project owner over the course
of development — not derivable from the code alone, and easy to silently regress during a
refactor. The QA agent reads this file as part of its audit: a behavior that contradicts a rule
below is a real bug even if the code is internally consistent by its own logic.

When a new functional rule is agreed with the user, add it here in the same change.

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
  blockers/clarify, risks, epic/workstream statuses) is generated fresh from Confluence and Jira
  each time it's requested or regenerated.
- Navigating to or generating a report for a future ISO week is always blocked.
- Regenerating an existing week overwrites its stored content with the current Confluence/Jira
  state — this is the intended way to "fix" a report (fix the source, then regenerate).

## Project onboarding & editing

- A Confluence page is mandatory at project creation and must match the required structure
  ("Deliverables status", "Week summary", "Risk matrix" sections with their expected tables). A
  format mismatch produces an explicit, actionable error — never a silently empty project.
- Any common Confluence URL shape is accepted (`/display/SPACE/Title`, or a `pageId=` link).
- A project's target ETA always comes from its root Jira epic's "End date" field — it is never
  typed in manually, at creation or on edit.
- Editing a project (name, root epic, Confluence page, extra epics) does not itself resync
  workstreams — the "Sync Jira"/"Sync Confluence" buttons on the project page do that afterward.
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

# Suricate — instructions for Claude Code

Suricate generates frozen weekly status reports for OVHcloud projects from Confluence + Jira (+ BigPicture
for Planning). Node/Express/EJS, SQLite (`better-sqlite3`), Docker Compose. UI in French by default, English
toggle. Users are OVHcloud project managers; anyone logged in can view any project, only its owner edits.

**Read `FUNCTIONAL_RULES.md` before changing anything that touches report generation, status/date logic,
Planning, error messages or anything sourced from Jira/Confluence.** It is the living spec: every agreed
business rule is there, with the reason it exists (often a real incident). Don't re-litigate a rule silently —
if a change contradicts one, say so and ask.

## Workflow (maintainer and contributors alike)

1. **Branch from up-to-date `master`**: `feature/<short-name>` or `fix/<short-name>`. Never commit to `master`,
   never push it — `master` only moves through a reviewed PR merged by the maintainer, who also deploys prod.
   The repo's pre-push hook enforces it once enabled: `git config core.hooksPath .githooks` (check it's set;
   set it if not).
2. **Same change, same PR**: code + `FUNCTIONAL_RULES.md` (new/changed rule, with the why) + an entry in
   `whats-new/entries.json` when PMs will notice it (id, date, audience `all`/`creators`, FR/EN `title`,
   one-line `short`, longer `body`, optional `screenshot`). Bug fixes without visible change: no entry.
3. **Test on your own preview, not on prod.** One preview per person (`ops/previews.json`; yours is
   `git config suricate.preview`): skill `suricate-preview` pushes your branch to `preview/<you>`, waits for the
   automatic deploy and gives you the URL. Same for the maintainer.
4. **Open the PR**: skill `suricate-ship` (checklist + push + PR). The maintainer reviews (agent
   `suricate-reviewer`), merges and deploys prod. A contributor never deploys prod.

Environments, ports and the auto-deploy mechanism: `ops/README.md`. Human-readable version: `CONTRIBUTING.md`.

## Conventions that matter

- **Frozen snapshots**: a report row stores everything it shows (`*_snapshot_json`, `highlights_json`, …) at
  generation time; a past week must never change when Jira/Confluence change later. New report data → new
  snapshot field, with a fallback for old rows.
- **i18n**: every UI string in `i18n.js`, FR and EN; `t(key, vars)` with `{{var}}`. Report content coming from
  Confluence/Jira is not translated.
- **Errors**: never show a raw error. Throw `AppError(code, logMessage, vars)` (`errors.js`); the UI maps codes to
  one of the `detail.msg_*` templates (`userMessage` in `server.js`). Add a template only for a genuinely new
  cause.
- **HTML from Confluence/Jira**: escape it (`esc`), or pass it through the allowlist in `confluence-format.js`
  (`toSafeInlineHtml`). Never insert it raw.
- **Jira dates**: real Start/End fields only (`customfield_10110/10111`); a parent's own Jira date wins, computed
  from children only when missing. Statuses go through `jira.mapStatus` + `status.js`'s `rollupStatus`.
- **Brand**: OVHcloud identity (skill `ovhcloud-design`, agents `ui-reviewer` / `qa-agent-html`). Contrast WCAG AA.
- Comments explain *why* (constraints, incidents), matching the existing density; commit messages likewise.

## Local limits

- `npm install` fails on Windows (native `better-sqlite3` needs a build toolchain); the Docker image handles it.
  Pure-JS modules (`confluence-format.js`, `status.js`, `i18n.js`, `errors.js`) can be tested with plain
  `node -e` / small scripts; anything needing the DB, Jira or Confluence is tested on the preview.
- `node --check <file>` on every changed `.js` before pushing.
- No CI: the preview deploy (and its `/version` status) is the build check.
- Contributors have no access to the host, its database or its secrets — don't ask for them; the maintainer's
  session can run diagnostics on the host if needed.

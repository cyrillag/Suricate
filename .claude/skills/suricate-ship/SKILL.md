---
name: suricate-ship
description: Prepare and open a pull request for a Suricate change — conventions checklist, preview check, push, PR with the repo template. Use when a contributor says the change is ready, "ouvre la PR", "/suricate-ship", "prêt pour review". Never merges and never deploys prod.
---

# Ship a change as a pull request

1. **Branch**: must be a `feature/…` or `fix/…` branch, not `master`. Bring it up to date:
   `git fetch origin && git rebase origin/master` (resolve conflicts with the user; re-run `node --check`).
2. **Conventions** — go through each, fix what's missing, and tell the user what you did:
   - Business rule added or changed? → `FUNCTIONAL_RULES.md` updated in this branch, with the *why*.
   - Visible to PMs? → entry in `whats-new/entries.json` (FR/EN `title`, one-line `short`, `body`; audience
     `all` or `creators`; newest entries go where the maintainer wants them in the digest — default: top).
     Pure bug fix with no visible change → no entry.
   - New UI strings in `i18n.js` in **both** FR and EN.
   - No raw error reaching the UI; Confluence/Jira content escaped or filtered (`confluence-format.js`).
   - Every changed `.js` passes `node --check`.
   - Optional for UI changes: run the `ui-reviewer` agent on the changed views.
3. **Preview**: the user's preview (`git config suricate.preview` → port in `ops/previews.json`) must show the
   branch's latest commit on `/version` with `deploy.state` = `success`. If not, run the `suricate-preview`
   skill first and let the user test.
4. **Push and open the PR**: `git push -u origin HEAD`. Write the PR description from
   `.github/pull_request_template.md` into a temp file, filled in (what/why, what was tested on the preview,
   the checklist ticked honestly), then `gh pr create --base master --title "<short title>" --body-file <tmp>`.
   Without `gh`, give the user the URL
   `https://github.com/cyrillag/Suricate/compare/master...<branch>?expand=1` and the filled-in description to paste.
5. **Stop there.** Tell the user the maintainer reviews, merges and deploys prod. Never merge, never push
   `master`, never deploy.

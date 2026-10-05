---
name: suricate-preview
description: Deploy the current Suricate branch to the contributor preview (http://gw.lab.core.ovh.net:31625) and wait until it is live, reporting build failures with their log. Use when a contributor wants to test their change, says "déploie sur la preview", "teste sur la preview", "/suricate-preview", or before opening a PR.
---

# Deploy to the contributor preview

The contributor preview is rebuilt automatically, within a minute, from the `preview/contrib` branch
(see `ops/README.md`). You never touch the host: you push, then poll `/version`.

1. **Check the branch.** Refuse to deploy from `master` (create a `feature/…` branch first). Make sure the
   work is committed — if there are uncommitted changes, show them and ask before committing.
   Run `node --check` on every changed `.js` file; fix syntax errors before pushing.
2. **Push** the current commit to the preview branch (a disposable pointer, force is expected):
   `git push --force origin HEAD:preview/contrib`
   Also push the feature branch itself (`git push -u origin HEAD`) so the work is backed up.
3. **Wait for the deploy.** Note `git rev-parse --short=7 HEAD`. Poll every 15 s, for up to 6 minutes:
   `curl -s http://gw.lab.core.ovh.net:31625/version`
   - `commit` equal to your short SHA and `deploy.state` = `success` → live.
   - `deploy.commit` = your SHA and `deploy.state` = `failure` → the build or the start failed:
     show `deploy.log_tail`, diagnose, fix, commit, and deploy again (a failed commit is never retried).
   - Still the old commit after ~2 minutes with `deploy.state` not `deploying` → the poller hasn't picked it
     up yet; keep waiting. After 6 minutes, say so and suggest asking the maintainer to check the host's
     `~/suricate-contrib/autodeploy.log`.
4. **Report**: the URL (`http://gw.lab.core.ovh.net:31625`), the commit deployed, and a short list of what to
   check by hand for this change (pages, projects, edge cases). The preview badge shows
   `Preview · contrib · <commit>`. Its database is the contributor's own (a copy of prod taken at setup):
   generating or deleting reports there doesn't affect prod.

Notes: only one contributor branch is live at a time on this preview — deploying another branch replaces it.
The preview uses the app's real Jira/Confluence access, read-only in practice; it cannot send the Webex digest.

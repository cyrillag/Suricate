---
name: suricate-preview
description: Deploy the current Suricate branch to the user's own preview and wait until it is live, reporting build failures with their log. Use when someone wants to test a change, says "déploie sur la preview", "mets ça sur ma preview", "teste sur la preview", "/suricate-preview", or before opening a PR.
---

# Deploy to my preview

Everyone has their own preview (`ops/previews.json`: slug → name, port), rebuilt automatically within a
minute from the branch `preview/<slug>` (see `ops/README.md`). You never touch the host: you push, then poll.

1. **Whose preview.** `git config --get suricate.preview` gives the slug. If it's empty, ask the user which
   name in `ops/previews.json` is theirs and set it (`git config suricate.preview <slug>`). Read the port
   from `ops/previews.json`; the URL is `http://gw.lab.core.ovh.net:<port>`.
2. **Check the branch.** Refuse to deploy from `master` unless the user explicitly wants to see master on
   their preview. Make sure the work is committed — if not, show the changes and ask before committing.
   Run `node --check` on every changed `.js` file; fix syntax errors before pushing.
3. **Push** the current commit to the preview branch (a disposable pointer, force is expected) and back up
   the branch itself:
   `git push --force origin HEAD:preview/<slug>` then `git push -u origin HEAD`
4. **Wait for the deploy.** Note `git rev-parse --short=7 HEAD`. Poll every 15 s, for up to 6 minutes:
   `curl -s http://gw.lab.core.ovh.net:<port>/version`
   - `commit` = your short SHA and `deploy.state` = `success` → live.
   - `deploy.commit` = your SHA and `deploy.state` = `failure` → the build or the start failed; the preview
     was rolled back to the previous version (`commit` shows it). Show the relevant lines of
     `deploy.log_tail`, diagnose, fix, commit, deploy again — a failed commit is never retried.
   - Old commit still there and `deploy.state` ≠ `deploying` after ~2 minutes → not picked up yet, keep
     waiting. After 6 minutes, say so: the maintainer can check `~/suricate-<slug>/autodeploy.log` on the host.
5. **Report** in plain words: "ta preview est à jour" with the URL, and what to check by hand for this
   change (pages, projects, edge cases). The badge reads `Preview · <Name> · màj <date heure>` — the time
   of this deploy, so the person can tell at a glance it's their version (hovering shows the change's
   message). Each preview has its own database: generating or deleting reports there never affects prod.

The preview reads Jira/Confluence/BigPicture with the app's real access and cannot send the Webex digest.

# project-reports-app

Weekly project status report generator for OVHcloud Baremetal/Undercloud projects. Replaces a
hand-maintained static `index.html` (the legacy "project-report" app) with a dynamic, multi-project
tool that pulls live data from Jira and Confluence and freezes it into a per-week snapshot.

## What it does

- Tracks multiple projects, each backed by a Confluence "Deliverables status" page and a Jira
  portfolio (root LVL2 epic + its children).
- Generates one **frozen report per ISO week** (`/projects/<slug>/<year>-W<week>`): executive
  summary, deliverable/workstream status matrix, Planning/Gantt of epics, Achievements/Blockers/
  Clarify highlights, and a risk register. Once generated, a week's report never re-derives from
  live Jira/Confluence data — see `FUNCTIONAL_RULES.md`.
- Epic statuses are normalized from raw Jira status strings into Done/In Progress/Blocked/To Start
  (`jira.js`'s `mapStatus`).
- FR/EN UI (`i18n.js`).
- Passwordless login: an email is looked up against the Jira user directory (`jira.js`'s
  `findUserByEmail`) — no separate password store.

## Stack

Node.js + Express + EJS, `better-sqlite3` (WAL mode) for storage, `connect-sqlite3` for sessions.
No build step, no test framework, no CI/CD — deployment is manual (see below).

## Running locally

```
npm install
cp .env.example .env   # fill in the values below
npm run dev             # node --watch server.js
```

### Required environment variables

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Session cookie signing secret. The app refuses to start if unset. |
| `JIRA_SERVICE_TOKEN` | Bearer token for Jira REST API calls (login lookup, epics, statuses). |
| `CONFLUENCE_SERVICE_TOKEN` | Bearer token for Confluence page fetches. |
| `CONFLUENCE_BASE` | Confluence base URL (defaults to `https://confluence.ovhcloud.tools`). |
| `PORT` | HTTP port (defaults to `3000`). |
| `DATA_DIR` | Directory for the SQLite files (defaults to `.`). |

## Running with Docker Compose

```
docker compose up -d --build
```

`docker-compose.yml` maps port `3000` in-container to `31621` on the host and persists
`/data` (the SQLite DB + WAL/SHM files) in a named volume. Secrets are supplied via `.env`
in the same directory, read through the `environment:` block.

## Deployment

There is no CI/CD — pushing to `origin/master` does not update any running instance by itself.
The lab deployment (`http://gw.lab.core.ovh.net:31621/`) and its isolated preview stack
(`http://gw.lab.core.ovh.net:31622/`, for verifying a branch before merging) are both
manually-managed `docker compose` checkouts, redeployed with `git pull && docker compose up -d
--build`. Workflow: feature branch → PR → verify on the preview port → merge → redeploy prod.

## Documentation

- `FUNCTIONAL_RULES.md` — the living spec of business/product rules agreed with the project
  owner that aren't derivable from the code alone. Read this before touching report-generation
  logic, status mapping, or anything Confluence/Jira-sourced.

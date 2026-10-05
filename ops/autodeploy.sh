#!/usr/bin/env bash
# Suricate — contributor preview auto-deploy (see ops/README.md and CONTRIBUTING.md).
#
# Runs every minute from cron on the sdev host, as the host owner. Watches the contributor's preview
# branch on GitHub and, when it moved, rebuilds and restarts that contributor's own preview stack.
# Contributors never need access to the host: they push to `preview/<slot>` and read the result on
# GitHub (commit status) or at http://<host>:<port>/version.
#
# Install (once, from master):  install -m 755 ops/autodeploy.sh ~/bin/suricate-autodeploy
# Cron:                          * * * * * $HOME/bin/suricate-autodeploy contrib 31625 >/dev/null 2>&1
#
# Isolation: the compose file and the env file live in the slot directory, outside the git checkout,
# so a branch can change the app's code and Dockerfile but not the ports, mounts or secrets. The
# host's ~/.git-credentials is only read here, never exposed to the build context or the container.
set -uo pipefail

SLOT="${1:-contrib}"
PORT="${2:-31625}"
BRANCH="preview/${SLOT}"
BASE="$HOME/suricate-${SLOT}"
SRC="$BASE/src"
STATUS_DIR="$BASE/status"
LOG="$BASE/autodeploy.log"
STATE="$BASE/deployed.sha"
REPO="cyrillag/Suricate"
PUBLIC_URL="http://gw.lab.core.ovh.net:${PORT}"
PROJECT="suricate-${SLOT}"

[ -d "$SRC/.git" ] || exit 0
mkdir -p "$STATUS_DIR"
exec 9>"$BASE/.lock"
flock -n 9 || exit 0                      # a deploy is already running

log() { echo "$(date -Is) [$SLOT] $*" >> "$LOG"; }

cd "$SRC" || exit 0
git fetch -q origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}" 2>/dev/null || exit 0
SHA="$(git rev-parse -q --verify "refs/remotes/origin/${BRANCH}")" || exit 0
[ "$SHA" = "$(cat "$STATE" 2>/dev/null)" ] && exit 0
SHORT="${SHA:0:7}"
MSG="$(git log -1 --format=%s "$SHA" 2>/dev/null | head -c 120)"

# GitHub commit status, shown on the commit and on any PR containing it. Uses the host's own GitHub
# token (git credential store); best effort — a failure here never blocks the deploy.
gh_status() {
  local token
  token="$(sed -n 's#^https://[^:]*:\([^@]*\)@github\.com.*#\1#p' "$HOME/.git-credentials" 2>/dev/null | head -1)"
  [ -n "$token" ] || return 0
  curl -s -m 10 -o /dev/null -X POST \
    -H "Authorization: token $token" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/statuses/${SHA}" \
    -d "{\"state\":\"$1\",\"context\":\"suricate/preview-${SLOT}\",\"description\":\"$2\",\"target_url\":\"${PUBLIC_URL}\"}" || true
}

# Status file mounted read-only into the container and served by /version — the only way a
# contributor sees a failed build's log without host access.
write_status() {
  local state="$1" tail
  tail="$(tail -n 40 "$BASE/last-build.log" 2>/dev/null | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | awk '{printf "%s\\n", $0}')"
  printf '{"commit":"%s","message":"%s","state":"%s","at":"%s","log_tail":"%s"}\n' \
    "$SHORT" "$(echo "$MSG" | sed 's/\\/\\\\/g; s/"/\\"/g')" "$state" "$(date -Is)" "$tail" > "$STATUS_DIR/deploy.json.tmp"
  mv "$STATUS_DIR/deploy.json.tmp" "$STATUS_DIR/deploy.json"
}

log "deploying ${SHORT} — ${MSG}"
gh_status pending "Déploiement de la preview ${SLOT} en cours…"
write_status deploying
git checkout -q --force --detach "$SHA"
sed -i '/^APP_VERSION=/d' "$BASE/${SLOT}.env"
echo "APP_VERSION=${SHORT}" >> "$BASE/${SLOT}.env"

if docker compose -p "$PROJECT" -f "$BASE/compose.yml" up -d --build > "$BASE/last-build.log" 2>&1; then
  ok=""
  for _ in $(seq 1 45); do
    case "$(curl -s -m 3 "http://localhost:${PORT}/version" 2>/dev/null)" in *"\"commit\":\"${SHORT}\""*) ok=1; break ;; esac
    sleep 2
  done
  if [ -n "$ok" ]; then
    log "ok"; write_status success; gh_status success "Preview ${SLOT} à jour (${SHORT})"
  else
    docker compose -p "$PROJECT" -f "$BASE/compose.yml" logs --tail 40 app >> "$BASE/last-build.log" 2>&1
    log "started but /version never showed ${SHORT}"; write_status failure; gh_status failure "La preview n'a pas démarré — voir /version"
  fi
else
  log "build failed"; write_status failure; gh_status failure "Build KO — voir ${PUBLIC_URL}/version"
fi
cat "$BASE/last-build.log" >> "$LOG"
echo "$SHA" > "$STATE"                    # never retry the same commit in a loop: push a fix instead
docker image prune -f > /dev/null 2>&1   # disk is tight on this host
# keep the log bounded
[ "$(wc -c < "$LOG")" -gt 2000000 ] && tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0

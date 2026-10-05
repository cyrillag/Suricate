#!/usr/bin/env bash
# Suricate — create a person's preview on the host, in one command (see ops/README.md).
#
#   ops/new-preview.sh <slug> [--tokens-from <env file>] [--data-from <docker volume>] [--ref <git ref>]
#
# Prerequisite: <slug> listed in ops/previews.json on master (display name + port).
# Creates ~/suricate-<slug>/ (git checkout in src/, compose.yml rendered from
# ops/preview/compose.template.yml, preview.env with its own SESSION_SECRET), optionally copies the
# Jira/Confluence/BigPicture tokens from an existing env file (never the Webex digest token) and seeds
# the database from an existing volume, (re)installs the deploy agent and adds its cron line.
# The preview deploys itself as soon as the branch preview/<slug> exists on GitHub.
set -euo pipefail

SLUG="${1:?usage: new-preview.sh <slug> [--tokens-from FILE] [--data-from VOLUME]}"; shift
TOKENS_FROM=""; DATA_FROM=""; REF="origin/master"   # --ref: read the ops files from another branch (first install only)
while [ $# -gt 0 ]; do
  case "$1" in
    --tokens-from) TOKENS_FROM="$2"; shift 2 ;;
    --data-from)   DATA_FROM="$2"; shift 2 ;;
    --ref)         REF="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

BASE="$HOME/suricate-$SLUG"
REPO_URL="https://github.com/cyrillag/Suricate.git"
mkdir -p "$BASE/status" "$HOME/bin"
if [ ! -d "$BASE/src/.git" ]; then git clone -q "$REPO_URL" "$BASE/src"; fi
git -C "$BASE/src" fetch -q origin
TEMPLATE="$(git -C "$BASE/src" show "$REF":ops/preview/compose.template.yml)"
PREVIEWS="$(git -C "$BASE/src" show "$REF":ops/previews.json)"

read -r PORT NAME < <(printf '%s' "$PREVIEWS" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d)[process.argv[1]];
    if(!p){console.error("slug not in ops/previews.json");process.exit(1)}
    console.log(p.port+" "+p.name)})' "$SLUG")
[ -n "${PORT:-}" ] || exit 1
echo "preview $SLUG — $NAME — port $PORT"

printf '%s\n' "$TEMPLATE" | sed -e "s/__SLUG__/$SLUG/g" -e "s/__PORT__/$PORT/g" -e "s/__NAME__/$NAME/g" > "$BASE/compose.yml"

if [ ! -f "$BASE/preview.env" ]; then
  umask 077
  printf 'SESSION_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '=+/\n')" > "$BASE/preview.env"
fi
if [ -n "$TOKENS_FROM" ]; then
  # Only what the app needs to read Jira/Confluence/BigPicture — never DIGEST_* (a preview must not be
  # able to post the Webex digest).
  sed -i -E '/^(JIRA_SERVICE_TOKEN|CONFLUENCE_SERVICE_TOKEN|CONFLUENCE_BASE|BIGPICTURE_API_TOKEN)=/d' "$BASE/preview.env"
  grep -E '^(JIRA_SERVICE_TOKEN|CONFLUENCE_SERVICE_TOKEN|CONFLUENCE_BASE|BIGPICTURE_API_TOKEN)=' "$TOKENS_FROM" >> "$BASE/preview.env" || true
  echo "tokens copied from $TOKENS_FROM: $(grep -cE '^(JIRA|CONFLUENCE|BIGPICTURE)_' "$BASE/preview.env") line(s)"
fi

if [ -n "$DATA_FROM" ]; then
  VOL="suricate-${SLUG}_data"
  docker volume create "$VOL" > /dev/null
  # any local image with a shell will do; the app image is always there
  IMG="$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -m1 -E '^(project-reports-app|suricate-)' )"
  docker run --rm --entrypoint sh -v "$DATA_FROM":/from:ro -v "$VOL":/to "$IMG" -c 'cp -a /from/. /to/'
  echo "database seeded from volume $DATA_FROM into $VOL"
fi

git -C "$BASE/src" show "$REF":ops/autodeploy.sh > "$HOME/bin/suricate-autodeploy"
chmod 755 "$HOME/bin/suricate-autodeploy"
( crontab -l 2>/dev/null | grep -v "suricate-autodeploy $SLUG " ; echo "* * * * * \$HOME/bin/suricate-autodeploy $SLUG $PORT >/dev/null 2>&1" ) | crontab -
echo "cron installed. Push a branch to preview/$SLUG to deploy: http://gw.lab.core.ovh.net:$PORT"

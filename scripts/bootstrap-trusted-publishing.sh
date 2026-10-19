#!/usr/bin/env bash
# Reserve each public @dcmjs-org package name with a placeholder publish, then
# attach the GitHub Actions trusted publisher that CI's OIDC exchange expects.
# Run after `npm login` as a dcmjs-org admin. Safe to re-run: an existing
# package or trust config is reported, not treated as fatal.
#   --dry-run  preview the publish and trust calls
#   --status   only report each package's dist-tags and trust configs
# Each trust call asks for 2FA in the browser; the script waits for it.
set -uo pipefail

MODE="${1:-}"
DRY=""
[ "$MODE" = "--dry-run" ] && DRY="--dry-run"

# Every non-private workspace package under packages/, as its directory name.
cd "$(dirname "$0")/.."
PACKAGES="$(node -e '
const fs = require("fs");
for (const d of fs.readdirSync("packages")) {
  const f = `packages/${d}/package.json`;
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!j.private && j.name === `@dcmjs-org/${d}`) console.log(d);
}')"
REPO="dcmjs-org/dcmjs"
echo "Packages: $(echo $PACKAGES)"
WORK="$(mktemp -d)"
SUMMARY=""

npm whoami || exit 1

for p in $PACKAGES; do
  name="@dcmjs-org/$p"
  [ "$MODE" = "--status" ] && continue

  if npm view "$name" name >/dev/null 2>&1; then
    published="exists"
  else
    echo "== publish placeholder for $name"
    dir="$WORK/$p"
    mkdir -p "$dir"
    cat > "$dir/package.json" <<EOF
{
  "name": "$name",
  "version": "0.0.0-bootstrap.0",
  "description": "Placeholder that reserves the name. CI publishes the real releases.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/$REPO.git",
    "directory": "packages/$p"
  }
}
EOF
    echo "# $name" > "$dir/README.md"
    if (cd "$dir" && npm publish --access public --tag bootstrap $DRY); then
      published="published"
    else
      published="PUBLISH FAILED"
    fi
  fi

  echo "== trust publish-package.yml / publish env for $name"
  if npm trust github "$name" \
    --file publish-package.yml \
    --repository "$REPO" \
    --environment publish \
    --allow-publish --yes $DRY; then
    trusted="trusted"
  else
    trusted="trust call failed (already configured? see list below)"
  fi
  SUMMARY="$SUMMARY$name: $published, $trusted"$'\n'
done

echo
for p in $PACKAGES; do
  name="@dcmjs-org/$p"
  echo "== $name"
  npm view "$name" dist-tags 2>/dev/null || echo "not on npm"
  npm trust list "$name" || echo "trust list failed"
done

if [ -n "$SUMMARY" ]; then
  echo
  echo "Summary:"
  printf '%s' "$SUMMARY"
fi

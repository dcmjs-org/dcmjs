#!/usr/bin/env bash
# Reserve each public @dcmjs-org package name with a placeholder publish, then
# attach the GitHub Actions trusted publisher that CI's OIDC exchange expects.
# Run after `npm login` as a dcmjs-org admin. Pass --dry-run to preview.
set -euo pipefail

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

PACKAGES="core schemas dicomdir parser legacy generator"
REPO="dcmjs-org/dcmjs"
WORK="$(mktemp -d)"

npm whoami

for p in $PACKAGES; do
  name="@dcmjs-org/$p"
  if npm view "$name" name >/dev/null 2>&1; then
    echo "== $name already exists, skip placeholder"
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
    (cd "$dir" && npm publish --access public --tag bootstrap $DRY)
  fi

  echo "== trust publish-package.yml / publish env for $name"
  npm trust github "$name" \
    --file publish-package.yml \
    --repository "$REPO" \
    --environment publish \
    --allow-publish --yes $DRY
done

echo
for p in $PACKAGES; do npm trust list "@dcmjs-org/$p"; done

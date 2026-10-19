#!/usr/bin/env bash
# Usage: check-installed.sh name@version...
# Fails unless each package resolves (from the current directory) to exactly
# the requested version. `npm install --no-save` over a lockfile with
# conflicting peers only warns, so this is what proves the min-peers job is
# really testing the versions it names rather than the devDependencies.
set -euo pipefail
status=0
for spec in "$@"; do
  name="${spec%@*}"
  want="${spec##*@}"
  # A path, not a bare specifier: three 0.152 doesn't export ./package.json.
  got="$(node -p "require('./node_modules/$name/package.json').version")"
  if [ "$got" = "$want" ]; then
    echo "$name@$got"
  else
    echo "::error::$name resolved to $got, expected $want"
    status=1
  fi
done
exit "$status"

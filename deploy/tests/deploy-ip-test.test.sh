#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
temp_parent="${TMPDIR:-/tmp}"
workspace="$(mktemp -d "$temp_parent/astrosite-deploy-test.XXXXXX")"
cleanup() {
  case "$workspace" in "$temp_parent"/astrosite-deploy-test.*) rm -rf -- "$workspace" ;; *) echo 'Unexpected test directory; refusing cleanup.' >&2 ;; esac
}
trap cleanup EXIT
mkdir -p "$workspace/bin"
export CURRENT_SHA=1111111111111111111111111111111111111111

cat > "$workspace/bin/git" <<'GIT'
#!/usr/bin/env bash
if [ "$*" = 'rev-parse HEAD' ]; then printf '%s\n' "$CURRENT_SHA"; else exit 98; fi
GIT
cat > "$workspace/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  *' build') [ "${FAIL_STAGE:-}" != build ] || exit 22 ;;
  *' exec -T db '*) printf 'mock-postgres-backup\n' ;;
  *' --exit-code-from migrate migrate') [ "${FAIL_STAGE:-}" != migration ] || exit 33 ;;
  *' port gateway 80') printf '0.0.0.0:8080\n' ;;
  *' port gateway 81') printf '127.0.0.1:8081\n' ;;
  *' ps --status running --services') printf 'db\napi\nworker\nfrontend\ngateway\n' ;;
esac
exit 0
DOCKER
cat > "$workspace/bin/curl" <<'CURL'
#!/usr/bin/env bash
case "${!#}" in
  */api/health) printf '{"status":"ok"}' ;;
  http://127.0.0.1:8080/admin|http://127.0.0.1:8080/api/admin/me) printf 403 ;;
esac
exit 0
CURL
chmod +x "$workspace/bin/"*
export PATH="$workspace/bin:$PATH"

run_case() {
  local name="$1" fail_stage="$2" expected="$3"
  local app_dir="$workspace/$name"
  mkdir -p "$app_dir/deploy"
  cp "$repo_dir/deploy/deploy-ip-test.sh" "$app_dir/deploy/"
  touch "$app_dir/docker.env"
  export COMMAND_LOG="$app_dir/commands.log"
  export FAIL_STAGE="$fail_stage"
  local result=0
  bash "$app_dir/deploy/deploy-ip-test.sh" "$CURRENT_SHA" > "$app_dir/output.log" 2>&1 || result=$?
  test "$result" = "$expected" || { cat "$app_dir/output.log"; echo "Unexpected exit in $name: $result"; exit 1; }
  if [ "$expected" = 0 ]; then
    test "$(cat "$app_dir/.deployment/last-deployed-commit")" = "$CURRENT_SHA"
    grep -q mock-postgres-backup "$app_dir/.deployment/backups/"*.dump
    grep -q -- '--force-recreate gateway' "$COMMAND_LOG"
    local backup_line migration_line rollout_line
    backup_line="$(grep -n ' exec -T db ' "$COMMAND_LOG" | cut -d: -f1)"
    migration_line="$(grep -n -- '--exit-code-from migrate migrate' "$COMMAND_LOG" | cut -d: -f1)"
    rollout_line="$(grep -n ' up -d --no-build api worker frontend' "$COMMAND_LOG" | cut -d: -f1)"
    test "$backup_line" -lt "$migration_line"
    test "$migration_line" -lt "$rollout_line"
  else
    test ! -e "$app_dir/.deployment/last-deployed-commit"
    if grep -q ' up -d --no-build api worker frontend' "$COMMAND_LOG"; then
      echo "Application rollout occurred after a failed $name"; exit 1
    fi
  fi
  echo "Passed: $name"
}
run_case healthy '' 0
run_case build_failure build 22
run_case migration_failure migration 33
echo 'Deployment orchestration tests passed (all Docker/Git/HTTP calls mocked).'

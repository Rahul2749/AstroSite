#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$app_dir"
target_sha="${1:?Pass the tested Git commit SHA}"
[[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA.'; exit 1; }
test "$(git rev-parse HEAD)" = "$target_sha" || { echo 'Checkout does not match the tested commit.'; exit 1; }
test -f docker.env || { echo 'Configure docker.env on the VPS first.'; exit 1; }

dc() { docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml "$@"; }
diagnose() {
  dc ps -a || true
  # Provider credentials and request bodies are never printed by application logging.
  dc logs --tail=60 api worker frontend gateway || true
}
trap 'result=$?; echo "Deployment failed (exit $result). Review logs and migration compatibility before rollback."; diagnose; exit "$result"' ERR

dc config --quiet
# Build before changing the running services.
dc build
dc up -d --wait --wait-timeout 90 db

# Back up only this Compose project's database before applying schema changes.
umask 077
mkdir -p .deployment/backups
backup_file=".deployment/backups/veda-$(date -u +%Y%m%dT%H%M%SZ)-${target_sha:0:12}.dump"
dc exec -T db sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_file"
test -s "$backup_file"
echo "Database backup saved to $backup_file"

# Force the one-shot migration container to run for every release, including
# releases where its Compose configuration is unchanged. Failure stops rollout.
dc up --no-deps --force-recreate --exit-code-from migrate migrate
dc up -d --no-build api worker frontend
# Nginx resolves container addresses on startup; refresh it after replacements.
dc up -d --no-build --force-recreate gateway

public_address="$(dc port gateway 80)"
admin_address="$(dc port gateway 81)"
public_port="${public_address##*:}"
[[ "$public_port" =~ ^[0-9]+$ ]]
[[ "$admin_address" == 127.0.0.1:* ]] || { echo 'Admin gateway must remain bound to loopback.'; exit 1; }
for attempt in $(seq 1 45); do
  if curl --fail --silent --max-time 5 "http://127.0.0.1:$public_port/api/health" | grep -q '"status":"ok"' \
    && curl --fail --silent --head --max-time 5 "http://127.0.0.1:$public_port/" >/dev/null \
    && [ "$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$public_port/admin")" = 403 ] \
    && [ "$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$public_port/api/admin/me")" = 403 ] \
    && curl --fail --silent --head --max-time 5 "http://$admin_address/admin" >/dev/null; then
    running_services="$(dc ps --status running --services)"
    for service in db api worker frontend gateway; do
      grep -qx "$service" <<< "$running_services"
    done
    printf '%s\n' "$target_sha" > .deployment/last-deployed-commit
    echo "Deployment is healthy: $target_sha"
    exit 0
  fi
  sleep 2
done
echo 'Timed out waiting for application health.'
diagnose
exit 1

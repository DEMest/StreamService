#!/usr/bin/env bash
set -euo pipefail
umask 077

config="${ARCHIVE_MIRROR_CONFIG:-$HOME/.config/streamservice-archive-mirror}"
bucket=streamservice-archive
source_host=$(< "$config/source.host")
source_ssh="rootuser@$source_host"
image=$(docker inspect --format '{{.Image}}' streamservice-minio)

case "${1:-}" in
  '') mode=mirror ;;
  --dry-run) mode=dry-run ;;
  *) echo 'Usage: mirror-archive.sh [--dry-run]' >&2; exit 2 ;;
esac

exec 9>"$config/mirror.lock"
flock -n 9 || exit 0

work=$(mktemp -d /tmp/streamservice-archive.XXXXXX)
cleanup() {
  if [[ -S "$work/ssh.sock" ]]; then ssh -S "$work/ssh.sock" -O exit "$source_ssh" >/dev/null 2>&1 || true; fi
  rmdir "$work"
}
trap cleanup EXIT

ssh -fN -M -S "$work/ssh.sock" -o ExitOnForwardFailure=yes -o BatchMode=yes \
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$config/source_known_hosts" \
  -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -i "$config/tunnel" -L 127.0.0.1:19000:127.0.0.1:9000 "$source_ssh"
curl -fsS --max-time 10 http://127.0.0.1:19000/minio/health/live >/dev/null

# Идентичности отдельные для чтения источника и записи в резерв. Версии
# объектов хранятся на резерве, удаление объектов источника не переносится.
docker run --rm --network host --read-only --tmpfs /tmp:mode=1777 \
  --mount "type=bind,source=$config/source.secret,target=/source.secret,readonly" \
  --mount "type=bind,source=$config/target.secret,target=/target.secret,readonly" \
  --entrypoint /bin/sh "$image" -c '
    set -eu
    export MC_HOST_primary="http://archive-mirror-read:$(cat /source.secret)@127.0.0.1:19000"
    export MC_HOST_standby="http://archive-mirror-write:$(cat /target.secret)@127.0.0.1:9000"
    mode=$1
    bucket=$2
    set -- mirror --retry --max-workers 2 --limit-download 16MiB --limit-upload 16MiB --overwrite
    if [ "$mode" = dry-run ]; then set -- "$@" --dry-run; fi
    exec mc --config-dir /tmp/mc --quiet "$@" "primary/$bucket" "standby/$bucket"
  ' sh "$mode" "$bucket"
printf '%s archive mirror %s OK\n' "$(date -Is)" "$mode"

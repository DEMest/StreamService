#!/usr/bin/env bash
set -euo pipefail

# Строит и проверяет один Git-коммит. Реестр и кластер для этого не нужны.
sha=${1:-}
if [[ ! "$sha" =~ ^[a-f0-9]{40}$ ]] || ! git cat-file -e "$sha^{commit}"; then
  printf 'Укажите полный SHA коммита из текущего репозитория.\n' >&2
  exit 2
fi
: "${SITE_URL:?Укажите SITE_URL стенда или production}"

source_dir=$(mktemp -d)
trap 'rm -rf -- "$source_dir"' EXIT
git archive --format=tar "$sha" | tar -xf - -C "$source_dir"
cd "$source_dir"

api="streamservice-api:$sha"
web="streamservice-web:$sha"
media="streamservice-mediamtx:$sha"
revision="org.opencontainers.image.revision=$sha"

docker build --label "$revision" -t "$api" -f apps/api/Dockerfile .
docker run --rm --network none --entrypoint pnpm "$api" --filter api test --runInBand

docker build --label "$revision" -t "$web" -f apps/web/Dockerfile \
  --build-arg "SITE_URL=$SITE_URL" \
  --build-arg "NEXT_PUBLIC_SOCKET_URL=$SITE_URL" \
  --build-arg "NEXT_PUBLIC_DEMO_VIDEO_URL=${NEXT_PUBLIC_DEMO_VIDEO_URL:-}" \
  --build-arg "GOOGLE_SITE_VERIFICATION=${GOOGLE_SITE_VERIFICATION:-}" \
  --build-arg "YANDEX_VERIFICATION=${YANDEX_VERIFICATION:-}" .
docker run --rm --network none --entrypoint pnpm "$web" --filter web exec tsc --noEmit

docker build --label "$revision" -t "$media" infra/mediamtx
printf 'Проверенные локальные образы:\n%s\n%s\n%s\n' "$api" "$web" "$media"

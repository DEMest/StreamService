#!/usr/bin/env bash
set -euo pipefail

# Печатает манифест, применение остаётся отдельным действием оператора.
if [ "$#" -ne 4 ]; then
  printf 'Укажите четыре образа с digest: API, Web, MediaMTX, MinIO.\n' >&2
  exit 2
fi
for image in "$@"; do
  if ! [[ "$image" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9./_-]+@sha256:[a-f0-9]{64}$ ]]; then
    printf 'Каждый образ должен иметь адрес реестра и digest sha256.\n' >&2
    exit 2
  fi
done

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
cp -R "$root/k8s" "$scratch/"
mkdir "$scratch/k8s/overlays/release"
release="$scratch/k8s/overlays/release"

cat > "$release/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../prod
images:
YAML

for component in api web mediamtx minio; do
  printf '  - name: ghcr.io/demest/streamservice-%s\n    newName: %s\n    digest: %s\n' \
    "$component" "${1%@*}" "${1#*@}" >> "$release/kustomization.yaml"
  shift
done

kubectl kustomize "$release" > "$scratch/rendered.yaml"
if grep -q REPLACE_WITH_TAG "$scratch/rendered.yaml"; then
  printf 'В манифесте остались незаполненные теги.\n' >&2
  exit 1
fi
cat "$scratch/rendered.yaml"

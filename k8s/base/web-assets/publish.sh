#!/bin/sh
set -eu

cd /app/apps/web/.next/static
find . -type f | while IFS= read -r file; do
  target="/srv/web-assets/${file#./}"
  dir=$(dirname "$target")
  mkdir -p "$dir"
  if [ ! -e "$target" ]; then
    # Пишем во временный файл, чтобы nginx видел только завершённые файлы.
    temp=$(mktemp "$dir/.upload.XXXXXX")
    trap 'rm -f "$temp"' EXIT HUP INT TERM
    cp "$file" "$temp"
    chmod 644 "$temp"
    ln "$temp" "$target" 2>/dev/null || test -f "$target"
    rm -f "$temp"
    trap - EXIT HUP INT TERM
  fi
  if ! cmp -s "$file" "$target"; then
    printf 'Разное содержимое статического файла %s\n' "$file" >&2
    exit 1
  fi
done

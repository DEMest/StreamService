#!/usr/bin/env bash
# Разворачивает дистрибутив раннера на том (если том пуст), регистрируется в
# репозитории и запускается. Повторный старт с уже настроенным томом
# регистрацию пропускает — токен нужен только в первый раз.
set -euo pipefail

WORK_DIR=/home/runner/actions-runner

if [ ! -f "$WORK_DIR/config.sh" ]; then
  echo "==> Том пуст, разворачиваю дистрибутив раннера"
  cp -a /opt/runner-dist/. "$WORK_DIR/"
fi

cd "$WORK_DIR"

if [ ! -f .runner ]; then
  : "${REPO_URL:?нужен REPO_URL, например https://github.com/DEMest/StreamService}"
  : "${RUNNER_TOKEN:?нужен RUNNER_TOKEN — Settings → Actions → Runners → New self-hosted runner (живёт 1 час)}"

  echo "==> Регистрирую раннер в $REPO_URL"
  # --replace: если раннер с таким именем уже числится (например, после
  # пересоздания тома), затираем старую запись вместо ошибки регистрации.
  ./config.sh \
    --unattended \
    --replace \
    --url "$REPO_URL" \
    --token "$RUNNER_TOKEN" \
    --name "${RUNNER_NAME:-streamservice-ci}" \
    --labels "${RUNNER_LABELS:-self-hosted,linux,x64}" \
    --work _work
else
  echo "==> Раннер уже зарегистрирован, регистрацию пропускаю"
fi

# Снятие регистрации при штатной остановке контейнера, чтобы в списке раннеров
# не копились мёртвые записи. Без этого каждый docker compose down оставляет
# "offline" раннер, и GitHub продолжает считать его кандидатом на джобы.
cleanup() {
  echo "==> Снимаю регистрацию"
  ./config.sh remove --token "${RUNNER_TOKEN:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec ./run.sh

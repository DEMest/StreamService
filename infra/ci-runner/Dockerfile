# Self-hosted runner для GitHub Actions.
#
# Зачем контейнер, а не системный сервис: раннер выполняет то, что написано в
# workflow ЛЮБОЙ ветки. На этой машине рядом лежат .env с ключами S3, база и
# докер-сокет — раннеру там делать нечего. В контейнере он не видит ни одного
# из них: хостовых монтирований нет вообще (см. docker-compose.yml).
#
# Дистрибутив раннера лежит в /opt/runner-dist, а рабочий каталог — на томе.
# Так конфигурация регистрации переживает перезапуск, но образ остаётся
# пересобираемым: том пустой → entrypoint разворачивает дистрибутив заново.

FROM node:20-bookworm

# Версию поднимать вручную: раннер сам себя обновляет на лету, но образ должен
# стартовать с чего-то заведомо рабочего.
ARG RUNNER_VERSION=2.336.0

# libicu — обязательная зависимость .NET-рантайма раннера.
# git нужен actions/checkout, jq — удобство для отладочных шагов.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git jq libicu72 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash runner

# corepack enable ставит шимы pnpm/yarn в /usr/local/bin, а туда пишет только
# root. Джобы выполняются от runner, поэтому делаем это здесь, на сборке.
# Сам шим версионно-нейтрален: конкретную версию pnpm он берёт из
# "packageManager" проекта и складывает в кэш пользователя.
RUN corepack enable

# Без этого corepack при первом скачивании версии спрашивает подтверждение,
# а в неинтерактивной джобе это выглядит как зависание.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /opt/runner-dist
RUN curl -fsSL -o runner.tar.gz \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && tar xzf runner.tar.gz \
    && rm runner.tar.gz \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner /opt/runner-dist

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Раннер отказывается стартовать от root без явного RUNNER_ALLOW_RUNASROOT.
# Не обходим это, а работаем от обычного пользователя, как и задумано.
USER runner
WORKDIR /home/runner/actions-runner

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

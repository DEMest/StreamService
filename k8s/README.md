# Kubernetes (k3s)

Манифесты для запуска StreamService в Kubernetes вместо `docker-compose.yml`.
Целевая платформа — одноузловой k3s с встроенным Traefik. Это **первый шаг
переезда**: манифесты и локальный прогон. Прод они пока не затрагивают, и
`docker-compose.yml`, `infra/mediamtx/*`, CI и `deploy.sh` этим PR не изменены.

## Что внутри

```
k8s/
  base/             общие манифесты: postgres, minio, mediamtx, api, web, тома, Ingress
  overlays/
    local/          локальный стенд в k3d: http://localhost:8080, игрушечные секреты
    prod/           ЧЕРНОВИК боевого оверлея: домены, TLS, Traefik middleware
  cluster/          ставится один раз на кластер: настройка Traefik и ClusterIssuer
```

Имена сервисов (`postgres`, `minio`, `mediamtx`, `api`, `web`) намеренно те же,
что в compose: на них завязаны `mediamtx.yml` (`http://api:3001`), `on-ready.sh`
и build-arg `API_UPSTREAM` образа web. Не переименовывать.

`base/mediamtx.yml` повторяет `infra/mediamtx/mediamtx.yml` и дополнительно
включает внутренние метрики. При изменении приёма и вебхуков сверяй оба файла.

## Локальный прогон

Нужны Docker Desktop, `kubectl` и `k3d` (например, `scoop install k3d kubectl`
или `choco install k3d kubernetes-cli`). Команды — из корня репозитория.

```bash
# 1. Кластер. Порт 8080 вместо 80, чтобы не конфликтовать с чем-то на машине.
k3d cluster create stream \
  -p "8080:80@loadbalancer" \
  -p "1935:1935@loadbalancer" \
  -p "8890:8890/udp@loadbalancer"

# 2. Образы. NEXT_PUBLIC_* зашиваются в web на сборке, поэтому адрес — сейчас.
docker build -f apps/api/Dockerfile -t streamservice-api:dev .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_SOCKET_URL=http://localhost:8080 \
  -t streamservice-web:dev .
docker build -t streamservice-mediamtx:dev ./infra/mediamtx

# 3. Загрузить образы в кластер (из реестра они не тянутся).
k3d image import streamservice-api:dev streamservice-web:dev streamservice-mediamtx:dev -c stream

# 3a. Подготовить используемый в Compose образ MinIO, содержащий /usr/bin/mc.
# На машине с копией образа:
docker tag minio/minio:latest streamservice-minio:dev
k3d image import streamservice-minio:dev -c stream

# 4. Применить.
kubectl apply -k k8s/overlays/local

# 5. Дождаться готовности (api стартует дольше всех: миграции и seed).
kubectl -n streamservice get pods -w
```

Проверка:

- `http://localhost:8080` открывает сайт, `http://localhost:8080/login` — вход
  (`admin` / `adminpass`, это игрушечный пароль локального оверлея).
- `kubectl -n streamservice exec deploy/api -- wget -qO- localhost:3001/health`
  отвечает `{"status":"ok"}`.
- Чат: на странице эфира сообщение уходит и приходит (проверка `/socket.io`).
- Приём потока: в кабинете организации возьми адрес и ключ эфира и отправь
  тестовый поток на `rtmp://localhost:1935/...` (или SRT на `localhost:8890`).
- Архив (presigned-ссылки открывает браузер): держи открытым
  `kubectl -n streamservice port-forward svc/minio 9000:9000`, локальный оверлей
  уже указывает `S3_PUBLIC_ENDPOINT` на `http://localhost:9000`.

Логи: `kubectl -n streamservice logs deploy/api`, `deploy/mediamtx`, `deploy/web`.
Убрать всё: `k3d cluster delete stream`.

На отдельном стенде k3s v1.35.2 проверены запуск текущего приложения,
`/health`, доступ через Traefik, входящие SRT и RTMP и сохранение записи в MinIO.
Плейлист готового архива открылся через API. На двух репликах Web с маршрутом
через Kubernetes Service и отключённым повторным использованием соединений
получили 442 ответа `200` во время двух перезапусков и откатов. Проверка
использовала один образ. При последующем обновлении и откате между двумя версиями
получили 277 ответов `200` от HTML и 4 914 ответов `200` от статических файлов.
Проверка запрашивала файлы обеих версий в течение переключения.

При смене версии Web каждый новый под сначала публикует `.next/static` из
своего образа в общий том. Отдельный nginx отдаёт `/_next/static` с этого тома,
в том числе ресурсы предыдущей версии. При смене образа обновляй одновременно
`web` и `publish-static` либо применяй отрендеренный манифест, который
заменяет оба образа. Том рассчитан на одноузловой k3s. Следи за его размером
и сохраняй файлы текущего релиза и версии для отката.

### Если что-то не стартует

- `ErrImagePull` / `ImagePullBackOff` на образах из реестров: DNS внутри k3d-ноды
  (часто при включённом VPN). Выключить VPN, прописать DNS в Docker Desktop
  (`"dns": ["8.8.8.8", "1.1.1.1"]` в Docker Engine), перезапустить кластер.
- `docker build` падает на `apk add` или `corepack`: та же причина, помогает
  `docker build --network=host ...`.
- `k3d image import` пишет `content digest ... not found` (Docker Desktop с
  containerd-хранилищем): загрузить образ напрямую в ноду:
  `docker save --platform linux/amd64 <образ> -o x.tar`, затем
  `docker cp x.tar k3d-stream-server-0:/tmp/x.tar` и
  `docker exec k3d-stream-server-0 ctr -n k8s.io images import /tmp/x.tar`.
- Образы с тегом `latest` Kubernetes по умолчанию тянет всегда, а не берёт
  импортированный: в манифестах MinIO для этого стоит `imagePullPolicy: IfNotPresent`.
- Job `minio-init` неизменяем: перед повторным `apply` его нужно удалить
  (`kubectl -n streamservice delete job minio-init`).

## Секреты

В репозитории нет ни одного боевого секрета. Локальный оверлей генерирует
игрушечные значения. Для прода шаблон ключей лежит в
`overlays/prod/secret.example.yaml`: скопируй вне репозитория, заполни из
боевого `.env`, примени вручную. Способ хранения секретов на постоянку
(SealedSecrets, SOPS, внешнее хранилище) не выбран.

## Мониторинг

После запуска приложения добавить Prometheus и HTTP-проверки сервисов:

```bash
kubectl apply -k k8s/monitoring
kubectl -n streamservice rollout status deployment/streamservice-prometheus
kubectl -n streamservice port-forward deploy/streamservice-prometheus 9090:9090
```

В интерфейсе на `http://localhost:9090` запрос `probe_success` показывает
доступность API, Web и MinIO, а `up{job="mediamtx"}` — получение метрик
приёма. Состояние правил видно на вкладке Alerts. Данные сохраняются до 14
дней в отдельном томе. Для уведомлений нужен отдельный получатель Alertmanager.
Проверка CDN и доступности всего узла должна идти с другой машины.

Метрики MediaMTX доступны внутри кластера. При включении на существующем
кластере сначала обновить ConfigMap и Service, затем перезапустить MediaMTX
в окно без эфиров. Prometheus не публикуется через Ingress.

## Сборка и выпуск из любого CI

`infra/delivery/verify-release.sh` принимает полный SHA и строит образы из
этого коммита. Сборщик запускается на изолированном Linux-узле с Docker.
GitHub Actions, Jenkins и ручной оператор могут вызывать один и тот же скрипт.
Сборочный исполнитель не получает доступ к Kubernetes или production SSH.

```bash
SITE_URL=http://localhost:8080 bash infra/delivery/verify-release.sh "$sha"
```

Для production собрать Web с его публичным адресом и при необходимости
параметрами верификации сайта из Dockerfile. После зелёных проверок
загрузить образы в доступный кластеру реестр, сохранить digest каждого
и получить проверяемый манифест:

```bash
bash infra/delivery/render-release.sh "$api_image" "$web_image" \
  "$mediamtx_image" "$minio_image" > release.yaml
```

Каждый аргумент включает адрес реестра и `@sha256:…`. Перед применением
проверить diff, целевой контекст, доступ к реестру и текущий приём.
Для production используется отдельный операторский доступ. Первая выкатка
и перенос данных описаны в [порядке переключения](CUTOVER.md).

## Что не проверено

Манифесты прошли `kustomize build` и `kubeconform` (схемы Kubernetes 1.31;
CRD Traefik и cert-manager пропущены, схем у проверки нет). **Локальный
оверлей прогнан на k3d (k3s v1.35)**: все поды `Running`, `/health` api отвечает,
сайт и вход открываются через Ingress, чат работает, бакет архива создаётся
Job'ом. **Прод-оверлей на реальном кластере не применялся.** Особенно не проверено:

- порядок маршрутов в Traefik (приоритеты в `ingress-prod.yaml`) на реальном
  трафике;
- `traefik-config.yaml` (entrypoint `minio` на 9443): имена полей чарта;
- выпуск сертификата cert-manager по HTTP-01 через Traefik;
- один `LoadBalancer`-сервис с TCP и UDP портами под встроенным servicelb;
- общие тома `ReadWriteOnce` для mediamtx и api (работает только на одном узле).

## Условия для PR 2 (до переключения прода)

Что nginx делал на проде, а здесь пока нет:

- кэш HLS (`.m3u8` на 1 с, `.ts` на 5 с): Traefik его не умеет, без кэша
  нагрузка на web и api от зрителей выше;
- `limit_req` / `limit_conn`: зоны `global`, `qoe`, `conns` заданы в `nginx.conf`
  стека `edge`, которого в репозитории нет, перенести точно нечего;
- `access_log ... capacity` и отдельный маршрут `/api/v1/public/qoe` (на проде
  их тоже нет, см. `infra/deploy/DEPLOY.md`);
- `robots.txt` на `admin.` и `ads.` (заменён заголовком `X-Robots-Tag`);
- `Access-Control-Allow-Origin: *` на HLS-маршрутах.

- **Образ MinIO.** Загрузка `cgr.dev/chainguard/minio` и `minio-client` на стенде
  вернула `403`. Локальный оверлей принимает тот же образ MinIO, что и Compose.
  Если на машине его нет, перенесите проверенный образ через `docker save`
  и `docker load`. На стенде проверен образ
  `minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
  Для production нужен доступный из кластера реестр с закреплённым образом.

Остаётся выбрать: способ выкатки (ArgoCD или `kubectl` из CI) и реестр образов,
хранение секретов, размеры томов, перенос данных (Postgres, записи, MinIO) и
окно простоя. Подробности — в issue и в runbook PR 2.

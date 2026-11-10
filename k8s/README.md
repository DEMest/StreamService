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

`base/mediamtx.yml` — **копия** `infra/mediamtx/mediamtx.yml`. Правишь один файл —
правь и второй.

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

# 3a. Образы MinIO берутся с cgr.dev (Chainguard), Docker Hub и quay.io их больше
# не публикуют. Скачать и загрузить так же, как свои:
docker pull cgr.dev/chainguard/minio:latest
docker pull cgr.dev/chainguard/minio-client:latest
k3d image import cgr.dev/chainguard/minio:latest cgr.dev/chainguard/minio-client:latest -c stream

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

- **Образ MinIO.** `minio/minio` убран с Docker Hub и quay.io (октябрь 2025).
  Сейчас в манифестах временный бесплатный образ Chainguard
  (`cgr.dev/chainguard/minio:latest` и `minio-client`, без выбора тега).
  В `docker-compose.yml` на проде скорее всего `minio/minio:latest`: пока образ
  закеширован на сервере, всё работает, но обновить его или поднять на чистой
  машине нельзя. Нужно решить: форк с образами, закреплённая сборка или другое
  S3-хранилище (Garage, SeaweedFS). Образ `mediamtx` тоже стоит закрепить по тегу.

Остаётся выбрать: способ выкатки (ArgoCD или `kubectl` из CI) и реестр образов,
хранение секретов, размеры томов, перенос данных (Postgres, записи, MinIO) и
окно простоя. Подробности — в issue и в runbook PR 2.

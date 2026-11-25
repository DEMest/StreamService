# Зеркало архива MinIO

Для [#120](https://github.com/DEMest/StreamService/issues/120) резервный сервер забирает изменения бакета `streamservice-archive` с HostKey каждые 15 минут. Запуск выполняется от `rootuser` через cron и ограничен двумя параллельными копиями. При активном проходе следующий запуск пропускается.

## Доступы

Создать на резерве каталог `~/.config/streamservice-archive-mirror` с режимом `700`. В нём находятся:

| Файл | Содержимое |
|---|---|
| `source.host` | Tailscale-адрес HostKey |
| `source_known_hosts` | SSH-ключ хоста, сверенный через уже доверенное SSH-подключение |
| `tunnel` | Приватная половина отдельного ключа для SSH-туннеля |
| `source.secret` | Случайный hex-секрет пользователя MinIO `archive-mirror-read` на HostKey |
| `target.secret` | Отдельный случайный hex-секрет пользователя `archive-mirror-write` на резерве |

Секреты и ключ имеют режим `600`. Для нового ключа в `authorized_keys` на HostKey задать `from="<tailscale-ip-резерва>",restrict,port-forwarding,permitopen="127.0.0.1:9000",command="/bin/false"`. Туннель слушает только `127.0.0.1:19000` на резерве и закрывается после прохода.

Обе политики MinIO ограничены бакетом архива и его объектами. На источнике разрешены `s3:GetBucketLocation`, `s3:ListBucket` и `s3:GetObject`. На резерве дополнительно разрешены `s3:PutObject`, `s3:ListBucketMultipartUploads`, `s3:ListMultipartUploadParts` и `s3:AbortMultipartUpload`. На резервном бакете включено версионирование. Удаления с источника остаются локальными для источника.

## Запуск и проверка

На резервном сервере установить скрипт и проверить его с настройками из этого каталога:

```bash
cfg="$HOME/.config/streamservice-archive-mirror"
install -m 700 infra/deploy/mirror-archive.sh "$cfg/mirror-archive.sh"
"$cfg/mirror-archive.sh" --dry-run
"$cfg/mirror-archive.sh"
```

Добавить к crontab пользователя `rootuser`:

```cron
*/15 * * * * /home/rootuser/.config/streamservice-archive-mirror/mirror-archive.sh >> /home/rootuser/.config/streamservice-archive-mirror/mirror.log 2>&1
```

В `mirror.log` искать строки `archive mirror mirror OK` после каждого завершённого прохода. Для проверки восстановления загрузить выбранный объект из резервного MinIO в отдельный временный каталог и сравнить SHA-256 с исходным файлом. Если копия не обновилась, проверить SSH-туннель, доступность обоих MinIO и остаток места на резерве.

Перед повышением резерва в прод убрать этот cron-запуск и дождаться завершения текущего копирования. При возвращении HostKey сначала сверить записи, созданные на резерве после переключения, и выбрать новое направление копирования.

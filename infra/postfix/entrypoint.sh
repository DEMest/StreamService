#!/usr/bin/env bash
#
# Исходящий-only SMTP-релей для liga-live.ru. Единственные клиенты — MailService
# (apps/api) и ~/ops/notify.py на хосте, оба уже шлют SASL PLAIN/LOGIN с теми же
# SMTP_USER/SMTP_PASS, что у Gmail раньше — поэтому здесь всё завязано на SASL,
# без доверия по подсети: даже сервисы из docker-сети должны авторизоваться.
set -euo pipefail

: "${MAIL_DOMAIN:?MAIL_DOMAIN is required}"
: "${MAIL_HOSTNAME:?MAIL_HOSTNAME is required}"
: "${DKIM_SELECTOR:=mail}"
: "${SMTP_USER:?SMTP_USER is required}"
: "${SMTP_PASS:?SMTP_PASS is required}"

SASL_USER="${SMTP_USER%%@*}"

# ── Postfix: базовая конфигурация ──────────────────────────────────────────
postconf -e "myhostname = ${MAIL_HOSTNAME}"
postconf -e "mydomain = ${MAIL_DOMAIN}"
postconf -e "myorigin = \$mydomain"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mydestination = localhost"
postconf -e "relayhost ="
postconf -e "biff = no"
postconf -e "append_dot_mydomain = no"

# Ни один клиент не доверенный по адресу — только по SASL. Так же, как
# MEDIAMTX_WEBHOOK_SECRET не полагается на то, что запрос пришёл из docker-сети.
postconf -e "mynetworks = 127.0.0.0/8"
postconf -e "smtpd_relay_restrictions = permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_recipient_restrictions = permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_sasl_auth_enable = yes"
postconf -e "smtpd_sasl_security_options = noanonymous"
# $mydomain (= MAIL_DOMAIN), а не $myhostname: SMTP_USER — это email на
# MAIL_DOMAIN (совпадает с MAIL_FROM, см. mail.service.ts), Cyrus SASL при
# логине с "@" берёт realm из части после "@" в самой строке — она должна
# совпасть с realm записи в sasldb ниже, иначе AUTH падает с 535 в самом
# частом случае (SMTP_USER вида notify@liga-live.ru).
postconf -e "smtpd_sasl_local_domain = \$mydomain"
postconf -e "smtpd_sasl_type = cyrus"
postconf -e "smtpd_sasl_path = smtpd"

# Релей живёт только в приватной docker-сети (+ localhost хоста через
# проброшенный порт) — самоподписанный сертификат тут не нужен и не должен
# ронять nodemailer на проверке (у MailService rejectUnauthorized не менялся).
postconf -e "smtpd_tls_security_level = none"
postconf -e "smtp_tls_security_level = may"

# Входящий приём на 25 не нужен — это не MX домена, только исходящая доставка.
# Клиенты подключаются на submission (587), а Postfix-как-клиент шлёт вовне
# сам, без листенера на 25.
sed -i -E 's/^smtp([[:space:]]+)inet/#smtp\1inet/' /etc/postfix/master.cf
if ! postconf -Mf 2>/dev/null | grep -q '^submission/inet'; then
  postconf -M submission/inet="submission inet n - n - - smtpd" 2>/dev/null || true
fi

# ── SASL: единственный пользователь, из тех же SMTP_USER/SMTP_PASS, что у api ──
mkdir -p /etc/postfix/sasl
cat > /etc/postfix/sasl/smtpd.conf <<EOF
pwcheck_method: auxprop
auxprop_plugin: sasldb
mech_list: PLAIN LOGIN
EOF
# Realm = MAIL_DOMAIN — должен совпасть с тем, что Cyrus SASL вычисляет из
# SMTP_USER на логине (см. комментарий у smtpd_sasl_local_domain выше).
echo "${SMTP_PASS}" | saslpasswd2 -p -c -u "${MAIL_DOMAIN}" "${SASL_USER}"
chown postfix:sasl /etc/sasldb2
chmod 640 /etc/sasldb2
adduser postfix sasl >/dev/null 2>&1 || true

# ── DKIM (opendkim) ─────────────────────────────────────────────────────────
mkdir -p /etc/opendkim/keys /run/opendkim
if [ ! -f "/etc/opendkim/keys/${DKIM_SELECTOR}.private" ]; then
  opendkim-genkey -b 2048 -d "${MAIL_DOMAIN}" -s "${DKIM_SELECTOR}" -D /etc/opendkim/keys
fi
chown -R opendkim:opendkim /etc/opendkim/keys /run/opendkim

cat > /etc/opendkim.conf <<EOF
Syslog          yes
UMask           002
Domain          ${MAIL_DOMAIN}
Selector        ${DKIM_SELECTOR}
KeyFile         /etc/opendkim/keys/${DKIM_SELECTOR}.private
Socket          inet:8891@127.0.0.1
PidFile         /run/opendkim/opendkim.pid
Mode            sv
SubDomains      no
AutoRestart     yes
UserID          opendkim
EOF

postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:127.0.0.1:8891"
postconf -e "non_smtpd_milters = inet:127.0.0.1:8891"

echo "── DKIM DNS TXT (${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}) ──"
cat "/etc/opendkim/keys/${DKIM_SELECTOR}.txt"
echo "──────────────────────────────────────────────────────────────"

# ── Запуск: opendkim в фоне, postfix — на переднем плане (PID 1) ───────────
runuser -u opendkim -- /usr/sbin/opendkim -x /etc/opendkim.conf &

exec /usr/sbin/postfix start-fg

#!/bin/sh
# Builds /tmp/alertmanager.yml from alertmanager.yml (a template) and the environment, then runs Alertmanager.
#   ALERT_WEBHOOK_URL                           Slack/Teams/PagerDuty-style webhook receiver (the URL is kept in a file, not the config)
#   ALERT_SMTP_SMARTHOST (host:port), ALERT_EMAIL_FROM, ALERT_EMAIL_TO  e-mail receiver; optional ALERT_SMTP_USER,
#   ALERT_SMTP_PASSWORD, ALERT_SMTP_REQUIRE_TLS (default true)
set -eu
TEMPLATE=/etc/alertmanager/alertmanager.yml.tmpl
OUT=/tmp/alertmanager.yml

# Values go through sed: escape its special characters.
esc() { printf '%s' "$1" | sed 's/[\\&|]/\\&/g'; }

keep_webhook=0; keep_email=0; keep_auth=0
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  keep_webhook=1
  umask 077
  printf '%s' "$ALERT_WEBHOOK_URL" > /tmp/webhook_url
fi
if [ -n "${ALERT_SMTP_SMARTHOST:-}" ] && [ -n "${ALERT_EMAIL_TO:-}" ] && [ -n "${ALERT_EMAIL_FROM:-}" ]; then
  keep_email=1
  if [ -n "${ALERT_SMTP_USER:-}" ]; then
    keep_auth=1
    umask 077
    printf '%s' "${ALERT_SMTP_PASSWORD:-}" > /tmp/smtp_password
  fi
fi
if [ "$keep_webhook" = 0 ] && [ "$keep_email" = 0 ]; then
  echo "WARNING: neither ALERT_WEBHOOK_URL nor the ALERT_SMTP_*/ALERT_EMAIL_* variables are set: alerts will not be delivered anywhere." >&2
fi

sed \
  -e "s|__ALERT_SMTP_SMARTHOST__|$(esc "${ALERT_SMTP_SMARTHOST:-}")|" \
  -e "s|__ALERT_EMAIL_FROM__|$(esc "${ALERT_EMAIL_FROM:-}")|" \
  -e "s|__ALERT_EMAIL_TO__|$(esc "${ALERT_EMAIL_TO:-}")|" \
  -e "s|__ALERT_SMTP_USER__|$(esc "${ALERT_SMTP_USER:-}")|" \
  -e "s|__ALERT_SMTP_REQUIRE_TLS__|${ALERT_SMTP_REQUIRE_TLS:-true}|" \
  "$TEMPLATE" > "$OUT.1"

# Drop the optional blocks that are not configured; the markers themselves are comments, so kept lines stay valid.
[ "$keep_webhook" = 1 ] || sed -i '/# \[webhook\]/d' "$OUT.1"
[ "$keep_email" = 1 ] || sed -i '/# \[email\(-auth\)\?\]/d' "$OUT.1"
[ "$keep_auth" = 1 ] || sed -i '/# \[email-auth\]/d' "$OUT.1"
mv "$OUT.1" "$OUT"

# A receiver without any configuration is valid: the alerts are then only visible in the UI.
exec /bin/alertmanager --config.file="$OUT" --storage.path=/alertmanager "$@"

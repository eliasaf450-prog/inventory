#!/usr/bin/env bash
#
# סקריפט התקנה אוטומטי ל-Ubuntu/Debian VPS.
# מתקין Node.js 22, Caddy (ל-HTTPS אוטומטי), מקים שירות systemd ומפעיל הכל.
#
# שימוש (כ-root או עם sudo):
#   sudo DOMAIN=inventory.example.com REPO=https://github.com/eliasaf450-prog/inventory.git bash deploy/setup.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:?חובה להגדיר DOMAIN, למשל DOMAIN=inventory.example.com}"
REPO="${REPO:?חובה להגדיר REPO, כתובת ה-git של הפרויקט}"
APP_DIR="/opt/inventory"
APP_USER="inventory"

echo "==> מעדכן חבילות והתקנת כלי בסיס"
apt-get update -y
apt-get install -y curl git ca-certificates

echo "==> מתקין Node.js 22.x"
if ! node --version 2>/dev/null | grep -q "v2[2-9]"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> מתקין Caddy (HTTPS אוטומטי)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> יוצר משתמש מערכת ומושך את הקוד"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> מתקין שירות systemd"
install -m 644 "$APP_DIR/deploy/inventory.service" /etc/systemd/system/inventory.service
systemctl daemon-reload
systemctl enable --now inventory
sleep 2
systemctl --no-pager --full status inventory | head -6 || true

echo "==> מגדיר Caddy עם הדומיין $DOMAIN"
sed "s/inventory.example.com/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl restart caddy

echo
echo "================================================================"
echo "  ההתקנה הושלמה!"
echo "  פתחו בדפדפן:  https://$DOMAIN"
echo "  התחברו עם:    admin / admin123  (החליפו סיסמה מיד!)"
echo
echo "  עדכון גרסה בעתיד:  cd $APP_DIR && sudo git pull && sudo systemctl restart inventory"
echo "  גיבוי הנתונים:     $APP_DIR/data/inventory.db"
echo "================================================================"

#!/usr/bin/env bash
# EC2 上执行：拉取 main 并生效（由 GitHub Actions SSH 调用，或手动运行）
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/count168}"
BRANCH="${BRANCH:-main}"

echo "==> deploy start: user=$(whoami) host=$(hostname) root=${APP_ROOT}"
df -h "$APP_ROOT" / 2>/dev/null | tail -n +2 || true

# Ensure PHP APCu is present — dashboard_api.php's per-subsidiary capture cache
# (dash_cap_v1:*) silently no-ops without it, so every company x currency request
# would recompute the full pipeline (the Group/Company All first-paint stall).
# Idempotent: dnf skips already-installed packages; no-op when sudo is unavailable.
if command -v sudo >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then
  if ! php -m 2>/dev/null | grep -qi '^apcu$'; then
    echo "==> installing php-pecl-apcu (dashboard capture cache)"
    sudo dnf install -y php-pecl-apcu || echo "WARN: apcu install failed — cache stays disabled (slow but correct)"
    sudo systemctl restart php-fpm || true
  else
    echo "==> php apcu already loaded"
  fi
fi

cd "$APP_ROOT"

if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "ERROR: ${APP_ROOT}/.git missing — run deploy/ec2-amazon-linux-setup.sh first"
  exit 1
fi

fix_repo_permissions() {
  echo "==> fixing repo ownership for $(whoami)"
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: ${APP_ROOT}/.git is not writable and sudo is unavailable"
    exit 1
  fi
  if ! sudo chown -R "$(whoami):nginx" "$APP_ROOT"; then
    sudo chown -R "$(whoami):$(id -gn)" "$APP_ROOT"
  fi
}

if [[ ! -w "$APP_ROOT/.git/objects" ]] || [[ ! -w "$APP_ROOT/.git/FETCH_HEAD" ]]; then
  fix_repo_permissions
fi

echo "==> git fetch + reset to origin/${BRANCH}"
if ! git fetch origin "$BRANCH"; then
  echo "==> git fetch failed, retry after chown"
  fix_repo_permissions
  git fetch origin "$BRANCH"
fi
git reset --hard "origin/${BRANCH}"

if command -v chcon >/dev/null 2>&1; then
  chcon -R -t httpd_sys_content_t "$APP_ROOT" 2>/dev/null || true
fi

# C168 Mobile SPA nginx include (works with certbot le-ssl after one-time patch)
MOBILE_INC_SRC="$APP_ROOT/deploy/nginx/c168-mobile-locations.inc"
MOBILE_INC_DST="/etc/nginx/conf.d/c168-mobile-locations.inc"
NGINX_SSL="/etc/nginx/conf.d/count168.site-le-ssl.conf"
NGINX_SRC="$APP_ROOT/deploy/nginx/count168.site.amazon-linux.conf"
NGINX_DST="/etc/nginx/conf.d/count168.site.conf"
LE_CERT="/etc/letsencrypt/live/count168.site/fullchain.pem"

# certbot 会把旧的 inline SPA 正则拷进 le-ssl；仅更新 .inc 时 HTTPS 仍可能走旧正则
patch_mobile_spa_maintenance() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if sudo grep -q '|account|more|reset-password|' "$f" && ! sudo grep -q '|account|maintenance|more|' "$f"; then
    echo "==> inject maintenance into mobile SPA regex: $f"
    sudo sed -i 's/|account|more|reset-password|/|account|maintenance|more|reset-password|/g' "$f"
  fi
}

if [[ -f "$MOBILE_INC_SRC" ]]; then
  echo "==> sync c168 mobile nginx include"
  sudo cp "$MOBILE_INC_SRC" "$MOBILE_INC_DST"
  if [[ -f "$NGINX_SSL" ]]; then
    # 在每个 server_name count168.site 块后确保 include（HTTP + HTTPS）
    if ! sudo grep -q 'c168-mobile-locations.inc' "$NGINX_SSL"; then
      echo "==> patch count168.site-le-ssl.conf for /c168_mobile/"
      sudo sed -i '/server_name count168.site/a \    include /etc/nginx/conf.d/c168-mobile-locations.inc;' "$NGINX_SSL"
    fi
    # 即使已有 include，也修补 le-ssl 里可能残留的旧 inline 正则
    patch_mobile_spa_maintenance "$NGINX_SSL"
  fi
  patch_mobile_spa_maintenance "$NGINX_DST"
fi

# 同步 Nginx 站点配置（git pull 不会自动更新 /etc/nginx/）
# certbot 已上 HTTPS 时跳过整文件覆盖，避免毁掉 le-ssl；路由增量由上方 patch 负责
if [[ -f "$LE_CERT" ]] || [[ -f "$NGINX_SSL" ]]; then
  echo "==> skip nginx full config sync (certbot HTTPS active for count168.site)"
elif [[ -f "$NGINX_SRC" ]]; then
  echo "==> sync nginx site config"
  NGINX_BAK="$(mktemp)"
  sudo cp "$NGINX_DST" "$NGINX_BAK" 2>/dev/null || true
  sudo rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
  sudo cp "$NGINX_SRC" "$NGINX_DST"
  if ! sudo nginx -t; then
    echo "ERROR: nginx -t failed after config sync — restoring previous config"
    if [[ -f "$NGINX_BAK" ]]; then
      sudo cp "$NGINX_BAK" "$NGINX_DST"
      sudo nginx -t || true
    fi
    rm -f "$NGINX_BAK"
    exit 1
  fi
  rm -f "$NGINX_BAK"
fi

if systemctl is-active --quiet nginx 2>/dev/null; then
  if ! sudo nginx -t; then
    echo "ERROR: nginx -t failed — check c168-mobile-locations.inc / le-ssl patch"
    exit 1
  fi
  sudo systemctl reload nginx
fi

echo "==> Deploy OK at $(date -Iseconds)"
FRONTEND_INDEX="${APP_ROOT}/frontend/dist/index.html"
if [[ -f "$FRONTEND_INDEX" ]]; then
  grep -o 'index-[A-Za-z0-9_-]*\.js' "$FRONTEND_INDEX" | head -1 || true
fi

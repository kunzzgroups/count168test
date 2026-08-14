# c168_lynx — ReactLynx mobile entry

Login + Member Win/Loss on Lynx. Existing `c168_mobile` stays as the current phone SPA.

## Local

```bash
# repo root
php -S 127.0.0.1:8000

# another terminal
cd c168_lynx
npm install
npm run dev
```

Open the Web preview URL. `/api` proxies to PHP on `:8000`.

## Live

After deploy: https://count168.site/c168_lynx/

Pack the static host (web runtime + `main.web.bundle`):

```bash
cd c168_lynx
npm run build:web
```

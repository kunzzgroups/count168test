import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const web = path.join(root, 'web')
const srcStatic = path.join(root, 'node_modules', '@lynx-js', 'web-core', 'dist', 'client_prod', 'static')
const bundle = path.join(root, 'dist', 'main.web.bundle')

if (!fs.existsSync(bundle)) {
  throw new Error('Missing dist/main.web.bundle — run rspeedy build first')
}
if (!fs.existsSync(srcStatic)) {
  throw new Error('Missing @lynx-js/web-core client_prod — run npm install')
}

fs.rmSync(web, { recursive: true, force: true })
fs.mkdirSync(web, { recursive: true })
fs.cpSync(srcStatic, path.join(web, 'static'), { recursive: true })
fs.copyFileSync(bundle, path.join(web, 'main.web.bundle'))
fs.writeFileSync(
  path.join(web, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>EazyCount</title>
    <link rel="stylesheet" href="./static/css/client.css" />
    <style>
      html, body { margin: 0; height: 100%; background: #0b1f4a; }
      lynx-view { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <lynx-view url="./main.web.bundle" style="width:100%;height:100%"></lynx-view>
    <script type="module" src="./static/js/client.js"></script>
  </body>
</html>
`,
)

console.log('packed', web)

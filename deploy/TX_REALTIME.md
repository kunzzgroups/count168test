# App-wide realtime sync（SSE Invalidate Bus）

保存成功后，其他开着相关页面的浏览器经 SSE 收到变更信号，静默重拉数据（约 &lt;1s）。**不推送完整业务行**，客户端按权限自行 refetch。

Transaction Payment 的 `ledger_changed` 仍兼容；新域使用 `domain_changed` + `domain` 字段。

## 组件

| 组件 | 路径 |
|------|------|
| Node SSE hub | `services/tx-realtime/server.mjs` |
| PHP publish（通用） | `api/includes/realtime.php` |
| PHP ledger 兼容包装 | `api/includes/ledger_realtime.php` |
| Ticket API（全站） | `api/realtime/ticket_api.php` |
| 前端单连接 | `frontend/src/lib/realtime/AppRealtimeBridge.jsx`（AuthenticatedLayout） |
| 页面订阅 | `useRealtimeDomain(domain, refetch)` |
| systemd | `deploy/systemd/tx-realtime.service` |

## 桌面端已覆盖页面

| Domain | 写（publish） | 读（subscribe / invalidate） |
|--------|---------------|------------------------------|
| `ledger` | submit / contra / process→tx | Transaction、TX Maintenance、Dashboard、Reports、Member |
| `accounts` | account CRUD/link/currency… | Account List、TX To/From、Bank Process、User Access |
| `processes` | process CRUD/list writes | Process List、Bank Process、User Access、Data Capture Query |
| `datacapture` | submissions / catalog / summary | Data Capture Query、Summary |
| `ownership` | owners / company-group | Ownership |
| `users` | userlist create/update、toggle、useraccess | User List、User Access |
| `maintenance` | capture/formula/payment/bank/site maint | 各 Maintenance 页、Announcement |
| `announcements` | announcement CRUD | Announcement |
| `domain` | domain_api writes | Domain |

暂缓：Deleted Log、Auto Renew（无/弱 publish）；mobile 另线。

## 新人接新功能（checklist）

1. **写 API 成功后**：

```php
require_once __DIR__ . '/../includes/realtime.php';
realtime_publish_companies([$company_id], 'accounts', 'add');
```

2. **列表页**：

```js
useRealtimeDomain(REALTIME_DOMAINS.ACCOUNTS, () => refreshList({ silent: true }));
```

3. Hub / nginx / secret **不用改**。

## EC2 部署

```powershell
powershell -ExecutionPolicy Bypass -File deploy\winscp-deploy-ec2.ps1
```

发版前端请用 `npm run build:deploy`（或脚本内 build）保留 hashed assets。

`includes/config.local.php` 的 `$tx_realtime_secret` 须与 `services/tx-realtime/.env` 一致。

排障：

- `/realtime/health` 的 `clients` ≥ 已登录开着 SPA 的浏览器数
- Network 里 `/realtime/sse` 应长期 **pending**（不是红叉）。红叉常见原因：ticket 过期后浏览器用同一 URL 重试；前端已改为 `onerror` 立刻关连并重新领票
- ticket 有效期 6h；公司切换会 debounce 后按 scope 重连（scope 未变且已 OPEN 则跳过）
- Cloudflare：勿对 `/realtime/*` 开缓存；Rocket Loader 若干扰可对站点关闭

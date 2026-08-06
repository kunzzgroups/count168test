# Group 一等租户契约（路线 B · Phase 0–5）

> 状态：Phase 0–5 已落地。Company 默认路径不得被 Group 改动语义。  
> 模块入口：`includes/group_tenant_v2.php`（与 `gc_resolve_company_category_flags` 子公司并集解耦）。

## 1. 产品契约

| 项 | 约定 |
|---|---|
| 空 Group 登录 | 允许。Owner 用 Group ID；已绑定 Admin / 其他账号（`user_group_map`）也可进 |
| Category | Group **写死** `["Games"]`；与 `company.permissions`、子公司并集无关 |
| DataCapture 格式 | Group → Bank 式 payroll UI；身份仍是 Games |
| Bank 式 DC 受众 | C168、**所有 Group domain**、Bank-only 公司 |
| Games 公司 | 正常 Games Data Capture |
| Stub company | **禁止** |
| Add User / Account | 空 Group 走 `groups.id` / `user_group_map` / `scope_type=group`（`company_id` 可为 NULL） |
| Currency / account_company | 纯 Group 行：`company_id` **NULL**（FK 拒 0）。迁移：`20260731_currency_company_id_nullable.sql`、`20260731_account_company_company_id_nullable.sql` |

## 2. Session 契约（Group login）

| 字段 | 含义 |
|---|---|
| `login_scope` | `"group"` |
| `login_identifier` | Group code（大写） |
| `login_group_scope_id` | `groups.id` |
| `company_id` | 可为 `null` / `0`（空 Group）；选中子公司后为该子公司 id |
| Category flags（纯 Group / group-entity） | `company_has_gambling=true`, `company_has_bank=false`, `company_permissions=["Games"]` |
| Category flags（已选真实子公司） | 跟该子公司 `company.permissions`（Bank-only → 无 Report；Games / C168 → 有 Report） |

## 3. 阶段状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 契约 + 验收清单 | ✅ |
| 1 | 空 Group 登录 + session | ✅ |
| 2 | 侧栏 / session Games 门禁 | ✅ |
| 3 | DC scope/draft 允许无 anchor | ✅ |
| 4 | UserList 绑 `user_group_map`；Account/Currency 纯 group ledger | ✅ |
| 5 | Domain 持久化 Group=`["Games"]`；前端 Group Settings 同步 | ✅ |
| 6 | 验收堵漏（Currency / Account / DC / Link scope…） | ✅ |
| 7 | 空 Group → 第一家真实子公司衔接 | ✅（P0 登录；KK+子公司 TT 筛选展示用户确认） |
| 8 | Ownership：空 Group / Group login 双轨 | ✅ |
| 9 | Transaction：Group / Company 双账本对齐 | ✅ |
| 10 | Report：Group / Company 双账本（Customer / Domain） | ✅ |
| 11 | Maintenance：Group / Company 双账本对齐 | ✅ |

## 3b. Phase 7 产品约定

| 项 | 约定 |
|---|---|
| 账本 | **双账本**：Group ledger（`scope_type=group`）与子公司 ledger 分开；禁止 stub |
| Group ID 登录 | `login_scope=group`，**`company_id=null`**；即使已有子公司，也不 pin 第一家公司 |
| 公司 ID 登录 | 不变（走该公司 session） |
| 筛选默认 | Group 登录后 **Group-only**；用户再点 Company pill 进子公司 |
| 侧栏 | Group 登录固定 Games；进公司 pill / 公司登录再按该公司 category |
| Domain 加公司 | 选 Group → Add Company → `company.group_id` + `group_company_map`（已有路径） |

## 3c. Phase 8 Ownership 约定

| 项 | 约定 |
|---|---|
| Group Earnings 列表 | 从 `groups` 表出组（空 Group 也显示）；子公司只作 company_count |
| Group login 范围 | 只显示当前可访问 Group（`gc_session_can_access_group_ledger`） |
| Available accounts | `groups.owner` + `user_group_map` + 子公司 owners/users |
| Account Ownership | 子公司卡（如 TT）；默认筛到登录 Group |
| 写 API | `gc_assert_group_ledger_access` / company access 护栏 |

## 3d. Phase 9 Transaction 约定

| 项 | 约定 |
|---|---|
| Group-only | `scope_type=group` + `groups.id`；请求不传 `company_id` |
| Company pill | 子公司 ledger；与 Group 账本互不混入 |
| 空 Group boot | 无子公司也可进 Transaction（不依赖 owner companies 非空） |
| RATE / CONTRA | 账户与币种走 `tx_fetch_account_row` / `tx_resolve_currency_id_for_scope`；写行带 scope 列 |
| Currency order | 纯 Group 用 `group_id` 键（`g:{groups.id}`），不强制 company_id |

## 3e. Phase 10 Report 约定

| 项 | 约定 |
|---|---|
| Group-only | Category 闸门走 `gt_v2_group_category_access_ok`（Games）；Win/Lose 用 `scope_type=group` |
| Company pill | 子公司 ledger；与 Group 账本互不混入 |
| Customer / Domain | 共用 `resolveReportDualTenantCaptureScope`；FE groupIds 含 Domain/登录 Group |

## 3f. Phase 11 Maintenance 约定

| 项 | 约定 |
|---|---|
| Group-only boot | Group 登录默认 Group ledger（`company_id=null`）；与 Formula/Capture/Payment/Transaction Maint 对齐 `isMaintenanceGroupOnlyBoot` |
| Company pill | 子公司 ledger；`report_scope` + ledger filter 禁止混入 Group 行 |
| Formula | `formulaMaintenanceBuildTemplateLedgerFilter` 仅 `scope_type=group`；空 Group 可写（无 anchor）；Group ensure process 复制公式必须写 `scope_type=group`（`dcCopyTemplatesToProcess`）；历史错账本用 `scripts/_migrate_formula_templates_group_scope.php` promote |
| Capture / Txn Maint | Group 请求 `unset(company_id)`；dual-tenant 纯 Group 不因 `company_id=0` 短路空列表 |
| Payment | API 已用 `tx_resolve_transaction_list_scope`；FE boot 对齐 Group-only |
| Bankprocess | **无 Group ledger**（数据为 Bank 子公司）；Group 登录可进页再选 Bank 子公司（勿因 `company_has_bank=false` 踢出） |

## 4. 验收清单

### Company 回归

- [x] Company ID 登录（Games）→ 正常 DC / 展示（用户确认 AP+C168 等）
- [ ] Bank-only / C168 → Bank 式 DC（可选抽测）

### Group（KK 空 Group）

- [x] Owner KK / KK / 1 → 登录
- [x] User List → Add User 可开、可创建 Admin（写入 `user_group_map`）
- [x] Account List → Create Currency / Currency Setting 列表与删除（纯 Group）
- [x] Account List → Add Account（`group_only`）可成功
- [x] 侧栏 DataCapture 稳定；payroll 表单；Submit→Summary 不因 process ensure 失败
- [x] Domain 保存 Group 后 `groups.permissions` 为 `["Games"]`（含历史 NULL 回填：`scripts/_migrate_groups_permissions_games.php`）
- [ ] Ownership → Group Earnings：空 Group / KK 可见；可加载 available accounts
- [ ] Ownership → Account Ownership：KK+TT 可见子公司 TT 并展开
- [ ] Transaction → Group-only：空/有子公司均可进页；CONTRA/RATE 写入 `scope_type=group`
- [ ] Transaction → Company pill：只见子公司账本；与 Group 列表互不混入
- [ ] Transaction → Currency order：纯 Group 可拖拽保存（`group_id` / `g:{id}`）
- [ ] Maintenance → Formula/Capture/Payment/Txn：Group-only 与 Company pill 账本不混；空 Group 可搜/删（dual-tenant）
- [ ] Maintenance → Bankprocess：Group 登录可进页；选 Bank 子公司后可搜（无 Group ledger）
- [ ] Maintenance → Formula Group-only：纯 Group ensure 后的 SALARY 公式可见（需跑 promote 脚本清历史）

### 迁移脚本（发版 / site）

```bash
php scripts/_migrate_groups_permissions_games.php
php scripts/_migrate_formula_templates_group_scope.php
# 另见 database/migrations/20260731_*.sql 与 scripts/_migrate_account_link_scope.php 等
# 确认 pdo_db 指向目标库（本地 easycount / 发版 site）
```

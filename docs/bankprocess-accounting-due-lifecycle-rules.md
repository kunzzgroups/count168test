# Bank Process：状态与合同到期对 Accounting Due 出账的影响

> 适用范围：`bank_process` 的 `status`（active/inactive）与 `issue_flag`（''/official/e_invoice/block）两个字段，
> 如何共同决定 Accounting Due 是否继续生成账单，以及 Inactive → Active 之间的账期衔接规则。
> 只改变「何时停止/恢复出账」这一层判断，不改变已有的比例计算、精度、Resend、1+1/1+2/1+3 违约金等规则。

---

## 1. 背景

`bank_process` 表上有两个独立字段：

- `status`：`active` / `inactive`，纯粹的启停开关。
- `issue_flag`（或历史列名 `flag`）：`''` / `official` / `e_invoice` / `block`，前端 Status 下拉的 OFFICIAL / E-INVOICE / BLOCK 三个选项。切换这三项**不会**触碰 `status`，两个字段可以独立组合。

在这两个字段之外，合同（`contract` + `day_start`）与 `day_end`（含「Day end 旁开关」`day_end_monthly_cap_enabled`，仅 1st of Every Month 可编辑）共同决定了一份合同的自然到期日。旧逻辑里，**任何** `status=active` 的 process 一旦过了这个到期日，Accounting Due 就会停止出新账（只留一笔尾款）。

这份文档记录三条新规则，把「到期后继续出账 / 停止出账」按 `status` 和 `issue_flag` 的组合拆开。

---

## 2. 规则（现行）

| 状态组合 | day_end 旁开关 | 到期后的行为 |
|---|---|---|
| Active（`issue_flag=''`） | **OFF** | **不再停止**：合同/day_end 到期后继续按周期正常出账，无终止时间，直到手动切 Inactive |
| Active（`issue_flag=''`） | **ON** | 维持旧行为：到期即停（该开关本来就是显式「按 day_end 封顶」的开关） |
| Official / E-Invoice / Block | 不限 | 到期前照常出账；到期出完最后一笔尾款后**彻底停止**，此后修改/拉长 `day_end` **不会**重新触发出账（**功能一**） |
| Inactive → Active（任何 process、任何 frequency） | 不限 | Inactive 期间跳过、不补账；重新 Active 后**从重新激活当月 1 号**整月起算，无终止时间，直到再次 Inactive（**功能三**） |

补充：

- 1+1 / 1+2 / 1+3 合同在设为 Official / E-Invoice 时的一次性违约金入账（`manual_inactive`）逻辑**保留不变**，是叠加在上表之上的额外规则，不受本次改动影响。
- Resend、默认列表可见性（Official/E-Invoice/Block 不在默认列表、需要对应 Show 筛选）等既有行为不变。

---

## 3. 实现机制

### 3.1 新增字段（`ensure_bank_process_billing_extension_columns.php` 懒迁移，首次请求自动建表）

| 字段 | 类型 | 用途 |
|---|---|---|
| `bank_process.issue_flag_locked_end_ymd` | `DATE NULL` | 功能一：第一次侦测到「已过期」时冻结的截止日 |
| `bank_process.accounting_reactivated_floor_ymd` | `DATE NULL` | 功能三：最近一次 inactive→active 时写入的「本月 1 号」 |

### 3.2 功能一 — Official/E-Invoice/Block 到期即停（不再限定 1+1/1+2/1+3，也不再受拉长 day_end 影响）

- 每次读取该 process 时（Accounting Due 列表 / Post to Transaction 各自独立执行，算法完全一致）：
  1. 若 `issue_flag_locked_end_ymd` 已有值 → 直接用它覆盖当次计算用的 `day_end`（忽略数据库里真实的 `day_end`）。
  2. 否则按当前 `day_start` / `contract` / `day_end` 算出到期截止日；若「今天」还没到 → 不冻结，照常出账。
  3. 若「今天」已经过了截止日 → 把这个截止日写入 `issue_flag_locked_end_ymd`（一次性），并用它覆盖当次 `day_end`。
- 后续所有账期计算（含 day_end_tail 尾款）读到的都是这个冻结值，因此无论之后怎么改 `day_end`，都不会重新打开出账窗口；尾款只会因为「未曾入账」而正常出这一笔，出完之后（`process_accounting_posted` 已有记录）自然不再出现。
- 切回 ACTIVE / INACTIVE（`issue_flag` 清空）时，会同时清空 `issue_flag_locked_end_ymd`，process 重新进入功能二/三的规则。

### 3.3 功能二 — 纯 Active + day_end 旁开关 OFF：到期不再停

- 引入行级布尔 `unlimitedWindow = (issue_flag 为空) && (day_end_monthly_cap_enabled 为 OFF)`。
- 该开关仅 1st of Every Month 可编辑，其余 frequency 前端恒存 `0`，所以本条件对所有 frequency 天然生效。
- `unlimitedWindow=true` 时：
  - 核心窗口函数 `isWithinRecurringBillingWindow()` / `...ForTxn()` 直接短路返回 `true`（不再比较合同/day_end）。
  - 月付账期生成器内部的 `exclusiveEnd`（合同天然结束日）与 `anchorMonthCap`（首段后月数上限）也一并置空，交给「今天所在月」自然限速，不会一次性把历史所有月份都吐出来。
  - 原本用于「合同结束～day_end」补差的 day_end_tail 尾款逻辑不再触发（1st_of_every_month / monthly 两种频率），避免和持续出的整月账重复计费。Week / Day / Once 频率的既有尾款判断不受影响。

### 3.4 功能三 — Inactive → Active：跳过空档，从重新激活当月起算

- 复用了代码里本来就有的“创建日门槛”（`createdYmd`，原本用来防止新建流程倒补 day_start 之前的历史账）。
- `toggle_process_status_api.php` 在 `inactive → active` 时，把 `accounting_reactivated_floor_ymd` 写成「今天所在月的 1 号」。
- `createdYmdOrFallbackToday()`（及 Post-to-Transaction 侧的等价函数）在算出基准创建日后，再与这个门槛取较晚者。由于 1st_of_every_month / monthly（对日对月）两种月付频率本来就「只看当月这一期」，这条改动对它们是无操作的；真正被修复的是 **Week（周付）** 频率——此前 Inactive 期间跳过的每一周，重新 Active 后会被当作「未入账」逐一补出来，现在会被门槛统一拦掉，只从重新激活当月起继续。
- 不区分 frequency、不受 day_end 旁开关影响，统一生效。

---

## 4. 关键代码

| 位置 | 作用 |
|---|---|
| `api/includes/ensure_bank_process_billing_extension_columns.php` | 懒迁移两个新字段 |
| `api/processes/process_accounting_inbox_api.php` | `isWithinRecurringBillingWindow()` 新增 `$unlimitedWindow` 参数；`bmpApplyIssueFlagBillingLock()` 功能一冻结；`bmpRowUnlimitedWindow()` 功能二判断；`createdYmdOrFallbackToday()` 功能三门槛；`fetchActiveBankProcessesForInbox()` 补选新字段 |
| `api/processes/process_post_to_transaction_api.php` | 同上逻辑的独立实现（`...ForTxn` 后缀），`fetchBankProcessesByIds()` 补选新字段并在入账前独立复核冻结/窗口判断，与 Inbox 端各自幂等 |
| `api/processes/update_bank_issue_flag_api.php` | `issue_flag` 清空为 ACTIVE/INACTIVE 时清掉 `issue_flag_locked_end_ymd` |
| `api/processes/toggle_process_status_api.php` | `inactive → active` 时写入 `accounting_reactivated_floor_ymd` = 当月 1 号 |

---

## 5. 验收要点

1. **功能一**：Official 标记的 process，人为把 `day_end` 设到过去 → 到期前照常出账；到期出完最后一笔尾款后不再出新账；之后把 `day_end` 改到未来，确认账单**没有**恢复。
2. **功能二**：1st of Every Month + Day end 旁开关 **OFF** 的纯 Active process，合同到期后继续正常整月出账，且没有额外的尾款重复账；开关 **ON** 时到期仍旧停止（对照组）。
3. **功能三**：一个 Week 频率 process，今天设为 Inactive，几周后切回 Active → Accounting Due 只从重新激活当月开始出账，中间跳过的周不补。1st_of_every_month / monthly 频率同样操作应无变化（本来就只看当月）。
4. 确认 Resend 对 Official/E-Invoice/Block 依旧报错拦截；确认 1+1/1+2/1+3 合同打 Official/E-Invoice 标记时的一次性违约金入账仍照旧触发。

---

## 6. 已知限制 / 未覆盖

- 本次改动未经真实数据库跑测（本地/CI 均无自动化测试覆盖这套计费逻辑），仅完成了 `php -l` 语法检查与逐行走查，上线前请按第 5 节手动过一遍。
- Feature 1 的「首次侦测到过期」冻结是懒加载式的（第一次被读取到才会写入 `issue_flag_locked_end_ymd`），存量已经打了 Official/E-Invoice/Block 标记的 process，会在部署后第一次被 Accounting Due 或 Post to Transaction 读取时补冻结，不需要手动跑 SQL。

---

## 7. 回滚

还原本次改动涉及的 5 个 PHP 文件即可；新增的两个字段留在表里不影响旧代码运行（旧代码不会读取这两列）。

---

## 8. 补充修复（2026-08）：Resend 覆盖 day_start/day_end 污染 unlimitedWindow 判断

### 8.1 现象

一份「建立时合同就已过期、纯记录用途」的 process（例如 day_start/day_end 都是很久以前，Day end 旁开关 OFF），本来应该永远不再自动出账（见第 3.3 节）。但只要对它执行过 Resend（`accounting_resend_relax_created_floor = 1` 仍未处理完），Accounting Due 会**额外多出一笔当月正常流程账单**，且这笔账单在下次读取时可能反复出现——不管 Resend 弹窗填的日期是过去还是未来。

### 8.2 根因

`fetchActiveBankProcessesForInbox()`（`process_accounting_inbox_api.php`）/ `fetchBankProcessesByIds()`（`process_post_to_transaction_api.php`）在抓取每一行数据时，只要该行 `accounting_resend_relax_created_floor=1`，就会调用 `bmp_mergeResendScheduleIntoBankProcessRowForAccounting()` 把 `day_start`/`day_end` **临时覆盖成 Resend 弹窗填的锚点日期**（真实原始值另存进 `bank_process_stored_day_start`/`bank_process_stored_day_end`/`bank_process_stored_day_start_frequency`）。

问题是：这个覆盖发生在 `bmpRowUnlimitedWindow()` / `bmpRowUnlimitedWindowForTxn()`（第 3.3 节讲的「建档时合同已过期」判断）**之前**。这两个函数读到的 `day_start` 已经是 Resend 填的日期，不是合同真正的原始 day_start——用这个被覆盖的日期 + 合同期限去算「合同到期日」，只要 Resend 填的锚点落在未来（或距今够近），算出来的到期日会比真实建立日更晚，导致「建立时是否已过期」这条判断失效，本该被永久锁死的记录用合同又重新获得 `unlimitedWindow=true`，正常月度流程就被意外打开一次。

（这个 bug 和第 3.3 节原本要防的问题是同一类：`day_start`/`day_end`/建立日 任何一个被 Resend 相关的临时覆盖污染，都会让「建档时是否已过期」这条判断失真。第 3.3 节当时只处理了「有效建立日被 relax 拉低」这一种污染路径，这次是另一条「day_start/day_end 本身被 merge 覆盖」的路径。）

### 8.3 修复

`bmpRowUnlimitedWindow()`（`process_accounting_inbox_api.php`）与 `bmpRowUnlimitedWindowForTxn()`（`process_post_to_transaction_api.php`）在算「合同到期日」这一步，判断 `accounting_resend_relax_created_floor` 是否为真：
- 为真（有未处理的 Resend）→ 改用 merge 函数存下的原始值 `bank_process_stored_day_start`/`bank_process_stored_day_end`/`bank_process_stored_day_start_frequency`。
- 为假（没有 Resend 在等）→ 照旧读 `day_start`/`day_end`/`day_start_frequency`，不受影响。

Resend 锚点本身那笔补单不受此修复影响——它是走 `inboxAppendResendOpenAnchorRows()`/`inboxAppendMonthlyNeedToday()` 这条完全独立、不看 `unlimitedWindow` 的路径直接生成的。

### 8.4 验收要点

对一份建立时已过期、Day end 旁开关 OFF 的记录用合同执行 Resend（日期随便填过去或未来），确认 Accounting Due 只会出现你 Resend 的那几笔锚点，不会再多出当月/其他自然月的正常流程账单；对该笔 Resend 点 Transaction 入账，确认入账内容跟画面一致。

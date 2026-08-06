# Bank Process → Transaction 金额精度

> 适用范围：从 **bankProcess**（Accounting Due / 列表 Transaction / Resend 后入账等）写入 `transactions.amount` 的全部频率与 period 类型。  
> 不改变 Week / Day / Monthly / 1st of Every Month / Once 等业务日程规则，只统一金额小数位口径。

---

## 1. 问题

按天数比例入账时（例如 Buy=1000、7 月 2 天 → `1000 × 2/31 ≈ 64.516129…`），若在**写入 DB 前**就压成 2 位（trunc / Half Up），同一笔逻辑金额可能在不同账户一侧变成 `64.51`、另一侧 `64.52`，Transaction 列表左右 Win/Loss 对不平。

---

## 2. 规则（现行）

| 层 | 口径 | 说明 |
|---|---|---|
| **计算** | 高精度（`MONEY_CALC_SCALE`） | 比例、累加用 BC Math |
| **落库** | **6 位小数**（`MONEY_TX_STORE_SCALE`） | 截断到 6 位，**不做** Half Up 到 2 位 |
| **前端展示** | Half Up **2** 位 | 仅 UI；**禁止**用展示值做汇总 / 余额 / 分摊 |
| **汇总逻辑** | 用 `win_loss_full` 等高精度字段 | 先累加全精度，展示层再 Half Up |

示例：存库 `64.516129`；界面显示 `64.52`（Half Up）。

---

## 3. 覆盖范围（全部 bankProcess 入账）

凡经 `api/processes/process_post_to_transaction_api.php` 写入的金额，一律 6 位，包括但不限于：

- Frequency：`monthly`、`1st_of_every_month`、`week`、`day`、`once`
- Period：`partial_first_month`、`monthly`、`day_end_tail`、`weekly`、`daily` / `daily_consolidated`、`once_one_off`、`resend_consolidated_range`、`manual_inactive`
- 分录：Buy（Supplier）、Sell（Customer）、Profit（Company）、Profit Sharing

Accounting Due 预览比例（`process_accounting_inbox_api.php`）与入账共用同一 6 位口径，避免「列表预览 vs 入账」不一致。

---

## 4. 关键代码

| 位置 | 作用 |
|---|---|
| `api/includes/money_decimal.php` | 常量 `MONEY_TX_STORE_SCALE = 6` |
| `api/processes/process_post_to_transaction_api.php` | `txnStoreAmount()`；比例 / 乘子 / INSERT `amount` |
| `api/processes/contract_billing_addon.php` | monthly 线性比例、daily × 天数 |
| `api/processes/process_accounting_inbox_api.php` | Inbox 比例金额与 fingerprint 归一 |
| `frontend/.../TransactionWinLossCell.jsx` | 单元格 Half Up 2 位展示 |
| `frontend/.../TransactionTablesSection.jsx` | Win/Loss 优先读 `win_loss_full` 再展示 |
| `frontend/.../transactionPaymentLogic.js` | 汇总用 `win_loss_full`，不用展示 2 位 |

Description / Remark 里的可读金额仍可用 Half Up 2 位文案（`txnDescriptionAmount`），**不**作为落库值。

---

## 5. 验收要点

1. Process Buy=1000、`1st of Every Month`、仅 2 天比例入账 → DB `amount` 约为 `64.516129`（6 位），不是 `64.51` / `64.52`。
2. Transaction 主表左右对应账户展示均为 Half Up 后的同一 2 位观感；Total 汇总用全精度后应可对平（B/F+Win/Loss+Cr/Dr）。
3. 其它 frequency（Week / Day / Once / Monthly）入账同样写 6 位；日程与 period 规则不变。
4. 前端改金额展示类代码时，**不得**把 `formatTransactionGridMoneyHalfUp` 的结果再拿去加减。

---

## 6. 回滚

还原上述 PHP 落库 scale 与前端 `displayWinLossValue` 相关改动即可；无 DB migration（`transactions.amount` 列精度已足够）。

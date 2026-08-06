# Transaction 页面 — RATE 手动交易逻辑说明书

> 本文档说明 Transaction Payment（`/transaction`）右侧「手动交易账单」在 **Type = RATE** 时的完整行为：表单字段、即时计算、校验、提交 payload、后端落库、历史展示、余额归类。
>
> 目标读者：产品 / 开发。写法偏白话，但尽量落到具体字段与代码位置。
>
> **Service Fee / Platform Fee 现行规则（2026-07）：** 见 [`transaction-rate-service-platform-fee.md`](./transaction-rate-service-platform-fee.md)。本文 §18 仍写「Platform Fee 仅 UI」，**已过时**。

---

## 目录

1. [RATE 是什么](#1-rate-是什么)
2. [相关代码与文件](#2-相关代码与文件)
3. [表单 UI 结构](#3-表单-ui-结构)
4. [字段字典](#4-字段字典)
5. [汇率 Rate 的解析规则](#5-汇率-rate-的解析规则)
6. [即时计算逻辑（前端）](#6-即时计算逻辑前端)
7. [Middle-Man：Rate multiplier 与 Fee](#7-middle-manrate-multiplier-与-fee)
8. [第二组账户（Transfer）金额怎么算](#8-第二组账户transfer金额怎么算)
9. [提交前校验](#9-提交前校验)
10. [提交 Payload 组装](#10-提交-payload-组装)
11. [Description / Remark（SMS）规则](#11-description--remarksms规则)
12. [后端 submit 落库](#12-后端-submit-落库)
13. [分录类型与余额归类](#13-分录类型与余额归类)
14. [Payment History 展示加工](#14-payment-history-展示加工)
15. [提交成功后的前端行为](#15-提交成功后的前端行为)
16. [完整数字示例](#16-完整数字示例)
17. [场景对照表](#17-场景对照表)
18. [Platform Fee（当前状态）](#18-platform-fee当前状态)
19. [易误解点汇总](#19-易误解点汇总)
20. [后续扩展建议（仅备忘）](#20-后续扩展建议仅备忘)

---

## 1. RATE 是什么

RATE **不是**普通的 CONTRA / PAYMENT「一进一出」。

一次 RATE 手动交易可以理解为：

1. **第一组账户 + 第一币种**：在两个账户之间按「第一币种金额」做一笔换汇侧记账；
2. **货币行**：用汇率把第一币种金额换算成第二币种毛额（gross）；
3. **第二组账户 + 第二币种**（可选）：再在第二币种上做一对划转；金额可能因手续费被扣减，两边不一定相等；
4. **Middle-Man（可选）**：中间人抽成（比例乘数 和/或 固定 Fee），金额进 **Win/Loss**，不是 Cr/Dr。

整组交易在后端用同一个 `rate_group_id` 串起来，并 **直接 APPROVED**（不走待审批）。

---

## 2. 相关代码与文件

| 层级 | 路径 | 职责 |
|------|------|------|
| 页面入口 | `frontend/src/pages/transaction/TransactionPaymentPage.jsx` | 把 form state 传给 Add 区 |
| 表单 UI | `frontend/src/pages/transaction/components/TransactionAddSection.jsx` | RATE 字段渲染（含 Middle-Man / Platform Fee） |
| 表单状态与计算 | `frontend/src/pages/transaction/hooks/useTransactionForm.js` | 即时算金额、校验、调用 submit |
| Payload 组装 | `frontend/src/pages/transaction/lib/transactionSubmitHelpers.js` | `buildRatePayload`、`buildRateServiceFeeRemark` |
| 汇率/金额格式 | `frontend/src/pages/transaction/lib/transactionFormat.js` | `parseRateExpression`、`formatRateAmount`、小数位限制 |
| 文案 | `frontend/src/translateFile/pages/transactionTranslate.js` | Fee / Platform Fee / Middle-Man 等 |
| 样式 | `frontend/public/css/transaction.css` | `.rate-row-mm` 等布局（Middle-Man 现为 5 列） |
| 提交 API | `api/transactions/submit_api.php` | RATE 校验、写 transactions / rate 表 / transaction_entry |
| 历史 API | `api/transactions/history_api.php` | EXCH RATE / MARKUP 描述美化、符号、Win/Loss |
| 列表搜索 | `api/transactions/search_api.php` | RATE_MIDDLEMAN 计入 Win/Loss 过滤与汇总 |

---

## 3. 表单 UI 结构

当 `Type = RATE` 时：

- 标准交易字段（普通 To/From/Currency/Amount）**隐藏**；
- `#rate-transaction-fields` **显示**；
- 普通 **Remark 输入框隐藏**（RATE 的 remark/sms 由系统生成，见第 11 节）。

从上到下四块：

```text
┌─ Date ─────────────────────────────────────────────┐
│  交易日期（RATE 专用 date picker）                    │
└────────────────────────────────────────────────────┘

┌─ Account（第一组）──────────────────────────────────┐
│  Select To Account │ Select From Account │ Reverse │
└────────────────────────────────────────────────────┘

┌─ Currency（货币行）─────────────────────────────────┐
│  币种A │ 金额A │ Rate │ 币种B │ 金额B(只读) │
└────────────────────────────────────────────────────┘

┌─ Account（第二组 / Transfer）───────────────────────┐
│  Select To Account │ Select From Account │ Reverse │
└────────────────────────────────────────────────────┘

┌─ Middle-Man ───────────────────────────────────────┐
│  账户 │ Rate multiplier │ Fee │ Platform Fee │ Amount(只读) │
└────────────────────────────────────────────────────┘
```

### Reverse 行为差异

| 按钮位置 | 互换内容 |
|----------|----------|
| 第一组账户 Reverse | 互换 To/From 账户，并调用 `onRateCurrencyRowReverse`：互换金额A/金额B，以及内部 gross 槽位 |
| 第二组账户 Reverse | **只**互换第二组 To/From 账户，不影响货币行 |

---

## 4. 字段字典

### 4.1 第一组账户

| UI | React state | 提交字段 | 含义 |
|----|-------------|----------|------|
| Select To Account | `rateToAccount` | `rate_to_account_id` / `account_id` | 第一币种侧「收款/To」账户 |
| Select From Account | `rateFromAccount` | `rate_from_account_id` / `from_account_id` | 第一币种侧「付款/From」账户 |

### 4.2 货币行

| UI | React state | 提交字段 | 可编辑 | 含义 |
|----|-------------|----------|--------|------|
| 左币种 | `rateCurrencyFrom` | `rate_from_currency` / `currency` / `rate_currency_from` | 是 | 第一币种（Fee 也按此币种理解） |
| 左金额 | `rateCurrencyFromAmount` | `rate_from_amount` / `amount` / `rate_currency_from_amount` | 是 | 第一币种本金 |
| Rate | `rateExchangeRateRaw` | `rate_exchange_rate`（解析后的规范化值） | 是 | 汇率表达式原文；计算用解析值 |
| 右币种 | `rateCurrencyTo` | `rate_to_currency` / `rate_currency_to` | 是 | 第二币种 |
| 右金额 | `rateCurrencyToAmount` | **不直接等于**提交的 to amount | 只读 | **净值展示** = gross − 中间人总手续费 |
| （内部） | `rateToAmountGrossStr` | `rate_to_amount` / `rate_currency_to_amount` | 隐藏 | **毛额 gross**，供提交与后端使用 |

> 关键点：屏幕右边看到的金额B，往往已经扣过中间人费用；真正写入 `rate_to_amount` 的常常是 **gross**（未扣或按规则处理后的毛额字符串）。

### 4.3 第二组账户（Transfer）

| UI | React state | 提交字段（注意命名交叉） | 含义 |
|----|-------------|--------------------------|------|
| Select To Account | `rateTransferToAccount` | `rate_transfer_from_account_id` | UI 的 To，payload 里叫 transfer_from |
| Select From Account | `rateTransferFromAccount` | `rate_transfer_to_account_id` | UI 的 From，payload 里叫 transfer_to |

金额：

| 提交字段 | 大致对应 |
|----------|----------|
| `rate_transfer_from_amount` | 第二组 UI To 侧金额（净基额，可能不再扣乘数） |
| `rate_transfer_to_amount` | 第二组 UI From 侧金额（可能再扣乘数抽成） |

币种：第二组统一用第二币种（`rateCurrencyTo`）。

### 4.4 Middle-Man

| UI | React state | 提交字段 | 可编辑 | 含义 |
|----|-------------|----------|--------|------|
| Select Account | `rateMiddlemanAccount` | `rate_middleman_account` / `rate_middleman_account_id` | 是 | 中间人账户 |
| Rate multiplier | `rateMiddlemanRate` | `rate_middleman_rate` | 是 | 比例乘数 |
| Fee | `rateMiddlemanInputAmount` | `rate_middleman_input_amount` | 是 | 固定手续费（**第一币种**口径） |
| Platform Fee | `rateMiddlemanPlatformFee` | **无** | 是 | **仅 UI，不参与计算/提交** |
| Amount | `rateMiddlemanAmount` | `rate_middleman_amount` | 只读 | 中间人总抽成（**第二币种**口径合计） |

---

## 5. 汇率 Rate 的解析规则

实现：`parseRateExpression`（`transactionFormat.js`）。

### 5.1 允许的输入

- 纯数字：`4.5`
- 以 `/` 开头：`/4.5` → 视为 `1 / 4.5`
- 乘除链：`2*1.5`、`9/2`、`2*3/4`
- `÷` 会先被替换成 `/`
- 空白会被去掉

### 5.2 不允许 / 判无效

- 空字符串
- 非法字符（只允许 `0-9 . * /`）
- 以 `*` `/` 开头或结尾（`/数字` 特例除外）
- 连续运算符 `**`、`//`
- 任一数字小数位 **超过 8 位**
- 结果 ≤ 0
- 除以 0

### 5.3 规范化

解析成功后：

- 用 `MoneyDecimal` 算出精确值；
- 再截断到最多 **8 位小数**（不是四舍五入到 8，而是 truncate 规范化字符串）；
- 提交字段 `rate_exchange_rate` 用这个规范化值；
- description 里括号中的 `(Rate: …)` 则保留用户输入的 **原文** `rateExchangeRateRaw`。

后端也会再校验：Exchange Rate 小数位最多 8、且必须 > 0。

---

## 6. 即时计算逻辑（前端）

触发位置：`useTransactionForm.js` 中 `useEffect`，依赖：

```text
txType, rateCurrencyFromAmount, rateExchangeRateRaw,
rateMiddlemanRate, rateMiddlemanInputAmount
```

仅当 `txType === "RATE"` 时运行。

### 6.1 符号定义

| 符号 | 来源 | 口径 |
|------|------|------|
| `A` | `rateCurrencyFromAmount` | 第一币种金额 |
| `R` | `parseRateExpression(rateExchangeRateRaw).value` | 解析后汇率 |
| `M` | `rateMiddlemanRate` | Rate multiplier |
| `Fee` | `rateMiddlemanInputAmount` | 第一币种固定费 |
| `baseFee` | `A × M`（A>0 且 M>0） | 比例抽成基数（随后与换算 Fee 相加进中间人 Amount） |
| `convertedFee` | `Fee × R`（Fee>0 且 R>0） | Fee 换到第二币种 |
| `finalFee` | `baseFee + convertedFee` | 中间人 Amount 合计 |
| `gross` | `A × R` | 第二币种毛额 |
| 金额B 显示 | `gross - finalFee`（有 finalFee 时） | 只读净值 |

### 6.2 中间人 Amount（只读框）

```text
rateMiddlemanAmount =
  (金额A × Rate multiplier)   // baseFee，要求两者都 > 0
  + (Fee × 汇率R)             // convertedFee，要求 Fee>0 且 R>0
```

特殊显示：

- 合计非零 → `formatRateAmount`（half-up 两位小数）显示；
- 合计为零但确实算过（例如极端抵消）→ 可能显示 `0.00`；
- 否则清空。

### 6.3 金额B 与内部 gross

```text
gross = A × R
```

写入：

- `rateToAmountGrossStr` = `formatRateAmount(gross)`（另有负 Fee 特例，见下）
- `rateCurrencyToAmount`（界面）= `formatRateAmount(gross - finalFee)`（finalFee 非零时）

若汇率无效或 `A ≤ 0` 或 `R ≤ 0`：清空金额B 与 gross。

#### 负 Fee 特例（少见）

若用户把 Fee 填成 **负数**：

```text
finalGrossForBackend = gross + Fee   // 注意：这里加的是未换算的负 Fee 原值
```

正常正 Fee **不会**改 gross；正 Fee 只影响展示净值与 transfer 净额。

### 6.4 金额格式

`formatRateAmount` = `MoneyDecimal.formatFixedHalfUp(..., 2)`  
即金额侧统一 **四舍五入到 2 位小数**（与后端 `submitRateRound2` 对齐）。

---

## 7. Middle-Man：Rate multiplier 与 Fee

### 7.1 两种抽成方式

| 方式 | 输入 | 币种理解 | 换算 | 进入中间人 Amount 的部分 |
|------|------|----------|------|--------------------------|
| Rate multiplier | 小数乘数 | 乘在第一币种金额上 | `A × M` 直接进入合计 | `baseFee` |
| Fee | 固定金额 | **第一币种** | 先 `Fee × R` 再进合计 | `convertedFee` |

两者可同时存在 → **相加**。

### 7.2 校验（成套规则）

提交时（`onSubmitTx` RATE 分支）：

| 条件 | 结果 |
|------|------|
| 填了乘数或 Fee，但没选中间人账户 | 报错：请选择 Middle-Man 账户 |
| 选了中间人账户，但乘数和 Fee 都空 | 报错：请输入 Rate multiplier 或 Fee |
| 填了乘数，但不是有限数字或 ≤ 0 | 报错：请输入有效 Middle-Man rate |
| 乘数小数位 > 8 | 报错：最多 8 位小数 |
| 账户 / 乘数 / Fee 全空 | **允许**，当作无 Middle-Man |

> 校验上「乘数 **或** Fee 二选一即可」；算账上若两个都填则 **相加**。

### 7.3 Fee 对 Remark 的独占影响

只要 Fee > 0，就会生成 Service Fees 文案（见第 11 节）。  
**仅有 Rate multiplier、没有正 Fee** 时，不会生成 `charge … Service Fees`。

### 7.4 Fee 对 transfer 的影响 vs 乘数对 transfer 的影响

见下一节：  

- **正 Fee**：两边 transfer 先一起扣掉 `convertedFee`；  
- **乘数部分**：在扣完 Fee 之后，**只再扣 From 侧**。

---

## 8. 第二组账户（Transfer）金额怎么算

仅当 **第二组 To 与 From 都已选择** 时，`buildRatePayload` 才会写入 transfer / middleman 相关字段。

### 8.1 计算步骤（白话）

1. `transferGross` = 前端传来的 `toGrossStr`（即内部 gross）；
2. 若 `Fee > 0` 且 `R > 0`：  
   `convertedFee = Fee × R`  
   `transferBase = transferGross - convertedFee`  
   否则 `transferBase = transferGross`；
3. 初始：  
   `transferToSide = transferBase`（对应 UI To / payload transfer_from_amount）  
   `transferFromSide = transferBase`（对应 UI From / payload transfer_to_amount）；
4. 若存在中间人且 `middlemanAmount ≠ 0`：  
   - `rateMultiplierFee = middlemanAmount - convertedFee`（若有 convertedFee）  
   - 若 `rateMultiplierFee > 0`：  
     `transferFromSide = transferBase - rateMultiplierFee`  
   - To 侧 **不**因乘数再扣。

### 8.2 结果直觉

| 情况 | To 侧 | From 侧 |
|------|-------|---------|
| 无 Fee、无乘数 | 都 = gross | 都 = gross |
| 只有正 Fee | 都 = gross − convertedFee | 同左 |
| 只有乘数 | = gross | = gross − middlemanAmount |
| Fee + 乘数 | = gross − convertedFee | = gross − convertedFee −（middlemanAmount − convertedFee）= gross − middlemanAmount |

因此：**有乘数时两边常不相等**；差额大致就是中间人吃掉的「乘数部分」。

### 8.3 为什么第一币种金额不因 Fee 减少？

注释与实现约定：

> Fee（`rate_middleman_input_amount`）已经体现在第一币种金额的业务语义 / 展示与第二币种净额里；  
> **不要**再在某一侧非对称地重复扣一遍 converted Fee。

第一组两边记账金额仍是 **金额A**（见后端 `RATE_FIRST_*`）。

---

## 9. 提交前校验

RATE 分支必过项：

1. 已勾选 Confirm Submit，且非提交中、非只读；
2. scope 就绪；
3. 必须选第一组 To、From；
4. 必须选双币种；
5. 金额A（或 `rateFullAmount`）与 gross 必须是有限且 **> 0**；
6. Rate 表达式必须 `parseRateExpression` 成功；
7. 必须有交易日期 `rateDate`；
8. Middle-Man 成套规则（第 7.2 节）。

失败时用 toast 提示对应翻译文案，不发请求。

---

## 10. 提交 Payload 组装

函数：`buildRatePayload`（`transactionSubmitHelpers.js`）。

### 10.1 主字段（摘要）

```text
transaction_type: "RATE"
account_id / rate_to_account_id: 第一组 To
from_account_id / rate_from_account_id: 第一组 From
amount / rate_from_amount / rate_currency_from_amount: 金额A（格式化）
transaction_date: rateDate
description: ""（主 description 空；各腿另有 *_description）
sms: Service Fees 文案 或 txRemark 大写
currency / rate_from_currency / rate_currency_from: 第一币种
rate_to_currency / rate_currency_to: 第二币种
rate_to_amount / rate_currency_to_amount: gross（格式化）
rate_exchange_rate: 解析后的汇率字符串
rate_middleman_rate / rate_middleman_amount / rate_middleman_account / rate_middleman_input_amount: 中间人相关
```

### 10.2 有第二组账户时追加

```text
rate_transfer_from_account_id = UI Transfer To
rate_transfer_to_account_id   = UI Transfer From
rate_transfer_from_amount     = transferToSide
rate_transfer_to_amount       = transferFromSide
rate_transfer_*_currency      = 第二币种
rate_transfer_*_description   = 见第 11 节

若中间人账户存在且 middlemanAmount ≠ 0：
  rate_middleman_account_id
  rate_middleman_currency = 第二币种
  rate_middleman_amount
  rate_middleman_description
```

### 10.3 注意

- `rate_middleman_amount` 在基础 payload 里就有一份；有 transfer 时可能再以 `rate_middleman_account_id` 等形式补全。
- **Platform Fee 不在 payload 中。**

---

## 11. Description / Remark（SMS）规则

### 11.1 Remark / SMS

前端：

```text
serviceFeeRemark = buildRateServiceFeeRemark(第一币种, Fee)
sms = serviceFeeRemark || upper(txRemark)
```

`buildRateServiceFeeRemark`：

- Fee 清理后为空 → 返回空；
- Fee ≤ 0 → 返回空；
- 否则：`charge {CURRENCY} {用户输入的Fee原文字符串} Service Fees`  
  例：`charge MYR 5 Service Fees`

后端（`submit_api.php`）在 Fee > 0 时也会强制重写为同类文案（并可能去掉 Fee 小数尾零）。

RATE 表单隐藏 Remark 输入，因此无正 Fee 时 sms 通常为空。

### 11.2 各腿 description（写入库的原文）

| 腿 | 模板 |
|----|------|
| 第一组 From | `Transaction to {To账号} (Rate: {Rate原文})` |
| 第一组 To | `Transaction from {From账号} (Rate: {Rate原文})` |
| 第二组 From 描述 | `Transaction to {TransferTo账号} (Rate: {Rate原文})` |
| 第二组 To 描述 | `Transaction from {TransferFrom账号} (Rate: {Rate原文})` |
| 中间人 | 仅当有 middleId 且 middleAmount ≠ 0：`Rate charge (x{乘数}) from {第一币种} {金额A两位小数}` |

说明：

- 中间人描述文案 **强调 Rate multiplier**；  
- Fee 更体现在 **sms** 与金额计算，而不是 middleman description 模板里。

### 11.3 历史页美化后的展示（见第 14 节）

- 普通腿 → `EXCH RATE …`
- 中间人 → `MARKUP …`

---

## 12. 后端 submit 落库

入口：`api/transactions/submit_api.php`（`$is_rate` 分支）。

### 12.1 校验要点

- 第一组 From/To 账户必须存在且属于当前公司（`account_company`）；
- 金额A、金额B（此处为提交的 to amount / gross）必须 > 0；
- 币种不存在则自动创建（code 长度 ≤ 10）；
- Exchange Rate 小数 ≤ 8 且 > 0；
- Middle-Man rate 若填写，小数 ≤ 8；
- 若填了第二组账户，必须同时有 transfer 金额。

### 12.2 写入哪些表 / 记录

1. **主交易** `transactions`  
   - type=RATE，默认 `approval_status=APPROVED`  
   - amount=金额A，currency=第一币种  
   - sms=Service Fees 或原 sms  

2. **`transactions_rate`**  
   - 组信息：`rate_group_id`（形如 `RATE_{time}_{rand}`）  
   - 汇率、双边账户/币种/金额、transfer、middleman 字段  

3. **`transactions_rate_details`**  
   - `first_from` / `first_to`：两边金额都是 **金额A**、币种都是 **第一币种**  
   - 若有 transfer：`transfer_from` / `transfer_to`  
   - 若有 middleman：`middleman`；必要时还有差额扣减类 `transfer_from` 明细  

4. **可能额外的 `transactions` 行**  
   - transfer 主行  
   - middleman 行（金额=middleman amount）  
   - 若 `transfer_from_amount - transfer_to_amount` 绝对值 > 0.01，再写一笔扣减行  

5. **`transaction_entry`（统一分录，现代余额主要看这个）**  
   - 见第 13 节  

6. 提交成功后：清 Transaction List 搜索缓存；广播 realtime（RATE 恒为已批准）。

### 12.3 transaction_entry 写入符号（重要）

| entry_type | 账户 | 写入金额符号（库内） | 币种 |
|------------|------|----------------------|------|
| `RATE_FIRST_FROM` | 第一组 From | **负**金额A | 第一币种 |
| `RATE_FIRST_TO` | 第一组 To | **正**金额A | 第一币种 |
| `RATE_TRANSFER_FROM` | UI 第二组 To（payload transfer_from） | **正** transfer_from_amount | 第二币种 |
| `RATE_TRANSFER_TO` | UI 第二组 From（payload transfer_to） | **负** transfer_to_amount | 第二币种 |
| `RATE_MIDDLEMAN` | 中间人 | **正** middleman amount | 第二币种（或回退） |

注释说明：search/history 会对部分 `RATE_TRANSFER_*` / `RATE_FIRST_*` **再乘 -1** 以适配列表展示习惯，因此库内符号与最终屏幕符号不一定相同，但成对设计是自洽的。

---

## 13. 分录类型与余额归类

### 13.1 列表 / 搜索（`search_api.php`）

| 类型 | 计入 |
|------|------|
| `RATE_FIRST_*` / `RATE_TRANSFER_*` 等非 MIDDLEMAN | **Cr/Dr** |
| `RATE_MIDDLEMAN` | **Win/Loss** |

因此：

- 「Show Win/Loss Only」会把有 Middle-Man 手续费的账户也筛出来；
- Middle-Man 收益不会当成普通 Payment Cr/Dr。

### 13.2 历史（`history_api.php`）

- `RATE_FIRST_*` / `RATE_TRANSFER_*`：金额展示前可能 `historyNeg`；进 Cr/Dr；
- `RATE_MIDDLEMAN`：保持正数；`win_loss = amount`，`cr_dr = 0`。

### 13.3 历史排序习惯

同一 RATE header 下，展示顺序大致：

1. FROM 侧（`RATE_FIRST_FROM` / `RATE_TRANSFER_FROM`）
2. TO 侧（`RATE_FIRST_TO` / `RATE_TRANSFER_TO`）
3. Middle-Man / Fee 类（`RATE_MIDDLEMAN` / `RATE_FEE`）

---

## 14. Payment History 展示加工

### 14.1 普通 RATE 腿 → EXCH RATE

函数：`formatExchangeRateDescription`

原文匹配：

```text
Transaction (from|to) {对方账号} (Rate: {rate})
```

美化为：

```text
EXCH RATE {rate展示} {第一币种} {金额A} > {第二币种} | FROM|TO {对方账号}
```

Rate 展示最多约 6 位小数并去尾零。

### 14.2 中间人 → MARKUP

函数：`formatMarkupDescription`

```text
MARKUP {middleman_rate} {第一币种} {金额A} > {第二币种} | FROM {账号}
```

### 14.3 TO 侧「净汇率」细节

对 `RATE_FIRST_TO` / `RATE_TRANSFER_TO`：

若同时有 `exchange_rate` 与 `rate_middleman_rate`，且  

```text
netRate = exchange_rate - middleman_rate > 0
```

则描述里的汇率可用 **净汇率** 覆盖；FROM 侧通常仍用原始汇率。

### 14.4 Member 用户

Member 视角可能再 `stripTrailingRateSuffix`，去掉末尾 `(Rate: …)` 类后缀。

---

## 15. 提交成功后的前端行为

1. Toast：成功，或若返回 PENDING（RATE 正常应为已批准，此分支少见）则提示等待审批；
2. 清空：金额、汇率、Middle-Man 乘数/Fee/Amount/Platform Fee、各组账户选择、confirm 勾选等；
3. 触发 post-submit refresh；非 PENDING 时按涉及账户做 focused list（第一组、第二组、中间人账户 ID 集合）；
4. 列表货币聚焦用第一币种、日期用 `rateDate`。

乐观更新：`buildOptimisticSubmitDeltas` 对 RATE **直接返回空数组**（不做前端乐观 Cr/Dr 加减），依赖刷新。

---

## 16. 完整数字示例

### 假设输入

| 项 | 值 |
|----|----|
| 金额A | 1000 |
| 第一币种 | MYR |
| Rate | 4 |
| 第二币种 | USD（示例） |
| Fee | 5 |
| Rate multiplier | 0.01 |
| 第二组 To/From | 都已选择 |
| 中间人账户 | 已选择 |

### 计算过程

```text
gross            = 1000 × 4 = 4000
convertedFee     = 5 × 4 = 20
baseFee          = 1000 × 0.01 = 10
middlemanAmount  = 10 + 20 = 30          ← 右边 Amount
金额B 显示        = 4000 − 30 = 3970
transferBase     = 4000 − 20 = 3980
rateMultiplierFee= 30 − 20 = 10
transfer To 侧   = 3980
transfer From 侧 = 3980 − 10 = 3970
```

### 文案

```text
sms: charge MYR 5 Service Fees
middleman description: Rate charge (x0.01) from MYR 1000.00
```

### 分录直觉（忽略展示翻号）

| 腿 | 币种 | 金额量级 |
|----|------|----------|
| FIRST From/To | MYR | 1000 |
| TRANSFER To 侧 | 第二币种 | 3980 |
| TRANSFER From 侧 | 第二币种 | 3970 |
| MIDDLEMAN | 第二币种 | 30（进 Win/Loss） |

> 实际落库还有 2 位小数 half-up / trunc 细节；上表是逻辑口径。

---

## 17. 场景对照表

| 场景 | 金额B 显示 | Transfer 两边 | 中间人分录 | SMS |
|------|------------|-------------|------------|-----|
| 只填货币行，无第二组、无 MM | = gross | 无 | 无 | 空 |
| 有第二组，无 MM | = gross | 两边 = gross | 无 | 空 |
| 仅 Fee>0 + 第二组 + MM账户 | gross − convertedFee | 两边都扣 convertedFee | 有（Amount=convertedFee） | `charge … Service Fees` |
| 仅乘数 + 第二组 + MM账户 | gross − baseFee | To=gross，From=gross−baseFee | 有 | 通常空 |
| Fee+乘数 + 第二组 + MM账户 | gross − (base+converted) | To=gross−converted；From=gross−合计 | 有 | 有 Service Fees |
| 填了 Fee/乘数但没选 MM 账户 | 仍会即时算显示 | — | 提交被拦 | — |
| 只选 MM 账户不填费 | Amount 空 | — | 提交被拦 | — |
| 填了 Platform Fee | **无影响** | **无影响** | **无** | **无** |

---

## 18. Platform Fee（当前状态）

2026-07 新增 UI，位置：Middle-Man 行里 **Fee 右侧、Amount 左侧**。

| 项目 | 状态 |
|------|------|
| 输入框 | 有（`rate_middleman_platform_fee`） |
| React state | 有（`rateMiddlemanPlatformFee`） |
| 文案 | EN: `Platform Fee` / ZH: `平台费` |
| 布局 | `.rate-row-mm` 为 5 列等宽 |
| 即时计算 | **未接入** |
| 提交校验 | **未接入** |
| Payload / 后端 | **未接入** |
| 提交成功清空 | 会清空 state（避免残留） |

最右边 Amount 展示框位置刻意保持在行尾不变。

---

## 19. 易误解点汇总

1. **金额B ≠ 永远的 A×R**：有中间人费用时显示净值。  
2. **提交的 to amount 常用 gross**：不要把屏幕净值误当成唯一真相。  
3. **Fee 是第一币种；中间人 Amount / transfer 是第二币种口径。**  
4. **校验「或」、算账「加」**：乘数或 Fee 可只填一个；两个都填会相加。  
5. **RATE 不显示手填 Remark**；正 Fee 会接管 sms。  
6. **中间人进 Win/Loss；换汇本体进 Cr/Dr。**  
7. **第二组 UI To/From 与 payload transfer_from/to 命名交叉**——改接口时务必对照 `buildRatePayload`。  
8. **完整 Middle-Man 分录依赖第二组两边都选**：无第二组时，前端 middleman 的 `rate_middleman_account_id` 等补全写在 transfer 分支内。  
9. **Platform Fee 目前只是样子。**  
10. **RATE 不做乐观余额 delta**，以刷新为准。

---

## 20. 后续扩展建议（仅备忘）

若要让 Platform Fee 真正生效，通常需要依次明确：

1. 币种口径：第一币种还是第二币种？是否需要 ×R？  
2. 是否并入 `rateMiddlemanAmount`？是否单独分录（例如未来的 `RATE_FEE`）？  
3. 是否影响金额B 净值与 transfer 扣减？扣两边还是只扣一边？  
4. Remark / description 文案模板；  
5. 校验是否纳入「与 Fee/乘数成套」规则；  
6. 后端 `submit_api` / `transactions_rate` / `transaction_entry` / history 美化是否要新字段。

在未产品定案前，保持 UI-only 是安全的。

---

## 附录 A：关键 React state 一览

```text
rateDate
rateToAccount / rateFromAccount
rateCurrencyFrom / rateCurrencyTo
rateCurrencyFromAmount / rateCurrencyToAmount
rateExchangeRateRaw
rateToAmountGrossStr / rateFromAmountGrossStr   // Reverse 用的内部 gross 槽
rateFullAmount                                 // 若有「点余额同步」等场景
rateTransferToAccount / rateTransferFromAccount
rateMiddlemanAccount
rateMiddlemanRate
rateMiddlemanInputAmount                       // Fee
rateMiddlemanPlatformFee                       // UI only
rateMiddlemanAmount                            // 只读合计
txRemark                                       // RATE 下通常不用
txConfirm
```

## 附录 B：关键 entry_type

```text
RATE_FIRST_FROM
RATE_FIRST_TO
RATE_TRANSFER_FROM
RATE_TRANSFER_TO
RATE_MIDDLEMAN
RATE_FEE          // 历史/展示侧有映射；当前手动提交主路径以 RATE_MIDDLEMAN 为主
```

---

*文档基于当前仓库实现整理（前端 React Transaction 页 + `api/transactions/*`）。若代码变更，请以源码为准并同步更新本文。*

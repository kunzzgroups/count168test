# RATE — Service Fee / Platform Fee 逻辑说明（现行）

> 范围：Transaction Payment（桌面 `/transaction` + mobile 同 API）在 **Type = RATE** 时，**Service Fee** 与 **Platform Fee** 的计算、提交、落库、Payment History 展示。
>
> 日期：2026-08-01  
> 状态：桌面与 Mobile Rate-Mul 均只接受 `/newDivisor`（除法模式）或纯正数（乘法模式，FX 乘法写法时代表新汇率、自动做差）两种写法，纯负数无效（入库 6 位）；Fee / PT-Fee 均只允许正数入力，PT-Fee 恒代表减法（无加法算法）。Mobile 已与桌面共用同一套 `transactionSubmitHelpers` 逻辑。
>
> 完整 RATE 手册仍见 `docs/transaction-rate-manual-logic.md`；其中 §18「Platform Fee 仅 UI」**已过时**，以本文为准。

---

## 金额入库精度（现行）

| 类型 | 入库 | 展示 |
|------|------|------|
| 非 RATE | 最多 **6** 位小数（截断，不做 round-2） | 页面 half-up 2 仅供查看 |
| RATE | 最多 **6** 位小数（截断，不做 round-2） | 页面 half-up 2 仅供查看 |

实现：`submitStoreAmount` + 前端 `formatAmountForStore`；算法用全精度 `MoneyDecimal`，入库截断 6 位；**禁止**用展示用的 2 位再去算/提交。

---

## 1. 产品规则（现行）

| 项目 | 规则 |
|------|------|
| **Service Fee** | 只允许**正数**入力（无负数算法）。桌面 + Mobile：From RATE 扣 Fee（如 310→300）；**不**在 From 写 `RATE_FEE`；To = gross（已含 Fee 口径）。发 `rate_skip_from_service_fee=1`。 |
| **Platform Fee（PT-Fee）** | 只允许**正数**入力，恒代表**减法**（无加法算法）：From RATE 不动；Select From 另写 **正数** `RATE_PLATFORM_FEE`（+PT）；Middle = `Fee − PT`；无 Middle Remark。桌面 + Mobile 同路径。 |
| **Rate-Mul（桌面）** | 只接受两种写法：**`/newDivisor`**（跟 FX Rate 同款除法写法，仅在 FX Rate 本身也是 `/divisor` 时生效，直接当新除数）或**纯正数**（FX Rate 是 `/divisor` 时当点数直接用 `×1000`；FX Rate 是乘法写法时当「新汇率」，带符号跟原汇率做差再 `×fromAmount`，Rate-Mul 比原汇率大时结果为负）。**纯负数无效**。详见 §3.1。 |
| **前提** | 第二组账户（Transfer To / From）都选了，才会写 transfer 腿、Middle-Man（及 PT-Fee 的 Remark / fallback）。 |

**为何桌面拆出 `RATE_FEE`：**  
把 Service Fee 与正常 RATE 兑换行分开展示；From 腿先扣掉 Fee 再写 `RATE_FEE`，净额不变、不双计。桌面 + Mobile 同路径。

> 旧说明「为何去掉 RATE_FEE」已由桌面新路径取代；存量仅-sms Remark 的单仍可展示。

---

## 2. 表单字段（Middle-Man 行）

```text
账户 | Rate-Mul | Fee (Service Fee) | Platform Fee | Amount(只读利润)
```

| UI | State / POST 相关 | 说明 |
|----|-------------------|------|
| Rate-Mul | `rateMiddlemanRate` / `rate_middleman_rate` | 见 §3.1；**桌面**禁除法表达式 |
| Fee | `rateMiddlemanInputAmount` / `rate_middleman_input_amount` | Service Fee 面值（第二币种，不乘汇率，**只能为正数**） |
| Platform Fee | `rateMiddlemanPlatformFee` / `rate_middleman_platform_fee` | Platform Fee 面值（第二币种，**只能为正数**，恒代表减法） |
| Amount | `rateMiddlemanAmount` / `rate_middleman_amount` | 只读：Middle-Man 利润 |

---

## 3. 前端即时计算

**文件：** `frontend/src/pages/transaction/hooks/useTransactionForm.js`  
**助手：** `frontend/src/pages/transaction/lib/transactionSubmitHelpers.js`  
（mobile：`c168_mobile/frontend/src/lib/transactionSubmitHelpers.js`，已与桌面同步）

### 3.1 Rate-Mul 佣金

「点」= 差值 `× 1000`（平数金额，第二币种；0.001→1、0.01→10、0.1→100）。

Rate-Mul 输入只有两种合法形态（`parseMiddlemanRateInput`）：**`/newDivisor`**（跟 FX Rate 同款除法写法）或**纯正数**（新汇率 / 点数，视 FX Rate 写法而定）。**纯负数一律无效**（不再支持像 `-0.05` 这种写法）。

```text
Rate-Mul = /newDivisor（「除法」模式，只在 FX Rate 本身也是 /divisor 时生效；例: from=1500, FX=/1.5, Rate-Mul=/1.55）:
  base     = from / divisor            # 1500 / 1.5  = 1000
  adjusted = from / newDivisor         # 1500 / 1.55 = 967.74
  rateMulCommission = base − adjusted  # 1000 − 967.74 = 32.26
  # newDivisor 直接取自输入，不再相加；newDivisor < divisor 时算出负数，允许（倒贴）

Rate-Mul = 纯正数，且 FX Rate 本身是 /divisor（例: from=1500, FX=/1.5, Rate-Mul=0.05）:
  rateMulCommission = Rate-Mul × 1000  # 0.05 × 1000 = 50（点数直接用，不跟原汇率做差）

Rate-Mul = 纯正数，且 FX Rate 本身是乘法写法（例: from=10000, FX=3.15, Rate-Mul=2.93）:
  rateMulCommission = (原汇率 − Rate-Mul) × fromAmount   # (3.15 − 2.93) × 10000 = 2200
  # Rate-Mul 当作「新汇率」，带符号跟原汇率做差（不取绝对值）；
  # Rate-Mul > 原汇率时结果为负（允许，倒贴）；差值按 fromAmount 换算金额，不是 ×1000；
  # FX Rate 解析不出时忽略（0）

Rate-Mul = /newDivisor，但 FX Rate 本身是乘法写法:
  rateMulCommission = 0（忽略）
```

实现：`computeRateMulCommission` + `parseMiddlemanRateInput`。旧版「互补价差」（ε / edge / `|mul|=divisor` 拿完 / `|mul|>divisor/2` 对调）、`-0.05` 加除数的写法、以及 `isRateMulAdjustedDivisorValid` 上限校验都已整个移除。

### 3.2 Middle-Man 利润

```text
middlemanProfit = rateMulCommission + (serviceFee − PT)
```

Fee、PT-Fee 入力均恒为正数（负数一律当 0 处理）；PT-Fee 没有加法路径，只做减法。
`computeRateMiddlemanProfit(...)`：Fee / Platform Fee **不做 FX 换算**；需传 `exchangeRateRaw`。

### 3.3 第二币种金额预览

```text
displayAmt = gross − (Rate-Mul + Service Fee)
```

- PT-Fee **不**参与表单预览 / Transfer 金额的扣减，只体现在 Middle 利润和 `RATE_PLATFORM_FEE` 落库行。
- 展示 half-up 2；底层用全精度再扣。

To 腿 = **全额 gross**。

### 3.4 Transfer 金额（有第二组账户时）

```text
transfer To 侧金额   = gross
transfer From 侧金额 = gross − rateMul − Service Fee
+ RATE_PLATFORM_FEE（PT-Fee > 0：正数 +PT 挂 Select From；flag rate_platform_fee_from_credit=1）
```

- From RATE 不因 PT-Fee 变动；PT-Fee 只在 Select From 上多写一笔正数 `RATE_PLATFORM_FEE`；Middle = `Fee − PT`。
- 桌面 + Mobile：同路径（正数 PT，`rate_platform_fee_from_credit=1`）。

---

## 4. 提交 Payload（要点）

**函数：** `buildRatePayload`

| 字段 | 用途 |
|------|------|
| `sms` | 有 Service Fee 时：`charge {第二币种} {金额} Service Fees`（或等价大小写），否则用户 remark |
| `rate_middleman_input_amount` | Service Fee 原值 |
| `rate_service_fee_amount` / `rate_service_fee_description` | **桌面**：有 Service Fee 且有 transfer 时发送 → 写 `RATE_FEE` |
| `rate_middleman_platform_fee` | Platform Fee 原值（恒为正数） |
| `rate_platform_fee_amount` / `rate_platform_fee_description` | **PT-Fee > 0** 时发送（正数，Select From 落 `RATE_PLATFORM_FEE`） |

`rate_to_amount` / transfer 基数使用 **gross**（`toGrossStr`）。

---

## 5. 后端落库流程

**文件：** `api/transactions/submit_api.php`

```text
POST RATE
  ├─ 写 transactions 主单（含 sms = Service Fee remark，若有）
  ├─ 写 RATE 扩展 / rate_group_id
  └─ 写 transaction_entry（同一 header）
        ├─ RATE_FIRST_*          第一币种腿
        ├─ RATE_TRANSFER_FROM    第二币种 To（有 transfer 时）
        ├─ RATE_TRANSFER_TO      第二币种 From（有 transfer 时；PT-Fee 不扣在金额）
        ├─ RATE_FEE              桌面可选（rate_service_fee_amount；挂 Select From）
        ├─ RATE_MIDDLEMAN        可选（利润 > 0；Mobile 旧路径可带 [[PFEE_REMARK]]）
        ├─ RATE_PLATFORM_FEE     PT-Fee > 0 时：桌面挂 Select From；无 MIDDLEMAN 行时 Mobile fallback 挂 Middle-Man
        └─ （PT-Fee = 0 不写 RATE_PLATFORM_FEE）
```

### Service Fee

1. **桌面**（`rate_service_fee_amount > 0`）：`INSERT RATE_FEE` 正数挂 Select From；**不**把 Fee 写入主单 `sms`
2. **Mobile / 未带 rate_service_fee_amount**：若 `rate_middleman_input_amount > 0` → 主单 `sms = charge … Service Fees`（Remark 路径）
3. **不**在同一单上同时走 sms Fee + `RATE_FEE`（由是否 POST `rate_service_fee_amount` 分流）

### Platform Fee

1. 金额优先 `rate_platform_fee_amount`，否则 `rate_middleman_platform_fee`（恒为正数）
2. 描述默认：`charge {币种} {金额} PlatForm Fee`
3. 输入 `> 0` + 桌面 `rate_platform_fee_from_credit=1`：Select From 写 **正数** `RATE_PLATFORM_FEE`；**不**写 Middle Remark；Middle = `Fee − PT`
4. 输入 `> 0` 且无 from_credit（Mobile 旧路径）：Middle Remark 或 fallback 负数 Fee 挂 Middle
5. 输入 `= 0`：不写 `RATE_PLATFORM_FEE`

---

## 6. Payment History 展示

**文件：** `api/transactions/history_api.php`

| entry_type | Product | Cr/Dr / WinLoss | Remark |
|------------|---------|-----------------|--------|
| `RATE_TRANSFER_TO` 等兑换腿 | RATE / EXCH… | 符号按既有 RATE 规则翻号 | 仅 **TRANSFER_TO**：用主单 `sms` 作为 Remark（Service Fee 文案） |
| `RATE_FEE` | **Fee** | Cr/Dr（桌面新单为正数） | Description = charge … Service Fees；**Remark 空** |
| `RATE_PLATFORM_FEE` | **Fee** | Cr/Dr（fallback / 旧数据） | Description 为 PlatForm Fee 文案 |
| `RATE_FEE`（仅 sms 旧路径） | — | — | Mobile/旧单：Fee 文案在 RATE 行 Remark |

Fee + PT-Fee 的桌面新单在 **第二 form account（Select From）** 上看到：

1. 一笔 **RATE**（金额已扣 Fee；PT-Fee 不扣在此金额；**无** Service Fee Remark）  
2. 一笔 **Fee**（Service Fee，独立行）  
3. 一笔 **Fee**（Platform Fee，独立行，`RATE_PLATFORM_FEE`）  
4. Middle-Man：MARKUP = `Fee − PT`  
5. To：全额 gross（例 310） 

---

## 7. 数据库要求

`transaction_entry.entry_type` / `transaction_entry_backup.entry_type` 必须包含：

`RATE_PLATFORM_FEE`

**Migration（幂等）：**  
`database/migrations/20260729_transaction_entry_rate_platform_fee.sql`

未执行前：负 PT fallback 插入 `RATE_PLATFORM_FEE` 可能被 MySQL enum 拒绝后 catch 吞掉。

Schema 已同步：`easycount_schema.sql` / `banks_schema.sql` / `easycount_fresh_install.sql`。

---

## 8. 数字示例（与产品预期一致）

### 8.1 Fee + PT-Fee（桌面，唯一路径）

假设：gross `310`，Service Fee `10`，PT-Fee `1.50`，无 Rate-Mul，Middle-Man 已选账户

| 步骤 | 结果 |
|------|------|
| Middle 利润 | `10 − 1.50 = 8.50` |
| 表单右侧预览 | `310 − 10 = 300`（PT-Fee 不参与预览扣减） |
| Transfer To 腿 | **310**（全额 gross，不扣 Fee） |
| Transfer From 腿 | **300**（gross − Fee；PT-Fee 不再额外扣） |
| **写** | Select From：`RATE_FEE` **+10**（Service Fee，无 Remark）；`RATE_PLATFORM_FEE` **+1.50**（PlatForm Fee，无 Remark） |
| **不写** | RATE 行 Service Fee Remark；Middle Remark |

From 净影响：`300 + 10 + 1.50 = 311.50`。

### 8.2 PT-Fee = 0

只有 Service Fee 时，`RATE_PLATFORM_FEE` 不写，Middle 利润 = `serviceFee`（同 §8.1 去掉 PT-Fee 部分）。

---

## 9. 端到端流程（简图）

```text
用户填 Fee / Platform Fee
        │
        ▼
前端：算 middlemanProfit（Fee − PT）、gross、displayAmt；组装 payload
        │  sms ← Service Fee
        │  From 金额 ← 只扣 Fee，PT-Fee 不动 From
        │  rate_platform_fee_* ← PT-Fee > 0 时发送
        ▼
submit_api.php
        │  主单 sms
        │  entries: FIRST / TRANSFER / MIDDLEMAN（Mobile 旧路径可带 Remark）
        │  PT-Fee > 0 → 写 PLATFORM_FEE（桌面挂 Select From）
        ▼
history_api.php
        │  TRANSFER_TO.remark ← sms
        │  MIDDLEMAN.remark ← Mobile 旧路径 PlatForm Fee
        ▼
Payment History
```

---

## 10. 相关文件清单

| 层级 | 路径 |
|------|------|
| 桌面 payload / 利润 | `frontend/src/pages/transaction/lib/transactionSubmitHelpers.js` |
| 桌面表单计算 | `frontend/src/pages/transaction/hooks/useTransactionForm.js` |
| 桌面 UI | `frontend/src/pages/transaction/components/TransactionAddSection.jsx` |
| Mobile payload | `c168_mobile/frontend/src/lib/transactionSubmitHelpers.js` |
| Mobile 表单 | `c168_mobile/frontend/src/pages/transaction/AddTransactionSheet.jsx` |
| 提交 API | `api/transactions/submit_api.php` |
| 历史 API | `api/transactions/history_api.php` |
| 搜索兼容旧 `RATE_FEE` | `api/transactions/type_*_lib.php` 等（只读兼容，新单不写） |
| DB migration | `database/migrations/20260729_transaction_entry_rate_platform_fee.sql` |

---

## 11. 本次变更摘要（相对旧行为）

1. **启用 Platform Fee 落库**：`RATE_PLATFORM_FEE` + enum migration（负 PT fallback / 旧数据）。  
2. **停写 Service Fee 独立分录**：不再 `INSERT RATE_FEE`；前端也不再发 `rate_service_fee_*`。  
3. **Service Fee 仅 Remark**：主单 `sms` → 第二币种 From 腿 Remark。  
4. **旧 `RATE_FEE` 行**：历史/搜索仍识别，仅兼容存量数据。  
5. **正 PT-Fee**：From RATE 扣 PT；Middle=`Fee+PT`；不写 `RATE_PLATFORM_FEE`。  
6. **正 PT-Fee（桌面 + Mobile）**：From 独立正数 `RATE_PLATFORM_FEE` 行；Middle=`Fee−PT`；无 Remark。  
7. **Service Fee（桌面 + Mobile）**：`rate_skip_from_service_fee=1` + From 腿扣 Fee；To = gross。

### 2026-08-01 追加变更

8. **Fee 去掉负数算法**：Fee 只允许正数入力，移除所有"负数 Fee 反向调整 gross"的代码分支（`buildRatePayload` / `useTransactionForm.js` 各一处）。
9. **PT-Fee 去掉加法算法，统一为减法**：`computeRateMiddlemanProfit` 不再区分正负号，恒为 `Fee − PT`；移除"正 PT 额外扣 From/表单预览"的加法路径及其专用函数 `positivePlatformFeeDeduction`；未使用的 `negativePlatformFeeCredit` 一并删除。PT-Fee 现在直接输入正数（如 `1.5`）即代表减法，无需再输入 `-1.5`。
10. **后端同步**：`submit_api.php` 里 `RATE_PLATFORM_FEE` / Middle-Man 必填校验按 `> 0`；桌面与 Mobile 前端均按正数 PT / `rate_skip_from_service_fee=1` 发请求。
11. **UI**：Fee 输入框加 `min="0"` 且屏蔽 `-` 键；Platform Fee 输入框改为自动加负号（输完数字自动变成 `-1.5`），不让用户手输 `-`，但底层解析改用绝对值，减法算法本身不变。
12. **Rate-Mul 算法大改（第一版，已被 13 取代部分细节）**：正数 mul 改为「乘法」模式（点数 = mul×1000）；负数 mul 改为「除法」模式，`effectiveDivisor = divisor + |mul|`。旧版「互补价差」（ε/edge/拿完/对调）与 `isRateMulAdjustedDivisorValid` 上限校验整个移除。
13. **Rate-Mul 输入方式再改**：
    - 「除法」模式不再靠输入负数（`-0.05`）让系统去加除数，改成**直接输入 `/newDivisor`**（跟 FX Rate 同款写法，如 `/1.55`），系统直接拿这个当新除数用，不再相加；纯负数输入现在**无效**。
    - 「乘法」模式细分两种：FX Rate 本身是 `/divisor` 时，Rate-Mul 纯正数仍是点数直接用（`mul×1000`，不变）；**FX Rate 本身是乘法写法时，Rate-Mul 纯正数改成「新汇率」输入**，系统自动跟原汇率做差再 `×1000`（`(Rate-Mul − 原汇率) × 1000`），不再是 `Rate-Mul × 1000`。
    - `parseMiddlemanRateSigned` 重命名为 `parseMiddlemanRateInput`，返回 `{ valid, mode: "divide"|"multiply", divisor/value }`。
    - `buildRatePayload` 里 `rate_middleman_rate` 若是「除法」模式，改送裸除数（如 `"1.55"`）给后端，不送带 `/` 的原始字符串——后端 `money_normalize` 遇到 `/` 会直接抛异常导致提交失败。
14. **FX Rate 是乘法写法时的「新汇率」换算方式改正**：13 里 `(Rate-Mul − 原汇率) × 1000` 验证时发现跟 fromAmount 的量级对不上（`from=1500` 时 `×1000` 巧合对上，`from=10000` 时就差 10 倍）。改为 `|原汇率 − Rate-Mul| × fromAmount`；`from=1500, 1.5→1.51` 的旧例子重新核对后正确答案应为 `15`（不是之前误确认的 `10`）；`from=10000, 3.15→2.93` 例子为 `2200`。
15. **上一条的「取绝对值」也是错的，改成带符号**：用两张 FX/Rate-Mul 数值互换的截图（`FX=3.15,Rate-Mul=2.93`→`+22`；`FX=2.93,Rate-Mul=3.15`→`-22`）验证出方向必须保留，不能取绝对值。最终公式：`rateMulCommission = (原汇率 − Rate-Mul) × fromAmount`（不取绝对值，`Rate-Mul > 原汇率` 时为负）。连带把 14 里 `from=1500, 1.5→1.51` 的例子也重新订正为 `-15`（原先确认的 `+15` 也是错的）。「除法」模式与「FX Rate 是 `/divisor` 时的点数直接用」两条路径不受影响。负 `rateMulCommission` 目前不会额外调整 Transfer From 金额、也不会写 `RATE_MIDDLEMAN` 分录（既有的 `> 0` 判断门槛，非本次改动引入）。

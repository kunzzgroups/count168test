# Dashboard 金额抓取方式 与 Ownership 分成算法 — 分析记录

> 说明：仓库里没有专门叫 `dashboard.test.js` 的测试文件。与"金额抓取"直接相关的测试，是
> `frontend/src/pages/datacapture/paste/core/*.test.js`（数据录入粘贴解析），这些测试保证了
> 报表金额能被正确抓取、最终汇入交易表 → Dashboard 聚合。以下按"抓取 → 汇总 → 分成"的链路说明。

## 1. 金额抓取（Data Capture 粘贴解析，被 test 覆盖的部分）

路径：`frontend/src/pages/datacapture/paste/core/`

这一层负责把用户从各家上游系统（fruit16 dailyWinlose、Citibet Agent PT Report、
King855、PS38、Gamingsoft Invoice、WOS 等）**复制粘贴**过来的表格文本 / HTML，解析成
可写入网格的金额矩阵。每个上游格式对应一个 `xxxPasteHelper.js` + 对应的
`xxxPasteHelper.test.js`：

| 来源 | Helper 文件 | 测试文件 |
|---|---|---|
| fruit16 Win/Lose 只复制 Sub Total + Grand Total 两行 | `dataCaptureWinLoseFooterOnlyPasteHelper.js` | 同名 `.test.js` |
| Citibet Agent PT Report | `dataCaptureCitibetAgentPtReportPasteHelper.js` | 同名 `.test.js` |
| King855 Win/Loss | `dataCaptureKing855WinLossPasteHelper.js` | 同名 `.test.js` |
| PS38 Win/Loss | `dataCapturePs38WinLossPasteHelper.js` | 同名 `.test.js` |
| Gamingsoft Invoice | `dataCaptureGamingSoftInvoicePasteHelper.js` | 同名 `.test.js` |
| WOS Win/Loss Detail | `dataCaptureWosWinLossDetailPasteHelper.js` | 同名 `.test.js` |
| 通用粘贴格式判定 | `dataCapturePasteDetect.js` | `dataCapturePasteDetect.test.js` |
| 粘贴矩阵清洗/对齐 | `dataCapturePasteMatrixSanitize.js`, `dataCaptureTotalRowAlign.js` | 对应 `.test.js` |

**抓取方式的共同套路**（以 `dataCaptureWinLoseFooterOnlyPasteHelper.js` 为例，详见
[frontend/src/pages/datacapture/paste/core/dataCaptureWinLoseFooterOnlyPasteHelper.js](frontend/src/pages/datacapture/paste/core/dataCaptureWinLoseFooterOnlyPasteHelper.js)）：

1. **来源判定**：先用正则/关键字判断粘贴内容是不是这个上游的格式（如 `SUB TOTAL` /
   `GRAND TOTAL` 标签、`upline payment` 等特征词），避免误吃别的格式。
2. **金额识别**：`isMoneyOrCount()` — 用正则 `/^-?\d+(?:\.\d+)?$/`（先去掉千分位逗号，
   括号负数 `(123)` → `-123`）判断一个 token 是不是金额/数量。
3. **两种输入形态都处理**：
   - **HTML 表格**（`parseHtmlFooterOnlyTable`）：解析 `<tr>/<td>`，处理 `colspan`、
     单元格内多行堆叠（`<br>` 当换行）等情况；
   - **纯文本**（Tab 分隔 / 无 Tab 按空格 flatten）：`flattenNonEmptyTokens()` 把整段
     文本拆成 token 数组，并合并 "SUB"+"TOTAL" → "SUB TOTAL" 这类被空格拆开的标签。
4. **修复错位**：不同网站复制出来的表格经常"列错位/转置/交错"（column-major、
   相邻两行 SUB/GRAND 交错），代码里专门写了 `deinterleaveAdjacentFooterLabels`、
   `reshapeVerticalFooterTokens`、`alignFooterOnlySubGrandMatrix` 来把这些畸形粘贴
   还原成对齐的二维矩阵。
5. **写入网格**：最终矩阵通过 `applyDataMatrixToGrid()` 灌入 Data Capture 表格 UI，
   用户确认后提交，落库为 `transactions` / 数据录入相关表的记录。

测试文件（`.test.js`）就是针对上面这些函数，喂各种"畸形粘贴"样本（转置、错位、
括号负数、千分位逗号等），断言解析出的矩阵/金额是否正确 —— 这就是"金额抓取的测试"。

## 2. Dashboard 页面怎么把这些金额聚合出来

抓取进来的交易数据，最终由后端 `api/transactions/dashboard_api.php`
（约 4900 行，核心聚合逻辑）用 SQL 聚合成 KPI：

- **Profit（本期盈亏）**：对 `transactions` 表按 `transaction_type` 做
  `SUM(CASE WHEN ... THEN amount ELSE 0 END)`，例如：
  - `WIN` 且描述是 `Process: %`（自动结算）→ `+amount`
  - `LOSE` 且 `Process: %` → `-amount`
  - `WIN`/`LOSE` 且是手动录入（`dashboardManualProfitDescSql`）→ 符号相反
  - `RECEIVE/CLAIM/CONTRA/CLEAR/PAYMENT` → 计入应收应付方向
  - `ADJUSTMENT` → 直接加总
  （见 [api/transactions/dashboard_api.php:774](api/transactions/dashboard_api.php:774) 附近）
- **Expenses**：另一组 `SUM(CASE ...)`，对 Cr/Dr、手续费等做符号处理。
- 结果打包成 `period_total.profit` / `period_total.expenses` 返回给前端。

前端 `frontend/src/pages/dashboard/lib/dashboardKpi.js`：
- `netProfitFromDashboardPayload()` / `computeKpiMetrics()`：
  `netProfit = profit + (expenses>0 ? -expenses : expenses)`（Expenses 展示为负数）。
- KPI 卡片、走势图、Earnings 饼图分别调用这些函数把后端返回的原始数字格式化展示。

## 3. Ownership（分成）算法怎么抓、怎么算

分两层：**后端读取分成配置** + **前端把配置换算成一个乘数应用到 netProfit**。

### 3.1 后端：读取分成比例
函数：`dashboardLoadCompanyDashboardOwnership()`
（[api/transactions/dashboard_api.php:1392](api/transactions/dashboard_api.php:1392)）

- 数据表：`company_ownership` / `company_ownership_history`（按公司维度的直接持股 or
  与某个 partner group 的股权比例）、`group_ownership` / `group_ownership_history`
  （集团层面，账号在集团里的分成比例）。是否用 `_history` 表由日期决定
  （`dashboardResolveOwnershipMonthFromDate`：查历史月份用带月份快照的 history 表，
  当月用 live 表）—— 这样过去月份的分成比例改了也不会影响历史 Dashboard 数字。
- 查询顺序：
  1. **直接持股**：`SELECT percentage FROM company_ownership WHERE company_id=? AND
     account_id=? AND owner_type=?` → `ownership_percentage`（有直接持股就跳过下面的
     集团链路，`skipGroupChain`）。
  2. **集团链路**（无直接持股时）：
     - 若指定了 `viewGroup`，先尝试 `dashboardResolveEarningsPathProduct()`
       算"多层集团路径"的连乘比例（子公司→集团A→集团B…），得到
       `group_equity_percentage`；
     - 再查该 group 下这个账号的 `group_ownership.percentage` 作为
       `group_account_percentage`（账号在集团里能分到的比例）；
     - 否则退回单层：从 `company_ownership WHERE owner_type='group'` 找该公司挂在
       哪个 `partner_group_id` 下、股权多少（`group_equity_percentage`），再查
       `group_ownership` 里该账号在这个 group 的比例（`group_account_percentage`）。
- 返回给前端的字段：`ownership_percentage`、`group_equity_percentage`、
  `group_account_percentage`、`has_group_ownership`、`has_ownership_setup`。

### 3.2 前端：把分成配置换算成乘数
函数：`resolveEarningsMultiplier()`（内部）→
`resolveEffectiveOwnershipPct()` / `resolvePanelEarningsPct()`
（[frontend/src/pages/dashboard/lib/dashboardKpi.js:148](frontend/src/pages/dashboard/lib/dashboardKpi.js:148)）

优先级（从高到低）：
1. **Group 聚合口径**（`_group_aggregate_earnings`）：直接用
   `group_account_percentage / 100` 作为乘数。
2. **Link multiplier**（`_link_multiplier`，公司间转账链路带来的连乘系数，
   非 1 才生效）：`linkMul × (group_account_percentage>0 ? account%/100 : 1)`。
3. **直接持股** `ownership_percentage > 0`：直接用 `directPct = ownership_percentage/100`。
4. **集团两段乘**：`(group_equity_percentage/100) × (group_account_percentage/100)`
   —— 即"公司在集团里的股权占比" × "我在集团里的分成占比"。
5. 都没有配置 → 乘数为 0（不显示 Earnings，除非是"子公司下钻"场景等特殊 fallback）。

最终：
```
Earnings = netProfit × 分成乘数
```
`netProfit` 就是第 2 节算出来的 `profit + 负号处理后的 expenses`。

子公司下钻场景（`subsidiaryGroupDrillDown`）逻辑更严格：必须
`has_ownership_setup` 为真才算，且不允许 fallback 到"无配置=100%"，避免误算。

## 4. 一句话总结

- **金额抓取**：靠 `datacapture/paste/core` 下一批 `xxxPasteHelper.js`，用"关键字判定
  来源 + 正则识别金额 + 处理各种复制错位/转置" 的方式，把网页表格粘贴解析成结构化矩阵写入
  数据录入表；对应的 `.test.js` 专门测这些畸形粘贴样本的解析正确性。
- **Dashboard 金额来源**：不是直接读 Data Capture 表，而是这些录入最终落到
  `transactions`（及 `transaction_entry`）表，由 `dashboard_api.php` 用一堆
  `SUM(CASE transaction_type ...)` SQL 按业务语义（WIN/LOSE/PAYMENT/…）加总出
  `profit` / `expenses`。
- **Ownership 算法**：后端按"直接持股优先，其次集团链路（公司在集团股权% × 我在集团分成%），
  历史月份查 history 快照表"的规则读出比例；前端再按"group聚合 > link乘数 > 直接持股 >
  集团两段乘"的优先级把比例转成一个乘数，乘在 netProfit 上得到 Earnings。

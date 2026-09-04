# Mobile Dashboard Alignment Changelog

日期：2026-09-04
范围：`c168_mobile/frontend/src`（与桌面版 `frontend/src/pages/dashboard/` 的功能对齐）

## 背景

对桌面版与电话版的 dashboard 做了逐项功能比对（数据 API 参数、KPI 指标、图表、Earnings 面板、
汇率换算、组/公司范围能力），移动端本就是桌面端的忠实移植（多处标注 "desktop parity"），
真正的缺口集中在数据层韧性。本轮对齐了以下三项：

## 1. `chart_monthly=1` — 长区间图表服务端聚合

- **文件**：`lib/dashboardLoad.js`
- 桌面端在日期跨度 ≥ 3 个月时向 `dashboard_bootstrap_api.php` 发送 `chart_monthly=1`，
  由服务端直接返回 `YYYY-MM` 月桶数据；移动端此前从不发送该参数，拉每日数据在前端自行聚合。
- 现在两个 bootstrap 查询构建器（per-company 与 group-ledger）在 `bootstrap_scope=full`
  且 `shouldAggregateChartByMonth(dateFrom, dateTo)` 时都会带上 `chart_monthly=1`。
- 移动端图表构建器（`lib/dashboardChart.js`）本就优先消费月桶键，无需改动。

## 2. FX 汇率韧性层（整体移植桌面版 `frankfurterRates.js`）

- **文件**：`lib/frankfurterRates.js`（以桌面版 `frontend/src/utils/dashboard/frankfurterRates.js`
  为基础整体移植，686 行），新增能力：
  - **双层缓存**：内存 Map + sessionStorage（`frankfurter_rates_v1:*`，1 小时 TTL）
  - **in-flight 去重**：相同 base/quotes/date 的并发请求只发一次
  - **加密/自定义币种排除**：USDT/USDC/BTC/ETH 等不会发给 Frankfurter（避免整批 422），
    走系统 FX API（`api/fx/fx_rates_api.php`）或直接标记 unsupported
  - **重试 + 逐币种补拉（backfill）**：批量失败重试 2 次（间隔 200/350ms），
    仍缺的 quote 逐个按历史日期→最新回填；部分可用即入库，不再整批作废
  - **跨币种汇率推导**（`deriveFrankfurterRates`）与预热接口
    （`peekFrankfurterRatesCacheOrDerived` / `warmFrankfurterRatesForCurrencies`）
  - **AbortSignal 贯穿**（移动端特有）：切换范围/卸载时中止在途请求；
    低层 fetch 带 12 秒超时（TimeoutError 走重试路径）
- 对外签名保持移动端兼容：`fetchFrankfurterRates(base, quotes, { signal, date })`。
- 效果：此前单个缺失/不支持汇率会导致换算显示 "—" 并弹出 ratesWarning 横幅，
  现在与桌面端一样能通过缓存/补拉自愈。

## 3. previous 周期回退（环比 KPI 不再静默消失）

- **文件**：`lib/dashboardLoad.js` `fetchBootstrapData()`（所有 bootstrap 调用的唯一收口点）
- 桌面端在 bootstrap 省略 `previous` 时会用 `bootstrap_scope=previous` 重发一次拿对比期数据。
  移动端此前直接不显示环比。
- 现在 `bootstrap_scope=full` 且响应缺 `previous` 时自动补拉一次
  （AbortError 正常上抛，其余失败静默——环比保持缺席但不阻塞主数据）。

## 4. Earnings 面板展示对齐（桌面版细节补齐）

- **文件**：`pages/dashboard/CurrencyDistributionCard.jsx`、`CurrencyListCard.jsx`、
  `pages/dashboard/DashboardPage.jsx`
- **饼图点击详情**：点击扇区或图例行 → 显示该币种明细卡
  （原生金额、换算金额、占比 %、FX 单位汇率）。再次点击取消。
- **币种列表原生金额行**：多币种换算时，列表行在换算金额下方显示
  `≈ 原生金额 CODE`（与桌面版的 native 列对齐）。
- **币种胶囊长按拖拽排序 + 持久化**（`lib/currencyOrder.js` 新增
  `saveUserCurrencyOrder` / `persistCurrencyDisplayOrder` / `persistUserCurrencyDisplayOrder`）：
  - Company 面板中**长按币种胶囊 260ms** 进入拖拽排序，松手即保存
    （POST `user_currency_order_api.php`，带 `company_id` 或 `group_id`，
    并同步 localStorage 两份镜像）——与桌面版拖拽排序的持久化格式一致。
  - 长按期间 `touch-action: none` 避免与横滚冲突；快速点击仍是选择币种。
- DistributionCard 新增 `exchangeRates` / `exchangeRatesLoading` props
  （DashboardPage 传入 `dash.exchangeRates`）。

## 5. 背景无缝融合（本轮附带的全局视觉修复）

- **文件**：`index.css`、`components/layout/mobile-shell.css`、`MobileShell.jsx`
- `body::before` 作为唯一的全屏固定背景层（底色 + 顶部光晕）；
  `.m-shell` / sticky 区 / 内容区全部透明，消除固定顶栏与页面背景之间的色差接缝。
- sticky 区在页面滚动 > 8px 后淡入实底 + 细分割线（`m-shell-chrome--scrolled`），
  防止列表内容从透明区穿过。

## 排查记录（重要经验）

- **FilterChips 的迷你弹层必须用 React Portal 挂到 `document.body`**：
  胶囊位于 sticky bar 内，其 `overflow-x: auto` 与 pull-refresh 的 `translate3d`
  会劫持 `position: fixed` 的定位并裁剪面板。
- **移动端 `lib/dashboardEarnings.js` 没有 `computeDisplayConvertedAmount` /
  `formatFrankfurterUnitRate` 导出**（桌面版有，移动端在 `lib/frankfurterRates.js`）。
  从 dashboardEarnings 导入它们会触发 ESM 链接错误，导致全部页面白屏
  （root 空、无 window error 事件——模块链接失败不冒泡）。
- 币种胶囊列表打开时先用 `dash.currencies` 全量种子渲染，再由异步 scope 拉取精炼
  ——避免公司列表异步加载的竞态导致只剩单一币种。

## 已知遗留（低优先级）

- 饼图 reveal 编排动画、空区间骨架行、动画数字（桌面版有，装饰性）
- 预取/预热层（`prefetch=1` + LRU + sessionStorage 筛选包）——性能优化项
- `group_all=1` 服务端批量合并（冷路径才用到，移动端前端并行合并结果一致）
- `earnings` KPI 在无 earnings 配置时的回退值：桌面回退 0，移动回退净利
  （被 `showEarnings` 门控遮蔽，实际不可见）

# Bank Process List：2026-08 前端 UI / 效能優化記錄

> 適用範圍：`frontend/src/pages/bankprocesslist/`（BankProcessListPage 及其 hook/components）與相關 CSS
> （`processCSS.css` / `processlist.css` / `userlist.css`）、共用日期選擇器 `utils/date/dateRangePicker.js`。
> 這份文件記錄同一輪修改裡跟後端出賬邏輯無關、純前端 UI／效能相關的優化；
> 出賬/Resend 相關的修復記在 [`bankprocess-accounting-due-lifecycle-rules.md`](bankprocess-accounting-due-lifecycle-rules.md) 第 8 節。

---

## 1. Date range 篩選：無日期時預設顯示全部，不再顯示空清單

**問題**：早前一版改動（commit `f1e25c1a5` "bankProcess date range func customized"）把「沒有選日期範圍」的行為從「顯示全部 process」改成「顯示空清單，等使用者選了日期才出資料」。

**修復**：還原成沒有選日期時顯示全部（再套用 Active/Inactive 等其他篩選）。

- 位置：[`hooks/useBankProcessListPage.js`](../frontend/src/pages/bankprocesslist/hooks/useBankProcessListPage.js) 的 `visibleRows` `useMemo`。
- 邏輯：`if (dateFrom || dateTo) { ...按日期過濾... }`，沒有日期就跳過這段過濾，不再有 `if (!dateFrom && !dateTo) return [];` 這種提早清空。

---

## 2. Date range 跨頁面污染：從 Dashboard 切到 bankProcess 會誤顯示 Dashboard 的日期

**現象**：從 Dashboard（已選好一個日期範圍，例如「今天」）切到 Process 頁面時，bankProcess 自己的 Date range 藥丸會顯示 Dashboard 選的日期，而不是清空／預設空白。bankProcess 自己讀 URL query 算出來的 React state（`dateFrom`/`dateTo`）其實是空的，但畫面顯示的文字不是空的。

**根因**：日期選擇器 `window.MaintenanceDateRangePicker`（[`utils/date/dateRangePicker.js`](../frontend/src/utils/date/dateRangePicker.js)）是整個 SPA 共用的單例（模組級閉包變數，SPA 路由切換不會重建）。裡面有個 `stashedCommittedRange`（`preserveDisplayUntilCommit` 模式下，防止「重選日期期間」畫面被清空的暫存值），這個值只有 `clearSelection()` 才會清掉，**`init()` 完全不會重置它**。Dashboard 那邊只要曾經觸發過一次「已提交範圍」的畫面繪製，這個 stash 就會殘留下來；bankProcess 掛載時就算把隱藏欄位跟 `calendarStartDate` 都正確清空了，`updateDateRangeDisplay()` 因為 `preserveDisplayUntilCommit: true` 還是會優先去畫這個殘留的 stash，把畫面蓋回 Dashboard 的日期。

**修復**（兩處，缺一不可）：
1. [`dateRangePicker.js`](../frontend/src/utils/date/dateRangePicker.js) 的 `init(options)`：一開始就把 `stashedCommittedRange = null` 和 `isSelectingRange = false`——`init()` 代表有頁面（可能跟上次不同）要接管這個共用單例，先前殘留的「選取中預覽」快取到這裡已經過期，不該帶過去。這是修在共用元件的根源，所有用到這個 picker 的頁面都受益。
2. [`hooks/useBankProcessListPage.js`](../frontend/src/pages/bankprocesslist/hooks/useBankProcessListPage.js)：在掛載當下（比原本要等 `loading`/`cssReady` 都緒才跑的 init effect 更早）新增一個 `useLayoutEffect`，先把共用單例按 bankProcess 自己的 URL（沒有 date_from/date_to 就清空）釘一次，減少競態窗口。

---

## 3. Filter chips：小螢幕不再收進漏斗圖示，永遠完整展示

**需求**：bankProcess 頂欄的 Show All / Active / Inactive / Official / E-Invoice / Blocked 這排 filter chip，原本窄螢幕下會被 `useBankProcessFilterCollapse`（ResizeObserver 動態量測）收進一顆漏斗圖示，點開才有 dropdown。改成任何寬度都直接 inline 完整顯示，不再有收合狀態。

- 位置：[`BankProcessListPage.jsx`](../frontend/src/pages/bankprocesslist/BankProcessListPage.jsx)。移除了 `useBankProcessFilterCollapse` hook 呼叫、`filterPanelOpen` 狀態、漏斗按鈕點擊/雙擊/外部點擊關閉/Esc 關閉這些邏輯，以及隱藏的量測用 DOM clone；`BankProcessFilterChips` 永遠用 `layout="inline"`。
- **Search bar 的收合行為完全沒動**（`isNarrowToolbar` / `window.matchMedia("(max-width: 1699px)")` 驅動，跟 filter 是獨立機制）：小螢幕還是圖示形態，點了才展開成輸入框。

### 3.1 副作用：窄螢幕 filter chips 出現橫向 scroll，加了響應式縮小

因為 chips 永遠 inline，窄螢幕下總寬度可能超出可用空間，容器本身有 `overflow-x:auto` 的 fallback（本來就有，不是新加的），但體驗上會出現橫向 scrollbar。

- 位置：[`userlist.css`](../frontend/public/css/userlist.css)（`.userlist-filter-chips--bank-process` 這套 chip 樣式，跟 User List / Account List 共用同一份基底樣式，只是疊加了 `--bank-process` 修飾）。
- `@media (max-width: 1349px)` / `@media (max-width: 1199px)` 兩級：字號、padding、chip 間距、圓點/勾勾圖示尺寸改用**固定緊縮數值**（不是 `clamp(..., vw, ...)`），一跌破門檻立刻縮到位；同時拿掉每顆 chip 原本為了「切換中英文語言時 chip 寬度不跳動」而預留的固定 `min-width`，改成貼合當前文案實際長度。
  - 早期版本曾用 `clamp(min, vw, max)` 做這段縮放，但 `vw` 剛跌破門檻時算出來的值離下限還很遠，導致「剛跌破 1350px 那一小段仍縮不夠、還是要 scroll」——這是切成固定值兩級門檻的原因。

---

## 4. Search bar：窄螢幕展開後的寬度縮短

- 位置：[`processCSS.css`](../frontend/public/css/processCSS.css)，`@media (max-width: 1699px)` 內 `.bank-process-search-bar.is-expanded` 的寬度：`clamp(220px, 18vw, 320px)` → `clamp(150px, 11vw, 210px)`。收合狀態（僅顯示放大鏡圖示）沒有變動。

---

## 5. Edit Process modal 滾動效能

### 5.1 狀態下拉選單的 scroll 監聽沒有節流

`BankProcessStatusControl.jsx`（ACTIVE/INACTIVE 那顆狀態下拉選單）打開時掛的 `scroll`/`resize` 監聽，原本每個事件都同步跑 `getBoundingClientRect()`（強制版面計算）+ `setState`（觸發重渲染），是典型的 layout thrashing，快速滑動時容易在效能較弱的設備上掉幀——同一個 modal 裡另一個很像的下拉選單（`bankProcessFormFields.jsx` 的 `BankSearchableAccountPick`）先前已經修過這個問題，這次補齊。

- 位置：[`components/BankProcessStatusControl.jsx`](../frontend/src/pages/bankprocesslist/components/BankProcessStatusControl.jsx)。改成用 `requestAnimationFrame` 合併，每一幀最多重新量一次版面，而不是每個 scroll 事件都同步跑。
- 只在「狀態下拉選單開著、同時在滾動」時才會生效；如果卡頓是在沒開任何下拉選單、純滾動 modal 內容時發生，這個修復不會有感覺，要看下一項。

### 5.2 短滾動區域快速滑動「撞底」的突兀感

**現象**：Edit Process modal 內容較短時，快速甩動滑動，內容幾乎立刻到底，減速動畫被硬生生截斷，視覺上容易被誤讀成「卡了一下」（並非真的掉幀）。

**做法**：不去人為拖慢滾動速度（會破壞觸控 1:1 跟手的原生體驗，且需要用 JS 接管原生滾動，風險比原問題更高），改成在可滾動區域底部**加大留白**，讓內容有更長的「跑道」，減速動畫比較有機會自然收尾。

- 位置：[`processlist.css`](../frontend/public/css/processlist.css)，`#addBankModal .bank-form-fields-scroll` 的 `padding-bottom`。
- **只在需要滾動的矮螢幕才套用**：這段留白放進既有的 `@media (max-height: 820px)` 斷點裡（`10px` → `56px`），跟這個 modal 本來就用來判斷「螢幕矮到需要壓縮間距」的斷點共用。視窗高度 > 820px（內容本來就完整可見、不需要滾動）完全不受影響，不會平白多出捲軸和空白。

---

## 已知限制 / 未覆蓋

- 第 3.1 節的響應式縮小是用固定的寬度斷點（1349px / 1199px）調出來的，沒有實機在所有裝置尺寸窮舉驗證，如果某個寬度區間還是不夠塞，需要再補一級斷點。
- 第 5.2 節的「撞底突兀感」目前只用加大留白處理；如果加大留白後感覺仍不夠，下一步要查撞底那一刻是不是缺少原生 rubber-band 回彈（需要在真機上測，這邊沒有工具能模擬觸控手勢）。
- 這幾項改動都只在自動化 `vite build` 做過語法檢查，沒有自動化 UI 測試覆蓋，上線前建議依本文件逐項在目標設備上手動過一遍。

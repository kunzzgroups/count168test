import {
  eachDateInRange,
  eachMonthInRange,
  formatChartMonthLabel,
  parseYmd,
  shouldAggregateChartByMonth,
} from "./dashboardDateUtils.js";
import { resolveEarningsMultiplier, viewerHasEarningsConfig } from "./dashboardKpi.js";

export function resolveDailyChartXAxisTicks(pointCount, { monthly = false } = {}) {
  if (monthly) {
    if (pointCount <= 8) return { interval: 0, minTickGap: 4, height: 24, marginBottom: 8 };
    return { interval: "preserveStartEnd", minTickGap: 18, height: 26, marginBottom: 10 };
  }
  if (pointCount <= 10) return { interval: 0, minTickGap: 6, height: 22, marginBottom: 8 };
  if (pointCount <= 31) return { interval: "preserveStartEnd", minTickGap: 20, height: 24, marginBottom: 10 };
  if (pointCount <= 100) return { interval: "preserveStartEnd", minTickGap: 36, height: 28, marginBottom: 12 };
  return { interval: "preserveStartEnd", minTickGap: 52, height: 30, marginBottom: 14 };
}

export function computeTrendYDomain(rows, dataKeys) {
  if (!rows?.length || !dataKeys?.length) return [0, 1];
  let min = 0;
  let max = 0;
  rows.forEach((row) => {
    dataKeys.forEach((key) => {
      const value = Number(row[key]) || 0;
      if (value < min) min = value;
      if (value > max) max = value;
    });
  });
  if (min === 0 && max === 0) return [-1, 1];
  const span = max - min || Math.max(Math.abs(max), Math.abs(min), 1);
  const pad = span * 0.08;
  return [min < 0 ? min - pad : 0, max > 0 ? max + pad : 0];
}

function buildChartMetricRow(date, label, dailyData, earningsMultiplier) {
  const profitDelta = parseFloat(dailyData.profit?.[date] || 0) || 0;
  const expensesDelta = parseFloat(dailyData.expenses?.[date] || 0) || 0;
  const displayProfit = profitDelta;
  const displayExpenses = expensesDelta > 0 ? -expensesDelta : expensesDelta;
  const netProfit = displayProfit + displayExpenses;
  const earnings = netProfit * earningsMultiplier;
  return {
    date,
    label,
    profit: displayProfit,
    expenses: displayExpenses,
    netProfit,
    earnings,
  };
}

export function buildChartRows(data, startYmd, endYmd, options = {}) {
  if (!data?.daily_data) return [];
  const dailyData = data.daily_data;
  const earningsMultiplier = viewerHasEarningsConfig(data, options)
    ? resolveEarningsMultiplier(data, false, options)
    : 0;

  const rangeStart = parseYmd(startYmd);
  const rangeEnd = parseYmd(endYmd);

  if (shouldAggregateChartByMonth(startYmd, endYmd)) {
    return eachMonthInRange(startYmd, endYmd).map(({ year, month }) => {
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const label = formatChartMonthLabel(year, month);
      const hasMonthBucket =
        dailyData.profit?.[monthKey] != null || dailyData.expenses?.[monthKey] != null;
      if (hasMonthBucket) {
        return buildChartMetricRow(monthKey, label, dailyData, earningsMultiplier);
      }
      const lastDay = new Date(year, month, 0).getDate();
      let profitSum = 0;
      let expensesSum = 0;
      for (let day = 1; day <= lastDay; day += 1) {
        const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
        const dateObj = parseYmd(dateStr);
        if (dateObj < rangeStart || dateObj > rangeEnd) continue;
        profitSum += parseFloat(dailyData.profit?.[dateStr] || 0) || 0;
        expensesSum += parseFloat(dailyData.expenses?.[dateStr] || 0) || 0;
      }
      const displayProfit = profitSum;
      const displayExpenses = expensesSum > 0 ? -expensesSum : expensesSum;
      const netProfit = displayProfit + displayExpenses;
      return {
        date: monthKey,
        label,
        profit: displayProfit,
        expenses: displayExpenses,
        netProfit,
        earnings: netProfit * earningsMultiplier,
      };
    });
  }

  const dates = eachDateInRange(startYmd, endYmd);
  const sameCalendarMonth =
    rangeStart &&
    rangeEnd &&
    rangeStart.getFullYear() === rangeEnd.getFullYear() &&
    rangeStart.getMonth() === rangeEnd.getMonth();

  return dates.map((date) => {
    const d = parseYmd(date);
    const label = sameCalendarMonth
      ? String(d.getDate())
      : `${d.getDate()}/${d.getMonth() + 1}`;
    return buildChartMetricRow(date, label, dailyData, earningsMultiplier);
  });
}

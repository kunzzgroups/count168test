import {
  formatAmountForStore,
  parseRateExpression,
  RATE_STORE_MAX_DECIMALS,
} from "./transactionFormat.js";
import MoneyDecimal from "./money/moneyDecimal.js";

export function toNumberLike(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function cleanAmt(raw) {
  return String(raw ?? "")
    .replace(/,/g, "")
    .trim();
}

function parsePositiveAmt(raw) {
  try {
    const inputStr = cleanAmt(raw);
    if (!inputStr) return MoneyDecimal.toDecimal("0", 0);
    const dec = MoneyDecimal.toDecimal(inputStr, 0);
    return dec.gt(0) ? dec : MoneyDecimal.toDecimal("0", 0);
  } catch {
    return MoneyDecimal.toDecimal("0", 0);
  }
}

function parseSignedAmt(raw) {
  try {
    return MoneyDecimal.toDecimal(cleanAmt(raw) || "0", 0);
  } catch {
    return MoneyDecimal.toDecimal("0", 0);
  }
}

/** Rate-Mul factor: plain number or expression (`/0.1` → 10), same rules as exchange Rate. */
function parseMiddlemanRateFactor(raw) {
  const parsed = parseRateExpression(raw);
  if (!parsed.valid) return MoneyDecimal.toDecimal("0", 0);
  try {
    const dec = MoneyDecimal.toDecimal(parsed.value || "0", 0);
    return dec.gt(0) ? dec : MoneyDecimal.toDecimal("0", 0);
  } catch {
    return MoneyDecimal.toDecimal("0", 0);
  }
}

/** RATE Service Fee remark / desc：charge {第二币种} {用户输入} Service Fees */
export function buildRateServiceFeeRemark(currencyTo, middlemanInputAmount) {
  const inputStr = cleanAmt(middlemanInputAmount);
  if (!inputStr) return "";
  try {
    const dec = MoneyDecimal.toDecimal(inputStr, 0);
    if (dec.lte(0)) return "";
  } catch {
    return "";
  }
  const currency = String(currencyTo ?? "").trim().toUpperCase();
  if (!currency) return "";
  return `charge ${currency} ${inputStr} Service Fees`;
}

/** RATE Platform Fee desc：charge {第二币种} {用户输入} PlatForm Fee */
export function buildRatePlatformFeeRemark(currencyTo, platformFeeAmount) {
  const inputStr = cleanAmt(platformFeeAmount);
  if (!inputStr) return "";
  let displayAmount;
  try {
    const dec = MoneyDecimal.toDecimal(inputStr, 0);
    if (dec.isZero()) return "";
    displayAmount = dec.abs().toString();
  } catch {
    return "";
  }
  const currency = String(currencyTo ?? "").trim().toUpperCase();
  if (!currency) return "";
  return `charge ${currency} ${displayAmount} PlatForm Fee`;
}

/**
 * Middle-Man profit: rate-mul commission + Service Fee, with negative PT only.
 * - PT-Fee > 0 → 外来平台费，只扣 From，**不**进 Middle（Middle = Fee + rateMul）
 * - PT-Fee < 0 → Middle = Fee − abs(PT-Fee)
 * Fee / Platform Fee are face values (no FX multiply).
 */
export function computeRateMiddlemanProfit({
  fromAmount,
  middlemanRate,
  feeAmount,
  platformFeeAmount,
}) {
  const fromDec = parsePositiveAmt(fromAmount);
  let rateMulDec = MoneyDecimal.toDecimal("0", 0);
  const mmrDec = parseMiddlemanRateFactor(middlemanRate);
  if (fromDec.gt(0) && mmrDec.gt(0)) {
    rateMulDec = fromDec.times(mmrDec);
  }
  const feeDec = parsePositiveAmt(feeAmount);
  const platformSigned = parseSignedAmt(platformFeeAmount);
  let feeNet = feeDec;
  // Positive PT is external — never add into Middle-Man profit.
  if (platformSigned.lt(0)) {
    feeNet = feeDec.minus(platformSigned.abs());
  }
  return rateMulDec.plus(feeNet);
}

/** Positive PT-Fee abs for From-amount deduction; otherwise 0. */
export function positivePlatformFeeDeduction(platformFeeAmount) {
  const platformSigned = parseSignedAmt(platformFeeAmount);
  return platformSigned.gt(0) ? platformSigned.abs() : MoneyDecimal.toDecimal("0", 0);
}

/**
 * RATE submit payload aligned with `js/transaction.js` submitAction + `api/transactions/submit_api.php` expectations.
 * Amounts are truncated to 8dp for storage (no round-2). `formatRateAmount` is display-only elsewhere.
 * `toGrossStr` is a fallback when rate/from cannot rebuild gross (e.g. missing rate).
 */
export function buildRatePayload({
  toId,
  fromId,
  fromAmt,
  toGrossStr,
  rateDate,
  txRemark,
  rateCurrencyFrom,
  rateCurrencyTo,
  parsedRateNormalizedStr,
  rateMiddlemanRate,
  rateMiddlemanAmount,
  rateMiddlemanAccount,
  rateExchangeRateRaw,
  rateFromAccount,
  rateToAccount,
  rateTransferToAccount,
  rateTransferFromAccount,
  rateMiddlemanInputAmount,
  rateMiddlemanPlatformFee,
}) {
  const transferToId = rateTransferToAccount?.id ? String(rateTransferToAccount.id) : "";
  const transferFromId = rateTransferFromAccount?.id ? String(rateTransferFromAccount.id) : "";
  const middleId = rateMiddlemanAccount?.id ? String(rateMiddlemanAccount.id) : "";
  const store = (v) => formatAmountForStore(v, RATE_STORE_MAX_DECIMALS);

  const fromDec = MoneyDecimal.toDecimal(cleanAmt(fromAmt) || "0", 0);

  // Rebuild gross at full precision (UI may have rounded toGrossStr to 2dp for display).
  let grossDec;
  try {
    const rateDec = MoneyDecimal.toDecimal(cleanAmt(parsedRateNormalizedStr) || "0", 0);
    if (fromDec.gt(0) && rateDec.gt(0)) {
      grossDec = fromDec.times(rateDec);
      try {
        const feeInputDec = MoneyDecimal.toDecimal(cleanAmt(rateMiddlemanInputAmount) || "0", 0);
        if (feeInputDec.lt(0)) {
          grossDec = grossDec.plus(feeInputDec);
        }
      } catch {
        // ignore fee adjust
      }
    } else {
      grossDec = MoneyDecimal.toDecimal(cleanAmt(toGrossStr) || "0", 0);
    }
  } catch {
    grossDec = MoneyDecimal.toDecimal(cleanAmt(toGrossStr) || "0", 0);
  }

  // Prefer recomputed middleman profit so store precision is not lost to display round-2.
  let middleDec = computeRateMiddlemanProfit({
    fromAmount: fromAmt,
    middlemanRate: rateMiddlemanRate,
    feeAmount: rateMiddlemanInputAmount,
    platformFeeAmount: rateMiddlemanPlatformFee,
  });
  if (middleDec.isZero() && cleanAmt(rateMiddlemanAmount)) {
    try {
      middleDec = MoneyDecimal.toDecimal(cleanAmt(rateMiddlemanAmount) || "0", 0);
    } catch {
      middleDec = MoneyDecimal.toDecimal("0", 0);
    }
  }

  const platformInputDec = parseSignedAmt(rateMiddlemanPlatformFee);

  // Rate-mul commission only (excludes fee / platform fee). Supports `/0.1` via parseRateExpression.
  let rateMulDec = MoneyDecimal.toDecimal("0", 0);
  const mmrDec = parseMiddlemanRateFactor(rateMiddlemanRate);
  if (fromDec.gt(0) && mmrDec.gt(0)) {
    rateMulDec = fromDec.times(mmrDec);
  }

  const fromCode = rateFromAccount?.account_id || "";
  const toCode = rateToAccount?.account_id || "";
  const fromDesc = `Transaction to ${toCode} (Rate: ${rateExchangeRateRaw})`;
  const toDesc = `Transaction from ${fromCode} (Rate: ${rateExchangeRateRaw})`;

  const transferFromCode = rateTransferFromAccount?.account_id || "";
  const transferToCode = rateTransferToAccount?.account_id || "";
  const transferFromDesc = `Transaction to ${transferToCode} (Rate: ${rateExchangeRateRaw})`;
  const transferToDesc = `Transaction from ${transferFromCode} (Rate: ${rateExchangeRateRaw})`;

  const middleDesc =
    middleId && !middleDec.isZero()
      ? `Rate charge (x${rateMiddlemanRate}) from ${rateCurrencyFrom} ${MoneyDecimal.formatFixed(fromDec.toString(), 2)}`
      : "";

  const serviceFeeRemark = buildRateServiceFeeRemark(rateCurrencyTo, rateMiddlemanInputAmount);
  const platformFeeRemark = buildRatePlatformFeeRemark(rateCurrencyTo, rateMiddlemanPlatformFee);
  // Service Fee → header sms / history Remark only (no RATE_FEE row).
  const sms = serviceFeeRemark || String(txRemark || "").toUpperCase();

  const storeFrom = store(fromDec.toString());
  const storeGross = store(grossDec.toString());

  const payload = {
    transaction_type: "RATE",
    account_id: toId,
    from_account_id: fromId,
    amount: storeFrom,
    transaction_date: rateDate,
    description: "",
    sms,
    currency: rateCurrencyFrom,

    rate_from_account_id: fromId,
    rate_from_currency: rateCurrencyFrom,
    rate_from_amount: storeFrom,
    rate_from_description: fromDesc,

    rate_to_account_id: toId,
    rate_to_currency: rateCurrencyTo,
    rate_to_amount: storeGross,
    rate_to_description: toDesc,

    rate_currency_from: rateCurrencyFrom,
    rate_currency_from_amount: storeFrom,
    rate_currency_to: rateCurrencyTo,
    rate_currency_to_amount: storeGross,
    rate_exchange_rate: String(parsedRateNormalizedStr ?? ""),

    rate_middleman_rate: rateMiddlemanRate,
    rate_middleman_amount: !middleDec.isZero() ? store(middleDec.toString()) : "",
    rate_middleman_account: middleId,
    rate_middleman_input_amount: rateMiddlemanInputAmount ? cleanAmt(rateMiddlemanInputAmount) : "",
    rate_middleman_platform_fee: rateMiddlemanPlatformFee ? cleanAmt(rateMiddlemanPlatformFee) : "",

    rate_transfer_amount: "",
    rate_account_from_amount: "",
    rate_account_to_amount: "",
  };

  if (transferToId && transferFromId) {
    // To = net (exclude Service Fee) so 收款方 matches form amount (e.g. 300 not 310).
    // From keeps Service Fee; positive PT-Fee deducts From in-leg (no RATE_PLATFORM_FEE row).
    // Negative PT-Fee does not touch From/To; Middle = Fee − abs(PT), Remark on MARKUP.
    const transferBase = grossDec;
    const serviceFeeDec = parsePositiveAmt(rateMiddlemanInputAmount);
    const positivePtDec = positivePlatformFeeDeduction(rateMiddlemanPlatformFee);
    let transferToSide = serviceFeeDec.gt(0) ? transferBase.minus(serviceFeeDec) : transferBase;
    let transferFromSide = transferBase;
    if (middleId && rateMulDec.gt(0)) {
      transferFromSide = transferBase.minus(rateMulDec);
    }
    if (positivePtDec.gt(0)) {
      transferFromSide = transferFromSide.minus(positivePtDec);
    }

    payload.rate_transfer_from_account_id = transferToId;
    payload.rate_transfer_from_currency = rateCurrencyTo;
    payload.rate_transfer_from_amount = store(transferToSide.toString());
    payload.rate_transfer_from_description = transferFromDesc;

    payload.rate_transfer_to_account_id = transferFromId;
    payload.rate_transfer_to_currency = rateCurrencyTo;
    payload.rate_transfer_to_amount = store(transferFromSide.toString());
    payload.rate_transfer_to_description = transferToDesc;

    payload.rate_transfer_from_account = transferToId;
    payload.rate_transfer_to_account = transferFromId;

    if (middleId && !middleDec.isZero()) {
      payload.rate_middleman_account_id = middleId;
      payload.rate_middleman_currency = rateCurrencyTo;
      payload.rate_middleman_amount = store(middleDec.toString());
      payload.rate_middleman_description = middleDesc;
    }

    // Only negative PT-Fee still needs platform-fee fields (Middle Remark / fallback Fee row).
    if (platformInputDec.lt(0)) {
      payload.rate_platform_fee_amount = store(platformInputDec.toString());
      payload.rate_platform_fee_description =
        platformFeeRemark ||
        `charge ${String(rateCurrencyTo ?? "").trim().toUpperCase()} ${store(platformInputDec.abs().toString())} PlatForm Fee`;
    }
  }

  return { payload, middleId };
}

/** Account DB ids involved in a submit — used for post-submit focused list (To + From, RATE legs, etc.). */
export function collectSubmitFocusAccountIds({
  txType,
  toAccountId,
  fromAccountId,
  isAdjustment = false,
  rateToAccountId,
  rateFromAccountId,
  rateTransferToAccountId,
  rateTransferFromAccountId,
  rateMiddlemanAccountId,
} = {}) {
  const ids = new Set();
  const add = (id) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  };

  const type = String(txType || "").toUpperCase().trim();
  if (type === "RATE") {
    add(rateToAccountId);
    add(rateFromAccountId);
    add(rateTransferToAccountId);
    add(rateTransferFromAccountId);
    add(rateMiddlemanAccountId);
    return [...ids];
  }

  add(toAccountId);
  if (!isAdjustment) add(fromAccountId);
  return [...ids];
}

/**
 * Cr/Dr (or Win/Loss) deltas for optimistic list update after approved submit.
 * CONTRA/PAYMENT/CLAIM/CLEAR/RECEIVE: To −amount, From +amount.
 * ADJUSTMENT: To += signed amount.
 * WIN/LOSE: amounts go to win_loss (To/From signs per period search).
 */
export function buildOptimisticSubmitDeltas({
  txType,
  amount,
  toAccountId,
  fromAccountId,
} = {}) {
  const type = String(txType || "").toUpperCase().trim();
  if (!type || type === "RATE") return [];

  let amtStr;
  try {
    const cleaned = MoneyDecimal.cleanMoneyInput(amount);
    if (!cleaned) return [];
    amtStr = MoneyDecimal.toDecimal(cleaned).toString();
  } catch {
    return [];
  }

  const toId = Number(toAccountId);
  const fromId = Number(fromAccountId);
  const deltas = [];
  const push = (id, patch) => {
    if (Number.isFinite(id) && id > 0) deltas.push({ accountDbId: id, ...patch });
  };

  if (type === "ADJUSTMENT") {
    push(toId, { crDrDelta: amtStr });
    return deltas;
  }

  if (type === "WIN" || type === "LOSE") {
    const absAmt = MoneyDecimal.abs(amtStr).toString();
    // Period search: To WIN −amount / LOSE +amount; From WIN +amount / LOSE −amount.
    if (type === "WIN") {
      push(toId, { winLossDelta: MoneyDecimal.sub("0", absAmt).toString() });
      push(fromId, { winLossDelta: absAmt });
    } else {
      push(toId, { winLossDelta: absAmt });
      push(fromId, { winLossDelta: MoneyDecimal.sub("0", absAmt).toString() });
    }
    return deltas;
  }

  if (["CONTRA", "PAYMENT", "CLAIM", "CLEAR", "RECEIVE"].includes(type)) {
    push(toId, { crDrDelta: MoneyDecimal.sub("0", amtStr).toString() });
    push(fromId, { crDrDelta: amtStr });
  }

  return deltas;
}

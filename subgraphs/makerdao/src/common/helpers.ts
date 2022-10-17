import { ethereum, BigDecimal, BigInt, log, Address } from "@graphprotocol/graph-ts";
import {
  Market,
  Account,
  ActiveAccount,
  Deposit,
  Withdraw,
  Borrow,
  Repay,
  Liquidate,
  Token,
} from "../../generated/schema";
import {
  getOrCreateFinancials,
  getOrCreateLendingProtocol,
  getOrCreateUsageMetricsDailySnapshot,
} from "./getters";
import {
  BIGDECIMAL_ZERO,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
  BIGINT_ZERO,
  BIGINT_NEG_ONE,
  BIGDECIMAL_NEG_ONE,
  DAI_ADDRESS,
  VAT_ADDRESS,
  WAD,
  RAD,
  ProtocolSideRevenueType,
} from "./constants";
import { createEventID, getDateXDaysAheadInUTC, getISODateStringInUTC, getISODateTimeStartOfDayStringInUTC } from "../utils/strings";
import { bigIntToBDUseDecimals, bigIntChangeDecimals } from "../utils/numbers";
import { Vat } from "../../generated/Vat/Vat";
import { DAI } from "../../generated/Vat/DAI";
import { getOrCreateMarket, getOrCreateToken } from "./getters";

export function updateProtocol(
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType: u32 = 0,
): void {
  let protocol = getOrCreateLendingProtocol();

  // update Deposit
  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeDepositUSD = protocol.cumulativeDepositUSD.plus(deltaCollateralUSD);
  }

  // protocol.totalDepositBalanceUSD = protocol.totalDepositBalanceUSD.plus(deltaCollateralUSD);
  // instead, iterate over markets to get "mark-to-market" deposit balance
  let totalBorrowBalanceUSD = BIGDECIMAL_ZERO;
  let totalDepositBalanceUSD = BIGDECIMAL_ZERO;
  for (let i: i32 = 0; i < protocol.marketIDList.length; i++) {
    let marketID = protocol.marketIDList[i];
    let market = Market.load(marketID);
    totalBorrowBalanceUSD = totalBorrowBalanceUSD.plus(market!.totalBorrowBalanceUSD);
    totalDepositBalanceUSD = totalDepositBalanceUSD.plus(market!.totalDepositBalanceUSD);
  }
  protocol.totalBorrowBalanceUSD = totalBorrowBalanceUSD;
  protocol.totalDepositBalanceUSD = totalDepositBalanceUSD;
  protocol.totalValueLockedUSD = protocol.totalDepositBalanceUSD;

  /* alternatively, get total borrow (debt) from vat.debt
  // this would include borrow interest, etc
  // so they two will have some difference
  let vatContract = Vat.bind(Address.fromString(VAT_ADDRESS));
  let debtCall = vatContract.try_debt();
  if (debtCall.reverted) {
    log.warning("[updateProtocal]Failed to call Vat.debt; not updating protocol.totalBorrowBalanceUSD", []);
  } else {
    protocol.totalBorrowBalanceUSD = bigIntToBDUseDecimals(debtCall.value, RAD+);
  }
  */

  // update Borrow
  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD.plus(deltaDebtUSD);
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD.plus(liquidateUSD);
  }

  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD.plus(newTotalRevenueUSD);
  }

  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeSupplySideRevenueUSD = protocol.cumulativeSupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }

  let newProtocolSideRevenueUSD = newTotalRevenueUSD.minus(newSupplySideRevenueUSD);
  if (newProtocolSideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    protocol.cumulativeProtocolSideRevenueUSD = protocol.cumulativeTotalRevenueUSD.minus(
      protocol.cumulativeSupplySideRevenueUSD,
    );
    switch (protocolSideRevenueType) {
      case ProtocolSideRevenueType.STABILITYFEE:
        protocol._cumulativeProtocolSideStabilityFeeRevenue = protocol._cumulativeProtocolSideStabilityFeeRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
      case ProtocolSideRevenueType.LIQUIDATION:
        protocol._cumulativeProtocolSideLiquidationRevenue = protocol._cumulativeProtocolSideLiquidationRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
      case ProtocolSideRevenueType.PSM:
        protocol._cumulativeProtocolSidePSMRevenue = protocol._cumulativeProtocolSidePSMRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
    }
  }

  // update mintedTokenSupplies
  let daiContract = DAI.bind(Address.fromString(DAI_ADDRESS));
  protocol.mintedTokens = [DAI_ADDRESS];
  protocol.mintedTokenSupplies = [daiContract.totalSupply()];

  protocol.save();
}

export function updateMarket(
  event: ethereum.Event,
  market: Market,
  deltaCollateral: BigInt = BIGINT_ZERO,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
): void {
  let token = getOrCreateToken(market.inputToken);

  if (deltaCollateral != BIGINT_ZERO) {
    market.inputTokenBalance = market.inputTokenBalance.plus(deltaCollateral);
  }

  // here we "mark-to-market" - re-price total collateral using last price
  if (token.lastPriceUSD) {
    market.inputTokenPriceUSD = token.lastPriceUSD!;
    market.totalDepositBalanceUSD = bigIntToBDUseDecimals(market.inputTokenBalance, token.decimals).times(
      market.inputTokenPriceUSD,
    );
  } else if (deltaCollateralUSD != BIGDECIMAL_ZERO) {
    // add deltaCollateralUSD to market.totalDepositBalanceUSD
    market.totalDepositBalanceUSD = market.totalDepositBalanceUSD.plus(deltaCollateralUSD);
  }

  market.totalValueLockedUSD = market.totalDepositBalanceUSD;

  if (deltaCollateral.gt(BIGINT_ZERO)) {
    //let deltaCollateralUSD = bigIntToBDUseDecimals(deltaCollateral, token.decimals).times(token.lastPriceUSD!);
    market.cumulativeDepositUSD = market.cumulativeDepositUSD.plus(deltaCollateralUSD);
  } else if (deltaCollateral.lt(BIGINT_ZERO)) {
    // ignore as we don't care about cumulativeWithdraw in a market
  }

  if (deltaDebtUSD != BIGDECIMAL_ZERO) {
    market.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD.plus(deltaDebtUSD);
    if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
      market.cumulativeBorrowUSD = market.cumulativeBorrowUSD.plus(deltaDebtUSD);
    } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
      // again ignore repay
    }
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD.plus(liquidateUSD);
  }

  // update revenue
  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD.plus(newTotalRevenueUSD);
  }

  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeSupplySideRevenueUSD = market.cumulativeSupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }

  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO) || newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    market.cumulativeProtocolSideRevenueUSD = market.cumulativeTotalRevenueUSD.minus(
      market.cumulativeSupplySideRevenueUSD,
    );
  }
  market.save();
}

export function updateFinancialsSnapshot(
  event: ethereum.Event,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType: u32 = 0,
): void {
  let protocol = getOrCreateLendingProtocol();
  let financials = getOrCreateFinancials(event);

  financials.totalValueLockedUSD = protocol.totalValueLockedUSD;
  financials.totalBorrowBalanceUSD = protocol.totalBorrowBalanceUSD;
  financials.totalDepositBalanceUSD = protocol.totalDepositBalanceUSD;
  financials.mintedTokenSupplies = protocol.mintedTokenSupplies;

  financials.cumulativeSupplySideRevenueUSD = protocol.cumulativeSupplySideRevenueUSD;
  financials.cumulativeProtocolSideRevenueUSD = protocol.cumulativeProtocolSideRevenueUSD;
  financials._cumulativeProtocolSideStabilityFeeRevenue = protocol._cumulativeProtocolSideStabilityFeeRevenue;
  financials._cumulativeProtocolSideLiquidationRevenue = protocol._cumulativeProtocolSideLiquidationRevenue;
  financials._cumulativeProtocolSidePSMRevenue = protocol._cumulativeProtocolSidePSMRevenue;
  financials.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD;
  financials.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD;
  financials.cumulativeDepositUSD = protocol.cumulativeDepositUSD;
  financials.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD;

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailyDepositUSD = financials.dailyDepositUSD.plus(deltaCollateralUSD);
  } else if (deltaCollateralUSD.lt(BIGDECIMAL_ZERO)) {
    // minus a negative number
    financials.dailyWithdrawUSD = financials.dailyWithdrawUSD.minus(deltaCollateralUSD);
  }

  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailyBorrowUSD = financials.dailyBorrowUSD.plus(deltaDebtUSD);
  } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
    // minus a negative number
    financials.dailyRepayUSD = financials.dailyRepayUSD.minus(deltaDebtUSD);
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailyLiquidateUSD = financials.dailyLiquidateUSD.plus(liquidateUSD);
  }

  if (newTotalRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailyTotalRevenueUSD = financials.dailyTotalRevenueUSD.plus(newTotalRevenueUSD);
  }

  if (newSupplySideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailySupplySideRevenueUSD = financials.dailySupplySideRevenueUSD.plus(newSupplySideRevenueUSD);
  }

  let newProtocolSideRevenueUSD = newTotalRevenueUSD.minus(newSupplySideRevenueUSD);
  if (newProtocolSideRevenueUSD.gt(BIGDECIMAL_ZERO)) {
    financials.dailyProtocolSideRevenueUSD = financials.dailyTotalRevenueUSD.minus(
      financials.dailySupplySideRevenueUSD,
    );
    switch (protocolSideRevenueType) {
      case ProtocolSideRevenueType.STABILITYFEE:
        financials._dailyProtocolSideStabilityFeeRevenue = financials._dailyProtocolSideStabilityFeeRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
      case ProtocolSideRevenueType.LIQUIDATION:
        financials._dailyProtocolSideLiquidationRevenue = financials._dailyProtocolSideLiquidationRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
      case ProtocolSideRevenueType.PSM:
        financials._dailyProtocolSidePSMRevenue = financials._dailyProtocolSidePSMRevenue!.plus(
          newProtocolSideRevenueUSD,
        );
        break;
    }
  }

  financials.blockNumber = event.block.number;
  financials.timestamp = event.block.timestamp;
  financials.save();
}

export function updateUsageMetrics(
  event: ethereum.Event,
  users: string[] = [], //user u, v, w
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
  liquidateUSD: BigDecimal = BIGDECIMAL_ZERO,
): void {
  let protocol = getOrCreateLendingProtocol();
  let usageDailySnapshot = getOrCreateUsageMetricsDailySnapshot(event);

  // userU, userV, userW may be the same, they may not
  for (let i: i32 = 0; i < users.length; i++) {
    let accountID = users[i];
    let account = Account.load(accountID);
    if (account == null) {
      account = new Account(accountID);
      account.save();

      protocol.cumulativeUniqueUsers += 1;
      usageDailySnapshot.cumulativeUniqueUsers += 1;
    }

    const timestamp = event.block.timestamp.toI64();
    const timestampInMilliseconds = timestamp * 1000;
    const days: i64 = timestamp / SECONDS_PER_DAY;


    const date = new Date(timestampInMilliseconds);
    const next_date = getDateXDaysAheadInUTC(1, date);
    const datetime_start = getISODateTimeStartOfDayStringInUTC(date);
    const datetime_end = getISODateTimeStartOfDayStringInUTC(next_date);

    let dailyActiveAccountId = "daily-"
      .concat(accountID)
      .concat("-")
      .concat(days.toString());
    let dailyActiveAccount = ActiveAccount.load(dailyActiveAccountId);
    if (dailyActiveAccount == null) {
      dailyActiveAccount = new ActiveAccount(dailyActiveAccountId);
      dailyActiveAccount.account_id = accountID;
      dailyActiveAccount.granularity = "1_day";
      dailyActiveAccount.datetime_start = datetime_start;
      dailyActiveAccount.datetime_end = datetime_end;
      dailyActiveAccount.save();
      usageDailySnapshot.dailyActiveUsers += 1;
    }
  }

  if (deltaCollateralUSD.gt(BIGDECIMAL_ZERO)) {
    usageDailySnapshot.dailyDepositCount += 1;
  } else if (deltaCollateralUSD.lt(BIGDECIMAL_ZERO)) {
    usageDailySnapshot.dailyWithdrawCount += 1;
  }

  if (deltaDebtUSD.gt(BIGDECIMAL_ZERO)) {
    usageDailySnapshot.dailyBorrowCount += 1;
  } else if (deltaDebtUSD.lt(BIGDECIMAL_ZERO)) {
    usageDailySnapshot.dailyRepayCount += 1;
  }

  if (liquidateUSD.gt(BIGDECIMAL_ZERO)) {
    usageDailySnapshot.dailyLiquidateCount += 1;
  }

  usageDailySnapshot.dailyTransactionCount += 1;
  usageDailySnapshot.blockNumber = event.block.number;
  usageDailySnapshot.timestamp = event.block.timestamp;

  protocol.save();
  usageDailySnapshot.save();
}

export function handleTransactions(
  event: ethereum.Event,
  market: Market,
  lender: string | null,
  borrower: string | null,
  deltaCollateral: BigInt = BIGINT_ZERO,
  deltaCollateralUSD: BigDecimal = BIGDECIMAL_ZERO,
  deltaDebt: BigInt = BIGINT_ZERO,
  deltaDebtUSD: BigDecimal = BIGDECIMAL_ZERO,
): void {
  let protocol = getOrCreateLendingProtocol();
  let transactionID = createEventID(event);

  if (deltaCollateral.gt(BIGINT_ZERO)) {
    // deposit
    let deposit = new Deposit("DEPOSIT-" + transactionID);
    deposit.hash = event.transaction.hash.toHexString();
    deposit.logIndex = event.logIndex.toI32();
    deposit.protocol = protocol.id;
    deposit.to = market.id;
    deposit.from = lender!;
    deposit.blockNumber = event.block.number;
    deposit.timestamp = event.block.timestamp;
    deposit.market = market.id;
    deposit.asset = market.inputToken;
    deposit.amount = deltaCollateral;
    deposit.amountUSD = deltaCollateralUSD;
    deposit.save();
  } else if (deltaCollateral.lt(BIGINT_ZERO)) {
    //withdraw
    let withdraw = new Withdraw("WITHDRAW-" + transactionID);
    withdraw.hash = event.transaction.hash.toHexString();
    withdraw.logIndex = event.logIndex.toI32();
    withdraw.protocol = protocol.id;
    withdraw.to = lender!;
    withdraw.from = market.id;
    withdraw.blockNumber = event.block.number;
    withdraw.timestamp = event.block.timestamp;
    withdraw.market = market.id;
    withdraw.asset = market.inputToken;
    withdraw.amount = deltaCollateral.times(BIGINT_NEG_ONE);
    withdraw.amountUSD = deltaCollateralUSD.times(BIGDECIMAL_NEG_ONE);
    withdraw.save();
  }

  if (deltaDebt.gt(BIGINT_ZERO)) {
    // borrow
    let borrow = new Borrow("BORROW-" + transactionID);
    borrow.hash = event.transaction.hash.toHexString();
    borrow.logIndex = event.logIndex.toI32();
    borrow.protocol = protocol.id;
    borrow.to = borrower!;
    borrow.from = market.id;
    borrow.blockNumber = event.block.number;
    borrow.timestamp = event.block.timestamp;
    borrow.market = market.id;
    borrow.asset = DAI_ADDRESS;
    borrow.amount = deltaDebt;
    borrow.amountUSD = deltaDebtUSD;
    borrow.save();
  } else if (deltaDebt.lt(BIGINT_ZERO)) {
    // repay
    let repay = new Repay("REPAY-" + transactionID);
    repay.hash = event.transaction.hash.toHexString();
    repay.logIndex = event.logIndex.toI32();
    repay.protocol = protocol.id;
    repay.to = market.id;
    repay.from = borrower!;
    repay.blockNumber = event.block.number;
    repay.timestamp = event.block.timestamp;
    repay.market = market.id;
    repay.asset = DAI_ADDRESS;
    repay.amount = deltaDebt.times(BIGINT_NEG_ONE);
    repay.amountUSD = deltaDebtUSD.times(BIGDECIMAL_NEG_ONE);
    repay.save();
  }

  // liquidate is handled by getOrCreateLiquidate() in getters
}

export function updatePriceForMarket(marketID: string, event: ethereum.Event): void {
  // Price is updated for market marketID
  let market = getOrCreateMarket(marketID);
  let token = Token.load(market.inputToken);
  market.inputTokenPriceUSD = token!.lastPriceUSD!;
  market.totalDepositBalanceUSD = bigIntToBDUseDecimals(market.inputTokenBalance, token!.decimals).times(
    market.inputTokenPriceUSD,
  );
  market.totalValueLockedUSD = market.totalDepositBalanceUSD;
  market.save();

  // iterate to update protocol level totalDepositBalanceUSD
  let protocol = getOrCreateLendingProtocol();
  let marketIDList = protocol.marketIDList;
  let protocolTotalDepositBalanceUSD = BIGDECIMAL_ZERO;
  for (let i: i32 = 0; i < marketIDList.length; i++) {
    let marketAddress = marketIDList[i];
    let market = getOrCreateMarket(marketAddress);
    if (market == null) {
      log.warning("[updatePriceForMarket]market {} doesn't exist", [marketAddress]);
      continue;
    }
    protocolTotalDepositBalanceUSD = protocolTotalDepositBalanceUSD.plus(market.totalDepositBalanceUSD);
  }

  protocol.totalDepositBalanceUSD = protocolTotalDepositBalanceUSD;
  protocol.totalValueLockedUSD = protocol.totalDepositBalanceUSD;
  protocol.save();

  updateFinancialsSnapshot(event);
}

export function updateRevenue(
  event: ethereum.Event,
  marketID: string,
  newTotalRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  newSupplySideRevenueUSD: BigDecimal = BIGDECIMAL_ZERO,
  protocolSideRevenueType: u32 = 0,
): void {
  let market = getOrCreateMarket(marketID);
  if (market) {
    updateMarket(
      event,
      market,
      BIGINT_ZERO,
      BIGDECIMAL_ZERO,
      BIGDECIMAL_ZERO,
      BIGDECIMAL_ZERO,
      newTotalRevenueUSD,
      newSupplySideRevenueUSD,
    );
  }

  updateProtocol(
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    newTotalRevenueUSD,
    newSupplySideRevenueUSD,
    protocolSideRevenueType,
  );

  updateFinancialsSnapshot(
    event,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    newTotalRevenueUSD,
    newSupplySideRevenueUSD,
    protocolSideRevenueType,
  );
}

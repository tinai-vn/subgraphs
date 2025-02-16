// update snapshots and metrics
import {
  getOrCreateFinancials,
  getOrCreateLendingProtocol,
  getOrCreateMarket,
  getOrCreateMarketDailySnapshot,
  getOrCreateMarketHourlySnapshot,
  getOrCreateUsageDailySnapshot,
  getOrCreateUsageHourlySnapshot,
} from "./getters";
import { Address, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { Account, ActiveAccount,  UsageMetricsDailySnapshot, UsageMetricsHourlySnapshot } from "../../generated/schema";
import { ActivityType, SECONDS_PER_DAY, SECONDS_PER_HOUR, TransactionType } from "./constants";

// updates a given FinancialDailySnapshot Entity
export function updateFinancials(
    block: ethereum.Block,
    amountUSD: BigDecimal,
    eventType: string
  ): void {
  // number of days since unix epoch
  let financialMetrics = getOrCreateFinancials(block.timestamp, block.number);
  let protocol = getOrCreateLendingProtocol();

  // update vars
  financialMetrics.totalValueLockedUSD = protocol.totalValueLockedUSD;
  financialMetrics.totalDepositBalanceUSD = protocol.totalDepositBalanceUSD;
  financialMetrics.cumulativeDepositUSD = protocol.cumulativeDepositUSD;
  financialMetrics.totalBorrowBalanceUSD = protocol.totalBorrowBalanceUSD;
  financialMetrics.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD;
  financialMetrics.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD;
  // Note: daily balances updated in respective functions in helpers.ts

  // update revenues
  financialMetrics.cumulativeSupplySideRevenueUSD = protocol.cumulativeSupplySideRevenueUSD;
  financialMetrics.cumulativeProtocolSideRevenueUSD = protocol.cumulativeProtocolSideRevenueUSD;
  financialMetrics.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD;

  // update the block number and timestamp
  financialMetrics.blockNumber = block.number;
  financialMetrics.timestamp = block.timestamp;

  // add to daily amounts
  if (eventType == TransactionType.DEPOSIT) {
    financialMetrics.dailyDepositUSD = financialMetrics.dailyDepositUSD.plus(amountUSD);
  } else if (eventType == TransactionType.BORROW) {
    financialMetrics.dailyBorrowUSD = financialMetrics.dailyBorrowUSD.plus(amountUSD);
  } else if (eventType == TransactionType.REPAY) {
    financialMetrics.dailyRepayUSD = financialMetrics.dailyRepayUSD.plus(amountUSD);
  } else if (eventType == TransactionType.WITHDRAW) {
    financialMetrics.dailyWithdrawUSD = financialMetrics.dailyWithdrawUSD.plus(amountUSD);
  } else if (eventType == TransactionType.LIQUIDATE) {
    financialMetrics.dailyLiquidateUSD = financialMetrics.dailyLiquidateUSD.plus(amountUSD);
  }

  financialMetrics.save();
}

// update a given UsageMetricDailySnapshot
export function updateUsageMetrics(event: ethereum.Event, from: Address, transaction: string): void {
  // Number of days since Unix epoch
  let id: i64 = event.block.timestamp.toI64() / SECONDS_PER_DAY;
  let hour: i64 = (event.block.timestamp.toI64() - id * SECONDS_PER_DAY) / SECONDS_PER_HOUR;
  let dailyMetrics = getOrCreateUsageDailySnapshot(event);
  let hourlyMetrics = getOrCreateUsageHourlySnapshot(event);

  // Update the block number and timestamp to that of the last transaction of that day
  dailyMetrics.blockNumber = event.block.number;
  dailyMetrics.timestamp = event.block.timestamp;
  dailyMetrics.dailyTransactionCount += 1;

  // update hourlyMetrics
  hourlyMetrics.blockNumber = event.block.number;
  hourlyMetrics.timestamp = event.block.timestamp;
  hourlyMetrics.hourlyTransactionCount += 1;

  let accountId = from.toHexString();
  let account = Account.load(accountId);
  let protocol = getOrCreateLendingProtocol();
  dailyMetrics.totalPoolCount = protocol.totalPoolCount;
  if (!account) {
    account = new Account(accountId);
    account.save();

    protocol.cumulativeUniqueUsers += 1;
    protocol.save();
  }
  hourlyMetrics.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
  dailyMetrics.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;

  // Combine the id and the user address to generate a unique user id for the day
  let dailyActiveAccountId = ActivityType.DAILY + "-" + from.toHexString() + "-" + id.toString();
  let dailyActiveAccount = ActiveAccount.load(dailyActiveAccountId);
  if (!dailyActiveAccount) {
    dailyActiveAccount = new ActiveAccount(dailyActiveAccountId);
    dailyActiveAccount.save();
    dailyMetrics.dailyActiveUsers += 1;
  }

  // create active account for hourlyMetrics
  let hourlyActiveAccountId = ActivityType.HOURLY + "-" + from.toHexString() + "-" + hour.toString();
  let hourlyActiveAccount = ActiveAccount.load(hourlyActiveAccountId);
  if (!hourlyActiveAccount) {
    hourlyActiveAccount = new ActiveAccount(hourlyActiveAccountId);
    hourlyActiveAccount.save();
    hourlyMetrics.hourlyActiveUsers += 1;
  }

  // update transaction for daily/hourly metrics
  updateTransactionCount(dailyMetrics, hourlyMetrics, transaction);

  hourlyMetrics.save();
  dailyMetrics.save();
}

// update a given MarketDailySnapshot
export function updateMarketDailyMetrics(
  block: ethereum.Block, 
  marketId: string,
  amountUSD: BigDecimal,
  eventType: string | null = null
): void {
  let marketMetrics = getOrCreateMarketDailySnapshot(block, marketId);
  let market = getOrCreateMarket(marketId);

  // update to latest block/timestamp
  marketMetrics.blockNumber = block.number;
  marketMetrics.timestamp = block.timestamp;

  // update other vars
  marketMetrics.rates = market.rates;
  marketMetrics.totalValueLockedUSD = market.totalValueLockedUSD;
  marketMetrics.cumulativeSupplySideRevenueUSD = market.cumulativeSupplySideRevenueUSD;
  marketMetrics.cumulativeProtocolSideRevenueUSD = market.cumulativeProtocolSideRevenueUSD;
  marketMetrics.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD;
  marketMetrics.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  marketMetrics.cumulativeDepositUSD = market.cumulativeDepositUSD;
  marketMetrics.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  marketMetrics.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  marketMetrics.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  marketMetrics.inputTokenBalance = market.inputTokenBalance;
  marketMetrics.inputTokenPriceUSD = market.inputTokenPriceUSD;
  marketMetrics.outputTokenSupply = market.outputTokenSupply;
  marketMetrics.outputTokenPriceUSD = market.outputTokenPriceUSD;
  marketMetrics.exchangeRate = market.exchangeRate;
  marketMetrics.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  marketMetrics.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  // Note: daily tracking of deposit/borrow/liquidate in respective functions in helpers.ts

  // add to daily amounts  
  if (eventType != null) {
    if (eventType == TransactionType.DEPOSIT) {
      marketMetrics.dailyDepositUSD = marketMetrics.dailyDepositUSD.plus(amountUSD);
    } else if (eventType == TransactionType.BORROW) {
      marketMetrics.dailyBorrowUSD = marketMetrics.dailyBorrowUSD.plus(amountUSD);
    } else if (eventType == TransactionType.REPAY) {
      marketMetrics.dailyRepayUSD = marketMetrics.dailyRepayUSD.plus(amountUSD);
    } else if (eventType == TransactionType.WITHDRAW) {
      marketMetrics.dailyWithdrawUSD = marketMetrics.dailyWithdrawUSD.plus(amountUSD);
    } else if (eventType == TransactionType.LIQUIDATE) {
      marketMetrics.dailyLiquidateUSD = marketMetrics.dailyLiquidateUSD.plus(amountUSD);
    }
  }

  marketMetrics.save();
}

// update a given MarketHourlySnapshot
export function updateMarketHourlyMetrics(
  block: ethereum.Block, 
  marketId: string,
  amountUSD: BigDecimal,
  eventType: string | null = null
): void {
  let marketMetrics = getOrCreateMarketHourlySnapshot(block, marketId);
  let market = getOrCreateMarket(marketId);

  // update to latest block/timestamp
  marketMetrics.blockNumber = block.number;
  marketMetrics.timestamp = block.timestamp;

  // update other vars
  marketMetrics.rates = market.rates;
  marketMetrics.totalValueLockedUSD = market.totalValueLockedUSD;
  marketMetrics.cumulativeSupplySideRevenueUSD = market.cumulativeSupplySideRevenueUSD;
  marketMetrics.cumulativeProtocolSideRevenueUSD = market.cumulativeProtocolSideRevenueUSD;
  marketMetrics.cumulativeTotalRevenueUSD = market.cumulativeTotalRevenueUSD;
  marketMetrics.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  marketMetrics.cumulativeDepositUSD = market.cumulativeDepositUSD;
  marketMetrics.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  marketMetrics.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  marketMetrics.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  marketMetrics.inputTokenBalance = market.inputTokenBalance;
  marketMetrics.inputTokenPriceUSD = market.inputTokenPriceUSD;
  marketMetrics.outputTokenSupply = market.outputTokenSupply;
  marketMetrics.outputTokenPriceUSD = market.outputTokenPriceUSD;
  marketMetrics.exchangeRate = market.exchangeRate;
  marketMetrics.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  marketMetrics.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  // Note: hourly tracking of deposit/borrow/liquidate in respective functions in helpers.ts

  // add to hourly amounts
  if (!eventType) {
    if (eventType == TransactionType.DEPOSIT) {
      marketMetrics.hourlyDepositUSD = marketMetrics.hourlyDepositUSD.plus(amountUSD);
    } else if (eventType == TransactionType.BORROW) {
      marketMetrics.hourlyBorrowUSD = marketMetrics.hourlyBorrowUSD.plus(amountUSD);
    } else if (eventType == TransactionType.REPAY) {
      marketMetrics.hourlyRepayUSD = marketMetrics.hourlyRepayUSD.plus(amountUSD);
    } else if (eventType == TransactionType.WITHDRAW) {
      marketMetrics.hourlyWithdrawUSD = marketMetrics.hourlyWithdrawUSD.plus(amountUSD);
    } else if (eventType == TransactionType.LIQUIDATE) {
      marketMetrics.hourlyLiquidateUSD = marketMetrics.hourlyLiquidateUSD.plus(amountUSD);
    }
  }

  marketMetrics.save();
}

/////////////////
//// Helpers ////
/////////////////

function updateTransactionCount(
  dailyUsage: UsageMetricsDailySnapshot,
  hourlyUsage: UsageMetricsHourlySnapshot,
  transaction: string,
): void {
  if (transaction == TransactionType.DEPOSIT) {
    hourlyUsage.hourlyDepositCount += 1;
    dailyUsage.dailyDepositCount += 1;
  } else if (transaction == TransactionType.WITHDRAW) {
    hourlyUsage.hourlyWithdrawCount += 1;
    dailyUsage.dailyWithdrawCount += 1;
  } else if (transaction == TransactionType.BORROW) {
    hourlyUsage.hourlyBorrowCount += 1;
    dailyUsage.dailyBorrowCount += 1;
  } else if (transaction == TransactionType.REPAY) {
    hourlyUsage.hourlyRepayCount += 1;
    dailyUsage.dailyRepayCount += 1;
  } else if (transaction == TransactionType.LIQUIDATE) {
    hourlyUsage.hourlyLiquidateCount += 1;
    dailyUsage.dailyLiquidateCount += 1;
  }

  hourlyUsage.save();
  dailyUsage.save();
}

import type { ELBProductSpec, ELSProductSpec, ProductSpec, Underlying } from '../../products/types'
import type { NormalizedPricePoint, PayoffInput, PayoffResult } from './types'

const MILLIS_PER_DAY = 86_400_000
const MAX_OBSERVATION_LOOKBACK_DAYS = 7

/**
 * Calculates a product payoff from a supplied normalized close-price path.
 * This module intentionally performs no I/O, market-data lookup, or UI work.
 */
export function calculatePayoff(product: ProductSpec, input: PayoffInput): PayoffResult {
  validateInput(product, input)
  const path = input.isChronological ? input.pricePath : [...input.pricePath].sort((left, right) => left.date.localeCompare(right.date))

  return product.productType === 'ELB'
    ? calculateElbPayoff(product, input.investmentAmount, path)
    : calculateElsPayoff(product, input.investmentAmount, path)
}

function calculateElbPayoff(
  product: ELBProductSpec,
  principal: number,
  path: readonly NormalizedPricePoint[],
): PayoffResult {
  let couponCount = 0
  const couponPaidMonths: number[] = []

  for (let month = 1; month <= product.maturityMonths; month += 1) {
    const scheduledDate = addMonths(product.initialReferenceDate, month)
    const point = resolveObservation(path, scheduledDate)

    // Coupon is evaluated before an early redemption on the same observation date.
    if (allAtLeast(point, product.underlyings, product.monthlyCoupon.barrier)) {
      couponCount += 1
      couponPaidMonths.push(month)
    }

    const earlyCondition = product.earlyRedemptions.find((condition) => condition.month === month)
    if (earlyCondition && allAtLeast(point, product.underlyings, earlyCondition.barrier)) {
      return createElbResult(product, principal, 'early', point.date, couponCount, couponPaidMonths, month)
    }
  }

  return createElbResult(product, principal, 'maturity', addMonths(product.initialReferenceDate, product.maturityMonths), couponCount, couponPaidMonths)
}

function calculateElsPayoff(
  product: ELSProductSpec,
  principal: number,
  path: readonly NormalizedPricePoint[],
): PayoffResult {
  for (const condition of product.earlyRedemptions) {
    const point = resolveObservation(path, addMonths(product.initialReferenceDate, condition.month))
    if (allAtLeast(point, product.underlyings, condition.barrier)) {
      return createElsProfitResult(product, principal, 'early', point.date, condition.totalReturn!, hasKnockIn(product, path, point.date), condition.month)
    }
  }

  const maturityDate = addMonths(product.initialReferenceDate, product.maturityMonths)
  const finalPrices = averageFinalThreeCloses(path, product.underlyings, maturityDate)
  const knockInOccurred = hasKnockIn(product, path, maturityDate)
  const maturityBarrierMet = product.underlyings.every((underlying) => finalPrices[underlying] >= product.maturity.barrier * 100)
  const worstFinalRatio = Math.min(...product.underlyings.map((underlying) => finalPrices[underlying] / 100))

  if (maturityBarrierMet || !knockInOccurred) {
    return createElsProfitResult(product, principal, 'maturity', maturityDate, product.maturity.totalReturn, knockInOccurred, undefined, worstFinalRatio)
  }

  const totalPayout = principal * worstFinalRatio
  return createResult({
    product,
    redemptionType: 'maturity',
    redemptionDate: maturityDate,
    principal,
    principalReturned: totalPayout,
    couponIncome: 0,
    totalPayout,
    couponCount: 0,
    couponPaidMonths: [],
    knockInOccurred: true,
    principalLossOccurred: totalPayout < principal,
    maturityWorstOfRatio: worstFinalRatio,
  })
}

function createElbResult(
  product: ELBProductSpec,
  principal: number,
  redemptionType: 'early' | 'maturity',
  redemptionDate: string,
  couponCount: number,
  couponPaidMonths: readonly number[],
  earlyRedemptionMonth?: number,
): PayoffResult {
  const couponIncome = principal * product.monthlyCoupon.rate * couponCount
  return createResult({
    product,
    redemptionType,
    redemptionDate,
    principal,
    principalReturned: principal,
    couponIncome,
    totalPayout: principal + couponIncome,
    couponCount,
    couponPaidMonths,
    earlyRedemptionMonth,
    knockInOccurred: false,
    principalLossOccurred: false,
  })
}

function createElsProfitResult(
  product: ELSProductSpec,
  principal: number,
  redemptionType: 'early' | 'maturity',
  redemptionDate: string,
  totalReturn: number,
  knockInOccurred = false,
  earlyRedemptionMonth?: number,
  maturityWorstOfRatio?: number,
): PayoffResult {
  const couponIncome = principal * totalReturn
  return createResult({
    product,
    redemptionType,
    redemptionDate,
    principal,
    principalReturned: principal,
    couponIncome,
    totalPayout: principal + couponIncome,
    couponCount: 0,
    couponPaidMonths: [],
    earlyRedemptionMonth,
    knockInOccurred,
    principalLossOccurred: false,
    maturityWorstOfRatio,
  })
}

function createResult(args: {
  product: ProductSpec
  redemptionType: 'early' | 'maturity'
  redemptionDate: string
  principal: number
  principalReturned: number
  couponIncome: number
  totalPayout: number
  couponCount: number
  couponPaidMonths: readonly number[]
  earlyRedemptionMonth?: number
  knockInOccurred: boolean
  principalLossOccurred: boolean
  maturityWorstOfRatio?: number
}): PayoffResult {
  const holdingDays = daysBetween(args.product.initialReferenceDate, args.redemptionDate)
  const totalReturn = args.totalPayout / args.principal - 1
  const annualizedReturn = Math.pow(args.totalPayout / args.principal, 365 / holdingDays) - 1

  return {
    productId: args.product.id,
    redemptionType: args.redemptionType,
    redemptionDate: args.redemptionDate,
    holdingDays,
    principalReturned: args.principalReturned,
    couponIncome: args.couponIncome,
    totalPayout: args.totalPayout,
    totalReturn,
    annualizedReturn,
    couponCount: args.couponCount,
    couponPaidMonths: args.couponPaidMonths,
    earlyRedemptionMonth: args.earlyRedemptionMonth,
    knockInOccurred: args.knockInOccurred,
    principalLossOccurred: args.principalLossOccurred,
    maturityWorstOfRatio: args.maturityWorstOfRatio,
    lossRate: Math.max(0, 1 - args.totalPayout / args.principal),
  }
}

function averageFinalThreeCloses(
  path: readonly NormalizedPricePoint[],
  underlyings: readonly Underlying[],
  maturityDate: string,
): Record<Underlying, number> {
  const valuationPoints = path.filter((point) => point.date <= maturityDate).slice(-3)
  if (valuationPoints.length !== 3) {
    throw new Error('ELS maturity payoff requires three closing prices on or before the maturity valuation date.')
  }

  return Object.fromEntries(
    underlyings.map((underlying) => [
      underlying,
      valuationPoints.reduce((sum, point) => sum + priceAt(point, underlying), 0) / valuationPoints.length,
    ]),
  ) as Record<Underlying, number>
}

function resolveObservation(path: readonly NormalizedPricePoint[], scheduledDate: string): NormalizedPricePoint {
  let low = 0
  let high = path.length - 1
  let candidateIndex = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (path[middle].date <= scheduledDate) {
      candidateIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const closestPrior = candidateIndex >= 0 ? path[candidateIndex] : undefined
  if (closestPrior && daysBetween(closestPrior.date, scheduledDate) <= MAX_OBSERVATION_LOOKBACK_DAYS) {
    return closestPrior
  }

  throw new Error(`Missing close-price observation for scheduled date ${scheduledDate}.`)
}

function allAtLeast(point: NormalizedPricePoint, underlyings: readonly Underlying[], barrier: number): boolean {
  return underlyings.every((underlying) => priceAt(point, underlying) >= barrier * 100)
}

function hasKnockIn(product: ELSProductSpec, path: readonly NormalizedPricePoint[], throughDate: string): boolean {
  return path
    .filter((point) => point.date <= throughDate)
    .some((point) => product.underlyings.some((underlying) => priceAt(point, underlying) < product.knockIn.barrier * 100))
}

function priceAt(point: NormalizedPricePoint, underlying: Underlying): number {
  const price = point.prices[underlying]
  if (price === undefined) throw new Error(`Missing normalized price for ${underlying} at ${point.date}.`)
  return price
}

function validateInput(product: ProductSpec, input: PayoffInput): void {
  if (!Number.isFinite(input.investmentAmount) || input.investmentAmount <= 0) {
    throw new Error('investmentAmount must be a positive finite number.')
  }
  if (input.pricePath.length === 0) throw new Error(`A price path is required for ${product.id}.`)
}

/** Calendar-month scheduling only; market-data adapters are responsible for business-day closes. */
export function addMonths(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`)
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12)
  const targetMonth = (source.getUTCMonth() + months) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(source.getUTCDate(), lastDay)
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLIS_PER_DAY)
}

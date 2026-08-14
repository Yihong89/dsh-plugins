import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CostMeter, formatCost } from '../src/client/CostMeter.tsx'
import { costBand } from '../src/client/color.ts'
import { formatCny, usdToCny } from '../src/client/currency.ts'

function renderWith(value: { totals: { cost: number } } & Partial<{ priceUpdateAvailable: boolean; unpricedModels: string[] }> | undefined) {
  // The slot component contract requires the full framework kit; the unit test
  // supplies only `useProjection`, so cast to satisfy the composed props type.
  const merged = value === undefined ? undefined : { priceUpdateAvailable: false, unpricedModels: [] as string[], ...value }
  return render(<CostMeter useProjection={() => merged} /> as any)
}

describe('costBand', () => {
  it('bands below the low threshold as low', () => {
    expect(costBand(0.4)).toBe('low')
  })

  it('bands at the low threshold as mid', () => {
    expect(costBand(1.0)).toBe('mid')
  })

  it('bands mid-range as mid', () => {
    expect(costBand(2.5)).toBe('mid')
  })

  it('bands at/above the high threshold as high', () => {
    expect(costBand(5.0)).toBe('high')
  })
})

describe('formatCost', () => {
  it('formats to two decimals with a dollar sign', () => {
    expect(formatCost(1.25)).toBe('$1.25')
  })
})

describe('usdToCny / formatCny', () => {
  it('converts USD to CNY with the default rate', () => {
    expect(usdToCny(0.42)).toBeCloseTo(3.024, 5)
  })

  it('formats CNY with a yuan sign', () => {
    expect(formatCny(3.024)).toBe('¥3.02')
  })
})

describe('CostMeter', () => {
  it('renders nothing when there is no projection', () => {
    const { container } = renderWith(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the cost in USD and CNY with the low band marker', () => {
    const { getByTestId } = renderWith({ totals: { cost: 0.42 } })
    expect(getByTestId('usage-cost')).toHaveAttribute('data-band', 'low')
    expect(getByTestId('usage-cost')).toHaveTextContent('$0.42 · ¥3.02')
  })

  it('renders the cost with the high band marker', () => {
    const { getByTestId } = renderWith({ totals: { cost: 8.0 } })
    expect(getByTestId('usage-cost')).toHaveAttribute('data-band', 'high')
    expect(getByTestId('usage-cost')).toHaveTextContent('$8.00 · ¥57.60')
  })

  it('shows a price-update badge when a DeepSeek price change is available', () => {
    const { getByTestId } = renderWith({ totals: { cost: 0.42 }, priceUpdateAvailable: true })
    expect(getByTestId('price-badge')).toHaveAttribute('data-badge', 'price-update')
  })

  it('shows an unpriced-model badge naming the model', () => {
    const { getByTestId } = renderWith({ totals: { cost: 0.42 }, unpricedModels: ['claude-sonnet-5'] })
    const badge = getByTestId('unpriced-badge')
    expect(badge).toHaveAttribute('data-badge', 'unpriced')
    expect(badge).toHaveAttribute('title', expect.stringContaining('claude-sonnet-5'))
  })
})

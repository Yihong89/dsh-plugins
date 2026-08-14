/**
 * Live session-cost readout for the web composer dock. Reads the host's
 * `usageReport` session projection through the framework's `useProjection`
 * standard-kit seat (session-scope slots receive it automatically) and renders
 * the estimated cost, color-coded by magnitude.
 * @module dsh-usage-report/client/CostMeter
 */

// Type-only: pulls the 'conversation.composer.dock' SlotMap entry and the
// runtime's session standard kit (which merges `useProjection`) into
// PropsRuntime for session-scope slots — so `useProjection` arrives as a prop.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { costBand, HIGH_COST_THRESHOLD, LOW_COST_THRESHOLD } from './color.ts'
import { formatCny, usdToCny } from './currency.ts'
import type { UsageReportValue } from '../types.js'

/** Props of the dock entry — the session standard kit already carries `useProjection`. */
export type CostMeterProps = PropsRuntime<'conversation.composer.dock'>

/**
 * Format a USD cost to a compact string, e.g. `$1.25`.
 * @param cost - the estimated cost (USD).
 * @param decimals - decimal places for display (default 2).
 * @returns the `$`-prefixed fixed-point string.
 */
export function formatCost(cost: number, decimals = 2): string {
  return `$${cost.toFixed(decimals)}`
}

/**
 * Render the current session's estimated cost in USD and CNY, color-coded by
 * magnitude (banded on the USD figure). Renders nothing until the projection
 * has a value (no session / no usage yet).
 * @param props - dock-slot props; only `useProjection` is consumed.
 * @returns the cost readout, or `null` when no projection value exists.
 */
export function CostMeter({ useProjection }: CostMeterProps): JSX.Element | null {
  // Typed via the SessionProjectionMap augmentation in src/types.ts.
  const value = useProjection('usageReport') as UsageReportValue | undefined
  if (value === undefined) return null
  const cost = value.totals.cost
  const band = costBand(cost)
  return (
    <span
      data-testid="usage-cost"
      data-band={band}
      title={`est. cost · band: <$${LOW_COST_THRESHOLD} low, >=$${HIGH_COST_THRESHOLD} high`}
    >
      {formatCost(cost)} · {formatCny(usdToCny(cost))}
    </span>
  )
}

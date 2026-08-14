/**
 * Client half of dsh-usage-report: contributes the live session-cost readout
 * to the web composer dock. Registers one list entry into the
 * `conversation.composer.dock` slot; the component reads the host's
 * `usageReport` projection and renders nothing until a value exists.
 * @module dsh-usage-report/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'conversation.composer.dock' SlotMap entry into the
// register call's type contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CostMeter } from './CostMeter.tsx'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-usage-report/client'

/** Services required by this plugin. */
export const inject = ['sessions', 'slots']

/**
 * Register the cost readout into the composer dock on the client context.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'usage-cost',
    // After the built-in stats line (order 0).
    order: 5,
  }, CostMeter))
}

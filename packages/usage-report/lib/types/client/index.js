/**
 * Client half of dsh-usage-report: contributes the live session-cost readout
 * to the web composer dock. Registers one list entry into the
 * `conversation.composer.dock` slot; the component reads the host's
 * `usageReport` projection and renders nothing until a value exists.
 * @module dsh-usage-report/client
 */
import { CostMeter } from "./CostMeter.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-usage-plugin/client';
/** Services required by this plugin. */
export const inject = ['sessions', 'slots'];
/**
 * Register the cost readout into the composer dock on the client context.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'usage-cost',
        // After the built-in stats line (order 0).
        order: 5,
    }, CostMeter));
}
//# sourceMappingURL=index.js.map
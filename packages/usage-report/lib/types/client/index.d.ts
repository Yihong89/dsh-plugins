/**
 * Client half of dsh-usage-report: contributes the live session-cost readout
 * to the web composer dock. Registers one list entry into the
 * `conversation.composer.dock` slot; the component reads the host's
 * `usageReport` projection and renders nothing until a value exists.
 * @module dsh-usage-report/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "dsh-usage-report/client";
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Register the cost readout into the composer dock on the client context.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;

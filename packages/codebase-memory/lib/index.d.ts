/**
 * dsh-codebase-memory: persistent per-workspace codebase knowledge memory for
 * DeepSeek Harness. One host-plane plugin row registers:
 *
 * - the `memory_store` / `memory_recall` / `memory_forget` / `memory_list`
 *   model tools over a per-workspace JSON memory file;
 * - the `/memory` human command (recent entries or keyword search);
 * - an optional one-line system-prompt hint and an optional session-start
 *   injection of the most recent memories.
 *
 * @module dsh-codebase-memory
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-codebase-memory";
export declare const inject: string[];
/** Plugin configuration, settable from the cordis.yml entry's `config:` block. */
export interface Config {
    /** Directory name for the memory file inside each workspace (default `.dsh-memory`). */
    dirName: string;
    /** Memory file name inside that directory (default `memory.json`). */
    fileName: string;
    /** Hard cap on entries per workspace; the oldest are dropped beyond it (default 2000). */
    maxEntries: number;
    /** Default result limit for recall/list (default 5). */
    defaultLimit: number;
    /** Contribute a one-line system-prompt hint about the memory tools (default true). */
    workspaceHint: boolean;
    /** Inject the most recent memories into each new session's context (default false). */
    injectOnStart: boolean;
    /** How many entries the session-start injection includes (default 5). */
    injectCount: number;
    /** Maximum characters of injected digest text (default 2000). */
    injectMaxChars: number;
}
export declare const Config: z<Config>;
/**
 * Register the memory tools, the `/memory` command, and the optional prompt
 * hint / session-start injection on the calling context.
 * @param ctx - registrant context carrying the tool and command registries.
 * @param config - validated plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;

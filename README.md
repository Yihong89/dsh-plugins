# dsh-plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

A pnpm workspace: one package per plugin under `packages/`.

| Package | What it does |
|---|---|
| [`dsh-usage-report`](packages/usage-report/README.md) | Per-session token usage and estimated cost report (`/usage` command + `usage_report` tool), priced from the DeepSeek pricing table. |
| [`dsh-codebase-memory`](packages/codebase-memory/README.md) | Persistent per-workspace codebase knowledge memory — `memory_store` / `memory_recall` / `memory_forget` / `memory_list` tools, `/memory` command, stored in a project-file JSON store. |

## Install a plugin

```sh
# install the package into your profile (each plugin is a workspace package)
dsh plugin --profile web add -w 'github:Yihong89/dsh-plugins#main&path:packages/usage-report'
dsh plugin --profile web add -w 'github:Yihong89/dsh-plugins#main&path:packages/codebase-memory'

# activate by inserting the plugin row into the profile's patch layer
# (~/.dsh/profiles/web/cordis.patch.yml):
#
#   - insert:
#       - id: usage-report
#         name: 'dsh-usage-report'
#       - id: codebase-memory
#         name: 'dsh-codebase-memory'
```

The loader hot-reloads config changes, so no process restart is needed.

## Development

```sh
pnpm install
pnpm run build   # tsc for every package
pnpm run test    # node --test for every package
```

## License

[MIT](LICENSE)

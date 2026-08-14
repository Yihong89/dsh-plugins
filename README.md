# dsh-plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

A pnpm workspace: one package per plugin under `packages/`.

| Package | What it does |
|---|---|
| [`dsh-usage-plugin`](packages/usage-report/README.md) | Per-session token usage and estimated cost report (`/usage` command + `usage_report` tool), priced from the DeepSeek pricing table. |

## Install a plugin

```sh
# install the package into your profile (each plugin is a workspace package)
dsh plugin --profile web add -w 'github:Yihong89/dsh-usage-plugin#main&path:packages/usage-report'

# activate by inserting the plugin row into the profile's patch layer
# (~/.dsh/profiles/web/cordis.patch.yml):
#
#   - insert:
#       - id: usage-report
#         name: 'dsh-usage-plugin'
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

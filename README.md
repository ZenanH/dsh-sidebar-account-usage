# dsh-sidebar-account-usage

English | [中文](README.zh.md)

A DSH bundle that shows your DeepSeek account balance, today's spend, and the current peak/off-peak pricing window above the sidebar account row.

## What it shows

```
Balance ¥297.10          Today ¥1.19
● Off-peak · next Wed 14:00
```

- **Balance** — the account's recharge wallet (bonus credit is reported separately by the account page, not added here). The first funded wallet's currency is used.
- **Today** — the sum of today's Model API cost buckets under the account, across all of its API keys, for your local calendar day.
- **Pricing window** — DeepSeek's peak pricing: Beijing time (UTC+8), Monday to Friday, 09:00–12:00 and 14:00–18:00, excluding China's statutory holiday periods. Everything else, including weekends and holidays all day, is off-peak at 50% of peak price. The badge is amber for peak and green for off-peak, and shows when the window next changes.
- With the sidebar collapsed to the rail, a circular currency badge appears above the account avatar; its tooltip carries the numbers.
- The tooltip also shows the last update time and the full pricing rule.
- Click the row to refresh. It also refreshes every 60 seconds, when the window regains focus, and at the next peak/off-peak boundary.

## Requirements

- DSH 0.2.x (`engines.dsh: >=0.2.1`) with the built-in DeepSeek account signed in.
- The bundle reads the wallets through DSH's `deepseekAccount` service and today's cost from the Platform usage endpoint (`/api/v0/usage/by_api_key/cost`). The account token never leaves the Host; it is sent only to `platform.deepseek.com`.
- An API-key-only setup has no account wallets, so the row stays at "—" and says it is not signed in.
- The Platform usage endpoint is not a documented public API and can change without notice; if it changes, the spend half degrades to "—" and the balance keeps working.

## Install

```sh
# From GitHub
dsh plugin --profile web add github:ZenanH/dsh-sidebar-account-usage

# From the release tarball
dsh plugin --profile web add https://github.com/ZenanH/dsh-sidebar-account-usage/releases/download/v0.1.0/dsh-sidebar-account-usage-0.1.0.tgz
```

On DSH Desktop, install the same spec from **Settings → Plugins**, or search for the plugin in the plugin market once it is listed. Most installs go live after a page refresh.

## Peak-hours data

The weekday dates of China's 2026 and 2027 statutory holiday periods are built in, from 国办发明电〔2025〕7号 and 国办发明电〔2026〕10号. Weekends are always off-peak by the pricing rule, so make-up workdays on weekends are not listed. When the next year's notice is published, add its weekday holiday dates to `HOLIDAYS` in [index.js](index.js).

## Limitations

- The holiday table must be updated once a year.
- The Platform usage endpoint is private and undocumented.
- The row shows one currency and does not break spend down per model.

## License

MIT

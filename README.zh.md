# dsh-sidebar-account-usage

[English](README.md) | 中文

一个 DSH 组合包：在侧边栏账户行上方显示 DeepSeek 账户余额、当日消耗，以及当前处于高峰还是空闲计费时段。

## 显示内容

```
Balance ¥297.10          Today ¥1.19
● Off-peak · next Wed 14:00
```

- **余额** — 账户的充值钱包（赠送余额由账户页单独显示，这里不合并）。取第一个有余额的钱包币种。
- **今日** — 该账户名下所有 API Key 今日的模型调用费用总和，按本机时区切日。
- **计费时段** — DeepSeek 的高峰定价：北京时间（UTC+8）周一至周五 09:00–12:00、14:00–18:00，不含中国法定节假日；其余时段（含周末和节假日全天）为空闲时段，价格为高峰的 50%。高峰时圆点为琥珀色，空闲时为绿色，并显示下次切换时间。
- 侧边栏收起成窄栏时，账户头像上方显示一个圆形币种徽标，完整数值在悬停提示里。
- 悬停提示还会显示最近更新时间和完整计费规则。
- 点击可刷新；此外每 60 秒自动刷新，窗口重新获得焦点时刷新，并在下次高峰/空闲切换时刻刷新一次。

## 要求

- DSH 0.2.x（`engines.dsh: >=0.2.1`），并已登录内置的 DeepSeek 账户。
- 余额通过 DSH 的 `deepseekAccount` 服务读取，当日消耗来自平台用量接口 `/api/v0/usage/by_api_key/cost`。账户 token 不会离开 Host，只会发往 `platform.deepseek.com`。
- 只配置了 API Key 的环境没有账户钱包，这一行会显示「—」并提示未登录。
- 平台用量接口不是公开 API，可能随时变更；如果失效，消耗部分会退化成「—」，余额部分不受影响。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:ZenanH/dsh-sidebar-account-usage

# 或从 Release 里的 tgz 安装
dsh plugin --profile web add https://github.com/ZenanH/dsh-sidebar-account-usage/releases/download/v0.1.0/dsh-sidebar-account-usage-0.1.0.tgz
```

桌面版在 **设置 → 插件** 里填同样的 spec 安装；插件进入插件市场后也可以直接搜索安装。多数情况下刷新页面即生效。

## 高峰时段数据

内置了 2026、2027 年国务院放假安排中落在工作日的那几天（国办发明电〔2025〕7号、国办发明电〔2026〕10号）。按定价规则周末全天都是空闲，所以调休补班的周末不列出。下一年安排公布后，在 [index.js](index.js) 的 `HOLIDAYS` 里补上对应的工作日日期即可。

## 限制

- 节假日表需要每年更新一次。
- 平台用量接口是私有的、未公开文档的接口。
- 只显示一个币种，不按模型拆分消耗。

## 许可证

MIT

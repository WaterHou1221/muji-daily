# MUJI 折扣日报

每天北京时间 09:00 抓取无印良品（中国）官网在售商品，逐个 SKU 比对售价与吊牌价，把「当天新增折扣」和「当天失效折扣」推送到企业微信群。

官方微信小程序与官网共用同一套商品接口，因此本名单与小程序中的 SALE / 限时特惠一致。

## 消息形态

每天固定三条（大促日自动续条）：

1. **日期**：`2026年11月9日 星期一`（纯文本）
2. **新增折扣**：`商品名｜¥现价（原¥吊牌价，X.X折）`，每 25 款一条，超额自动 `(1/N)`
3. **失效折扣**：`商品名｜¥现价（原¥吊牌价，X.X折）`，每 25 款一条

- 一条消息 = 一个商品；价格三元组取自**折扣最深的那个 SKU**，不会混用不同规格的价格。
- 只有部分规格折扣时，行尾标 `· 部分规格`。
- **只统计有货规格**：`stock = 0` 的 SKU 不参与折扣判定、不进快照、不进日报；没有任何有货折扣规格的商品不会出现在消息里。
- 库存口径是上海（`provinceCd=31`）的线上库存，不是门店自提库存。
- 当天无新增或无失效时，仍发一条 `今日无新增折扣 / 今日无失效折扣`。
- 消息里不放链接；完整明细在 `state/reports/当日.csv`。

## 数据来源

- 列表：`GET https://www.muji.com.cn/cn/ecapi/maps/ec/commodities`
- 详情：`GET https://www.muji.com.cn/cn/ecapi/maps/ec/commodity?id=`
- 请求需要 `X-Sign`：参数按 key 排序后拼接 `key+value`，追加固定密钥，MD5 转大写（见 `scripts/muji-api.js`）。
- 价格地区参数默认上海 `31`（官网使用两位省级短码，不是六位行政区码），线上价格全国统一。

## 判定口径

- 折扣：**有货** SKU 中任一 `price < mktPrice`；但衣服·杂货中**有 003 号 M 码时，只看 M 码**：M 码有货但都不在折扣的商品，不算折扣商品。
- 展示价：有 M 码时取折扣最深的 M 码 SKU，否则取全部有货 SKU 里折扣最深的。
- 新增：上一份快照没有该商品折扣，本次有。
- 失效：上一份快照有、本次没有，不再区分具体原因。
- 售罄：某个商品昨天还有折扣，今天所有折扣规格都无货，会进入失效列表；它本身不再进入快照和名单。
- 详情抓取失败：沿用上一份快照，不判失效；连续失败 3 天才标「数据缺失」。

## 过滤规则（FILTER_VERSION = 5）

在折扣判定之前先过滤商品，被过滤的商品不进入快照、日报、CSV 和消息：

1. **分类黑名单**
   - 二级分类：女式服装、女式内衣/睡衣、美妆护肤、芳香用品、童装、家具、电子产品、清扫洗涤·卫浴用品、收纳储物
   - 三级分类：鞋类、MUJI IDEE FURNITURE（精确匹配；`3801/3802` 两个未登记的商品线手动归入 MUJI IDEE FURNITURE）
2. **名称含“女”**
   - 仅在二级分类为 MUJI LABO、MUJI IDÉE WEAR、MUJI IDÉE、服饰杂货、鞋包时生效
   - 命中 `女式 / 女士 / 女款 / 女性 / ^女` 才排除；`男女通用`、`中性` 不误伤
3. **M 号有货门槛**
   - 只对一级分类「衣服·杂货」生效
   - 只认 `sizeCd = 003`（男式/通用 M）；不看 `026`（女式 M），也不把 `S-M` 之类算作 M 号
   - 如果商品有 003 号 SKU，但所有 003 号都无货，则整个商品被排除，即使 L/XL 有货
   - 仅记录、不拦截：通过 1、2 条过滤但没有 003、却有 026 的商品，会写入审计日志

修改过滤条件时必须递增 `config.js` 里的 `FILTER_VERSION`；版本不一致时下一次运行会重建基线并发送一条「初始化完成」，避免把被过滤的商品误报成失效。

## 目录

```
.github/workflows/daily.yml   GitHub Actions 定时任务
scripts/
  config.js       常量与阈值
  muji-api.js     签名与请求
  crawl.js        列表 / 类目 / 详情抓取
  discount.js     SKU 折扣判定与商品级聚合
  snapshot.js     快照、日报、outbox、清理
  diff.js         新增 / 失效 / 售罄 / carry-forward / 异常保护
  render.js       企业微信消息渲染与分条
  wecom.js        推送、限流、重试
  daily.js        编排入口
tests/            node:test 单元测试
state/            运行状态（提交进仓库）
```

## 本地运行

```bash
# 只抓取并打印消息，不发送、不写状态
node scripts/daily.js --state=./state --dry-run

# 抓取并写入状态，但不推送（用于建基线）
node scripts/daily.js --state=./state --no-send

# 正常跑（需要 WECOM_WEBHOOK）
WECOM_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' node scripts/daily.js --state=./state

# 同一天重跑
node scripts/daily.js --state=./state --force
```

环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `WECOM_WEBHOOK` | 企业微信群机器人地址 | 必填（dry-run / no-send 除外） |
| `PROVINCE_CD` | 价格/库存地区（两位省码） | `31` |
| `CONCURRENCY` | 详情并发 | `6` |
| `DRY_RUN` / `FORCE` | 等价于命令行参数 | 空 |

## 测试

```bash
node --test tests/          # CI / 普通终端
node tests/diff.test.js     # 单文件（受限环境可用）
```

覆盖：签名固定值、diff 四类分支、carry-forward、异常阈值、25 款分页与字节上限、750 款截断、最佳 SKU 选择。

## 状态与保留

- `state/snapshots/YYYY-MM-DD.json.gz`：每日快照（仅有货折扣商品 + 有货规格），保留 30 天。
- `state/reports/YYYY-MM-DD.csv|md`：日报明细，保留 30 天。
- `state/last_success.json`：最后一次成功日期、计数、近 14 次总数（用于异常波动判断）。
- `state/outbox.json`：推送失败待补发的消息，次日以【补发】前缀重发。

## GitHub Actions

- 触发：`cron "0 1 * * *"`（UTC，对应北京 09:00）+ 手动 `workflow_dispatch`（可传 `force` / `dry_run`）。
- 权限：`contents: write`，用内置 `GITHUB_TOKEN` 提交 `state/`。
- 并发：`concurrency: muji-daily`，避免两次运行抢 push。
- 失败：脚本会向企业微信发失败告警；`state/` 仍会在 `if: always()` 步骤中提交。

需要配置的 Secret：`WECOM_WEBHOOK`。

## 异常保护

- 详情失败率 > 5%：不更新基线，发告警。
- 折扣总数 < 100、或较近 7 次中位数波动 > 35%：只告警，不覆盖基线。
- 单日新增 + 失效 > 400：只告警；确认是活动切换后可用 `--force` 放行。
- 单类消息超过 30 条（750 款）：截断并在末条提示。

## 已知限制

- 数据是抓取时点快照，价格与库存随时变化。
- 官网改版可能导致签名失效，脚本会报「签名错误」并告警。
- 仅用于个人比价与研究，请保持低频访问。

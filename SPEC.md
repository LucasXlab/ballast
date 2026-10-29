# Ballast（压舱）0.1.0 规格

Ballast 是一个在本机运行的个人投资组合工具。它只回答一个问题：

> 我已经设好目标比例，现在有一笔新钱，**不卖出**，按整手买入，应该买什么？

输入持仓、最新价格、目标比例和本次投入金额；输出一张按代码列出的买入清单（份额、价格、金额）、买入前后的比例偏离、剩余现金。确认执行后，买入记录写进持仓，计划永久保留。

前端和后端只认本文件。路由、字段名、枚举值、错误码必须一字不差。开发中偏离本文件的地方，按编号记进 `docs/deviations.md`。

---

## 0. 第一版核心流程与非目标

### 0.1 第一版只做的核心流程

1. 首次启动：建立组合名称、基础币种、账户、资产分类和目标比例。
2. 录入持仓：手工新增买入记录，或导入 CSV。
3. 更新价格：手工填写每个代码的最新价格和价格日期。
4. 生成计划：输入本次投入金额和最小单笔金额，得到只买不卖的整手买入清单。
5. 执行计划：确认后生成买入记录，持仓立即更新；计划变为已执行，不能再次执行。
6. 查看历史：过去的计划、当时的持仓快照、买入前后的偏离都保留。
7. 备份：下载 SQLite 数据库文件；导出持仓和交易 CSV。

### 0.2 非目标（0.1.0 明确不做）

- 不抓取行情，不连接券商，不自动下单，不读取银行或支付账户。
- 不建议卖出，不计算税务、洗售规则、交易费用以外的成本，不做税批匹配。
- 不支持多币种换算。一个组合只有一个基础币种；所有账户、代码、金额都用这个币种。
- 不支持多用户、登录、云同步、远程访问、手机原生 App。
- 不提供收益归因、时间加权收益率、基准对比、K 线、新闻、预测、评分。
- 不调用大模型，不生成自然语言投资建议，不提供任何“该不该买”的判断。
- 不支持做空、杠杆、期权、期货、加密货币的 8 位小数数量。
- 不支持自动识别券商 CSV。导入格式由本文件固定，用户按模板整理。

---

## 1. 目录与技术栈

```
ballast/
  SPEC.md
  DESIGN.md
  package.json            根 package：workspaces、lockfile、start/build/test/check 脚本
  package-lock.json
  server/                 Node.js ESM（纯 JS + JSDoc，不用 TypeScript），Express 5
    src/
      index.js            CLI 入口：解析参数、读配置、启动
      config.js           环境变量校验
      app.js              createApp({ config, now, staticDir })
      db/
        database.js       node:sqlite 打开、PRAGMA、迁移、备份
        migrations/001_init.sql
      routes/             每个资源一个路由文件
      domain/             金额、CSV、计划算法、持仓计算
    test/                 node:test
    package.json
  web/                    React 19 + Vite 8，构建产物 web/dist 由 server 静态托管
    package.json
  scripts/                check-design.js / check-offline.js / test-repeat.js / screenshots.js
  Dockerfile
  docker-compose.yml
  .env.example
```

- 运行时：Node.js **>= 22.13.0**（使用内置 `node:sqlite`，不安装原生模块）。开发和验收使用 Node 24 LTS；Docker 基础镜像固定为 `node:24-bookworm-slim`。
- 主要依赖版本：`express@5.3.0`、`react@19.3.1`、`react-dom@19.3.1`、`vite@8.3.5`、`@vitejs/plugin-react@6.1.2`。运行时依赖只有 Express；数据库用 Node 内置 `node:sqlite`。
- 本地开发端口：server **8787**；Vite dev server **5173**，把 `/api` 代理到 `http://127.0.0.1:8787`。
- 生产：server 在 8787 同时提供 `/api/*` 和 `web/dist`；SPA 路由回退到 `index.html`。
- 一条命令启动（Docker）：`docker compose up -d --build`，打开 `http://127.0.0.1:8787`。
- 不用 Docker 时：在仓库根目录执行 `npm ci && npm run build && npm start`。
- 根 `package.json` 的脚本：`start` / `dev` / `build` / `test` / `test:repeat` / `check:design` / `check:offline` / `check` / `screenshots`。前端脚本在 `web/package.json`，由根脚本通过 workspace 调用。
- 根 `package-lock.json` 同时锁定 server 和 web 的依赖；`npm ci` 必须在根目录执行。
- 不引入 Tailwind、组件库、图表库、图标库、外部字体。

### 1.1 目录与技术栈的版本锁定

`package-lock.json` 必须提交。CI 使用 `npm ci`。Docker 构建使用同一份 lockfile。`npm install` 不得改写依赖版本范围。

---

## 2. 配置

### 2.1 环境变量

只读取以下变量。不读取 `NODE_ENV`、`PORT`、`DATABASE_URL`、`API_KEY` 这类通用名。

| 变量 | 默认值 | 必填 | 合法值 | 非法时 |
|---|---|---|---|---|
| `BALLAST_PORT` | `8787` | 否 | 1–65535 的十进制整数 | 拒绝启动，退出码 2，stderr 写明变量名和当前值 |
| `BALLAST_HOST` | `127.0.0.1` | 否 | 只能是 `127.0.0.1` 或 `::1`；Docker 容器内且 `BALLAST_DOCKER=1` 时允许 `0.0.0.0` | 拒绝启动，退出码 2 |
| `BALLAST_DOCKER` | `0` | 否 | `0` / `1` | 拒绝启动，退出码 2 |
| `BALLAST_DATA_DIR` | `./data` | 否 | 可创建或已存在的目录路径，长度 1–500 | 拒绝启动，退出码 2 |
| `BALLAST_LOG_LEVEL` | `info` | 否 | `info` / `warn` / `error` | 拒绝启动，退出码 2 |
| `BALLAST_DEMO` | `0` | 否 | `0` / `1` | 拒绝启动，退出码 2 |
| `BALLAST_BACKUP_KEEP` | `7` | 否 | 1–100 的整数 | 拒绝启动，退出码 2 |

- 项目不保存任何密钥。没有 API key、token、密码类变量。
- `.env.example` 只放示例值，域名一律用 `example.com`。服务本身不自动读取 `.env`；Docker Compose 通过 `environment` 传入，裸机用户用 shell 环境变量。
- 任何日志、错误响应、备份文件名都不包含环境变量的完整值；非法配置的错误里可以包含变量名和截断到 40 字符的当前值。

### 2.2 数据目录

- 启动时如果目录不存在，创建它，权限 `0700`。
- 数据库文件 `ballast.sqlite` 创建后权限 `0600`。
- 备份目录 `data/backups/`，权限 `0700`；备份文件权限 `0600`。
- 数据目录不可写时拒绝启动，退出码 2，stderr 写明绝对路径和系统错误。
- Ballast 只创建和修改自己数据目录里的 `ballast.sqlite`、`ballast.sqlite-wal`、`ballast.sqlite-shm` 和 `backups/` 下以 `backup-before-` 开头的文件；不删除、不覆盖其他文件。

### 2.3 命令行

包提供可执行文件 `ballast`（`package.json` 的 `bin` 指向 `server/src/index.js`）。

```
ballast [--port <1-65535>] [--data-dir <path>] [--help] [--version]
```

- 无参数：按环境变量启动 HTTP 服务。
- `--port`：覆盖 `BALLAST_PORT`。
- `--data-dir`：覆盖 `BALLAST_DATA_DIR`。
- `--help`：向 stdout 打印用法（不超过 20 行），退出码 0。
- `--version`：向 stdout 打印 `0.1.0` 和换行，退出码 0。
- 未知参数或缺少参数值：向 stderr 打印一行 `参数错误：<说明>`，退出码 2。
- 启动成功后 stdout 依次打印三行：
  ```
  Ballast 0.1.0
  数据目录：<绝对路径>
  监听：http://127.0.0.1:<端口>
  ```
- `SIGINT` / `SIGTERM`：停止接受新连接，关闭数据库，退出码 0。
- 端口被占用：stderr 打印 `启动失败：端口 <端口> 已被占用`，退出码 1。
- 数据库无法打开或迁移失败：stderr 打印 `启动失败：<原因>`，退出码 1；不删除数据库。

### 2.4 HTTP 通用约定

- 所有请求和响应 JSON 使用 UTF-8、`application/json; charset=utf-8`。
- JSON 字段一律 camelCase。ID 是 UUID v4 字符串。时间戳是 ISO 8601 UTC 字符串，精确到毫秒，例如 `2026-10-29T12:00:00.000Z`。
- 日期字段是 `YYYY-MM-DD`，一律按 **UTC** 解释；“今天”指服务器 UTC 当天。API 只接受显式日期，不做浏览器时区换算。前端显示日期时原样显示，不转本地时区。
- 金额、价格、费用、数量一律用**整数微单位**（1 单位 = 1,000,000 微单位）。字段名以 `Micros` 结尾。例：`12345678` 表示 12.345678。
- 比例一律用**基点**（1% = 100 bp，100% = 10000 bp），字段名以 `Bp` 结尾。偏离可以是负数。
- 数量字段 `quantityMicros` 必须大于 0，最大 1,000,000,000,000,000（1e15）。
- 金额字段最大 1,000,000,000,000,000（1e15 微单位 = 10 亿单位）。
- 全局不变量：任意一笔成交或持仓的 `quantityMicros × priceMicros / 1,000,000` 不得超过 1e15；超过时 400 `invalid_input`（计划计算时 422 `value_overflow`）。所有写入前用 BigInt 计算并检查 `Number.isSafeInteger`。
- 所有写操作在一个 SQLite 事务内完成；失败回滚，不留半条记录。
- 错误响应统一：
  ```json
  {"error": "给人看的中文说明", "code": "machine_code", "details": []}
  ```
  `details` 只在有字段级或行级错误时出现，最多 20 项；每项固定为 `{"field": "字段名或 null", "line": 行号或 null, "message": "说明", "context": {}}`，`context` 可省略。本文后面写“details 带 X”时，X 放进 `context`。
- 成功响应直接返回资源对象，不再包一层 `ok`；唯一例外是 `GET /api/health`，它返回 `{"ok":true,...}`。删除成功返回 204 无 body。
- 请求处理顺序固定：`Content-Type`（415）→ body 字节上限（413）→ JSON 解析（400 `invalid_json`）→ 设置状态（409）→ 资源存在（404）→ 状态冲突（409）→ 字段校验（400）→ 计算类错误（422）→ 内部错误（500）。本文各接口列出的错误按此顺序判断。
- 未匹配的 `/api/*` 返回 404 `{"error":"接口不存在","code":"not_found"}`。
- JSON 解析失败返回 400 `invalid_json`。JSON 请求体超过 **4MB**（按字节）返回 413 `payload_too_large`。CSV 文本上限另按 UTF-8 字节计算，见 4.7。
- 所有响应加以下头：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- API 响应加 `Cache-Control: no-store`。

### 2.5 本机安全

- 裸机只监听回环地址。Docker 端口映射固定为 `127.0.0.1:8787:8787`；容器内允许 `BALLAST_HOST=0.0.0.0` + `BALLAST_DOCKER=1`，且只有检测到容器环境（`/.dockerenv` 或 `/run/.containerenv`）才接受这组值。
- 所有请求的 `Host` 必须是 `127.0.0.1:<端口>`、`localhost:<端口>` 或 `[::1]:<端口>`，否则 403 `bad_host`（防 DNS rebinding）。
- 写操作（POST/PUT/PATCH/DELETE）必须满足两条：
  1. `Content-Type` 是 `application/json`（DELETE 无 body 时除外）；
  2. 如果请求带 `Origin` 头，它的值必须是 `http://127.0.0.1:<端口>`、`http://localhost:<端口>`、`http://[::1]:<端口>` 之一。
- `Origin` 不匹配返回 403 `bad_origin`；需要 body 的写请求不是 JSON 返回 415 `unsupported_media_type`。
- 不提供 CORS。不设置 `Access-Control-Allow-Origin`。
- 前端不加载任何外部资源。构建产物中出现 `http://` 或 `https://` 外链即视为发布阻断项，唯一例外是 `http://www.w3.org/2000/svg` 命名空间和 `http://127.0.0.1`。

---

## 3. 数据模型

SQLite 使用 `PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`、`PRAGMA busy_timeout=5000`。所有表名和列名用 snake_case；API 输出用 camelCase。

### 3.1 portfolio（恰好一行）

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | 固定 `portfolio` | — |
| `name` | TEXT | 1–60 字符，去首尾空白后非空 | — |
| `base_currency` | TEXT | 枚举 `CNY` / `USD` / `EUR` / `HKD` / `JPY` / `GBP` | `CNY` |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |
| `updated_at` | TEXT | ISO 时间戳 | 创建时 |

- 基础币种在首次设置后不可修改。`PUT /api/portfolio` 只接受 `name`。
- `JPY` 在前端显示 0 位小数，其余显示 2 位；内部仍用微单位。

### 3.2 account

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | UUID | — |
| `name` | TEXT | 1–40 字符，去空白后非空；不区分大小写唯一 | — |
| `kind` | TEXT | 枚举 `taxable` / `tax_advantaged` / `cash` / `other` | `taxable` |
| `archived` | INTEGER | 0 / 1 | 0 |
| `sort_order` | INTEGER | 0–10000 | 按创建顺序递增 |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |
| `updated_at` | TEXT | ISO 时间戳 | 创建时 |

- 至少保留一个未归档账户。
- 有交易记录的账户不能删除，只能归档。

### 3.3 sleeve（资产分类）

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | UUID | — |
| `name` | TEXT | 1–30 字符，去空白后非空；不区分大小写唯一 | — |
| `target_bp` | INTEGER | 0–10000 | — |
| `band_bp` | INTEGER | 0–2000，允许的偏离带 | 500 |
| `sort_order` | INTEGER | 0–10000 | 按创建顺序递增 |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |
| `updated_at` | TEXT | ISO 时间戳 | 创建时 |

- 组合内 1–12 个 sleeve；所有 `target_bp` 之和在编辑过程中可以是 0–10000，但生成计划时必须恰好为 10000。
- 新建或修改单个分类时，总和超过 10000 返回 400 `target_sum_exceeded`；`PUT /api/targets` 要求总和恰好 10000。
- 至少保留一个 sleeve。
- 有代码引用的 sleeve 不能删除。

### 3.4 symbol（可买入代码）

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | UUID | — |
| `ticker` | TEXT | 1–20 字符；大写字母、数字、`.`、`-`；不区分大小写唯一 | — |
| `name` | TEXT | 1–60 字符，去空白后非空 | — |
| `sleeve_id` | TEXT FK → sleeve.id | 必须存在 | — |
| `currency` | TEXT | 必须等于组合 `base_currency` | 组合币种 |
| `lot_size_micros` | INTEGER | 1,000,000–1,000,000,000,000；买入数量必须是它的整数倍 | 1,000,000 |
| `price_micros` | INTEGER | 0 或 1–1e12；0 表示未填 | 0 |
| `price_as_of` | TEXT | `YYYY-MM-DD` 或 NULL；价格 >0 时必填 | NULL |
| `archived` | INTEGER | 0 / 1 | 0 |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |
| `updated_at` | TEXT | ISO 时间戳 | 创建时 |

- `lot_size_micros` 是买入的最小单位。A 股 ETF 常见 100 份一手，填 100,000,000；美股/场外基金填 1,000,000（1 份）。
- 归档的代码不参与新的买入计划，但已有持仓仍计入当前市值。
- 有交易记录的代码不能删除，只能归档。
- `price_as_of` 不能晚于服务器当天 +1 天。

### 3.5 transaction（成交记录）

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | UUID | — |
| `account_id` | TEXT FK → account.id | 必须存在且未归档 | — |
| `symbol_id` | TEXT FK → symbol.id | 必须存在 | — |
| `side` | TEXT | 枚举 `buy` / `sell` | — |
| `quantity_micros` | INTEGER | 1–1e15 | — |
| `price_micros` | INTEGER | 1–1e12 | — |
| `fee_micros` | INTEGER | 0–1e12 | 0 |
| `traded_at` | TEXT | `YYYY-MM-DD`，2000-01-01 ≤ 日期 ≤ 今天+1 天 | — |
| `note` | TEXT | 0–200 字符 | `""` |
| `source` | TEXT | 枚举 `manual` / `import` / `plan` | `manual` |
| `plan_id` | TEXT FK → plan.id，可空 | `source=plan` 时必填 | NULL |
| `import_id` | TEXT FK → import.id，可空 | `source=import` 时必填 | NULL |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |

- 当前持仓按 `account_id + symbol_id` 汇总，计划按 `symbol_id` 再汇总全组合。
- 卖出前必须检查当前持仓；卖出后持仓不得小于 0。错误 409 `insufficient_position`，details 里带 `availableQuantityMicros`。
- 每个账户、每个代码的平均成本 = 该账户该代码所有买入的（数量×价格 + 费用）之和 / 买入数量；卖出不改变平均成本。持仓为 0 时平均成本为 0。
- 只有 `source=manual` 的交易可以删除；不提供交易修改接口。删除后如果任一账户+代码持仓为负，返回 409 `would_make_position_negative`。
- 计划执行产生的交易和导入产生的交易不能删除。导入也没有撤销接口；导错了用备份恢复，或新增反向手工交易并保留记录。

### 3.6 plan（买入计划）

| 字段 | 类型 | 规则 | 默认 |
|---|---|---|---|
| `id` | TEXT PK | UUID | — |
| `amount_micros` | INTEGER | 1–1e12（最多 100 万单位） | — |
| `min_trade_micros` | INTEGER | 0–1e10（最多 10,000 单位） | 0 |
| `status` | TEXT | 枚举 `draft` / `executed` / `abandoned` | `draft` |
| `algorithm_version` | TEXT | 固定 `greedy-v1` | `greedy-v1` |
| `inputs_hash` | TEXT | 64 位小写十六进制 SHA-256 | — |
| `total_before_micros` | INTEGER | 生成时的总市值 | — |
| `total_after_micros` | INTEGER | 总市值 + 投入金额 | — |
| `planned_micros` | INTEGER | 所有买入项金额之和 | — |
| `cash_left_micros` | INTEGER | 投入金额 − planned | — |
| `max_drift_before_bp` | INTEGER | 买入前最大绝对偏离 | — |
| `max_drift_after_bp` | INTEGER | 买入后最大绝对偏离 | — |
| `warnings_json` | TEXT | JSON 数组，见 5.4 | `[]` |
| `note` | TEXT | 0–200 字符 | `""` |
| `created_at` | TEXT | ISO 时间戳 | 创建时 |
| `executed_at` | TEXT | ISO 时间戳或 NULL | NULL |
| `abandoned_at` | TEXT | ISO 时间戳或 NULL | NULL |

### 3.7 plan_item（计划买入项）

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `plan_id` | TEXT FK → plan.id | 必须存在 |
| `symbol_id` | TEXT | 生成时的代码 id |
| `ticker` | TEXT | 生成时的代码，快照 |
| `symbol_name` | TEXT | 生成时的名称，快照 |
| `sleeve_id` | TEXT | 生成时的分类 id |
| `sleeve_name` | TEXT | 生成时的分类名，快照 |
| `quantity_micros` | INTEGER | >0 |
| `price_micros` | INTEGER | >0，生成时价格快照 |
| `amount_micros` | INTEGER | 数量×价格，向下取整到微单位 |
| `sort_order` | INTEGER | 分类 `sort_order`×1000 + 该分类内按 ticker 升序的序号 |

### 3.8 plan_sleeve（计划里的分类快照）

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `plan_id` | TEXT FK → plan.id | 必须存在 |
| `sleeve_id` | TEXT | 分类 id |
| `name` | TEXT | 分类名快照 |
| `target_bp` | INTEGER | 目标基点快照 |
| `value_before_micros` | INTEGER | 买入前市值 |
| `value_after_micros` | INTEGER | 买入后市值 |
| `drift_before_bp` | INTEGER | 买入前偏离，可负 |
| `drift_after_bp` | INTEGER | 买入后偏离，可负 |
| `sort_order` | INTEGER | 分类顺序 |

### 3.9 import（CSV 导入记录）

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `kind` | TEXT | 固定 `transactions` |
| `filename` | TEXT | 1–200 字符，只保留文件名，不含路径 |
| `sha256` | TEXT | 原始 UTF-8 文本（含 BOM）的 SHA-256，唯一 |
| `row_count` | INTEGER | 1–5000 |
| `created_at` | TEXT | ISO 时间戳 |

### 3.10 meta

| key | value | 用途 |
|---|---|---|
| `schema_version` | 整数文本 | 已应用的迁移版本 |
| `demo_seeded` | `0` / `1` | 是否由示例数据初始化 |

---

## 4. HTTP 接口

所有 `/api/*` 在未完成首次设置时，除 `GET /api/health`、`GET /api/state`、`POST /api/setup`、`POST /api/demo/reload` 外，返回 409：

```json
{"error":"尚未完成首次设置","code":"setup_incomplete"}
```

### 4.1 健康与状态

#### GET /api/health

不需要设置完成。

200：
```json
{"ok":true,"version":"0.1.0","setupComplete":true,"demo":false,"today":"2026-10-29"}
```

#### GET /api/state

200，返回首屏需要的全部数据。设置未完成时完整返回：
```json
{
  "setupComplete": false,
  "demo": false,
  "today": "2026-10-29",
  "portfolio": null,
  "accounts": [],
  "sleeves": [],
  "symbols": [],
  "positions": [],
  "totals": {"marketValueMicros":0,"costBasisMicros":0,"unrealizedMicros":0,"positionCount":0},
  "targets": [],
  "lastPlan": null
}
```
设置完成时：
```json
{
  "setupComplete": true,
  "demo": false,
  "today": "2026-10-29",
  "portfolio": {"id":"portfolio","name":"长期组合","baseCurrency":"CNY","createdAt":"...","updatedAt":"..."},
  "accounts": [{"id":"...","name":"主账户","kind":"taxable","archived":false,"sortOrder":0,"createdAt":"...","updatedAt":"..."}],
  "sleeves": [{"id":"...","name":"股票","targetBp":6000,"bandBp":500,"sortOrder":0,"createdAt":"...","updatedAt":"..."}],
  "symbols": [{"id":"...","ticker":"510300","name":"沪深300ETF","sleeveId":"...","sleeveName":"股票","currency":"CNY","lotSizeMicros":100000000,"priceMicros":4123000,"priceAsOf":"2026-10-28","archived":false,"createdAt":"...","updatedAt":"..."}],
  "positions": [{"accountId":"...","accountName":"主账户","symbolId":"...","ticker":"510300","name":"沪深300ETF","sleeveId":"...","sleeveName":"股票","quantityMicros":1000000000,"avgCostMicros":4000000,"priceMicros":4123000,"priceAsOf":"2026-10-28","marketValueMicros":4123000000,"costBasisMicros":4000000000,"unrealizedMicros":123000000}],
  "totals": {"marketValueMicros":0,"costBasisMicros":0,"unrealizedMicros":0,"positionCount":0},
  "targets": [{"sleeveId":"...","name":"股票","targetBp":6000,"bandBp":500,"valueMicros":0,"actualBp":0,"driftBp":-6000,"status":"outside"}],
  "lastPlan": {"id":"...","status":"draft","amountMicros":1000000000,"plannedMicros":1000000000,"cashLeftMicros":0,"maxDriftBeforeBp":1333,"maxDriftAfterBp":429,"createdAt":"..."}
}
```
- `today` 是服务器 UTC 当天，`YYYY-MM-DD`；前端默认成交日期用它。
- `accounts`、`symbols` 包含已归档项，用 `archived` 区分。
- `positions` 按 `accountId + symbolId` 聚合，只返回数量 >0 的行；按 `marketValueMicros` 降序，相同按账户名、ticker 升序。`positionCount` 是这个行数。
- 同一代码在多个账户持有时，每个账户一行，平均成本和成本基础按该账户单独计算。
- `targets` 按 `sortOrder` 升序。`actualBp = round(value / total × 10000)`，0.5 远离 0；总市值为 0 时 `actualBp=0`，`driftBp=-targetBp`。
- `status` 为 `within`（`abs(driftBp) <= bandBp`）或 `outside`。
- `lastPlan` 是最近一个计划（任意状态），没有则为 null；字段与计划列表项一致。
- `demo` 为 `true` 当且仅当当前数据库由示例数据初始化（`meta.demo_seeded=1`）。

### 4.2 首次设置

#### POST /api/setup

请求：
```json
{"portfolioName":"长期组合","baseCurrency":"CNY","template":"three_sleeve"}
```
- `portfolioName`：1–60 字符。
- `baseCurrency`：`CNY` / `USD` / `EUR` / `HKD` / `JPY` / `GBP`；省略时默认 `CNY`。
- `template`：`three_sleeve` 或 `blank`。
  - `three_sleeve`：创建分类“股票”6000 bp / “债券”3000 bp / “现金”1000 bp，偏离带依次 500 / 300 / 200。
  - `blank`：创建一个分类“默认”10000 bp，偏离带 500。
- 同时创建一个账户“主账户”，`kind=taxable`。

201，返回 `GET /api/state` 的结构。

失败：
- 已设置：409 `already_setup`。
- 参数非法：400 `invalid_input`，details 带字段。
- 币种不在枚举：400 `invalid_currency`。

#### PUT /api/portfolio

请求 `{"name":"新名称"}`；200 返回 portfolio。空名称 400 `invalid_input`。币种字段被拒绝：400 `invalid_input`，details 写明 `baseCurrency` 不可修改。

### 4.3 账户

#### GET /api/accounts

200：Account[]，包含已归档账户，按 `sortOrder`、`createdAt`、`id` 升序；字段与 state.accounts 相同。

#### POST /api/accounts

请求 `{"name":"养老金","kind":"tax_advantaged"}`。201 返回 Account。
- 名称重复（不区分大小写）：409 `duplicate_account`。
- 名称空白、超长：400 `invalid_input`。
- `kind` 不在枚举：400 `invalid_input`。

#### PATCH /api/accounts/:id

请求可包含 `name`、`kind`、`archived`。200 返回 Account。
- 不存在：404 `not_found`。
- 把最后一个未归档账户归档：409 `last_account`。
- 名称重复：409 `duplicate_account`。

#### DELETE /api/accounts/:id

204。不存在 404 `not_found`。有交易记录 409 `account_has_transactions`。最后一个未归档账户 409 `last_account`。

### 4.4 分类与目标

#### POST /api/sleeves

请求 `{"name":"黄金","targetBp":500,"bandBp":300}`。201 返回 Sleeve。
- 名称重复：409 `duplicate_sleeve`。
- 加入后总和超过 10000：400 `target_sum_exceeded`，details 带 `currentSumBp`、`maxBp`。
- 超过 12 个：400 `invalid_input`。

#### PATCH /api/sleeves/:id

请求可包含 `name`、`targetBp`、`bandBp`。200 返回 Sleeve。
- 修改后总和不得超过 10000；否则 400 `target_sum_exceeded`，details 带 `currentSumBp`、`maxBp`。允许暂时小于 10000，但生成计划时会 400 `target_sum_mismatch`。
- 名称重复：409 `duplicate_sleeve`。

#### PUT /api/targets

整体替换所有分类的目标和偏离带，用于目标编辑页保存。

请求：
```json
{"sleeves":[{"id":"...","targetBp":6000,"bandBp":500},{"id":"...","targetBp":4000,"bandBp":500}]}
```
- 必须包含当前全部 sleeve，不能多、不能少。
- 总和必须为 10000；否则 400 `target_sum_mismatch`，details 带 `sumBp`。
- 每项 `bandBp` 0–2000；否则 400 `invalid_input`。
- 成功：200，返回 `GET /api/state` 的 `sleeves` 和 `targets` 两个字段。

#### DELETE /api/sleeves/:id

204。不存在 404 `not_found`。有代码引用 409 `sleeve_has_symbols`。最后一个分类 409 `last_sleeve`。删除后目标总和可以小于 10000，生成计划前需补回。

### 4.5 代码与价格

#### POST /api/symbols

请求：
```json
{"ticker":"510300","name":"沪深300ETF","sleeveId":"...","lotSizeMicros":100000000,"priceMicros":4123000,"priceAsOf":"2026-10-28"}
```
- `ticker` 去空白后转大写，必须匹配 `^[A-Z0-9.-]{1,20}$`。
- `currency` 不传，固定为组合币种。
- `lotSizeMicros` 可省略，默认 1,000,000（1 份）；必须是 1,000,000 的整数倍且不超过 1e12。
- `priceMicros` 可省略；省略时 `priceAsOf` 必须省略。
- 201 返回 Symbol。

失败：
- ticker 重复：409 `duplicate_ticker`。
- sleeve 不存在：404 `not_found`。
- 价格或日期非法：400 `invalid_input`。
- `priceAsOf` 晚于今天+1：400 `invalid_price_date`。

#### PATCH /api/symbols/:id

请求可包含 `name`、`sleeveId`、`lotSizeMicros`、`priceMicros`、`priceAsOf`、`archived`。200 返回 Symbol。
- 改价格时必须同时给 `priceAsOf`；只给日期不给价格：400 `invalid_input`。
- 归档后可以继续修改价格和名称。
- 不存在 404 `not_found`；sleeve 不存在 404 `not_found`。

#### PUT /api/prices

批量更新，最多 200 项，整体成功或整体失败。

请求：
```json
{"prices":[{"symbolId":"...","priceMicros":4123000,"priceAsOf":"2026-10-28"}]}
```
- 200，返回更新后的 Symbol[]，按请求顺序。
- 任一项非法：400 `invalid_input`，details 带索引和字段；所有项都不写入。
- 任一项 symbolId 不存在：404 `not_found`，details 带索引。

#### DELETE /api/symbols/:id

204。不存在 404 `not_found`。有交易记录 409 `symbol_has_transactions`。被草稿计划引用时允许删除；该计划执行时会因为 `inputsHash` 变化返回 409 `plan_stale`。

### 4.6 交易

#### GET /api/transactions

查询参数：`limit` 默认 50，1–200；`offset` 默认 0，≥0；`accountId`、`symbolId` 可选。

200：
```json
{"total":12,"items":[{"id":"...","accountId":"...","accountName":"主账户","symbolId":"...","ticker":"510300","symbolName":"沪深300ETF","side":"buy","quantityMicros":100000000,"priceMicros":4000000,"feeMicros":0,"tradedAt":"2026-01-05","note":"","source":"manual","planId":null,"createdAt":"..."}]}
```
- 按 `tradedAt` 倒序，同日按 `createdAt` 倒序。

#### POST /api/transactions

请求：
```json
{"accountId":"...","symbolId":"...","side":"buy","quantityMicros":100000000,"priceMicros":4000000,"feeMicros":0,"tradedAt":"2026-10-28","note":"定投"}
```
201，返回：
```json
{"transaction":{...},"position":{"accountId":"...","symbolId":"...","quantityMicros":100000000,"avgCostMicros":4000000}}
```

失败：
- 账户或代码不存在：404 `not_found`；存在但已归档：409 `account_archived` / `symbol_archived`；存在检查先于归档检查。
- 数量、价格、费用、note 非法：400 `invalid_input`；日期格式或越界统一 400 `invalid_date`。
- 卖出超过当前持仓：409 `insufficient_position`，details 带 `availableQuantityMicros`。
- 日期晚于今天+1 或早于 2000-01-01：400 `invalid_date`。

#### DELETE /api/transactions/:id

204。
- 不存在：404 `not_found`。
- `source` 不是 `manual`：409 `system_transaction`。
- 删除后任一代码持仓为负：409 `would_make_position_negative`。

### 4.7 CSV 导入与导出

#### GET /api/imports/template

200，`text/csv; charset=utf-8`，带 UTF-8 BOM，文件名 `ballast-transactions-template.csv`。内容固定：
```csv
date,account,symbol,side,quantity,price,fee,note
2026-01-05,主账户,510300,buy,1000,4.000000,0,首次定投
```

#### POST /api/imports

请求：
```json
{"filename":"2026-10.csv","csv":"date,account,symbol,side,quantity,price,fee,note\n..."}
```
- `filename` 只取最后一段路径，1–200 字符；不写入服务器磁盘。
- `csv` 是 UTF-8 文本，按 UTF-8 字节计最大 **1,000,000 字节**；超过 400 `file_too_large`。JSON body 上限 4MB，所以 1MB 的 CSV 一定先通过 body 检查。
- 1–5000 数据行；0 行 400 `invalid_csv`；超过 5000 行 400 `too_many_rows`。
- 允许 BOM、LF、CRLF。字段规则是 RFC 4180 的子集：字段可用双引号包围；引号内的 `""` 表示一个双引号；引号内允许逗号；**不允许字段内换行**。未加引号的字段去掉首尾空格；加引号的字段保留原内容。
- 表头是文件第 1 行，必须完全等于 `date,account,symbol,side,quantity,price,fee,note`（不区分大小写，顺序固定）。`details.line` 是文件物理行号，表头是第 1 行，数据从第 2 行开始；空行跳过但行号照算。
- 空行忽略；全空行不计入数据行数。
- `account` 按名称不区分大小写匹配；不存在或已归档：该行错误。
- `symbol` 按 ticker 不区分大小写匹配；不存在或已归档：该行错误。
- `quantity`、`price`、`fee` 必须匹配 `^\d+(\.\d{1,6})?$`；`quantity` 和 `price` 必须 >0，`fee` 可以为 0；不允许 `+`、`-`、指数、空值。转换成微单位时正好是整数，不做四舍五入。
- `side` 必须是 `buy` 或 `sell`。
- 同一文件内，八列完全相同的两行视为重复：第二行报错。
- 按文件顺序逐行检查卖出后的持仓，任何一行卖出超过已有持仓即报错。
- 所有行先校验，再在一个事务里写入。任一行失败：400 `invalid_csv`，`details` 最多 20 项 `{line, message, context}`；整个文件不写入。
- 成功后 201：
  ```json
  {"import":{"id":"...","filename":"2026-10.csv","rowCount":12,"createdAt":"..."},"importedRows":12}
  ```
- 同一内容（含 BOM 的原始 CSV 字符串的 SHA-256）重复导入：409 `duplicate_import`，details 带首次导入的 `importId` 和 `createdAt`。

#### GET /api/imports

查询参数 `limit` 默认 20、1–100；`offset` 默认 0、≥0。非法 400 `invalid_input`。

200：
```json
{"total":2,"items":[{"id":"...","filename":"2026-10.csv","rowCount":12,"createdAt":"..."}]}
```
按 `createdAt` 倒序，`createdAt` 相同按 `id` 升序。

#### GET /api/export/transactions.csv

200，`text/csv; charset=utf-8`，带 BOM，文件名 `ballast-transactions-YYYYMMDD.csv`。列与模板相同，日期用 `tradedAt`；数量、价格、费用固定输出 6 位小数（不截断、不四舍五入）；`note` 做 CSV 引号转义。任何以 `= + - @`、制表符、回车开头的单元格前加一个单引号 `'`，防止表格软件执行公式。导入端不剥离这个单引号；导出的文件用于查看和备份，不建议原样再导入。

#### GET /api/export/positions.csv

200，列固定 `account,symbol,name,sleeve,quantity,avg_cost,price,price_as_of,market_value,unrealized`。只导出数量 >0 的持仓；按账户名、ticker 排序。`quantity`、`avg_cost`、`price` 固定 6 位小数；`market_value`、`unrealized` 按组合币种小数位（见 4.7.1）四舍五入。

#### 4.7.1 金额、价格、数量的显示与导出

| 币种 | 符号 | 金额小数位 | 舍入 |
|---|---|---:|---|
| CNY | ¥ | 2 | 四舍五入，0.5 远离 0 |
| USD | $ | 2 | 同上 |
| EUR | € | 2 | 同上 |
| HKD | HK$ | 2 | 同上 |
| GBP | £ | 2 | 同上 |
| JPY | ¥ | 0 | 同上 |

- 价格、份额、费用始终最多 6 位小数；导出时固定 6 位，不按币种截断。
- 界面金额用上表格式；价格显示 6 位小数并去掉末尾 0（例如 `4.123`、`121.456`）。
- API 只传整数微单位，不做格式化。

### 4.8 计划

#### POST /api/plans

请求：
```json
{"amountMicros":1000000000,"minTradeMicros":0,"note":"10 月定投"}
```
- `amountMicros`：1–1e12（最多 1,000,000 单位）。
- `minTradeMicros`：0–1e10（最多 10,000 单位），默认 0。
- `note`：0–200 字符。

201，返回计划对象（4.8.1）。

失败：
- 参数非法：400 `invalid_input`。
- 有持仓代码没填价格：422 `missing_price`，details 带 `{ticker}` 列表。
- 某个目标 >0 的分类没有任何未归档代码：422 `sleeve_without_symbol`，details 带分类名。
- 所有代码都买不起：422 `amount_too_small`，`details.context.minimumAmountMicros = max(所有可买代码的最低一手成本, minTradeMicros)`。
- 数值溢出或内部错误：500 `internal_error`。

#### 4.8.1 计划对象

```json
{
  "id":"...",
  "status":"draft",
  "amountMicros":1000000000,
  "minTradeMicros":0,
  "plannedMicros":1000000000,
  "cashLeftMicros":0,
  "totalBeforeMicros":6000000000,
  "totalAfterMicros":7000000000,
  "maxDriftBeforeBp":1333,
  "maxDriftAfterBp":429,
  "algorithmVersion":"greedy-v1",
  "inputsHash":"...",
  "warnings":[{"code":"outside_band","message":"股票偏离 +6.67%，超出偏离带；债券偏离 -13.33%，超出偏离带；现金偏离 +6.67%，超出偏离带"}],
  "note":"10 月定投",
  "createdAt":"...",
  "executedAt":null,
  "abandonedAt":null,
  "items":[
    {"symbolId":"...","ticker":"510300","symbolName":"沪深300ETF","sleeveId":"...","sleeveName":"股票","quantityMicros":50000000,"priceMicros":4000000,"amountMicros":200000000},
    {"symbolId":"...","ticker":"511010","symbolName":"国债ETF","sleeveId":"...","sleeveName":"债券","quantityMicros":8000000,"priceMicros":100000000,"amountMicros":800000000}
  ],
  "sleeves":[
    {"sleeveId":"...","name":"股票","targetBp":6000,"valueBeforeMicros":4000000000,"valueAfterMicros":4200000000,"driftBeforeBp":667,"driftAfterBp":0},
    {"sleeveId":"...","name":"债券","targetBp":3000,"valueBeforeMicros":1000000000,"valueAfterMicros":1800000000,"driftBeforeBp":-1333,"driftAfterBp":-429},
    {"sleeveId":"...","name":"现金","targetBp":1000,"valueBeforeMicros":1000000000,"valueAfterMicros":1000000000,"driftBeforeBp":667,"driftAfterBp":429}
  ]
}
```

#### GET /api/plans

查询参数 `limit` 默认 20、1–100；`offset` 默认 0。200：
```json
{"total":5,"items":[{"id":"...","status":"draft","amountMicros":1000000000,"plannedMicros":1000000000,"cashLeftMicros":0,"maxDriftBeforeBp":1333,"maxDriftAfterBp":429,"createdAt":"...","executedAt":null}]}
```
按 `createdAt` 倒序，`createdAt` 相同按 `id` 升序。`limit`、`offset` 非法 400 `invalid_input`。

#### GET /api/plans/:id

200，返回完整计划对象。不存在 404 `not_found`。

#### POST /api/plans/:id/execute

请求：
```json
{"accountId":"...","tradedAt":"2026-10-29","note":"按计划买入"}
```
- `accountId` 必填，账户必须存在且未归档；所有买入项写入这个账户。
- `tradedAt` 规则同交易；`note` 追加到每条生成的交易 note，最终 note 为计划 note + ` · ` + 请求 note（都非空时），最长 200 字符，超出 400 `invalid_input`。

200：
```json
{"plan":{...},"transactions":[{"id":"...","symbolId":"...","quantityMicros":50000000,"priceMicros":4000000}]}
```

失败：
- 计划不存在：404 `not_found`。
- 状态不是 `draft`：409 `plan_not_draft`。
- 当前持仓、价格、价格日期、分类目标、分类顺序、代码归档状态、代码手数或 ticker 与生成时不一致：409 `plan_stale`。价格被清空也属于这一类。
- 执行过程中数据库写入失败：500 `internal_error`，整笔回滚，计划仍是 `draft`。

生成交易：
- `side=buy`，`source=plan`，`plan_id=计划 id`，`fee_micros=0`，`price_micros` 用计划快照价格，`quantity_micros` 用计划项数量，`account_id` 用请求里的 `accountId`。
- 计划项不绑定账户；执行时必须指定一个账户。
- 缺少 `accountId`：400 `invalid_input`，details 写明 `accountId` 必填。

#### POST /api/plans/:id/abandon

200，返回计划；`status=abandoned`，`abandonedAt` 写入。不存在 404 `not_found`；已执行或已放弃 409 `plan_not_draft`。

#### DELETE /api/plans/:id

204。不存在 404 `not_found`；只有 `draft` 可以删除，已执行或已放弃 409 `plan_not_draft`。

### 4.9 备份

#### POST /api/backup

备份有服务端副作用，用 POST，受 2.5 的 Origin/Content-Type 规则保护；无 body 也允许。

- 用 SQLite `VACUUM INTO` 生成一致性快照，不阻塞读。
- 200，`application/vnd.sqlite3`，`Content-Disposition: attachment; filename="ballast-backup-YYYYMMDD-HHMMSS.sqlite"`，`Cache-Control: no-store`。
- 生成失败：500 `backup_failed`，不返回半个文件。
- 文件名中的时间用 UTC。

### 4.10 示例数据

#### POST /api/demo/reload

只在 `BALLAST_DEMO=1` 时可用。

请求 `{"confirm":"RELOAD"}`。
- `confirm` 不等于 `RELOAD`：400 `bad_confirm`。
- 非 demo 模式：403 `demo_disabled`。
- 成功：清空所有业务表，重新写入示例数据，200 返回 `GET /api/state`。

示例数据固定：
- 组合“示例组合”，CNY。
- 账户“工资卡定投”（taxable）、“养老金账户”（tax_advantaged）。
- 分类：股票 6000/500、债券 3000/300、现金 1000/200。
- 代码：`510300` 沪深300ETF（股票，价格 4.123000）、`513100` 纳指ETF（股票，1.876000）、`511010` 国债ETF（债券，121.456000）、`511880` 银华日利（现金，100.123000）。价格日期为启动当天减 1 天。
- 两个账户共 12 笔买入，日期从启动当月往前推 11 个月到上月，数量和价格固定：

| # | 代码 | 账户 | 月份偏移 | 数量（份） | 价格 | 金额 |
|---:|---|---|---:|---:|---:|---:|
| 1 | 510300 | 工资卡定投 | -11 | 1,000 | 3.900000 | 3,900.00 |
| 2 | 513100 | 工资卡定投 | -10 | 3,000 | 1.700000 | 5,100.00 |
| 3 | 510300 | 工资卡定投 | -9 | 1,000 | 4.000000 | 4,000.00 |
| 4 | 511010 | 养老金账户 | -8 | 100 | 118.000000 | 11,800.00 |
| 5 | 510300 | 工资卡定投 | -7 | 500 | 3.800000 | 1,900.00 |
| 6 | 513100 | 养老金账户 | -6 | 2,000 | 1.800000 | 3,600.00 |
| 7 | 511880 | 养老金账户 | -6 | 200 | 100.000000 | 20,000.00 |
| 8 | 510300 | 工资卡定投 | -5 | 1,000 | 4.100000 | 4,100.00 |
| 9 | 513100 | 工资卡定投 | -4 | 2,000 | 1.900000 | 3,800.00 |
| 10 | 510300 | 工资卡定投 | -3 | 500 | 4.200000 | 2,100.00 |
| 11 | 511010 | 养老金账户 | -2 | 100 | 119.000000 | 11,900.00 |
| 12 | 511880 | 养老金账户 | -1 | 200 | 100.000000 | 20,000.00 |

- 当前价格：510300 = 4.123000，513100 = 1.876000，511010 = 121.456000，511880 = 100.123000；价格日期为启动当天减 1 天。
- 期望值：总市值 **93,964.40 元**（93,964,400,000 微单位），5 个持仓行（513100 分布在两个账户），股票 29,624.00、债券 24,291.20、现金 40,049.20。
- 示例数据也写 `meta.demo_seeded=1`。

---

## 5. 核心流程

### 5.1 启动与迁移

1. 解析命令行参数，覆盖环境变量。
2. 校验配置；任一项非法，stderr 一行，退出码 2。
3. 创建数据目录（0700）；不可写则退出 2。
4. 打开 `ballast.sqlite`，设置 PRAGMA。
5. 读取 `schema_migrations`；如果数据库已有表但版本低于代码内最新版本：
   - 用 `VACUUM INTO` 备份到 `data/backups/backup-before-v<旧版本>-<YYYYMMDD-HHMMSS>.sqlite`；
   - 只保留最近 `BALLAST_BACKUP_KEEP` 个 `backup-before-*` 文件，按修改时间从旧到新删除；
   - 备份失败则拒绝迁移，退出码 1。
6. 在单个事务内按版本顺序执行迁移。
7. 如果 `BALLAST_DEMO=1` 且 `portfolio` 表为空，写入示例数据。
8. 启动 HTTP 监听。端口占用退出 1。
9. 打印启动三行；注册 SIGINT/SIGTERM 处理。

### 5.2 首次设置

1. 前端打开 `/`，`GET /api/state` 返回 `setupComplete=false`，跳转 `/setup`。
2. 用户填写组合名、币种，选择 `three_sleeve` 或 `blank`。
3. `POST /api/setup` 在一个事务里写 portfolio、一个账户、分类目标。
4. 返回完整 state；前端进入总览。
5. 重复提交返回 409；不覆盖已有数据。

### 5.3 录入持仓

1. 全新安装后，用户先在“持仓”页点“新增代码”：ticker、名称、分类、每手份数、当前价格、价格日期。也可以直接点“新增买入”，弹窗里先选代码；代码为空时给出“先新增代码”的入口。
2. 然后新增一笔交易：账户、代码、方向、数量、价格、费用、日期、备注。
3. 也可以下载模板，整理 CSV 后上传。
4. 导入先逐行校验，再整体写入；任何一行失败都不写。
5. 写完后重新计算持仓和市值；价格来自 `symbol.price_micros`，与交易价格无关。
6. 价格和价格日期在“持仓”页的代码表逐个更新，或用批量价格表单一次保存；“代码”表还提供归档/恢复。

### 5.4 生成买入计划

输入：组合当前持仓、每个代码的价格、分类目标、投入金额、最小单笔金额、服务器当天日期。

输出：计划对象、买入项、分类快照、警告。

算法 `greedy-v1` 精确步骤：

1. **市值**：`value_s = quantity_s × price_s`（微单位，向下取整）。`total = Σ value_s`。任一 `quantity_s > 0` 且 `price_s = 0` → 422 `missing_price`；`total` 或任一笔市值超过 1e15 → 422 `value_overflow`。
2. **目标后总市值**：`totalAfter = total + amount`。
3. **分类目标值**：`raw_i = totalAfter × target_bp_i / 10000`。用最大余数法把 `totalAfter` 分配到各分类，得到整数 `goal_i`，保证 `Σ goal_i = totalAfter`：
   - 先取 `floor(raw_i)`；
   - 差额按小数部分从大到小逐微单位分配；小数部分相同按分类 `sort_order` 升序、再按 sleeveId 升序。
4. **缺口**：`gap_i = goal_i − value_i`；`deficit_i = max(0, gap_i)`。
   - `sleeve_without_symbol` 只在一个条件下抛出：某分类 `target_bp_i > 0`，且没有“未归档且有价格”的代码。details.context 带 `{sleeve: 分类名}`。
5. **预算比例**：`deficitSum = Σ deficit_i`。
   - `deficitSum = 0`（理论上只在 amount=0 时发生）→ 422 `amount_too_small`。
   - `rawBudget_i = amount × deficit_i / deficitSum`；向下取整；余数按小数部分从大到小分配，得到 `budget_i`，保证 `Σ budget_i = amount`，且 `budget_i <= deficit_i`。如果取整导致超过 `deficit_i`，把超出部分转给下一个有空间的分类。
6. **分类内分配**：
   - 分类 i 的未归档代码集合 `S_i`，排除 `price=0` 的代码；这些代码不参与买入。有价格且未归档的代码必须至少一个，否则 422 `sleeve_without_symbol`。
   - 当前分类市值 `value_i = Σ value_s`。
   - 如果 `value_i > 0`：代码 s 的预算 `raw_s = budget_i × value_s / value_i`；如果 `value_i = 0`：`raw_s = budget_i / |S_i|`。
   - 向下取整到微单位；余数按 ticker 升序、再按 symbolId 升序逐微单位分配。
   - 每份成本 `unit_s = floor(lot_size_s × price_s / 1,000,000)`；买入数量 `qty_s = floor(raw_s / unit_s) × lot_size_s`；金额 `amount_s = floor(qty_s × price_s / 1,000,000)`。
   - 如果 `amount_s < min_trade_micros`，丢弃该买入项。
7. **残值再分配**：`remaining = amount − Σ amount_s`。
   - 当 `remaining > 0` 时，按以下顺序找候选：
     - 计算每个分类当前缺口 `deficitNow_i = goal_i − (value_i + 已分配金额_i)`；
     - 只考虑 `deficitNow_i > 0` 的分类，按 `deficitNow_i` 从大到小、`sort_order` 升序；
     - 在每个分类内，只考虑一手成本 `unit_s <= remaining` 的代码，按 ticker 升序、再按 symbolId 升序；
     - 给第一个候选买一手（数量 += `lot_size_s`，金额 += `unit_s`，remaining −= `unit_s`）；
     - 重复，最多 10,000 次；达到上限时停止，并加警告 `residual_loop_limit`。
   - 如果没有任何候选，停止。
8. **过滤最小单笔**：再次删除 `amount_s < min_trade_micros` 的买入项；`remaining` 重新计算。
   - 如果没有任何买入项：422 `amount_too_small`，details 带 `minimumAmountMicros = max(所有可买代码的最低一手成本, min_trade_micros)`。
9. **计划金额**：`planned = Σ amount_s`；`cashLeft = amount − planned`。
10. **分类快照**：
    - `valueBefore_i` = 第 1 步的 `value_i`。
    - `valueAfter_i = valueBefore_i + Σ amount_s`（s 属于 i）。
    - `planned = Σ amount_s`；**买入后实际总市值是 `total + planned`，不是 `totalAfter`**。未投入的 `cashLeft` 不在任何分类里。
    - `driftBefore_i = round((valueBefore_i × 10000 / total) − target_bp_i)`，`total=0` 时 `driftBefore_i=-target_bp_i`。四舍五入，0.5 远离 0。
    - `driftAfter_i = round((valueAfter_i × 10000 / (total + planned)) − target_bp_i)`；`total + planned = 0` 时按 `-target_bp_i`。
    - `maxDriftBefore = max(abs(driftBefore_i))`；`maxDriftAfter = max(abs(driftAfter_i))`。
    - 当 `maxDriftAfter > maxDriftBefore` 时加警告 `drift_worsened`：整手限制可能让计划买不进最缺的分类，买入后偏离反而变大。
11. **警告**（按 code 字母序）：
    - `stale_price`：任一参与计算的 `price_as_of` 早于今天−30 天。message 带最早的日期。
    - `outside_band`：任一 `abs(driftBefore_i) > band_bp_i`。message 带分类名和偏离。
    - `residual_cash`：`cashLeft > 0`。message 带金额。
    - `symbol_without_price`：有未归档、当前持仓为 0、价格=0 的代码被跳过。message 带 ticker 列表。
    - `residual_loop_limit`：第 7 步达到 10,000 次上限。
    - `amount_below_min_trade`：有候选买入项因小于最小单笔被删除。
    - `drift_worsened`：`maxDriftAfter > maxDriftBefore`。
    - `value_overflow` 是错误，不是警告。
12. **inputsHash**：对下面这个 JSON 对象的 UTF-8 字节做 SHA-256，输出 64 位小写十六进制。对象键按字母序排列，数组顺序固定：
    ```json
    {
      "amountMicros": 0,
      "minTradeMicros": 0,
      "positions": [["symbolId", 0]],
      "prices": [["symbolId", 0, null]],
      "sleeves": [["sleeveId", 0, 0, 0]],
      "symbols": [["symbolId", "sleeveId", "ticker", 0]]
    }
    ```
    - `positions`：只含数量 >0 的代码，按 symbolId 升序；数量是整数微单位。
    - `prices`：含所有未归档代码，按 symbolId 升序；元组是 `[id, priceMicros, priceAsOf]`；没有价格日期时第三项写 JSON `null`，不是空字符串。
    - `sleeves`：含所有分类，按 sortOrder 升序、再按 id 升序；元组是 `[id, targetBp, bandBp, sortOrder]`。
    - `symbols`：含所有未归档代码，按 symbolId 升序；元组是 `[id, sleeveId, ticker, lotSizeMicros]`，**不含 archived 位**（未归档才进来）。
    - 因为 `symbols` 含所有未归档代码，新增一个无关代码也会改变哈希；这是有意的保守行为，见 4.8 的 stale 触发清单。
    - 规范化 JSON 使用 `JSON.stringify` 的紧凑格式，不排序对象键以外的空白。
13. 在一个事务里写 `plan`、`plan_item`、`plan_sleeve`。同一组合所有写操作串行；SQLite `BEGIN IMMEDIATE`。

### 5.5 执行计划

1. 读取计划；状态必须 `draft`。
2. 重新计算当前 `inputsHash`，与计划保存值不同 → 409 `plan_stale`。比较前不修改任何数据。
3. 校验 `accountId` 存在且未归档。
4. 在 `BEGIN IMMEDIATE` 事务里：
   - 再读一次计划状态，仍必须是 `draft`（防止并发）；
   - 重新计算 `inputsHash`；不同则回滚并 409；
   - 为每个 `plan_item` 插入 `transaction`：`source=plan`、`plan_id`、`side=buy`、价格和数量用计划快照、费用 0；
   - 更新计划 `status=executed`、`executed_at=now`；
   - 提交。
5. 返回计划和生成的交易。
6. 两个并发执行请求只有一个成功；另一个读到 `executed` 后返回 409 `plan_not_draft`。

### 5.6 备份与恢复

- 备份是单个 SQLite 文件；恢复到新目录：停止 Ballast，把备份文件命名为 `ballast.sqlite` 放进新的 `BALLAST_DATA_DIR`，启动。
- 备份包含全部业务数据；不包含任何密钥，因为项目不存密钥。
- 自动迁移备份只保留最近 `BALLAST_BACKUP_KEEP` 个；用户手动下载的备份不受此限制。

### 5.7 示例模式

- `BALLAST_DEMO=1` 且数据库为空：启动时写入示例数据，`demo=true`。
- 已有数据时不清空；只有显式 `POST /api/demo/reload` 才重建。
- 界面在侧栏底部显示一行“示例数据”，并提供一个“恢复示例数据”按钮；按钮需要二次确认。
- 非 demo 模式不显示“恢复示例数据”。

---

## 6. 风险与防护

| 风险 | 具体伤害 | 防护 | 对应测试 |
|---|---|---|---|
| 误删交易导致持仓被改坏 | 用户以为删的是备注，结果市值和计划都变 | 系统生成的交易禁止删除；删除前检查删除后持仓不为负；删除需要前端二次确认 | `transactions.test.js` 删除系统交易、删除后为负、正常删除 |
| 重复执行计划 | 同一笔钱被记两次，持仓虚增 | 执行在事务内重新检查 `status=draft`；二次执行 409 | `plans.test.js` 并发执行、顺序执行两次 |
| 计划过期后执行 | 价格或持仓已变，按旧价格记账 | 保存 `inputsHash`；执行前重新计算；不同则 409 `plan_stale` | `plans.test.js` 改价格、改持仓、改目标后执行 |
| 浮点误差 | 金额差 1 分，长期累积 | 全部整数微单位；BigInt 中间计算；最大余数法；`Number.isSafeInteger` 检查 | `money.test.js`、`plan-algorithm.test.js` 边界值 |
| 币种混用 | 把美元价格当人民币，计划金额错 | 组合币种不可改；代码币种固定等于组合币种；导入不接受币种列 | `symbols.test.js`、`imports.test.js` |
| 数据库损坏或迁移失败 | 数据打不开 | WAL、迁移事务、迁移前自动备份、备份失败不迁移 | `db.test.js` 迁移失败回滚、备份保留 |
| 浏览器被恶意网站跨站写/读 | 本地数据被改或被读走 | 只监听回环；Host 白名单；Origin 校验；JSON Content-Type；CSP；无 CORS；备份改 POST | `security.test.js` 错 Host、错 Origin、表单 Content-Type |
| 静态文件路径穿越 | 读取数据目录里的数据库 | `express.static` 固定根目录；SPA 回退只返回 `index.html`；不拼接用户路径 | `security.test.js` 路径穿越 |
| SQL 注入 | 数据泄露或删除 | 所有 SQL 用 prepared statement；动态排序只用白名单 | `security.test.js` ticker/note 注入样本 |
| CSV 公式注入 | 用户导出后在 Excel 打开触发公式 | 导出时对任何空白或控制字符后接 `= + - @` 的单元格加 `'` | `csv.test.js` 公式前缀 |
| 大输入拖垮进程 | 本地服务卡死 | JSON 2MB、CSV 1MB/5000 行、批量价格 200 项、金额上限 1e12、计划残值循环 10000 次 | `limits.test.js` |
| 价格过期 | 用几个月前的价格做计划 | 价格日期显示在界面；超过 30 天警告 `stale_price`；计划保存价格快照 | `plans.test.js` 过期警告 |
| 示例数据被误当真实数据 | 用户拿示例做决策 | 示例模式明确标识；非 demo 模式不自动出现；示例价格日期可见 | `demo.test.js` |
| 无模型但仍被误认为投资建议 | 用户把计划当推荐 | README、界面固定说明“只做算术，不判断该不该买”；不输出收益率预测 | 文档检查、README 审阅 |
| 远程暴露 | 局域网其他人读写数据 | host 只允许回环；Docker 端口映射 127.0.0.1 | `config.test.js` 非回环拒绝启动 |

---

## 7. Mock 与可测试性

- 运行时**不调用任何外部服务**：没有行情 API、没有大模型、没有遥测、没有字体 CDN、没有分析脚本。因此不需要网络 mock。
- 可注入项：
  - `createApp({ config, now, staticDir })` 里的 `now()` 返回毫秒时间戳；默认 `Date.now`。所有“今天”“30 天”“未来日期”判断都用它。
  - `staticDir` 默认 `web/dist`；测试可指向临时目录或不存在路径。
  - 示例数据播种函数接收 `now`，保证日期相对当前时间可复现。
- 测试全部在 `fs.mkdtempSync(os.tmpdir())` 的临时数据目录和随机端口上运行，不读写用户真实数据目录。
- 测试不启动 Vite，不访问外网；前端构建产物用 `npm run build` 单独验证。
- 测试等待用条件轮询（`waitFor`），超时 2 秒；不用固定 `sleep`。

---

## 8. 测试要求

每一节都要有 `node:test` 用例。所有用例在临时目录、mock 时钟下运行。至少覆盖：

### 8.1 配置与启动
- 缺省值正确；`BALLAST_PORT`、`BALLAST_BACKUP_KEEP` 非法值拒绝启动并退出 2。
- `BALLAST_HOST=0.0.0.0` 拒绝启动。
- 数据目录不存在时创建，权限 0700（POSIX）。
- 数据目录不可写时拒绝启动。
- 端口被占用时退出 1，错误信息含端口。
- `--help`、`--version`、未知参数、缺少参数值。
- 启动日志三行；`SIGTERM` 后退出 0。
- 数据库文件权限 0600（POSIX）。
- 首次启动建表；第二次启动不重复建表；迁移版本记录正确。
- 迁移失败时回滚，旧数据仍在，备份文件存在。

### 8.2 设置与状态
- 未设置时 `state.setupComplete=false`；业务接口 409 `setup_incomplete`。
- `POST /api/setup` 成功；三种模板目标总和 10000。
- 重复 setup 409；币种非法 400；名称空 400。
- `GET /api/state` 的 positions、totals、targets、lastPlan 字段逐项核对。
- 总市值为 0 时 targets 的 actual/drift 正确。
- 基础币种不可改。

### 8.3 账户、分类、代码
- 账户增删改查；重复名 409；最后一个未归档账户不能归档/删除；有交易不能删。
- 分类增删改查；新建/修改后总和不得超过 10000；`PUT /api/targets` 必须 10000；有代码不能删；最后一个不能删；12 个上限。
- `PUT /api/targets` 整体保存；少一个/多一个/总和不对都 400，原数据不变。
- 代码 ticker 规范化与校验；重复 409；币种固定；价格日期未来 400。
- 批量价格 200 项成功、201 项 400、任一项非法整体不写。
- 归档代码不参与买入但仍计入市值。

### 8.4 交易
- 买入、卖出、平均成本、市值、未实现盈亏。
- 卖出超过持仓 409，带可用数量。
- 数量×价格/1e6 超过 1e15 的成交被 400 拒绝。
- 未来日期、2000 年前日期、0 数量、负价格、超长 note 400。
- 归档账户/代码不可新增交易。
- 删除手动交易成功；删除后持仓为负 409；删除系统交易 409。
- 分页、按账户/代码过滤、排序。

### 8.5 CSV 导入导出
- 模板内容与 BOM。
- 合法文件导入；BOM、CRLF、带引号逗号、引号内 `""`、空行、0 费用、未加引号字段前后空格。
- 6 位小数边界；7 位小数报错；金额恰好为整数微单位。
- 未知账户、未知代码、归档账户、归档代码、非法方向、非法日期、卖超、同一文件内重复行，整体不写，details 行号是物理行号且表头算第 1 行。
- 0 数据行 400 `invalid_csv`；5001 行 400 `too_many_rows`；UTF-8 字节超过 1,000,000 400 `file_too_large`；JSON body 超过 4MB 413 `payload_too_large`。
- 重复内容 409；改一个字符后可导入。
- 导出交易 CSV：BOM、表头、引号、公式前缀；导出行数正确。
- 导出持仓 CSV：只含数量 >0；`quantity`、`avg_cost`、`price` 固定 6 位小数；金额按币种小数位。
- 导入记录列表。

### 8.6 计划算法
- SPEC 5.4 的示例：6000 总市值、1000 投入、60/30/10，逐项断言买入项和偏离。
- 无持仓、只有现金：按目标比例买入。
- 某分类超配：不给它买；不生成卖出项。
- 所有项金额之和 ≤ 投入；`cashLeft = amount - planned`。
- `lotSizeMicros=100,000,000`（100 份一手）时，买入数量必须是 100 份的整数倍。
- 整手：每个 `quantityMicros` 是该代码 `lotSizeMicros` 的整数倍；`amount = qty × price / 1e6` 向下取整。
- 最小单笔过滤后现金增加；全部被过滤时 422。
- 金额小于最低一份价格时 422，带最低金额。
- 持仓代码缺价格 422；未持仓代码缺价格只警告。
- 目标 >0 的分类没有代码 422。
- 超过 30 天价格警告；未超不警告。
- 偏离带警告。
- 相同输入重复生成：items 和 inputsHash 完全一致。
- 改变金额、价格、持仓、目标、归档状态，inputsHash 改变。
- 随机生成 200 组合法输入做属性测试，不出现负数量、负金额、卖出项；`planned + cashLeft = amount`；每个数量是手数的整数倍。
- 构造整手限制导致 `maxDriftAfter > maxDriftBefore` 的输入，断言出现 `drift_worsened` 警告，且 `driftAfter` 的分母是 `total + planned`。
- 总市值为 0 时 driftBefore = -targetBp。
- 1e12 金额上限、1e15 数量边界；`quantity×price/1e6 > 1e15` 时交易被 400 拒绝、计划返回 422 `value_overflow`，不出现 `Number.MAX_SAFE_INTEGER` 溢出。
- 残值循环上限触发警告（构造大量低价代码与残值）。

### 8.7 计划执行
- 执行成功：生成 N 条 `source=plan` 交易，持仓更新，计划 executed，执行时间写入。
- 未指定 accountId 400；账户归档 409。
- 执行两次第二次 409；不存在的计划 404；已放弃 409 `plan_not_draft`。
- 并发执行两个请求，一个 200 一个 409，只生成一组交易。
- 改价格后执行 409 `plan_stale`；改持仓后 409；改目标后 409；归档代码后 409。
- 放弃后执行 409；删除 draft 成功；删除 executed 409。
- 执行中数据库写入失败回滚（注入失败），计划仍 draft，交易 0 条。
- note 拼接与 200 字符上限。

### 8.8 备份、安全、限制
- 备份文件是合法 SQLite，包含已写入的数据；Content-Type 和文件名正确。
- 备份失败 500（注入失败）。
- 错误 Origin 403；缺 Content-Type 415；正确 Origin 200。
- 安全头存在；CSP 包含 `default-src 'self'`。
- `/api/../data/ballast.sqlite`、`/%2e%2e/` 不返回数据库内容。
- ticker/note 的 SQL 注入样本不改变数据。
- JSON 4MB 上限 413；CSV UTF-8 字节上限；批量价格上限；计划金额上限；检查顺序符合 2.4（Content-Type → body → JSON → 设置 → 存在 → 状态 → 字段 → 计算）。
- 静态文件：`web/dist` 存在时 `/` 返回 HTML；不存在时 503 `web_not_built`；未知前端路由返回 index.html；未知 API 返回 JSON 404。
- 构建产物不包含外部 http(s) 资源（`npm run check:offline`）。

### 8.9 示例与重启
- `BALLAST_DEMO=1` 空库播种；非空库不重复播种；`demo=true`。
- `POST /api/demo/reload` 清空并重建；非 demo 403；错误 confirm 400。
- 关闭服务再启动，数据、计划、交易、设置都保留。
- 计划执行后重启，计划仍 executed，不能再次执行。
- 导入记录和 hash 重启后仍能阻止重复导入。

### 8.10 前端与设计
- `npm run build` 成功。
- `npm run check:design`：页面 CSS 不出现 token 文件以外的十六进制颜色、`rgb()`、`hsl()`、硬编码 `font-size: <number>px`、`border-radius: <number>px`、`box-shadow` 字面量；`--fs-32`、`--focus-ring` 存在；375px 不横向滚动。
- `npm run check:offline`：`web/dist` 不出现外部 http(s) 链接。
- 375px 下页面不出现横向滚动（Playwright 检查 `document.documentElement.scrollWidth <= 375`）。
- 浅色、深色、375px 三套截图存在，且来自真实构建和示例数据。
- 每个页面都能打开；控制台无错误。
- 时延预算：在示例数据、本机、构建产物下，`/api/state` 和首屏渲染各 ≤300ms，`POST /api/plans` ≤100ms；用 `node --test` 外的 `scripts/perf-check.js` 记录 5 次中位数，写入 `notes/验收记录.md`。

### 8.11 连续运行
- `npm test` 连续运行 3 次全部通过，不能跳过用例。
- 不允许 `test.skip`、`describe.skip`、`it.skip`。

---

## 9. 验收标准

0.1.0 完成必须同时满足：

1. 本文件第 4 节每个接口、第 5 节每个流程、第 8 节每条测试要求都有实现和测试；偏离记在 `docs/deviations.md`。
2. `npm test` 在 mock 时钟、临时目录下连续 3 次通过，0 跳过。
3. 从零安装：新目录克隆本地仓库，按 README 执行 `docker compose up -d --build` 或 `npm ci && npm run build && npm start`，5 分钟内看到总览页；全过程记进 `notes/安装实录.md`。
4. 用示例数据完整走固定任务清单 10 次，每次记录通过/失败：
   - 启动 → 打开总览 → 新增代码 → 新增买入 → 改价格 → 生成计划 → 执行计划 → 查看持仓和计划历史；
   - 5 类异常各至少 1 次：价格缺失（422）、金额过小（422）、重复执行（409）、错误 Origin（403）、CSV 行错误（400）。
   - 10 次中 ≥9 次无需查文档即可完成；失败点修掉或记入 `docs/deviations.md`。
5. 浅色、深色、375px 截图各页齐全，符合 `DESIGN.md`。
6. 正确性、安全与数据、新用户体验三个角度的独立审查，按下面级别记录：严重=数据错误/安全漏洞/核心流程不可用；中=需要绕过或困惑；低=文案/样式。严重和中必须 0 未处理，低可以记入 `docs/deviations.md`。
7. README 中的功能、截图、数字都能用当前代码复现；`grep -n "TODO\|即将推出\|placeholder"` 不命中正文；无虚假远程地址。
8. 本地提交完成，`v0.1.0` 标签存在，无远程仓库、无推送。

---

## 10. 术语

| 概念 | 统一用词 | 不要用 |
|---|---|---|
| 一组目标比例 | 目标比例 / 分类目标 | 资产配置方案、策略 |
| `sleeve` | 分类 | 桶、资产类别（除非指具体分类名） |
| 新投入的钱 | 投入金额 / 本次投入 | 新钱、增量资金 |
| 计划中的买入行 | 买入项 | 订单、交易建议 |
| 已生成但未执行 | 草稿 | 待确认、临时计划 |
| 执行后的计划 | 已执行 | 已完成、已下单 |
| 偏离目标 | 偏离 | 漂移、误差 |
| 基点 | bp | 百分点（除非换算说明） |
| 价格日期 | 价格日期 | 估值日、行情时间 |

# 开发

## 环境

- Node.js >= 22.13.0（使用 `node:sqlite`；本项目在 Node 25 上开发，CI 用 Node 24）。
- npm；仓库根目录有 lockfile。
- 可选：Docker 24+。

## 安装与运行

```bash
npm ci
npm run build
npm start
# 打开 http://127.0.0.1:8787
```

前端开发：

```bash
npm run dev            # 后端 :8787
npm run dev --workspace web  # Vite :5173，/api 代理到 8787
```

## 目录

- `server/src/index.js`：CLI、配置、启动/关闭。
- `server/src/app.js`：Express 路由、校验、安全中间件。
- `server/src/db/`：SQLite 打开、迁移、备份。
- `server/src/domain/`：金额、计划算法、CSV、示例数据。
- `server/src/repo.js`：查询与 DTO。
- `web/src/`：React 页面、组件、token 与 CSS。
- `server/test/`：`node:test`，临时目录 + 固定时钟，不联网。

## 约定

- 钱是整数微单位（1e6），比例是基点（10000=100%），中间计算用 `BigInt`。
- 日期统一 UTC，API 只收 `YYYY-MM-DD`。
- 计划算法改动必须同时改 `SPEC.md` 5.4、`docs/features.md` 和测试。
- 不提交 `data/`、`web/dist/`、`.env`、`reference/`。

## 检查

```bash
npm test               # 全部测试
npm run test:repeat    # 连续 3 次
npm run build
npm run check          # check:design + check:offline
npm run screenshots    # 需要本机 Chrome；生成 assets/screenshots
```

## 数据库

`BALLAST_DATA_DIR` 下是 `ballast.sqlite`、WAL/SHM 和 `backups/`。迁移版本在 `schema_migrations`。手动恢复：停止服务，把备份改名为 `ballast.sqlite` 放入新目录，启动。

## 设计

`DESIGN.md` 是 UI 合同。CSS 只引用 `web/src/styles/tokens.css` 的变量；`npm run check:design` 检查五类字面量。

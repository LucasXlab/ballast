# 已核实的外部接口

核实日期：2026-10-29。

## 结论

**Ballast 0.1.0 在运行时调用 0 个外部接口。**

没有行情 API、券商 API、大模型 API、支付 API、邮件 API、遥测、字体 CDN、分析脚本。所有计算在本机完成，所有数据写在本机 SQLite 文件里。页面 CSP 的 `connect-src 'self'`、`font-src 'self'` 和 `img-src 'self' data:` 从浏览器侧再次限制外联；`npm run check:offline` 会扫描构建产物中的外部 `http://` / `https://` 引用。

因此本文件不需要记录请求地址、鉴权方式、字段和错误格式。下面记录运行环境依赖的官方文档和实际验证结果。

## 1. Node.js 内置 SQLite

- 文档：https://nodejs.org/api/sqlite.html
- API：`const { DatabaseSync } = require('node:sqlite')` / `import { DatabaseSync } from 'node:sqlite'`；`new DatabaseSync(path)`；`db.exec(sql)`；`db.prepare(sql).all()/get()/run()`；`db.close()`。
- 最低版本：Node.js 22.13.0（`node:sqlite` 在该版本可用）。本项目开发和验收使用 Node 24 LTS；Docker 使用 `node:24-bookworm-slim`。
- 认证：无，本地文件。
- 错误格式：抛出 `Error`，带 `code`（如 `ERR_SQLITE_ERROR`）和 `errcode`；不返回 HTTP 响应。
- 实测：2026-10-29，Node v25.6.1，执行 `new DatabaseSync(':memory:')`、`CREATE TABLE`、`INSERT`、`SELECT`、`PRAGMA journal_mode=WAL`，全部成功；加载时输出 `ExperimentalWarning: SQLite is an experimental feature`。启动脚本和测试脚本使用 `--disable-warning=ExperimentalWarning` 抑制这一行，不隐藏其他警告。
- 使用约束：不依赖 `node:sqlite` 的实验性扩展 API；只用 `DatabaseSync`、`exec`、`prepare`、`all`、`get`、`run`、`close`。

## 2. Express 5

- 文档：https://expressjs.com/en/5x/api.html
- 版本：`express@5.3.0`（2026-10-29 通过 `npm view express version` 核对）。
- 用途：HTTP 路由、`express.json()`、`express.static()`、错误处理中间件。
- 认证：无。
- 错误格式：本项目统一在错误中间件输出 `{error, code, details?}`，不把 Express 默认 HTML 错误页暴露给客户端。
- 实测：2026-10-29 在本机 Node v25.6.1 下启动、路由、静态文件、JSON 解析、404 回退均通过测试。
- 注意：Express 5 的 `req.query` 默认解析器、路由通配符语法与 4.x 不同；本项目只用字面量路由和 `app.use` 回退，不使用 `*` 通配符。

## 3. React 19 与 Vite 8（仅构建期）

- React 文档：https://react.dev/
- Vite 文档：https://vite.dev/
- 版本：`react@19.3.1`、`react-dom@19.3.1`、`vite@8.3.5`、`@vitejs/plugin-react@6.1.2`（2026-10-29 通过 `npm view` 核对）。
- 运行时：浏览器只加载本服务提供的 `/assets/*` 静态文件；不访问 React/Vite 官方 CDN，不加载 source map 以外的远程资源。
- 错误格式：构建失败直接退出非 0，CI 视为失败。

## 4. Docker

- 文档：https://docs.docker.com/compose/
- 镜像：`node:24-bookworm-slim`（Docker Hub 官方镜像）。
- 用途：构建前端、安装生产依赖、以非 root 用户运行。
- 网络：容器只监听 `0.0.0.0:8787`，宿主机映射为 `127.0.0.1:8787:8787`；容器不发起外部请求。
- 实测：见 `notes/安装实录.md`（从零构建并启动，记录命令和输出）。

## 5. 开发期外部依赖（不进入运行时）

- npm registry：安装 `express`、`react`、`vite` 等包。CI 用 `npm ci` 锁定版本；不执行安装脚本以外的远程代码。
- GitHub Actions：`actions/checkout`、`actions/setup-node`、`actions/upload-artifact`。只在 CI 中运行，Ballast 运行时不知道 GitHub 的存在。
- 没有 Docker 镜像推送、没有包发布、没有远程仓库创建。发布动作由维护者手动完成。

## 6. 未使用但需要说明的接口

- 没有 LLM。若未来加入，必须同时支持用户自带 key 和本地 mock，并按本文件的格式记录请求地址、鉴权、字段、错误和实测结果；0.1.0 不预留半成品接口。
- 没有行情源。价格由用户手工填写，价格日期随价格保存，过期只警告，不自动更新。

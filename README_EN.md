<p align="center"><img src="assets/logo.svg" width="72" height="72" alt="Ballast logo"></p>

<h1 align="center">Ballast</h1>

<p align="center">A local-first planner for new cash: what to buy, in whole lots, without selling.</p>

<p align="center">
  <img src="assets/badges/node.svg" alt="Node.js >=22.13">
  <img src="assets/badges/license.svg" alt="License MIT">
  <img src="assets/badges/tests.svg" alt="36 tests passing">
</p>

<p align="center">English · <a href="README.md">中文</a></p>

![Ballast overview](assets/screenshots/overview-light.png)

Ballast is a **contribution rebalancing** tool that runs on your machine. Tell it how much new cash you have, your current holdings and your target weights; it returns a buy-only, whole-lot plan. Execute it into one account and Ballast records the trades and keeps the plan history.

No market data, no broker connection, no auto-trading, no sell advice, no accounts, no telemetry, no external APIs. Everything lives in a local SQLite file.

## Good fit / not a fit

**Good fit**

- You add cash monthly or quarterly and invest in ETFs or stocks.
- You track holdings yourself and are willing to update prices manually.
- You want buy-only rebalancing to avoid taxable sales and emotional trading.
- You care about local data and auditable code.

**Not a fit**

- Automatic broker sync, live quotes or auto-trading.
- Sell advice, tax lots, return attribution or multi-currency.
- Multi-user, login, cloud sync or a mobile app.
- “Smart” recommendations; Ballast does arithmetic, not investment advice.

## Known limits

- Whole lots only; uninvestable cash stays in cash and max drift may increase (a `drift_worsened` warning is shown).
- Prices are manual; stale prices only trigger a warning.
- CSV imports cannot be undone; restore a backup or add a reversing manual trade.
- Dates are UTC, not browser-local.
- 0.1.0 has no sell advice, tax, multi-currency or login.

## Features

- Portfolio, accounts, target weights and tolerance bands
- Symbols, lot sizes, prices and price dates
- Manual buys/sells, positions, average cost, unrealized P/L
- CSV template, import, transaction and position export
- Buy-only `greedy-v1` plans, execution and plan history
- Stale-plan protection, idempotent execution, warnings, residual cash
- Backup download, demo mode, light/dark, 375px

See [docs/features.md](docs/features.md) (Chinese).

## Quick start

Requirements: Node.js >= 22.13.0.

```bash
npm ci
npm run build
npm start
# open http://127.0.0.1:8787
```

Docker:

```bash
docker compose up -d --build
```

On first launch, choose the three-sleeve template, then add a symbol and a buy on the Holdings page. Try the demo with `BALLAST_DEMO=1 npm start`.

## Commands

```bash
npm start
npm run dev
npm run build
npm test
npm run test:repeat
npm run check
npm run screenshots
```

CLI: `ballast [--port <n>] [--data-dir <path>] [--help] [--version]`.

## Upgrade and backup

- Upgrade: pull, `npm ci && npm run build`, restart. Migrations run automatically with a pre-migration backup in `data/backups/`.
- Backup: Settings → Download backup (one SQLite file).
- Restore: stop, rename the backup to `ballast.sqlite` inside a fresh `BALLAST_DATA_DIR`, start.
- Docker details: [docs/deploy.md](docs/deploy.md).

## Docs

[Features](docs/features.md) · [Development](docs/development.md) · [Deploy](docs/deploy.md) · [External dependencies](docs/external-apis.md) · [Deviations](docs/deviations.md) · [Spec](SPEC.md) · [Changelog](CHANGELOG.md). Most docs are in Chinese.

## License

MIT. See [LICENSE](LICENSE).

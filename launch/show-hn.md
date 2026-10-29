# Show HN 草稿（不要自动发布）

**Title:** Show HN: Ballast – buy-only rebalancing for new cash, local-first

**Body:**

I add cash to a long-term ETF portfolio every month. Most rebalancing tools assume you sell, or they want broker access and cloud sync. I wanted a small tool that answers one question: “I have this much new cash, I won't sell, what do I buy in whole lots?”

Ballast is that. It runs locally (Node + SQLite + React), stores integer micro-units and basis points, and has a deterministic `greedy-v1` planner. It shows the target/actual drift before and after, residual cash, and any warnings. Plans are hashed against prices/positions/targets, so executing a stale plan is rejected.

No market data, no broker connection, no auto-trading, no sell advice, no accounts, no telemetry. MIT. Demo mode included.

Limits: whole lots can leave cash and occasionally increase max drift; prices are manual; CSV import isn't undoable; dates are UTC. It's 0.1.0 and deliberately narrow.

Repo: <local placeholder — fill after publishing>

# Reddit 草稿（不要自动发布）

Subreddit suggestion: r/Bogleheads or r/personalfinance (check each community's self-promotion rules first).

**Title:** I built a local-first, buy-only rebalancing planner for monthly contributions

**Body:**

Every month I have new cash and don't want to sell. I couldn't find a small tool that just says “buy X lots of A, Y lots of B” while respecting target weights and whole lots, so I built one.

Ballast runs on your machine: Node + SQLite + React, no broker connection, no quotes, no account. You enter holdings/prices/targets, give it the amount, and it produces a buy-only plan with before/after drift, residual cash, and warnings. Execution writes transactions and keeps plan history; stale plans are rejected.

It's intentionally narrow: no sell advice, no tax lots, no multi-currency, no returns. MIT, 0.1.0. I'd especially value feedback on the plan algorithm's whole-lot behavior and the first-run flow.

Repo: <local placeholder — fill after publishing>

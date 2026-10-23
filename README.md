[English](./README.md) | [中文](./README.zh-CN.md)

<p align="center">
  <img src="./docs/assets/brand/mark.svg" width="56" height="56" alt="MacroBay mark">
</p>

<h1 align="center">MacroBay</h1>

<p align="center">
  <strong>Crypto market intelligence with receipts.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f766e?style=flat-square"></a>
  <a href="./docs/reference/status-and-limitations.md"><img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-d97706?style=flat-square"></a>
  <a href="https://github.com/shawn-tangsc/MacroBay/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/shawn-tangsc/MacroBay/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-111111?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#whats-on-the-desk">What's on the desk</a> ·
  <a href="#why-crypto-first">Why crypto</a> ·
  <a href="#data-sources">Data sources</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="./LICENSE">License</a>
</p>

<p align="center">
  <sub>Local-first. No bundled market data, no bundled API keys, no hosted account. Not affiliated with any venue or data provider.</sub>
</p>

---

MacroBay is a desktop intelligence desk for crypto. One screen holds what actually moves the market —
perpetual funding and positioning, stablecoin supply and ETF flows, risk appetite, cross-asset moves,
and the macro prints that reprice everything. The analyst agent reads the same evidence and explains
what changed, with the source and the cutoff time attached to every number.

A claim that cannot be traced to a source record and a timestamp is supposed to be reported as a gap.
That is the whole product: **not a paragraph you have to take on faith.**

<p align="center">
  <a href="./docs/assets/screenshots/demo-en.gif">
    <img src="./docs/assets/screenshots/demo-en-poster.png" alt="MacroBay crypto intelligence dashboard, analysis, and analyst agent" width="100%">
  </a>
</p>

<p align="center">
  <sub>Dashboard, evidence, analyst agent, calendar, and model settings. Click the image to play the 38-second demo.</sub>
</p>

Built for people whose read has to survive a follow-up question.

## Why crypto first

Crypto is the hardest place to fake a market read, which makes it the right place to build one.

- **The market never closes.** Funding flips at 00:00 UTC, a listing lands at 3am, CPI prints
  mid-session. There is no closing bell that consolidates the story, so the timestamp and the source
  *are* the analysis.
- **The signal is scattered.** Exchange announcements and API changes, status incidents, stablecoin
  supply, ETF flows, funding, sentiment, macro releases — no single feed tells you what changed.
- **Revisions are quiet.** A number you read yesterday may be restated today. A tool that overwrites
  the old reading removes the only way to learn from being wrong.

So the desk is built around three habits: read the whole picture on one screen, keep the observation
time on every reading, and make the AI show its work.

## What's on the desk

- **Funding and positioning.** BTC and ETH perpetual funding, who pays whom, and the history behind
  today's print instead of a single number.
- **Capital and flows.** Stablecoin supply and ETF net flows — the liquidity that has to be
  somewhere.
- **Risk appetite.** The Fear & Greed index read as evidence, with its observation time and bucket,
  not as a verdict.
- **Cross-asset, one scale.** DXY, gold, QQQ, US10Y, BTC and ETH normalized on a single chart.
- **A calendar that does not rewrite history.** Scheduled, observed, and later-revised values are
  separate records — FOMC, CPI, PCE and payrolls with their official release values.
- **Venue and chain events.** Binance and OKX announcements and API changes, plus Coinbase, Kraken
  and Solana status.
- **An analyst with a visible trace.** It reads the same evidence, separates facts from assumptions,
  asks a structured question when a choice changes the answer, and shows the tools it ran.

## How a complete answer looks

Every analysis separates five things, or it is incomplete:

| Element | What it means |
| --- | --- |
| **Facts** | Observed values, each tied to a source record |
| **Assumptions** | What the interpretation takes for granted |
| **Conditions** | What would invalidate the conclusion |
| **Gaps** | What the available evidence does not answer |
| **Time boundary** | The observation time, and the `asOf` cutoff the query used |

A later revision is not folded back into an earlier answer. Reading the market at 09:00 and reading
it at 21:00 should produce two different, defensible answers — not one answer silently rewritten.

## What it is not

- **Not a signal service.** No buy or sell calls, no return promises, no "alpha" for sale.
- **Not a trading bot.** No order execution, no position management, no brokerage connection.
- **Not a hosted account.** No MacroBay server holds your data or your keys; there is nothing to sign
  up for and nothing to cancel.
- **Not a data bundle.** No bundled feeds and no bundled credentials — you enable the sources you
  have access to.

## Data sources

30+ curated sources, chosen because crypto is where free and low-cost data is actually good enough:
exchange announcements and API changes (Binance, OKX), venue, chain status and release feeds
(Coinbase, Kraken, Solana, GitHub releases), market data (Binance spot and futures, CoinGecko,
DeFiLlama stablecoins and TVL, ETF flows, Fear & Greed), news and calendars (CoinDesk, CryptoPanic,
CoinMarketCal, Ethereum Foundation), and the macro layer that sets the regime (FRED, BLS, BEA,
Treasury, SEC, CFTC, Federal Reserve).

Some sources need your own account, key, or network access, and coverage varies by source. Anything
you have not enabled appears as an explicit gap — never as a neutral placeholder value.

## Quick start

Requires **Node.js 22+** and **pnpm 10**. The current release runs from source; there is no packaged
installer yet.

```bash
pnpm install
pnpm dev
```

Full walkthrough: **[Quick start](./docs/getting-started/quick-start.md)**.

1. **Settings → Model Service**: add a provider and API key, enable it, and choose the default model
   for agents.
2. **Settings → Intelligence Sources**: enable the sources you have access to and add any required
   credentials.
3. Open the **intelligence portal** → **Crypto Market Analyst** → **Open dashboard**.
4. Ask the analyst: *What changed in the last macro release, and which assets does it affect?*

The answer should show what is known, what is missing, where the evidence came from, and the time
boundary it used.

## Status

MacroBay is **alpha** (`0.1.0`). macOS is the verified platform; Windows and Linux are expected to
run but have not been validated. There is no demo dataset or installer yet — the dashboard needs
real provider credentials. See [Status and limitations](./docs/reference/status-and-limitations.md).

## Roadmap

Crypto depth comes first: more venues and derivatives coverage, ETF and flow history, on-chain
signals, and event-driven alerts. Review and replay make a decision inspectable after the fact.
The runtime stays model- and agent-replaceable so the desk can deepen without becoming a monolith.
See [ROADMAP.md](./ROADMAP.md).

## Documentation

| Start | Understand the product | Build on it |
| --- | --- | --- |
| [Quick start](./docs/getting-started/quick-start.md) | [Product overview](./docs/product/overview.md) | [Architecture](./docs/platform/architecture.md) |
| [Installation](./docs/getting-started/installation.md) | [Analysis workflow](./docs/product/analysis-workflow.md) | [Development setup](./docs/development/setup.md) |
| [First run](./docs/getting-started/first-run.md) | [Traceability](./docs/product/traceability.md) | [Adding a product](./docs/development/adding-a-product.md) |
| [Model service](./docs/getting-started/model-service.md) | [Analyst agent](./docs/product/analyst-agent.md) | [Platform and products](./docs/platform/platform-and-products.md) |
| [Status and limitations](./docs/reference/status-and-limitations.md) | — | — |

Chinese documentation: [docs/README.zh-CN.md](./docs/README.zh-CN.md)

## Data and privacy

MacroBay is a client for providers you configure. The MIT license covers the code, not the data.
There is no MacroBay-hosted data service, no resale, and no proxy: your data stays on your machine
and credentials stay in the local secret store. You are responsible for provider terms, keys, rate
limits, and any commercial use.

[Data and third-party services](./docs/reference/data-disclaimer.md)

## Feedback

Bug reports, data-source requests, and feature ideas are welcome — open an issue. Early feedback
shapes the roadmap directly: what gets added, and what gets dropped.

## Contributing

- [Contributing guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)

Electron 41 · React 19 · TypeScript 5.8 · pnpm 10. Local AI development notes may live in
`AGENTS.md`; that file is not part of the public repository.

## License

[MIT](./LICENSE) © 2026 MacroBay contributors

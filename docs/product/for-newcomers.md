[English](./for-newcomers.md) | [中文](./for-newcomers.zh-CN.md)

# For people still learning the market

You have read the threads. You know the words — funding, liquidity, ETF flows — and you still cannot
say, out loud, why price moved yesterday. That is usually not a knowledge gap. It is a structure gap:
most explanations hand you a conclusion and skip the machinery.

MacroBay shows the machinery.

![The dashboard: numbers with a plain-language note, and an AI conclusion with its conditions](../assets/screenshots/dashboard-window-en.png)

## What "understanding" looks like here

Instead of a verdict, you get a chain:

1. **the reading** — funding is negative;
2. **what it means** — leveraged longs are paying to stay in;
3. **what it implies** — crowding is unwinding, but only while the rate stays negative;
4. **what would break it** — funding flips positive while price holds.

Read a few of those and you start predicting what the next panel should say. That is the moment the
market stops being a set of magic numbers.

## Five things it will drill into you

| Signal | What it actually tells you |
| --- | --- |
| Perpetual funding | The price of leverage. Positive means longs pay shorts — crowded. |
| Stablecoin supply | Dry powder. Supply shrinking means liquidity is leaving, not just rotating. |
| ETF flows | Whether traditional money is adding or leaving, independent of crypto-native flows. |
| The dollar (DXY) | Global risk appetite. A rising dollar is usually a headwind for crypto. |
| Macro prints | The discount rate for every risk asset, crypto included. |

Each of those sits on the dashboard with a one-line explanation next to the number, so you are not
googling a term in the middle of reading the market.

## A first week that actually works

- **Day 1** — Open the dashboard. Read the AI conclusion, then click one number and look at its source
  and observation time. That is the habit the whole product is built around.
- **Day 2** — Ask the agent: *what would invalidate this conclusion?* Read the conditions, not the
  verdict.
- **Day 3** — Pick one panel, funding or stablecoins, and check it three days in a row. Notice the days
  it disagrees with price.
- **Day 4** — Ask a question you think you already know. See whether the answer cites a source, or
  hedges because the evidence is missing.
- **Day 5** — Open the macro calendar, pick one release, read the actual versus the prior, then look at
  how the market reacted.

By the end of the week you have a map of the plumbing instead of twenty indicators.

## What it will not do

- **It will not tell you what to buy.** It gives you the reasoning, not a signal, and none of it is
  investment advice.
- **It will not flatter you.** When data is missing, the panel says so instead of showing a zero. Empty
  means "not connected", not "neutral".
- **It is not a course.** There is no curriculum; you learn by reading real conclusions about real
  markets.
- **It asks for setup.** You bring a model API key and choose data sources, because it runs locally and
  keeps your data on your machine. It is not a one-click website.

## If you get stuck

Start with [Crypto Market Analyst](./crypto-market-analyst.md) — it walks through the setup step by
step, including the parts that need a key or a local proxy. Then read
[Analysis workflow](./analysis-workflow.md) to see what a complete answer contains.

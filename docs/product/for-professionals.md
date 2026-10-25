[English](./for-professionals.md) | [中文](./for-professionals.zh-CN.md)

# For people who do this for a living

You already have a framework. You know what funding, stablecoin supply and the dollar do to a crypto
book. What you do not have is a place where the four things you check every morning sit next to each
other, and where the answer can survive someone asking *"how do you know?"*.

MacroBay is built for that second problem.

![The dashboard and the analyst agent working on the same evidence](../assets/screenshots/demo-en-poster.png)

## The problem it actually solves

Most of the cost of a market read is not the reading. It is:

- **reassembly** — price on one screen, funding on another, the calendar in a tab, liquidity in a
  spreadsheet, and the story in your head;
- **defence** — someone asks where a number came from, and you have to reconstruct it from screenshots;
- **hindsight** — you want to check an old call, but the tool shows today's revised values and quietly
  rewrites what you knew then.

MacroBay collapses those three into the same artifact: a conclusion with its evidence attached.

## What you get that a charting tool does not give you

**1. Every claim carries a time boundary.**
Each analysis states its observation time and the `asOf` cutoff the query used. A later revision is not
folded back into an earlier answer. Reading the market at 09:00 and at 21:00 produces two different,
defensible answers rather than one silently updated one.

**2. Facts, assumptions, conditions and gaps are separated — by construction.**
Not as a writing style, but as the output contract. If a piece of the picture is missing, the analysis
says which piece; it does not substitute a neutral value. That is what makes it usable in a review,
a memo, or a position discussion.

**3. Coverage gaps are visible.**
Source health is part of the output. When nothing happened, you can tell whether that is "no news" or
"no coverage" — the difference between a quiet market and a blind spot.

**4. One screen, already normalised.**
Funding and positioning, stablecoin supply and ETF flows, risk appetite, DXY / gold / QQQ / US10Y next
to BTC and ETH on one scale, and the macro prints that reprice all of it.

**5. You own the stack.**
Local-first, MIT, your own keys and your own model provider. The source registry is data-driven and
extensible, so a missing feed is a configuration task, not a fork.

## How it fits an existing workflow

| You are doing | Use it for |
| --- | --- |
| Morning prep | One pass over funding, flows, sentiment and the calendar instead of five tabs |
| A written call | Publish the conclusion with its evidence refs, conditions and gaps |
| A challenge in review | Open the reading, show source and observation time, close the question |
| A post-mortem | Re-read the answer at its `asOf` instead of today's revised values |
| Model or data evaluation | Swap the provider, keep the analysis contract |

## What it does not do

- It does not execute, size, or manage positions, and it has no brokerage connection.
- It is not a replacement for an institutional terminal: coverage is a curated set of free and
  low-cost sources, not a full market-data licence.
- It does not tell you what to buy. It makes your reasoning checkable.
- It is alpha. APIs and schemas are not yet stable, and some sources are still marked pending.

## Getting to a useful setup

1. Add your model provider and pick an agent-compatible model.
2. Enable the sources you already pay for, or the ones you can reach; gaps stay visible.
3. Open the dashboard, ask one question you already know the answer to, and check whether the answer
   cites the right evidence. That is the fastest way to calibrate trust.

[Quick start](../getting-started/quick-start.md) ·
[Crypto Market Analyst](./crypto-market-analyst.md) ·
[Analysis workflow](./analysis-workflow.md) ·
[Traceability](./traceability.md)

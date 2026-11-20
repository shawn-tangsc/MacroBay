[English](./overview.md) | [中文](./overview.zh-CN.md)

# Product overview

MacroBay answers a simple question: **what changed, and how do you know?**

You open one desktop workspace instead of switching between a news feed, a chart, a macro calendar,
and a chat window. The dashboard shows the current picture; the analyst agent explains it; the
evidence view lets you check the number.

## What you see when you open the app

### Daily briefing

The daily briefing reads the same local evidence as the dashboard and puts one day on one page: what
the market is pricing, what changed overnight, and what to watch next. A reading that could not be
fetched is reported as a gap rather than dropped, so a missing figure says it was not collected —
not that nothing happened.

Each edition keeps its source references and the cutoff time it was read at. You can regenerate it,
export it as an image, and look back at earlier editions; the generation time is a setting.

### Dashboard

The dashboard is not here to replace your charting software: it draws no intraday tape and gives no
levels. It watches for changes that would move a call, uses AI to say what each change means, and sends
a notification through the channels you enabled for anything you should not miss — Telegram, Slack,
Discord, QQ or Lark, several at once if you want. The built-in sources are free or cheap, so the
expensive institutional data subscriptions stay optional.

The dashboard groups the market picture into panels:

- macro context;
- cross-asset observations;
- capital conditions;
- the latest published analysis;
- [news sentiment](./news-sentiment.md) — directional judgments for recent text events.

Each panel is backed by the same evidence records the agent uses. A number on the dashboard can be
traced to its source instead of ending at a chart label.

![Dashboard: the full page from the AI conclusion down to funding](../assets/screenshots/dashboard-full-en.png)

### Macro calendar

The calendar no longer takes a page of its own: it is a drawer opened from the calendar icon on the
dashboard, titled **Key indicators · expectations**. The upper half is the policy path and three core
indicators — the implied odds of a rate move at the next meeting, and the expected CPI YoY, payrolls and
core PCE YoY — each card carrying its next release date and how many days away it is. Below that is the
release calendar for the current month, with published, scheduled and today kept apart, a jump back to
this month, and a way into the configuration. The right column holds what to watch and the events of the
day, split into the standard table, items not in it, tier-two indicators, high-importance events and the
rest; the footer names where the schedule and consensus values come from.

Behind the calendar are 841 economic indicator codes (195 of them U.S.) and 524 collected release
events; the 48 that are not yet mapped into the standard table are listed as such instead of being
passed off as aligned.

The calendar keeps the schedule identity, the observation boundary, and later revisions separate, so an
updated official value does not rewrite what was known earlier.

### Analyst agent

The agent works on the selected market or event. It can read the evidence, explain a change, ask a
structured question when a choice matters, and show the tools it used.

## Three concrete use cases

### 1. “What changed this week?”

Open the dashboard, select a market, and ask:

> What changed in the last macro releases, and which assets are most exposed?

A useful answer names the releases, the direction of the change, the affected assets, and the gaps.

### 2. “Why is this number different from yesterday?”

Open the evidence behind a panel and compare the observation time and the cutoff time the query used. If the
source revised the value, the two readings should be distinguishable rather than silently merged.

### 3. “What would change your conclusion?”

Ask the agent for the conditions that would invalidate its view. A good answer describes scenarios
and triggers, not a price prediction.

## What a complete answer contains

- **Facts** with a source reference.
- **Assumptions** the interpretation depends on.
- **Conditions** that would change the conclusion.
- **Gaps** where the evidence is missing.
- **Time boundary** — the observation time and the `asOf` used by the query.

If any of these are missing, the answer is incomplete.

## What it answers, and what it does not

| It is built to answer | It will not answer |
| --- | --- |
| What changed in the last macro release, and which assets does it touch? | Should I buy now? |
| Which readings does this conclusion rest on? | Where is the support level? |
| What would invalidate this interpretation? | What is the price target? |
| What was known at a given time? | What is the chip distribution? |

If your question is about entry timing, levels, chip distribution or order flow, this is the wrong
tool — it does not read charts, and it does not pretend to.

## What the product does not do

- It does not execute trades or manage positions.
- It does not provide unconditional investment advice.
- It does not bundle market data or provider credentials.
- It does not invent a source when evidence is missing.

## Next

- [Analysis workflow](./analysis-workflow.md)
- [Traceability](./traceability.md)
- [Analyst agent](./analyst-agent.md)

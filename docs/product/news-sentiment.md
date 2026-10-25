[English](./news-sentiment.md) | [中文](./news-sentiment.zh-CN.md)

# News sentiment

The **Key sentiment** card in the dashboard's right column answers one question: **does this piece of news lean bullish, bearish, or have no clear direction for crypto markets?**

It handles text events only — regulatory filings, exchange announcements, industry news — and does not repeat the economic calendar, funding, stablecoin or market panels.

## What you see

Each item carries:

```text
source + published time + headline
direction: bullish / bearish / neutral / mixed
strength: 1–5 (weak / medium / strong)
confidence: 0–100%
an evidence quote
```

- **Direction** is the item's likely price impact, not the author's mood.
- **Strength** is how strong that directional impact is; neutral items are usually low strength.
- **Confidence** is how sure the model is about this judgment.
- **Neutral** means no clear direction, not “irrelevant”.

The model is the primary engine and rules are the fallback. When rules are used, the UI says so instead of presenting an unjudged item as neutral.

## What does not appear

Routine notices — maintenance windows, API or system upgrades, read-only periods, trading-hours changes — are neutral, low-strength operational messages, not price signals. They are kept out of Key sentiment; the raw intelligence stream and the source still hold them.

## Card and drawer

The card shows **eight items** by default, newest first. Scroll to the bottom to add eight more.

Choose **Open all sentiment** to open the drawer:

- time: `1h` / `4h` / `24h` / `7d` / `All`;
- filters by direction, source and scope;
- neutral filter: **With neutral / Without neutral**;
- list on the left, detail on the right; the detail includes the evidence quote, original body and a translation toggle.

## When data refreshes

News sources follow their collection preset:

| Source | Default interval |
| --- | --- |
| CoinDesk RSS | 15 minutes |
| SEC RSS | 15 minutes |
| Binance Announcements | 30 minutes |
| OKX Latest Announcements | 30 minutes |

A new item immediately triggers body extraction and sentiment scoring. The app also runs one reconciliation pass at startup. The UI does not poll: it queries when opened, refreshed, or when a filter or window changes.

SEC can go days without a new item. OKX is scored only for trading updates, API notices and deposit/withdrawal suspension notices, so seeing only CoinDesk and Binance in a period is normal.

## Translation

Translation targets the **current application language**:

- Chinese UI: headlines translate automatically when auto-translation is on; the body translates only after **Translate body** or right-click **Translate this item**;
- English UI: no translation buttons, statuses or settings are shown;
- translations are cached by `item + body hash + target language`, so an unchanged item is translated once; a changed body invalidates only that item;
- batch translation runs at most five items concurrently, shows per-item waiting/translating status, and can be cancelled.

## Ask the agent about a story

Clicking a card or drawer item makes it the agent's locked context. When you open the analysis conversation, the header shows **Selected news · headline**, and each question carries the source, time, direction, strength and body — you do not have to describe which story you mean.

## Limits

- Covers the four configured text sources; no social/KOL coverage, topic clustering or cross-source deduplication.
- Each item has a direction judgment, not a full per-article AI interpretation.
- It gives no trading advice, positions or price predictions.
- Data and translations stay on your machine; model calls use the provider you configured.

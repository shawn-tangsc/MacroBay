[English](./crypto-market-analyst.md) | [中文](./crypto-market-analyst.zh-CN.md)

# Crypto Market Analyst

The Crypto Market Analyst is the first live agent in MacroBay's market-intelligence module. It reads
the crypto evidence you have configured — funding and positioning, spot and cross-asset moves,
risk appetite, stablecoin supply, exchange and regulatory events, macro releases — and publishes
conditional analysis next to the dashboard that produced it.

Every statement is bound to evidence records and an `asOf` boundary. When the evidence is missing,
the answer says so instead of filling the gap with a neutral value.

Two sibling agents appear in the same portal, the Equities Market Analyst and the Futures Market
Analyst. Both are marked **coming soon** and cannot be configured yet.

![The agent portal with three analyst cards](../assets/screenshots/portal-en.png)

## What ships now, and what comes next

Crypto intelligence is the current focus, and it keeps getting deeper: more venues and derivatives
coverage, ETF and flow history, on-chain signals, and event-driven alerts.

The portal already shows the next two columns — the Equities Market Analyst and the Futures Market
Analyst — but they are marked **coming soon**: no sources, no dashboard, nothing to configure. When
each opens, it will follow the same shape as this one: its own evidence set, its own dashboard, and
the same rule that every number carries its source and cutoff time. The crypto desk does not depend
on them, and the configuration you build today stays yours.

## Where the analysis comes from

The analyst's judgment is not a generic prompt wrapped around a market feed. It grew out of a
long-time crypto trader's own review notes — what actually moved price across full cycles, what
looked like a signal and was not, and which mistakes kept repeating. Those notes became the prompt,
the checklist, and the conditions the agent has to state before it makes a claim.

Experience is a starting point here, not an authority. The agent still has to show its evidence, and
the notes keep growing: lessons that survive review are folded back into the product, so the analysis
should get more specific over time rather than more confident.

We are not claiming a track record, and none of this is investment advice. The point is narrower:
the reasoning comes from someone who has done the work, and it stays open to being proved wrong.

## The seven presets

The portal card labels the agent "7 static intelligence sources". Those seven are **presets**, not
individual feeds: each preset bundles the sources that serve one part of the picture.

| Preset | Tier | Sources behind it | What it powers |
| --- | --- | --- | --- |
| Fear & Greed | Required | A public market-sentiment index | The market-sentiment gauge |
| Spot and momentum | Required | Exchange quotes, market pricing, the dollar index | Market status, cross-asset comparison |
| Funding rate | Required | Exchange perpetual funding and positioning | Perpetual funding and positioning |
| Macro calendar | Recommended | Federal Reserve, BEA and BLS official schedules, plus a market calendar | Macro release dynamics, economic calendar |
| Stablecoins and DeFi | Recommended | Stablecoin supply and DeFi TVL data | Capital conditions |
| Regulation and venues | Recommended | SEC and CFTC announcements, exchange notices and status pages | Timeline and evidence for the analyst |
| Industry news | Optional | Industry media, project blogs, repository releases | Background context |

Activating the agent enables the three **required** presets. The recommended and optional presets are
yours to turn on; a source you leave off shows up as a gap, not as an empty panel pretending to be
complete.

## Before you start

- **A model provider.** The analyst runs on the platform's Claude Code runtime, so it needs an
  enabled provider with an agent-compatible model. See [Model service](../getting-started/model-service.md).
- **Optional credentials.** A few endpoints need an API key (BEA uses a free User ID); most sources need
  none. Without them the desk still runs on a smaller set of panels.
- **A local proxy for some sources.** A few data endpoints reject mainland-China network requests; they
  only collect through a proxy.
- **macOS.** It is the verified platform; Windows and Linux are expected to run but are not validated.

## ⚠️ A local proxy is required for some sources

<div align="center">
  <img alt="Local proxy required" src="https://img.shields.io/badge/local%20proxy%20required-some%20sources-cc0000?style=for-the-badge">
</div>

<span style="color:#cc0000;font-weight:700">Some data sources only collect through a local proxy.</span>

Some data endpoints — ETF flows, market pricing, and the part of the market calendar they carry —
reject requests coming from mainland-China networks. Without a proxy, **Test connection** and
**Refresh market calendar** keep failing, and the API key is not the problem. Do not start debugging
the key first.

A browser that reaches the site does not prove the app can: app requests only use the proxy
configured under **Settings → Basic settings**.

### Setting up the local proxy

1. **Start your proxy client.** Open the local proxy or VPN client you normally use and confirm the
   local address it listens on. Common shapes are `http://127.0.0.1:7890` or `socks5://127.0.0.1:6153`;
   take the port from the client, not from this page.
2. **Open the settings.** Go to **Settings → Basic settings → Proxy mode**.
3. **Choose Custom proxy.** The default "System proxy" is not always picked up by the app; a custom
   proxy is the reliable path.
4. **Enter the address.** Paste the address from step 1 into **Proxy address**, for example
   `http://127.0.0.1:7890`. Use `http://` for an HTTP proxy and `socks5://` for SOCKS5 — do not mix
   the two.
5. **Keep the bypass rules.** Leave **Proxy bypass rules** at `localhost,127.0.0.1,::1` so local traffic
   stays direct.
6. **Run the self-test.** **Test proxy** reports something like
   `Proxy self-test: passed (HTTP 200, 0.8s via http://127.0.0.1:7890)`; a failure shows the error code
   and the target host.
7. **Retry the source.** Open **Settings → Intelligence Sources**, pick the source marked **Proxy
   required**, and choose **Test connection**; then **Run now**. You can also run each feed from the
   dashboard's **Configure dashboard sources** drawer.

The setting applies immediately; no restart is needed.

### Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Proxy self-test fails | Proxy is off, the port is wrong, or the scheme is wrong | Re-enter the address the client actually listens on |
| Self-test passes, the source still fails | The proxy routes by domain and lets the browser through but not the app | Add the target domain to the proxy rules, or switch to global mode temporarily |
| Browser works, app does not | The app only uses the platform proxy setting | Switch to a custom proxy and match the client's address |
| Authentication error | The proxy requires a username and password | Use a local port without auth, or an address format that carries credentials |
| Everything fails after changing networks | Corporate network or hotspot blocks the proxy | Move back to a reachable network, or switch to the system proxy |

![Intelligence sources settings](../assets/screenshots/sources-en.png)

## 1. Configure the model

**Settings → Model Service**: add a provider, save its API key, enable it, and choose a default model
for agents. Use the connection check to confirm the key before you rely on it.

Inside the dashboard, the analysis panel has its own **AI analysis settings**. By default it follows
the default assistant model; you can pin a specific model there. Turning analysis off stops new
automatic analyses but keeps published history.

If the agent shows **No model selected**, either no provider is enabled or none of the enabled
providers exposes a model the agent runtime can use.

## 2. Activate the agent

Open **Intelligence** in the sidebar. The card for the Crypto Market Analyst shows its preset summary
and one of two states: **Configurable** or, for the two sibling agents, **Coming soon**.

Choose **Configure and activate**. The drawer lists the seven presets with their tier and the
underlying sources, and shows what each preset needs.

Choose **Activate**. This switches on every source in the three required presets that is implemented
and not already enabled. It does not add credentials, and it does not fetch data — that is the next
two steps.

Then choose **Open dashboard**.

## 3. Add credentials where they are required

Go to **Settings → Intelligence Sources**. The left pane is the source tree, filterable by
All / Calendar / Dashboard / Pending / Advanced. Select a provider to open its detail pane.

A handful of endpoints need credentials, and all of them take an API key — except BEA, which uses a
free User ID. Everything else needs none.

Two things to watch in this pane:

- **Implementation status.** A source marked **Collectible** can run now. **Fixture verifiable** means
  it only replays fixtures. **Not implemented** sources cannot be enabled, and the panel says so
  rather than silently accepting the switch.
- **Credential handling.** Keys go to the platform secret store; the settings pane only ever shows a
  masked preview. Use **Save and verify connection** and read the result before trusting the panel.

## 4. Choose a collection policy

Each provider has a collection policy:

- **Preset** — Manual, Balanced, or Frequent. Manual means enabling the source does *not* fetch
  anything; you run it yourself.
- **Include in sentiment analysis** — whether this source can influence the sentiment signal.
- **Scope policy** — All, Watchlist priority, or Active-position priority, for sources that can be
  narrowed.
- **Retention and replay** — whether raw payloads are archived, and whether a parser upgrade triggers
  a replay.
- **Source health** — last success, last failure, consecutive failures, and the last run summary.

The header actions are **Run now**, **Refresh health**, and **Replay window**.

## 5. Collect once

After enabling a source, check whether it already has data:

- **Configured, awaiting first collection** means the schedule has not fired yet. Use **Run now**.
- **Not configured** means the source is on but a required key is missing.
- **Configured but disabled** means it is set up and switched off.
- **Collection failed** shows an error code; open the provider's health section for the last run
  summary.
- **Data expired, fell back** means a fresher value was expected and the panel is showing the last
  good reading with its timestamp.

The dashboard also has a feed-status strip and a **Configure dashboard sources** drawer, which links
each panel to the provider that feeds it.

## 6. Read the dashboard

| Panel | What it shows | Depends on |
| --- | --- | --- |
| Market status | DXY, gold, QQQ, BTC, ETH, US10Y with 15m/1h/24h/7d changes | Dollar index, market pricing, exchange quotes, Fed rates |
| Cross-asset common-anchor returns | DXY, gold, QQQ, BTC, ETH normalized on one scale | The same market data |
| Capital conditions | Stablecoin supply, 7-day net change, latest BTC/ETH ETF readings, market flows | Stablecoin data, ETF flow data |
| Market sentiment | Fear & Greed gauge with buckets and observation time | Sentiment index |
| Perpetual funding rate | BTC and ETH funding, who pays whom, and history | Exchange perpetual data |
| Macro release dynamics | Upcoming and released events grouped by official date, with prior and actual values | BLS, BEA, Federal Reserve, market calendar |
| Latest AI conclusion | Direction per horizon, confidence, and conclusion blocks | The analyst agent |
| Watchlist and timeline | Recently released and upcoming events, published analyses, and their status | Calendar, analysis runs |

Two fallbacks are labelled rather than hidden: when the real dollar index is unavailable, the
dollar row may show a product-computed synthetic value; when the exact Nasdaq-100 index is
unavailable, QQQ may be shown through a clearly labelled proxy. A daily Fed rate carries its trading
period and can lag by several days — it explains the regime, not an intraday move.

Direction is reported per horizon — short term (0–24h), medium term (1–7 days), long term (1–4
weeks) — with a confidence level of low, medium, or high. A missing horizon means the evidence does
not support a call, not that the answer is neutral.

## 7. Ask the analyst

The dashboard and the conversation share one workspace: **Analysis chat** and **Market dashboard**
tabs switch between them, and **Full agent panel** opens the standalone session.

- Select a dashboard node or a calendar event to bind it as context. The agent answers about that
  node instead of guessing.
- Ask a question that can be tested against evidence: *what changed in the last macro release*, *which
  source produced this reading*, *what would invalidate this interpretation*.
- When a choice changes the answer — a comparison window, a baseline — the agent asks with a
  structured question card and returns your answer as data.
- Tools that can read local files, run commands, or change state ask for approval first.
- You can stop a running turn; the trace keeps the completed steps and marks the turn stopped.

## How to verify an answer

A complete analysis separates five things: **facts** with source references, **assumptions**, the
**conditions** that make the interpretation hold, the **gaps**, and the **time boundary** —
observation time plus the `asOf` cutoff.

Published analyses also carry conclusion blocks — what changed, the causal chain, conditions, the
macro side, evidence strength, and the data gap — and a verification status that moves from pending
to confirmed, partially confirmed, invalidated, or expired.

To check one number, open it: the evidence view shows the source record, the observation time, and
the cutoff the query used. A later revision is not folded back into the earlier answer.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A panel is empty or says "not configured" | The source is off, or its key is missing | **Settings → Intelligence Sources**: enable it, save the key, run it once |
| "Awaiting first collection" never clears | Manual preset | Press **Run now** |
| Source health shows failed | Network, proxy, key, or rate limit | Read the last run summary, then retry |
| A panel warns about the network, or stays empty | The source needs a local proxy | Follow "Setting up the local proxy" above, then retry the source |
| The agent says no model is selected | No enabled provider with a compatible model | **Settings → Model Service** |
| No analysis is produced | Analysis is off, no new event group, or the service is starting | Turn analysis on, or press **Analyze now** |
| The calendar is empty | Official schedules are not collected or imported | **Settings → Macro calendar**, then collect or sync |
| A provider is marked "pending" | The source is not implemented yet | Nothing to configure; it stays unavailable on purpose |

## Limits

- It is decision support, not investment advice, and it cannot place orders.
- Analysis quality tracks source coverage. A source you leave off shows up as a gap, not as a
  neutral reading.
- The agent needs a tool-capable, agent-compatible model route; an ordinary chat model is not enough.
- No demo dataset ships with this release, so a fresh install with no keys shows empty panels by
  design.
- Data and credentials stay on your machine. There is no hosted account to recover.

## Next

- [Analysis workflow](./analysis-workflow.md)
- [Traceability](./traceability.md)
- [Analyst agent](./analyst-agent.md)
- [Status and limitations](../reference/status-and-limitations.md)

<p align="center">
  <img src="./docs/assets/brand/mark.svg" width="56" height="56" alt="MacroBay mark">
</p>

<h1 align="center">MacroBay</h1>

<p align="center">
  <strong>Evidence-backed market analysis, on your desktop.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f766e?style=flat-square"></a>
  <img alt="Electron 41" src="https://img.shields.io/badge/Electron-41-47848F?style=flat-square&logo=electron&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111111">
  <img alt="TypeScript 5.8" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="pnpm 10" src="https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white">
  <a href="./docs/reference/status-and-limitations.md"><img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-d97706?style=flat-square"></a>
  <a href="https://github.com/shawn-tangsc/MacroBay/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/shawn-tangsc/MacroBay/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="./docs/README.md">Documentation</a> ·
  <a href="./docs/platform/architecture.md">Architecture</a> ·
  <a href="./ROADMAP.md">Roadmap</a> ·
  <a href="#feedback">Feedback</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./LICENSE">License</a>
</p>

<p align="center">
  <sub>Local-first. No bundled market data or provider credentials. Not affiliated with any data provider.</sub>
</p>

---

MacroBay is a local desktop workspace for market research. It combines a market dashboard, a macro
calendar, and an analyst agent, and keeps every reading tied to its evidence and cutoff time —
instead of a chat summary you cannot verify.

The goal is to make AI-assisted market research **inspectable**. That means keeping pace with new AI
capabilities, keeping every claim tied to evidence, and keeping control local. It is not a one-off demo.

<p align="center">
  <a href="./docs/assets/screenshots/demo-en.gif">
    <img src="./docs/assets/screenshots/demo-en-poster.png" alt="MacroBay dashboard, analysis, and analyst agent" width="100%">
  </a>
</p>

<p align="center">
  <sub>Dashboard, evidence, analyst agent, calendar, and model settings. Click the image to play the 38-second demo.</sub>
</p>

## The goal

MacroBay should feel less like “chat with a market prompt” and more like a research desk:

- **AI capability that keeps up.** Integrate new models, agent runtimes, tool use, structured
  questions, approvals, and inspectable execution traces as they become usable. Keep the model layer
  replaceable rather than tying the product to one vendor.
- **Investment intelligence that goes deeper.** Add market coverage, source coverage, calendar and
  revision workflows, and repeatable analysis playbooks.
- **A reusable core.** Keep the runtime generic and the product modules removable, so the app can
  evolve without turning into a monolith.

This alpha will keep changing. The direction is continuous iteration, not a frozen feature list.

## What you get

- **One workspace, not five tabs.** Macro context, cross-asset moves, capital and liquidity
  conditions, the macro calendar, and the latest published analysis sit on one screen.
- **Evidence and time on every number.** Open a reading to see its source, observation time, and the
  cutoff used by the query. A later revision is not folded back into the earlier answer.
- **An analyst with a visible work trace.** The agent reads the same evidence, separates facts,
  assumptions, conditions, and gaps, asks a structured question when a choice changes the answer,
  and shows the tools it used.
- **A calendar that does not rewrite history.** Scheduled release, observed value, and later revision
  are kept as distinct objects.
- **Your providers, your machine.** No bundled market data and no bundled API keys. Credentials stay
  in the local secret store; your data stays local.
- **A product that keeps moving.** New model and agent capabilities, plus deeper market coverage, are
  part of the roadmap, not a one-off release.

## Data sources

The source catalog is curated: it integrates a range of **free and low-cost platforms** instead of
tying the product to one expensive feed. Enable only the sources you need. Some sources require your
own account, API key, or network access, and coverage varies by source.

No market data or credentials are bundled with the app. Missing sources appear as explicit gaps
rather than being filled with a neutral value.

## Roadmap

- **Agent platform:** a general-purpose agent, product-scoped sub-agents, and channel notifications.
- **Investment intelligence:** multi-platform sentiment analysis, a market-data module, and a
  review/replay module, plus additional provider integrations such as JEV.
- **Platform:** keep the model/runtime replaceable and the product modules removable.

This is a direction, not a dated commitment. See [ROADMAP.md](./ROADMAP.md).

## Quick start

Requires **Node.js 22+** and **pnpm 10**.

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
4. Ask the analyst agent: *What changed in the last macro release, and which assets does it affect?*

The answer should show what is known, what is missing, where the evidence came from, and the cutoff
time it used.

## Documentation

| Start | Understand the product | Build on it |
| --- | --- | --- |
| [Quick start](./docs/getting-started/quick-start.md) | [Product overview](./docs/product/overview.md) | [Architecture](./docs/platform/architecture.md) |
| [Installation](./docs/getting-started/installation.md) | [Analysis workflow](./docs/product/analysis-workflow.md) | [Development setup](./docs/development/setup.md) |
| [First run](./docs/getting-started/first-run.md) | [Traceability](./docs/product/traceability.md) | [Adding a product](./docs/development/adding-a-product.md) |
| [Model service](./docs/getting-started/model-service.md) | [Analyst agent](./docs/product/analyst-agent.md) | [Platform and products](./docs/platform/platform-and-products.md) |
| [Status and limitations](./docs/reference/status-and-limitations.md) | — | — |

Chinese documentation: [docs/README.zh-CN.md](./docs/README.zh-CN.md)

## Status

MacroBay is an **alpha** release. It runs from source; packaged installers and an auto-update channel
are not part of this release. See [Status and limitations](./docs/reference/status-and-limitations.md).

## Data and privacy

MacroBay is a client for providers you configure. The MIT license covers the code, not the data.
There is no MacroBay-hosted data service, no resale, and no proxy. You are responsible for provider
terms, keys, rate limits, and any commercial use.

[Data and third-party services](./docs/reference/data-disclaimer.md)

## Feedback

Bug reports, data-source requests, and feature ideas are welcome. Open an issue on the repository;
feedback directly shapes the roadmap and is reviewed as the project iterates.

## Contributing

- [Contributing guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)

Local AI development notes may live in `AGENTS.md`; that file is not part of the public repository.

## License

[MIT](./LICENSE) © 2026 MacroBay contributors

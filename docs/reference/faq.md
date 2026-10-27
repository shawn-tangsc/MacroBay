[English](./faq.md) | [中文](./faq.zh-CN.md)

# FAQ

## Do I need a model provider account?

Yes. MacroBay does not bundle a model or a hosted proxy. Add an enabled provider and its API key in
**Settings → Model Service**.

## Does my data leave the machine?

Application data stays in the local `userData` directory. Requests go to the model provider and the
data sources you configure, through the platform network adapters. There is no MacroBay analytics
service.

## Which models can I use?

Any model that the configured provider exposes and that satisfies the task. Ordinary chat has
broader compatibility than the agent runtime, which expects a Claude Code-compatible Messages
route. The agent model picker shows the models that meet the runtime constraints.

## Why does an analysis need an `asOf` time?

Because a conclusion must state what information was available at that moment. Without a boundary,
a historical query can accidentally use later revisions and produce a result that could never have
been known at the time.

## Why do some tools need approval?

Tools that read local files, run commands, or change state can affect the machine. The approval row
shows what will run. You can allow or deny it; a denied call stops with a reason.

## Why did the agent ask me a question instead of answering?

Some choices change the analysis, such as a comparison window or a baseline. The structured
question card returns your answer to the runtime as data instead of asking the model to parse a
free-form message.

## Are channels available?

No. Telegram, Slack, Lark, Discord, QQ, and WeChat integrations exist in the platform code but are
not exposed in this release. Their UI and tests are disabled together.

## Does it work on Windows or Linux?

macOS is the verified development platform. The Electron code is expected to run elsewhere, but
Windows and Linux have not been validated end to end. Treat them as experimental and report
concrete failures.

## Can I use it without a dashboard or live data?

Yes, for a look: **sample mode** shows the full dashboard and three published analyses from a recorded real
week, with no key and no network. Doing your own analysis still needs configured source credentials and
data — sample mode never collects and never writes to your database.

## Is the analysis investment advice?

No. It is decision support. Outputs describe evidence, assumptions, conditions, and gaps; they are
not unconditional buy or sell instructions.

## How do I back up or migrate?

Back up the Electron `userData` directory. It contains settings, conversations, local databases, and
credentials protected by the OS keychain. Treat the backup as sensitive.

## How do I report a bug?

Include the OS version, whether you ran from source or a package, the exact UI error, and relevant
logs with credentials and personal paths removed.

## Next

- [Status and limitations](./status-and-limitations.md)
- [Privacy and security](../platform/privacy-and-security.md)

[English](./data-disclaimer.md) | [中文](./data-disclaimer.zh-CN.md)

# Data and third-party services

MacroBay is a desktop client. It does not operate a market-data service, resell data, or provide a
hosted proxy for third-party content.

## What the license covers

The repository's MIT license covers the source code. It does **not** grant any right to market data,
news articles, exchange announcements, calendar entries, or other content retrieved from a provider.

Data remains subject to the terms of the service that produced it.

## Sample data

The sample scenario contains aggregate values observed from public sources and from licensed providers you
configure (for example ETF flows and index levels). It ships so the product can be evaluated offline: it is
not a feed, it is not updated, and it must not be resold or treated as a substitute for a provider licence.
See [Sample data](./status-and-limitations.md#sample-data).

## What the project does not do

- It does not bundle a market-data database, provider accounts, or API keys.
- It does not proxy requests through a MacroBay server.
- It does not sell, sublicense, or redistribute market data.
- It does not guarantee that a source is available, accurate, complete, or licensed for your use.

## Your responsibilities

If you configure a provider or data source, you are responsible for:

- obtaining an account and API key where required;
- complying with that provider's terms, rate limits, attribution requirements, and usage limits;
- deciding whether your use is personal, internal, or commercial;
- storing and backing up any data you retrieve;
- removing credentials and personal data before sharing screenshots, logs, or exports.

A provider may change, restrict, or revoke access at any time.

## Public pages and undocumented endpoints

Some adapters read public web pages or endpoints that a provider may not document as a stable API.
Such access can be restricted by the provider's terms and can break without notice. It is not an
endorsement, a license, or a guarantee of continued availability.

If a provider asks for an integration to be removed or changed, open an issue in the repository so
the adapter can be reviewed.

## Test fixtures

The repository contains small fixtures used by parser and adapter tests. They are test inputs, not
a product data feed. They do not grant any data rights, and they are not intended for reuse as
market data.

Captured examples are replaced with synthetic fixtures where practical before a public release.
If you believe a file contains content that should not be distributed, open an issue with the file
path and the basis of the request.

## No warranty and no advice

The software and any retrieved content are provided "as is", without warranty of any kind. Market
intelligence output is decision support, not investment, legal, tax, or accounting advice.

Nothing in this repository grants a right to redistribute third-party content.

## Reporting a concern

Open a GitHub issue with:

- the file or adapter involved;
- the provider and the relevant term;
- whether the concern is about code, a bundled fixture, or documentation.

This page is a project policy, not legal advice.

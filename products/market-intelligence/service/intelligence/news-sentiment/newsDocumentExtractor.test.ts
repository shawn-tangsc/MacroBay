import { describe, expect, it } from 'vitest'

import { extractNewsBody } from './newsDocumentExtractor'

describe('extractNewsBody', () => {
  it('reads the SEC body container and ignores the .gov banner', () => {
    const html = `
      <div class="usa-banner"><p>Official websites use .gov</p></div>
      <div class="clearfix text-formatted usa-prose field field--name-body field__item">
        <p>The Securities and Exchange Commission today proposed amendments that would address how investment advisers and funds can custody crypto assets under the federal securities laws.</p>
        <p>The proposal would update existing custody rules for digital assets and is open for public comment for sixty days.</p>
      </div>
      <footer><p>Contact the SEC</p></footer>`
    const result = extractNewsBody({ sourceId: 'sec-rss', html })
    expect(result.state).toBe('available')
    expect(result.text).toContain('custody crypto assets')
    expect(result.text).not.toContain('Official websites use .gov')
    expect(result.text).not.toContain('Contact the SEC')
  })

  it('reads the CoinDesk document body and keeps list items', () => {
    const html = `
      <nav><p>Latest Crypto News Markets Policy</p></nav>
      <div class="document-body font-body-lg">
        <p>The U.S. risks losing digital asset business to faster-moving jurisdictions in Asia, the Middle East and Bermuda after the Senate failed to advance the Clarity Act.</p>
        <ul><li>Hong Kong and Singapore have moved faster on licensing regimes for exchanges and custodians.</li></ul>
        <p>Industry participants expect the debate to continue into next year.</p>
      </div>`
    const result = extractNewsBody({ sourceId: 'coindesk-rss', html })
    expect(result.text).toContain('risks losing digital asset business')
    expect(result.text).toContain('Hong Kong and Singapore')
    expect(result.text).not.toContain('Latest Crypto News')
  })

  it('reads an OKX article container', () => {
    const html = `<article>
      <p>Maintain competitive UAH/USDT prices, provide reliable liquidity, and earn weekly rewards on OKX P2P.</p>
      <p>From 26th October to 23rd November 2026, eligible UAH P2P merchants can compete for a share of 2,000 USDT.</p>
    </article>`
    const result = extractNewsBody({ sourceId: 'okx-latest-announcements', html })
    expect(result.text).toContain('2,000 USDT')
  })

  it('falls back to paragraphs and drops site chrome when no container exists', () => {
    const html = `
      <p>4 min read</p><p>Share this article</p>
      <p>A spot Ethereum ETF approval would let listed exchanges offer options on the funds.</p>
      <p>Analysts said volume may take months to build.</p>`
    const result = extractNewsBody({ sourceId: 'coindesk-rss', html })
    expect(result.text).toContain('spot Ethereum ETF approval')
    expect(result.text).not.toContain('4 min read')
    expect(result.text).not.toContain('Share this article')
  })

  it('decodes entities and caps the body', () => {
    const html = `<article><p>${'Alpha &amp; beta. '.repeat(900)}</p></article>`
    const result = extractNewsBody({ sourceId: 'okx-latest-announcements', html })
    expect(result.text).toContain('Alpha & beta.')
    expect(result.text.length).toBeLessThanOrEqual(8_000)
  })

  it('drops the publisher disclosure when no article container exists', () => {
    const html = `<p>Strategy, Strive face balancing act between bitcoin buying and preferred stock dividends.</p>
      <p>Disclosure &amp; Polices : CoinDesk is an award-winning media outlet that covers the cryptocurrency industry.</p>
      <p>Bullish owns and invests in digital asset businesses and digital assets.</p>`
    const result = extractNewsBody({ sourceId: 'coindesk-rss', html })
    expect(result.text).toContain('Strategy, Strive face balancing act')
    expect(result.text).not.toContain('award-winning media outlet')
    expect(result.text).not.toContain('Bullish owns and invests')
  })

  it('collects every article block when the publisher splits one story into several containers', () => {
    const html = `<div class="document-body"><p>Jack Dorsey's payments company Block has unveiled a voice AI model.</p></div>
      <div class="document-body"><p>For now, Dessa remains a research preview rather than a publicly available product.</p></div>
      <div class="document-body"><p>Block has not disclosed the model's size, benchmark results or a public release date.</p></div>`
    const result = extractNewsBody({ sourceId: 'coindesk-rss', html })
    expect(result.text).toContain('Jack Dorsey')
    expect(result.text).toContain('research preview')
    expect(result.text).toContain('benchmark results')
  })

  it('falls back to main text when the article uses divs instead of paragraphs', () => {
    const long = 'Stablecoins are ready for prime time because settlement is faster and cheaper than card rails. '.repeat(4)
    const html = `<main><div>${long}</div><div>Disclosure &amp; Polices : CoinDesk is an award-winning media outlet.</div></main>`
    const result = extractNewsBody({ sourceId: 'coindesk-rss', html })
    expect(result.state).toBe('available')
    expect(result.text).toContain('Stablecoins are ready')
    expect(result.text).not.toContain('award-winning media outlet')
  })

  it('marks a short extraction as too-short', () => {
    const html = '<article><p>Too short.</p></article>'
    const result = extractNewsBody({ sourceId: 'okx-latest-announcements', html })
    expect(result.state).toBe('too-short')
  })
})

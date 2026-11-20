import { describe, expect, it } from 'vitest'

import {
  calendarValueEncodingErrorCode, displayValueFromJson, normalizeValuesJsonForWrite
} from './marketCalendarValueEncoding'

/**
 * 值编码只有一处解释（用户 2026-11-18 的日报 JSON 泄漏）。
 *
 * 观测表三列（`provider_previous_json` / `consensus_json` / `provider_actual_json`）存的是
 * `{displayValue}` 的 **JSON 文本**；一次性补库脚本把它们当字符串塞进 `values_json`，
 * 外层又 `JSON.stringify` 一次 → 日报读到的 `previous` 是 `"{\"displayValue\":\"4.7%\"}"`。
 *
 * 这一条钉三件事：
 * 1. 文本 → 展示串：解析不出就 `undefined`（**该字段缺席**），不拿原文顶、不填空串；
 * 2. 写入闸门：双重编码的输入 → 落库是裸字符串；坏对象 → **抛错不写**；
 * 3. 正常数据**逐字节不变**（这道闸门不许让干净的值重排一次）。
 */
describe('观测值文本 → 展示字符串', () => {
  it('takes displayValue from the observation json text', () => {
    expect(displayValueFromJson('{"displayValue":"4.7%"}')).toBe('4.7%')
    expect(displayValueFromJson('{"displayValue":"-0.1%"}')).toBe('-0.1%')
  })

  it('returns undefined when the text carries no usable display value', () => {
    for (const text of [null, undefined, '', '   ', 'not json', '[]', '"4.7%"', '{"displayValue":123}', '{"displayValue":""}', '{"x":1}']) {
      expect(displayValueFromJson(text), String(text)).toBeUndefined()
    }
  })
})

describe('写标准表前的编码闸门', () => {
  it('decodes a stringified displayValue back to the bare string', () => {
    const input = JSON.stringify({ previous: '{"displayValue":"4.7%"}', consensus: '{"displayValue":"5%"}', actual: '4.9%' })
    expect(JSON.parse(normalizeValuesJsonForWrite(input))).toEqual({ previous: '4.7%', consensus: '5%', actual: '4.9%' })
  })

  it('refuses to write when the stringified object cannot be decoded', () => {
    const broken = JSON.stringify({ previous: '{"displayValue":123}' })
    expect(() => normalizeValuesJsonForWrite(broken)).toThrow(new RegExp(calendarValueEncodingErrorCode))
  })

  it('leaves clean values byte-for-byte unchanged', () => {
    const clean = JSON.stringify({ actual: '7.8', previous: '25.5', consensus: '18' })
    expect(normalizeValuesJsonForWrite(clean)).toBe(clean)
    // 值里本来就以 `{` 开头的普通文本（不是 displayValue 对象）也不碰。
    const literal = JSON.stringify({ previous: '{see note}' })
    expect(normalizeValuesJsonForWrite(literal)).toBe(literal)
  })

  it('rejects a values payload that is not an object', () => {
    expect(() => normalizeValuesJsonForWrite('[]')).toThrow(new RegExp(calendarValueEncodingErrorCode))
    expect(() => normalizeValuesJsonForWrite('null')).toThrow(new RegExp(calendarValueEncodingErrorCode))
    expect(() => normalizeValuesJsonForWrite('not json')).toThrow(new RegExp(calendarValueEncodingErrorCode))
  })
})

import { describe, it, expect } from 'vitest'
import { CURRENCIES, TIMEZONES, PHRASES } from '../src/screens/TravelToolkit'

describe('Travel Toolkit Currencies', () => {
  it('supports major travel currencies including INR, USD, EUR, GBP, AED, THB', () => {
    expect(CURRENCIES.INR).toBeDefined()
    expect(CURRENCIES.USD).toBeDefined()
    expect(CURRENCIES.EUR).toBeDefined()
    expect(CURRENCIES.GBP).toBeDefined()
    expect(CURRENCIES.AED).toBeDefined()
    expect(CURRENCIES.THB).toBeDefined()
  })

  it('calculates cross currency exchange conversion correctly', () => {
    const usdRate = CURRENCIES.USD.rateToUSD // 1
    const inrRate = CURRENCIES.INR.rateToUSD // 0.0116
    const calculatedInrPerUsd = usdRate / inrRate
    expect(calculatedInrPerUsd).toBeGreaterThan(80)
    expect(calculatedInrPerUsd).toBeLessThan(95)
  })
})

describe('Travel Toolkit Timezones', () => {
  it('includes key destination timezones', () => {
    const tzIds = TIMEZONES.map((t) => t.id)
    expect(tzIds).toContain('Asia/Kolkata')
    expect(tzIds).toContain('Asia/Dubai')
    expect(tzIds).toContain('Europe/London')
  })
})

describe('Travel Toolkit Phrasebook', () => {
  it('includes phrases for Spanish, French, Thai, Japanese, Arabic, and Hindi', () => {
    expect(PHRASES.es.list.length).toBeGreaterThan(5)
    expect(PHRASES.fr.list.length).toBeGreaterThan(5)
    expect(PHRASES.th.list.length).toBeGreaterThan(5)
    expect(PHRASES.ja.list.length).toBeGreaterThan(5)
    expect(PHRASES.ar.list.length).toBeGreaterThan(5)
    expect(PHRASES.hi.list.length).toBeGreaterThan(5)
  })
})

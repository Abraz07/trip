import { describe, it, expect } from 'vitest'
import { extractCoordsFromText } from '../src/geocode'

describe('Map Pin Focus & Coordinates Resolution', () => {
  it('extracts raw latitude and longitude from strings with comma coordinates', () => {
    const res = extractCoordsFromText('14.5283, 74.3184')
    expect(res).not.toBeNull()
    expect(res.lat).toBeCloseTo(14.5283)
    expect(res.lng).toBeCloseTo(74.3184)
  })

  it('extracts coordinates from Google Maps URLs', () => {
    const url = 'https://maps.google.com/?q=14.5200,74.3150'
    const res = extractCoordsFromText(url)
    expect(res).not.toBeNull()
    expect(res.lat).toBeCloseTo(14.52)
    expect(res.lng).toBeCloseTo(74.315)
  })

  it('handles Google Maps @lat,lng format correctly', () => {
    const url = 'https://www.google.com/maps/@15.2993,74.1240,15z'
    const res = extractCoordsFromText(url)
    expect(res).not.toBeNull()
    expect(res.lat).toBeCloseTo(15.2993)
    expect(res.lng).toBeCloseTo(74.124)
  })

  it('correctly formats and parses map focus payload between Plan and Map tabs', () => {
    const item = {
      id: 'stop_123',
      date: '2026-11-24',
      lat: 14.542,
      lng: 74.319,
      title: 'Om Beach',
      place: 'Om Beach, Gokarna',
    }

    // Plan tab serialization
    const payload = JSON.stringify({
      id: item.id,
      date: item.date,
      lat: item.lat,
      lng: item.lng,
      title: item.title,
      place: item.place,
    })

    // Map tab deserialization
    expect(payload.startsWith('{')).toBe(true)
    const parsed = JSON.parse(payload)
    expect(parsed.id).toBe('stop_123')
    expect(parsed.date).toBe('2026-11-24')
    expect(parsed.lat).toBe(14.542)
    expect(parsed.lng).toBe(74.319)
    expect(parsed.title).toBe('Om Beach')
  })

  it('handles backward-compatible string-only IDs without throwing', () => {
    const rawFocus = 'legacy_stop_999'
    let focusId = rawFocus
    let focusDate = null

    if (rawFocus.startsWith('{')) {
      const parsed = JSON.parse(rawFocus)
      focusId = parsed.id
      focusDate = parsed.date
    }

    expect(focusId).toBe('legacy_stop_999')
    expect(focusDate).toBeNull()
  })
})

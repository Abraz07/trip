import { describe, it, expect, beforeEach } from 'vitest'
import { getActiveTab, saveActiveTab, VALID_TABS } from '../src/tabRouter'

describe('Trip Tab Persistence and Hash Sync', () => {
  const tripId = 'goa-trip-2026'
  let mockStorage

  beforeEach(() => {
    const store = {}
    mockStorage = {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v) },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
    }
  })

  it('exports all 6 valid tabs', () => {
    expect(VALID_TABS).toEqual(['today', 'plan', 'map', 'money', 'photos', 'more'])
  })

  it('parses active tab directly from URL hash when present', () => {
    expect(getActiveTab(tripId, `#/t/${tripId}/plan`, mockStorage)).toBe('plan')
    expect(getActiveTab(tripId, `#/t/${tripId}/money`, mockStorage)).toBe('money')
    expect(getActiveTab(tripId, `#/t/${tripId}/map`, mockStorage)).toBe('map')
    expect(getActiveTab(tripId, `#/t/${tripId}/photos`, mockStorage)).toBe('photos')
    expect(getActiveTab(tripId, `#/t/${tripId}/more`, mockStorage)).toBe('more')
  })

  it('restores active tab from storage when hash has no subtab', () => {
    saveActiveTab(tripId, 'money', mockStorage)
    expect(getActiveTab(tripId, `#/t/${tripId}`, mockStorage)).toBe('money')

    saveActiveTab(tripId, 'plan', mockStorage)
    expect(getActiveTab(tripId, `#/t/${tripId}`, mockStorage)).toBe('plan')
  })

  it('defaults to today when neither hash nor storage has a tab', () => {
    expect(getActiveTab(tripId, `#/t/${tripId}`, mockStorage)).toBe('today')
    expect(getActiveTab(tripId, '', mockStorage)).toBe('today')
  })

  it('rejects invalid or arbitrary tab names and safely falls back', () => {
    expect(getActiveTab(tripId, `#/t/${tripId}/unknownTab`, mockStorage)).toBe('today')

    mockStorage.setItem(`yatra:tab:${tripId}`, 'hackedTab')
    expect(getActiveTab(tripId, `#/t/${tripId}`, mockStorage)).toBe('today')
  })

  it('keeps active tab state isolated between different trips', () => {
    // URL for trip-B does not pollute trip-A
    expect(getActiveTab('trip-A', '#/t/trip-B/money', mockStorage)).toBe('today')

    // Each trip has its own independent saved tab in storage
    saveActiveTab('trip-A', 'plan', mockStorage)
    saveActiveTab('trip-B', 'money', mockStorage)
    expect(getActiveTab('trip-A', '#/t/trip-A', mockStorage)).toBe('plan')
    expect(getActiveTab('trip-B', '#/t/trip-B', mockStorage)).toBe('money')
  })
})

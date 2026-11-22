import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  formatTime12,
  byTime,
  getInitials,
  interpretWeatherCode,
  getDefaultThemeWeather,
  EditorialHeader,
  HeroSpotlight,
  ExpeditionKitty,
  WaypointTimeline,
  MapLink,
} from '../src/screens/Today'

describe('Today Tab - Time Formatting & Parsing', () => {
  it('formats standard 24h time strings into 12-hour AM/PM format', () => {
    expect(formatTime12('09:00')).toBe('09:00 AM')
    expect(formatTime12('15:30')).toBe('03:30 PM')
    expect(formatTime12('00:00')).toBe('12:00 AM')
    expect(formatTime12('12:00')).toBe('12:00 PM')
    expect(formatTime12('23:59')).toBe('11:59 PM')
    expect(formatTime12('01:05')).toBe('01:05 AM')
  })

  it('handles single-digit hours correctly', () => {
    expect(formatTime12('9:30')).toBe('09:30 AM')
    expect(formatTime12('8:00')).toBe('08:00 AM')
  })

  it('handles invalid or empty time strings gracefully', () => {
    expect(formatTime12('')).toBe('—')
    expect(formatTime12(null)).toBe('—')
    expect(formatTime12(undefined)).toBe('—')
    expect(formatTime12('invalid')).toBe('invalid')
    expect(formatTime12('99:99')).toBe('99:99')
  })
})

describe('Today Tab - Waypoint Chronological Sorting', () => {
  it('sorts waypoints by time ascending, placing unscheduled items at the end', () => {
    const stops = [
      { id: '1', title: 'Sunset Dinner', time: '19:30' },
      { id: '2', title: 'Morning Coffee', time: '08:30' },
      { id: '3', title: 'Afternoon Trek', time: '14:00' },
      { id: '4', title: 'Unscheduled Walk', time: '' },
    ]

    const sorted = [...stops].sort(byTime)
    expect(sorted.map((s) => s.id)).toEqual(['2', '3', '1', '4'])
  })

  it('preserves order field when times are identical or missing', () => {
    const stops = [
      { id: 'a', title: 'First Unscheduled', time: '', order: 1 },
      { id: 'b', title: 'Second Unscheduled', time: '', order: 2 },
    ]
    const sorted = [...stops].sort(byTime)
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('Today Tab - User Initials Generation', () => {
  it('extracts two initials from full names and one from single names', () => {
    expect(getInitials('Abraz Shaik')).toBe('AS')
    expect(getInitials('Priya Sharma')).toBe('PS')
    expect(getInitials('Rahul')).toBe('R')
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
    expect(getInitials('John Fitzgerald Kennedy')).toBe('JF')
  })
})

describe('Today Tab - Destination Weather Telemetry', () => {
  it('maps WMO weather codes to descriptive climate labels', () => {
    expect(interpretWeatherCode(0)).toBe('Clear Skies ☀️')
    expect(interpretWeatherCode(1)).toBe('Partly Cloudy 🌤️')
    expect(interpretWeatherCode(45)).toBe('Coastal Mist 🌫️')
    expect(interpretWeatherCode(61)).toBe('Light Rain 🌦️')
    expect(interpretWeatherCode(80)).toBe('Passing Showers 🌧️')
    expect(interpretWeatherCode(95)).toBe('Thunderstorm ⛈️')
    expect(interpretWeatherCode(999)).toBe('Breezy 🍃')
  })

  it('provides sensible destination theme fallback weather when offline or coords missing', () => {
    expect(getDefaultThemeWeather('beach')).toContain('Sunny Coastal Breeze')
    expect(getDefaultThemeWeather('mountains')).toContain('Crisp Mountain Air')
    expect(getDefaultThemeWeather('heritage')).toContain('Golden Heritage Breeze')
    expect(getDefaultThemeWeather('nature')).toContain('Evergreen Canopy')
    expect(getDefaultThemeWeather('desert')).toContain('Warm Dune Breeze')
    expect(getDefaultThemeWeather('city')).toContain('Clear Metro Sky')
    expect(getDefaultThemeWeather('party')).toContain('Balmy Evening')
    expect(getDefaultThemeWeather('unknown')).toContain('Sunny Coastal Breeze')
  })
})

describe('Today Tab - React Component Render Tests (SSR / Crash Protection)', () => {
  const mockTrip = {
    id: 'trip_1',
    name: 'Gokarna Coast',
    theme: 'beach',
    start: '2026-11-20',
    end: '2026-11-25',
  }
  const mockMe = { id: 'u1', name: 'Abraz' }
  const mockMembers = [
    { id: 'u1', name: 'Abraz' },
    { id: 'u2', name: 'Priya' },
    { id: 'u3', name: 'Rahul' },
  ]
  const mockDay = { n: 3, date: '2026-11-22' }
  const mockDays = [
    { n: 1, date: '2026-11-20' },
    { n: 2, date: '2026-11-21' },
    { n: 3, date: '2026-11-22' },
  ]

  it('renders EditorialHeader without runtime errors', () => {
    const html = renderToString(
      React.createElement(EditorialHeader, {
        trip: mockTrip,
        me: mockMe,
        members: mockMembers,
        day: mockDay,
        days: mockDays,
        today: '2026-11-22',
        weather: '28°C • Sunny Coastal Breeze',
        sunsetInfo: '🌅 Sunset in 3h 15m',
      })
    )
    expect(html).toContain('Gokarna Coast')
    expect(html).toContain('Welcome back')
    expect(html).toContain('Abraz')
    expect(html).toContain('Sunset in 3h 15m')
  })

  it('renders HeroSpotlight without runtime errors', () => {
    const mockItem = {
      id: 'stop_1',
      title: 'Cliffside Trek to Half Moon Beach',
      time: '15:30',
      kind: 'activity',
      place: 'Om Beach Trailhead',
      duration: '2h',
      cost: 0,
      notes: 'Wear reef grip shoes',
    }
    const html = renderToString(
      React.createElement(HeroSpotlight, {
        item: mockItem,
        totalStops: 4,
        index: 2,
        tripId: 'trip_1',
        setTab: () => {},
        isToday: true,
      })
    )
    expect(html).toContain('Cliffside Trek to Half Moon Beach')
    expect(html).toContain('03:30 PM')
    expect(html).toContain('Om Beach Trailhead')
    expect(html).toContain('Start Route')
  })

  it('renders ExpeditionKitty in owed and owing states correctly', () => {
    // User is owed money (+₹2,450)
    const htmlOwed = renderToString(
      React.createElement(ExpeditionKitty, {
        myBal: 2450,
        totalSpend: 15200,
        setTab: () => {},
      })
    )
    expect(htmlOwed).toContain('owed to you')
    expect(htmlOwed).toContain('₹2,450')

    // User owes money (-₹1,100)
    const htmlOwes = renderToString(
      React.createElement(ExpeditionKitty, {
        myBal: -1100,
        totalSpend: 15200,
        setTab: () => {},
      })
    )
    expect(htmlOwes).toContain('you owe')
    expect(htmlOwes).toContain('₹1,100')

    // Settled
    const htmlSettled = renderToString(
      React.createElement(ExpeditionKitty, {
        myBal: 0,
        totalSpend: 15200,
        setTab: () => {},
      })
    )
    expect(htmlSettled).toContain('All settled 👌')
  })

  it('renders WaypointTimeline empty state and populated state', () => {
    // Empty state
    const htmlEmpty = renderToString(
      React.createElement(WaypointTimeline, {
        items: [],
        showDate: '2026-11-22',
        day: mockDay,
        setTab: () => {},
        activeItemId: null,
      })
    )
    expect(htmlEmpty).toContain('Nothing planned for this day yet')

    // Populated state
    const htmlPopulated = renderToString(
      React.createElement(WaypointTimeline, {
        items: [
          { id: 's1', title: 'Breakfast', time: '09:00', kind: 'food', place: 'Prema Cafe' },
          { id: 's2', title: 'Fort Walk', time: '11:30', kind: 'place', place: 'Mirjan Fort' },
        ],
        showDate: '2026-11-22',
        day: mockDay,
        setTab: () => {},
        activeItemId: 's1',
      })
    )
    expect(htmlPopulated).toContain('Breakfast')
    expect(htmlPopulated).toContain('09:00 AM')
    expect(htmlPopulated).toContain('Mirjan Fort')
  })
})

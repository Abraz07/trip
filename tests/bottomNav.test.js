import { describe, it, expect } from 'vitest'
import BottomNav, { CompassIcon, CalendarIcon, MapIcon, SplitsIcon, PlusIcon, CameraIcon, HubIcon } from '../src/components/BottomNav'

describe('BottomNav Component', () => {
  it('exports BottomNav as default and all vector icon components', () => {
    expect(BottomNav).toBeDefined()
    expect(typeof BottomNav).toBe('function')
    expect(CompassIcon).toBeDefined()
    expect(CalendarIcon).toBeDefined()
    expect(MapIcon).toBeDefined()
    expect(SplitsIcon).toBeDefined()
    expect(PlusIcon).toBeDefined()
    expect(CameraIcon).toBeDefined()
    expect(HubIcon).toBeDefined()
  })

  it('renders SVG icon elements with correct viewBox and geometry', () => {
    const compass = CompassIcon({ className: 'size-5', active: true })
    expect(compass).toBeDefined()
    expect(compass.props.viewBox).toBe('0 0 24 24')

    const plus = PlusIcon({ className: 'size-6' })
    expect(plus).toBeDefined()
    expect(plus.props.viewBox).toBe('0 0 24 24')
  })
})

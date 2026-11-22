import { useEffect, useRef, useState } from 'react'
import { update } from './data'

// Stops sort by day, then time (stops without a time last), then the manual `order` set by dragging.
export const stopOrder = (a, b) =>
  (a.date || '').localeCompare(b.date || '') ||
  (a.time || '99').localeCompare(b.time || '99') ||
  (a.order ?? 0) - (b.order ?? 0)

// Save a new order for one day's stops: the time slots stay where they are and the stops move between
// them (moving the 16:00 fort to the top makes it the 09:00 stop). Durations travel with their stop.
export function saveDayOrder(tripId, ordered) {
  const slots = ordered.map((i) => i.time || '').sort((a, b) => (a || '99').localeCompare(b || '99'))
  return Promise.all(ordered.map((i, k) => ((i.time || '') === slots[k] && i.order === k
    ? null
    : update(tripId, 'plan', i.id, { time: slots[k], order: k }))))
}

const HOLD_MS = 320 // press-and-hold before a row lifts; a quick tap stays a tap
const SLOP = 8 // px of movement that cancels the hold (the person is scrolling)

// Press-and-hold drag to reorder rows in a list, for touch and mouse. Rows only move within their group
// (e.g. a day). Returns props for each row plus the live drag state for styling.
export function useDragReorder({ items, groupOf = () => 'all', onReorder }) {
  const [drag, setDrag] = useState(null) // { id, group, target }
  const rows = useRef({})
  const press = useRef(null)
  const suppressClick = useRef(false)

  // While dragging, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!drag) return
    const block = (e) => e.cancelable && e.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [!!drag]) // eslint-disable-line react-hooks/exhaustive-deps

  function groupIds(group) {
    return items.filter((i) => groupOf(i) === group).map((i) => i.id)
  }

  // Where the held row should go: the number of *other* rows in its group whose middle is above the finger.
  // Works on the rows as currently displayed, so it stays right while the list reorders live.
  function targetIndex(group, heldId, clientY) {
    let t = 0
    for (const id of groupIds(group)) {
      if (id === heldId) continue
      const el = rows.current[id]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.top + r.height / 2 < clientY) t++
    }
    return t
  }

  function end(commit) {
    clearTimeout(press.current?.timer)
    const d = drag
    press.current = null
    setDrag(null)
    if (!commit || !d) return
    const ids = groupIds(d.group)
    const from = ids.indexOf(d.id)
    if (from < 0 || d.target === from) return
    const group = items.filter((i) => groupOf(i) === d.group)
    const moved = group.splice(from, 1)[0]
    group.splice(d.target, 0, moved)
    onReorder(group, d.group)
  }

  function rowProps(item) {
    return {
      ref: (el) => { rows.current[item.id] = el },
      onPointerDown: (e) => {
        if (e.button && e.button !== 0) return
        const start = { x: e.clientX, y: e.clientY }
        press.current = {
          start,
          timer: setTimeout(() => {
            const group = groupOf(item)
            if (groupIds(group).length < 2) return
            navigator.vibrate?.(12)
            suppressClick.current = true
            setDrag({ id: item.id, group, target: groupIds(group).indexOf(item.id) })
          }, HOLD_MS),
        }
        try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
      },
      onPointerMove: (e) => {
        const p = press.current
        if (!p) return
        if (!drag) {
          if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) > SLOP) { clearTimeout(p.timer); press.current = null }
          return
        }
        if (drag.id !== item.id) return
        const target = targetIndex(drag.group, drag.id, e.clientY)
        if (target !== drag.target) setDrag({ ...drag, target })
      },
      onPointerUp: () => end(true),
      onPointerCancel: () => end(false),
      onClickCapture: (e) => {
        // A finished drag shouldn't also count as a tap on the row.
        if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false }
      },
      onContextMenu: (e) => e.preventDefault(), // long-press menu on Android/desktop
      style: drag?.id === item.id
        ? { transform: 'scale(1.02)', zIndex: 20, position: 'relative', boxShadow: '0 10px 25px rgba(0,0,0,.18)', background: '#fff7ed', touchAction: 'none', userSelect: 'none', transition: 'box-shadow .15s' }
        : { userSelect: drag ? 'none' : undefined, WebkitUserSelect: 'none', WebkitTouchCallout: 'none' },
    }
  }

  // The list as it should look right now: while dragging, the held row sits where it would drop.
  function preview(list) {
    if (!drag) return list
    const group = list.filter((i) => groupOf(i) === drag.group)
    const from = group.findIndex((i) => i.id === drag.id)
    if (from < 0) return list
    const moved = group.splice(from, 1)[0]
    group.splice(drag.target, 0, moved)
    let g = 0
    return list.map((i) => (groupOf(i) === drag.group ? group[g++] : i))
  }

  return { drag, rowProps, preview }
}

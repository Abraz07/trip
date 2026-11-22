import { askJSON } from './ai'

// Match a name the AI returned to a trip member id. "me"/"I"/"myself" → the current user.
export function resolvePerson(name, members, uid) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  if (['me', 'i', 'myself', 'you', 'mine'].includes(n)) return uid
  const exact = members.find((m) => (m.name || '').toLowerCase() === n)
  if (exact) return exact.id
  const starts = members.filter((m) => (m.name || '').toLowerCase().startsWith(n) || n.startsWith((m.name || '').toLowerCase()))
  if (starts.length === 1) return starts[0].id
  const first = members.filter((m) => (m.name || '').toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0])
  return first.length === 1 ? first[0].id : null
}

const peopleList = (members, uid) => members.map((m) => (m.id === uid ? `${m.name} (this is "me"/"I")` : m.name)).join(', ')

// Chat turn on a scanned bill: returns new per-item assignments (arrays of member ids), optional payer, and a reply.
export async function splitChat({ items, assign, members, uid, paidBy, history, message }) {
  const itemLines = items.map((it, i) => `${i}. ${it.name} — ₹${it.price} — currently: ${(assign[i] || []).map((u) => members.find((m) => m.id === u)?.name).join(', ') || 'nobody'}`).join('\n')
  const out = await askJSON({
    system: `You split restaurant bills for a group of friends. Group members: ${peopleList(members, uid)}.
Only use these exact member names. "everyone"/"all"/"shared" means every member. Apply the user's instruction to the CURRENT assignments, changing only what they mention.
If a name doesn't match any member, list it in "unknown". Keep "reply" to one short, friendly sentence summarising what you changed.`,
    parts: [
      `Bill items (index. name — price — who currently has it):\n${itemLines}\nCurrently paid by: ${members.find((m) => m.id === paidBy)?.name || 'unknown'}`,
      ...(history.length ? [`Earlier messages:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n')}`] : []),
      `User says: ${message}`,
    ],
    schema: {
      type: 'OBJECT',
      properties: {
        assignments: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'INTEGER' }, people: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['item', 'people'] } },
        paidBy: { type: 'STRING', description: 'member name if the user said who paid, else empty' },
        unknown: { type: 'ARRAY', items: { type: 'STRING' } },
        reply: { type: 'STRING' },
      },
      required: ['assignments', 'reply'],
    },
    temperature: 0.1,
  })
  const next = assign.map((a) => [...a])
  for (const a of out.assignments || []) {
    if (!Number.isInteger(a.item) || a.item < 0 || a.item >= items.length) continue
    const ids = [...new Set((a.people || []).map((p) => resolvePerson(p, members, uid)).filter(Boolean))]
    if (ids.length) next[a.item] = ids
  }
  const payer = out.paidBy ? resolvePerson(out.paidBy, members, uid) : null
  return { assign: next, paidBy: payer, reply: out.reply || 'Updated.', unknown: out.unknown || [] }
}

// No photo: turn "Dinner 1450 at Namaste, Ravi paid, I skipped dessert…" into a bill + assignments.
export async function describeBill({ message, members, uid }) {
  const out = await askJSON({
    system: `You turn a spoken description of a group expense into a bill. Group members: ${peopleList(members, uid)}. Only use these names; "everyone" means all members.
If no item breakdown is given, make a single item with the whole amount. Amounts are in Indian rupees.`,
    parts: [message],
    schema: {
      type: 'OBJECT',
      properties: {
        merchant: { type: 'STRING' },
        items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, price: { type: 'NUMBER' }, people: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['name', 'price', 'people'] } },
        extras: { type: 'NUMBER', description: 'tax/service/tip on top of items, 0 if none' },
        paidBy: { type: 'STRING' },
        reply: { type: 'STRING' },
      },
      required: ['items', 'reply'],
    },
    temperature: 0.1,
  })
  const everyone = members.map((m) => m.id)
  const items = (out.items || []).filter((i) => Number(i.price) > 0).map((i) => ({ name: i.name, price: Math.round(Number(i.price) * 100) / 100, qty: 1 }))
  const assign = (out.items || []).filter((i) => Number(i.price) > 0).map((i) => {
    const ids = [...new Set((i.people || []).map((p) => resolvePerson(p, members, uid)).filter(Boolean))]
    return ids.length ? ids : everyone
  })
  return {
    bill: { merchant: out.merchant || '', items, extras: Math.round((Number(out.extras) || 0) * 100) / 100 },
    assign,
    paidBy: out.paidBy ? resolvePerson(out.paidBy, members, uid) : null,
    reply: out.reply || '',
  }
}

import { describe, it, expect } from 'vitest'
import { balances, settleUp, equalSplit, inr, upiLink } from '../src/settle'
import { itemSplits } from '../src/scan'

describe('Equal Split Algorithm', () => {
  it('splits cleanly divisible amounts equally', () => {
    const splits = equalSplit(120, ['alice', 'bob', 'charlie'])
    expect(splits).toEqual({
      alice: 40,
      bob: 40,
      charlie: 40,
    })
    const sum = Object.values(splits).reduce((a, b) => a + b, 0)
    expect(sum).toBe(120)
  })

  it('handles indivisible amounts by allocating remainder paise to first member', () => {
    const splits = equalSplit(100, ['alice', 'bob', 'charlie'])
    // 100 / 3 = 33.33 each, remainder 0.01 to first
    expect(splits.bob).toBe(33.33)
    expect(splits.charlie).toBe(33.33)
    expect(splits.alice).toBe(33.34)

    const sum = Object.values(splits).reduce((a, b) => a + b, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
  })

  it('handles single person split', () => {
    const splits = equalSplit(450.50, ['alice'])
    expect(splits).toEqual({ alice: 450.50 })
  })

  it('conserves money across 7 people without floating point drift', () => {
    const total = 1000
    const members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
    const splits = equalSplit(total, members)
    const sum = Object.values(splits).reduce((a, b) => a + b, 0)
    expect(Math.round(sum * 100) / 100).toBe(total)
  })
})

describe('Balances Calculation', () => {
  it('calculates net zero balance for equal single expense', () => {
    const members = [{ id: 'alice' }, { id: 'bob' }]
    const expenses = [
      { amount: 200, paidBy: 'alice', splits: { alice: 100, bob: 100 } },
    ]
    const bal = balances(expenses, members)
    expect(bal.alice).toBe(100)
    expect(bal.bob).toBe(-100)
    expect(bal.alice + bal.bob).toBe(0)
  })

  it('accurately accumulates multiple expenses across different payers', () => {
    const members = [{ id: 'alice' }, { id: 'bob' }, { id: 'charlie' }]
    const expenses = [
      // Alice pays 300 for dinner split 3 ways
      { amount: 300, paidBy: 'alice', splits: { alice: 100, bob: 100, charlie: 100 } },
      // Bob pays 150 for cab split 3 ways
      { amount: 150, paidBy: 'bob', splits: { alice: 50, bob: 50, charlie: 50 } },
    ]
    const bal = balances(expenses, members)
    // Alice: paid 300, owes 100 + 50 = 150 -> net +150
    // Bob: paid 150, owes 100 + 50 = 150 -> net 0
    // Charlie: paid 0, owes 100 + 50 = 150 -> net -150
    expect(bal.alice).toBe(150)
    expect(bal.bob).toBe(0)
    expect(bal.charlie).toBe(-150)

    // Sum of all balances in closed system must strictly equal zero
    const sum = Object.values(bal).reduce((a, b) => a + b, 0)
    expect(sum).toBe(0)
  })
})

describe('Settle Up (Debt Minimization Algorithm)', () => {
  it('minimizes circular debt from A -> B -> C into direct A -> C', () => {
    // Alice owes 100, Charlie gets 100, Bob is square
    const bal = {
      alice: -100,
      bob: 0,
      charlie: 100,
    }
    const transfers = settleUp(bal)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toEqual({
      from: 'alice',
      to: 'charlie',
      amount: 100,
    })
  })

  it('guarantees at most N - 1 transfers for complex 4-person debt', () => {
    const bal = {
      p1: -300,
      p2: -200,
      p3: 150,
      p4: 350,
    }
    const transfers = settleUp(bal)
    // 4 people with non-zero balances => at most 3 transfers
    expect(transfers.length).toBeLessThanOrEqual(3)

    // Total debt settled must equal total credit
    const totalSettled = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalSettled).toBe(500)

    // Verify each transfer goes from a debtor to a creditor
    transfers.forEach((t) => {
      expect(['p1', 'p2']).toContain(t.from)
      expect(['p3', 'p4']).toContain(t.to)
      expect(t.amount).toBeGreaterThan(0)
    })
  })

  it('returns empty array when all balances are square', () => {
    const bal = { alice: 0, bob: 0, charlie: 0 }
    expect(settleUp(bal)).toEqual([])
  })

  it('ignores minor floating point dust under 50 paise', () => {
    const bal = { alice: -0.2, bob: 0.2 }
    expect(settleUp(bal)).toEqual([])
  })
})

describe('Itemized Bill Splits (AI Receipt Engine)', () => {
  it('proportionally distributes tax and service charges according to item totals', () => {
    const items = [
      { name: 'Pizza', price: 400 },
      { name: 'Pasta', price: 200 },
    ]
    // Pizza consumed by Alice & Bob (200 each)
    // Pasta consumed by Charlie (200)
    // Subtotal: 600, Grand total with tax: 660 (10% extra)
    const assign = [
      ['alice', 'bob'],
      ['charlie'],
    ]
    const total = 660
    const splits = itemSplits(items, assign, total)

    // Each person gets 10% tax on their 200 subtotal = 220 each
    expect(splits.alice).toBe(220)
    expect(splits.bob).toBe(220)
    expect(splits.charlie).toBe(220)

    const sum = Object.values(splits).reduce((a, b) => a + b, 0)
    expect(sum).toBe(660)
  })

  it('reconciles rounding differences to match exact grand total', () => {
    const items = [
      { name: 'Coffee', price: 100 },
      { name: 'Tea', price: 100 },
      { name: 'Pastry', price: 100 },
    ]
    const assign = [
      ['alice'],
      ['bob'],
      ['charlie'],
    ]
    const total = 333.35 // non-divisible total
    const splits = itemSplits(items, assign, total)
    const sum = Object.values(splits).reduce((a, b) => a + b, 0)
    expect(Math.round(sum * 100) / 100).toBe(total)
  })
})

describe('Formatting & UPI Deep Links', () => {
  it('formats Indian rupee amounts with appropriate locale separators', () => {
    expect(inr(500)).toBe('₹500')
    expect(inr(1500)).toBe('₹1,500')
    expect(inr(100000)).toBe('₹1,00,000')
  })

  it('generates standard valid UPI deep link with URI encoding', () => {
    const link = upiLink({
      vpa: 'user@okaxis',
      name: 'Rohan Sharma',
      amount: 450,
      note: 'Yatra trip settle-up',
    })
    expect(link).toContain('upi://pay?')
    expect(link).toContain('pa=user%40okaxis')
    expect(link).toContain('pn=Rohan%20Sharma')
    expect(link).toContain('am=450')
    expect(link).toContain('cu=INR')
  })
})

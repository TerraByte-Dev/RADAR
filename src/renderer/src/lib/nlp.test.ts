import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './nlp'

// Fixed reference: Tuesday, 26 May 2026, 09:00 local time.
const REF = new Date(2026, 4, 26, 9, 0, 0)

describe('parseQuickAdd', () => {
  it('parses the full Todoist-style line', () => {
    const r = parseQuickAdd('Pay rent tomorrow 5pm p1 #finance @home', REF)
    expect(r.title).toBe('Pay rent')
    expect(r.priority).toBe('P1')
    expect(r.projectName).toBe('finance')
    expect(r.tags).toEqual(['home'])
    expect(r.due?.hasTime).toBe(true)
    const due = new Date(r.due!.date)
    expect(due.getDate()).toBe(27)
    expect(due.getHours()).toBe(17)
  })

  it('parses priority with no date', () => {
    const r = parseQuickAdd('Buy milk p3', REF)
    expect(r.title).toBe('Buy milk')
    expect(r.priority).toBe('P3')
    expect(r.due).toBeUndefined()
  })

  it('supports the !n priority shorthand', () => {
    const r = parseQuickAdd('!1 urgent thing', REF)
    expect(r.priority).toBe('P1')
    expect(r.title).toBe('urgent thing')
  })

  it('parses an all-day date (no time) and a project', () => {
    const r = parseQuickAdd('Call dentist friday #health', REF)
    expect(r.title).toBe('Call dentist')
    expect(r.projectName).toBe('health')
    expect(r.due?.hasTime).toBe(false)
    expect(new Date(r.due!.date).getDate()).toBe(29) // Fri 29 May 2026
  })

  it('collects multiple tags', () => {
    const r = parseQuickAdd('Review PR @work @urgent', REF)
    expect(r.title).toBe('Review PR')
    expect(r.tags).toEqual(['work', 'urgent'])
  })

  it('leaves a plain task untouched', () => {
    const r = parseQuickAdd('just a plain task', REF)
    expect(r.title).toBe('just a plain task')
    expect(r.priority).toBe('none')
    expect(r.tags).toEqual([])
    expect(r.due).toBeUndefined()
    expect(r.projectName).toBeUndefined()
  })
})

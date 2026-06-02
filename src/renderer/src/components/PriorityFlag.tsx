import { Flag } from 'lucide-react'
import type { Priority } from '@shared/types'

const COLOR: Record<Priority, string> = {
  P1: 'text-p1',
  P2: 'text-p2',
  P3: 'text-p3',
  P4: 'text-p4',
  none: 'text-faint'
}

export function PriorityFlag({ priority }: { priority: Priority }): JSX.Element | null {
  if (priority === 'none') return null
  return <Flag size={13} className={`${COLOR[priority]} shrink-0`} fill="currentColor" />
}

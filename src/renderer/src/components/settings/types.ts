import type { ComponentType, ReactNode } from 'react'

/** One tab in the Settings rail. `keywords` is a searchable bag-of-words covering this section's rows. */
export interface SectionDef {
  id: string
  label: string
  keywords: string
  icon: ReactNode
  Component: ComponentType
}

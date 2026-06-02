import type { TodoApi } from '../shared/types'

declare global {
  interface Window {
    api: TodoApi
  }
}

export {}

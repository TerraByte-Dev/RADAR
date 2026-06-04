import type { TodoApi } from '../shared/types'
import type { RadarApi } from '../shared/radar'

declare global {
  interface Window {
    api: TodoApi
    radar: RadarApi
  }
}

export {}

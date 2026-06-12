import type { AppApi } from '../shared/types'
import type { RadarApi } from '../shared/radar'

declare global {
  interface Window {
    api: AppApi
    radar: RadarApi
  }
}

export {}

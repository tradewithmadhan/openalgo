/**
 * Madhan Signal Store — sub-toggles for individual signal types.
 *
 * Works with alertStore.madhan (master toggle).
 * Master ON + sub-toggle ON → toast shown.
 *
 * Persisted in localStorage so toggles survive page refresh.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface MadhanSignalToggles {
  atp_ltp_signal: boolean
  // Future signal types:
  // volume_spike: boolean
  // th_touch: boolean
  // coi_trend: boolean
  // support_resistance: boolean
}

interface MadhanSignalStore extends MadhanSignalToggles {
  setToggle: <K extends keyof MadhanSignalToggles>(key: K, value: boolean) => void
}

export const useMadhanSignalStore = create<MadhanSignalStore>()(
  persist(
    (set) => ({
      atp_ltp_signal: true,
      // Future defaults:
      // volume_spike: true,
      // th_touch: true,
      // coi_trend: true,
      // support_resistance: true,
      setToggle: (key, value) => set({ [key]: value }),
    }),
    {
      name: 'madhan-signal-settings',
    }
  )
)

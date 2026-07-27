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
  volume_spike: boolean
}

interface MadhanSignalStore extends MadhanSignalToggles {
  setToggle: <K extends keyof MadhanSignalToggles>(key: K, value: boolean) => void
}

export const useMadhanSignalStore = create<MadhanSignalStore>()(
  persist(
    (set) => ({
      atp_ltp_signal: true,
      volume_spike: true,
      setToggle: (key, value) => set({ [key]: value }),
    }),
    {
      name: 'madhan-signal-settings',
    }
  )
)

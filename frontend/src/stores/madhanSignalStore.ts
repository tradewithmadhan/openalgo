/**
 * Madhan Signal Store — sub-toggles for individual signal types.
 *
 * Works with alertStore.madhan (master toggle).
 * Master ON + sub-toggle ON → toast shown.
 *
 * Per-instrument: atp_ltp_nifty, atp_ltp_banknifty, volume_spike_nifty, volume_spike_banknifty.
 * Legacy flat toggles kept for backward compat; new UI uses per-instrument fields.
 *
 * Persisted in localStorage so toggles survive page refresh.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface MadhanSignalToggles {
  atp_ltp_signal: boolean
  volume_spike: boolean
  atp_ltp_nifty: boolean
  atp_ltp_banknifty: boolean
  volume_spike_nifty: boolean
  volume_spike_banknifty: boolean
}

interface MadhanSignalStore extends MadhanSignalToggles {
  setToggle: <K extends keyof MadhanSignalToggles>(key: K, value: boolean) => void
}

export const useMadhanSignalStore = create<MadhanSignalStore>()(
  persist(
    (set) => ({
      atp_ltp_signal: true,
      volume_spike: true,
      atp_ltp_nifty: true,
      atp_ltp_banknifty: true,
      volume_spike_nifty: true,
      volume_spike_banknifty: true,
      setToggle: (key, value) => set({ [key]: value }),
    }),
    {
      name: 'madhan-signal-settings',
    }
  )
)

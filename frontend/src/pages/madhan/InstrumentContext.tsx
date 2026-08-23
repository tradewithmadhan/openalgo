import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Instrument = 'NIFTY' | 'BANKNIFTY'

interface InstrumentContextType {
  instrument: Instrument
  setInstrument: (inst: Instrument) => void
  strikeStep: number
  lotSize: number
  spotSymbol: Instrument
}

const STORAGE_KEY = 'madhan-instrument'

function getStoredInstrument(): Instrument {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'NIFTY' || stored === 'BANKNIFTY') return stored
  } catch {}
  return 'NIFTY'
}

const InstrumentContext = createContext<InstrumentContextType>({
  instrument: 'NIFTY',
  setInstrument: () => {},
  strikeStep: 50,
  lotSize: 65,
  spotSymbol: 'NIFTY',
})

export function InstrumentProvider({ children }: { children: ReactNode }) {
  const [instrument, setInstrument] = useState<Instrument>(getStoredInstrument)
  const strikeStep = instrument === 'BANKNIFTY' ? 100 : 50
  const lotSize = instrument === 'BANKNIFTY' ? 30 : 65

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, instrument) } catch {}
  }, [instrument])

  return (
    <InstrumentContext.Provider value={{ instrument, setInstrument, strikeStep, lotSize, spotSymbol: instrument }}>
      {children}
    </InstrumentContext.Provider>
  )
}

export function useInstrument() {
  return useContext(InstrumentContext)
}

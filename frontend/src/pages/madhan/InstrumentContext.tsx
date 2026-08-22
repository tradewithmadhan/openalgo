import { createContext, useContext, useState, type ReactNode } from 'react'

export type Instrument = 'NIFTY' | 'BANKNIFTY'

interface InstrumentContextType {
  instrument: Instrument
  setInstrument: (inst: Instrument) => void
  strikeStep: number
  spotSymbol: Instrument
}

const InstrumentContext = createContext<InstrumentContextType>({
  instrument: 'NIFTY',
  setInstrument: () => {},
  strikeStep: 50,
  spotSymbol: 'NIFTY',
})

export function InstrumentProvider({ children }: { children: ReactNode }) {
  const [instrument, setInstrument] = useState<Instrument>('NIFTY')
  const strikeStep = instrument === 'BANKNIFTY' ? 100 : 50
  return (
    <InstrumentContext.Provider value={{ instrument, setInstrument, strikeStep, spotSymbol: instrument }}>
      {children}
    </InstrumentContext.Provider>
  )
}

export function useInstrument() {
  return useContext(InstrumentContext)
}

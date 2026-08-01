import { useState, useEffect, useMemo, useCallback } from 'react'
import { useThemeStore } from '@/stores/themeStore'

type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'madhan-theme-mode'
const EVENT_NAME = 'madhan-theme-change'

const darkVars: Record<string, string> = {
  '--background': 'oklch(0.145 0 0)',
  '--foreground': 'oklch(0.985 0 0)',
  '--card': 'oklch(0.205 0 0)',
  '--card-foreground': 'oklch(0.985 0 0)',
  '--popover': 'oklch(0.205 0 0)',
  '--popover-foreground': 'oklch(0.985 0 0)',
  '--primary': 'oklch(0.922 0 0)',
  '--primary-foreground': 'oklch(0.205 0 0)',
  '--secondary': 'oklch(0.269 0 0)',
  '--secondary-foreground': 'oklch(0.985 0 0)',
  '--muted': 'oklch(0.269 0 0)',
  '--muted-foreground': 'oklch(0.708 0 0)',
  '--accent': 'oklch(0.269 0 0)',
  '--accent-foreground': 'oklch(0.985 0 0)',
  '--destructive': 'oklch(0.704 0.191 22.216)',
  '--border': 'oklch(1 0 0 / 10%)',
  '--input': 'oklch(1 0 0 / 15%)',
  '--ring': 'oklch(0.556 0 0)',
}

const lightVars: Record<string, string> = {
  '--background': 'oklch(1 0 0)',
  '--foreground': 'oklch(0.145 0 0)',
  '--card': 'oklch(1 0 0)',
  '--card-foreground': 'oklch(0.145 0 0)',
  '--popover': 'oklch(1 0 0)',
  '--popover-foreground': 'oklch(0.145 0 0)',
  '--primary': 'oklch(0.205 0 0)',
  '--primary-foreground': 'oklch(0.985 0 0)',
  '--secondary': 'oklch(0.97 0 0)',
  '--secondary-foreground': 'oklch(0.205 0 0)',
  '--muted': 'oklch(0.97 0 0)',
  '--muted-foreground': 'oklch(0.556 0 0)',
  '--accent': 'oklch(0.97 0 0)',
  '--accent-foreground': 'oklch(0.205 0 0)',
  '--destructive': 'oklch(0.577 0.245 27.325)',
  '--border': 'oklch(0.922 0 0)',
  '--input': 'oklch(0.922 0 0)',
  '--ring': 'oklch(0.708 0 0)',
}

const allKeys = Object.keys(darkVars)

function applyVars(vars: Record<string, string>) {
  const root = document.documentElement
  for (const key of allKeys) {
    root.style.setProperty(key, vars[key])
  }
}

function clearVars() {
  const root = document.documentElement
  for (const key of allKeys) {
    root.style.removeProperty(key)
  }
}

let _sharedMode: ThemeMode = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {}
  return 'dark'
})()

function setSharedMode(mode: ThemeMode) {
  if (_sharedMode === mode) return
  _sharedMode = mode
  try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode } }))
}

export function useMadhanTheme() {
  const { mode: globalMode, appMode } = useThemeStore()
  const [, forceRender] = useState(0)

  useEffect(() => {
    const handler = () => forceRender(n => n + 1)
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const toggleMode = useCallback(() => {
    if (appMode === 'live') {
      useThemeStore.getState().toggleMode()
    } else {
      setSharedMode(_sharedMode === 'dark' ? 'light' : 'dark')
    }
  }, [appMode])

  const mode = appMode === 'live' ? globalMode : _sharedMode
  const isDark = mode === 'dark'

  useEffect(() => {
    if (appMode !== 'analyzer') return
    applyVars(isDark ? darkVars : lightVars)
    document.documentElement.classList.toggle('dark', isDark)
    return () => {
      clearVars()
      document.documentElement.classList.remove('dark')
    }
  }, [isDark, appMode])

  const style = useMemo(() => (isDark ? darkVars : lightVars) as React.CSSProperties, [isDark])

  return { mode, toggleMode, isDark, style }
}

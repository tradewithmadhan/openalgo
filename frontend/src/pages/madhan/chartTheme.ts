export const chartTheme = {
  dark: {
    panel: '#1e222d',
    panelDarker: '#131722',
    border: '#2a2e39',
    text: '#d1d4dc',
    textSecondary: '#787b86',
    textMuted: '#4a4e59',
    badge: '#363a45',
    active: '#2962ff',
    danger: '#f23645',
    hover: '#2a2e39',
    activeBg: 'rgba(41,98,255,0.2)',
  },
  light: {
    panel: '#ffffff',
    panelDarker: '#f8f9fa',
    border: '#e5e7eb',
    text: '#1f2937',
    textSecondary: '#6b7280',
    textMuted: '#9ca3af',
    badge: '#e5e7eb',
    active: '#2563eb',
    danger: '#dc2626',
    hover: '#f3f4f6',
    activeBg: 'rgba(37,99,235,0.1)',
  },
} as const

export type ChartColors = (typeof chartTheme)['dark']

import { useState, useRef, useEffect, useCallback } from 'react'
import { type DrawingManager } from 'lightweight-charts-drawing'
import { Trash2, Lock, Unlock, Copy, MoreHorizontal, GripVertical } from 'lucide-react'
import { useMadhanTheme } from './useMadhanTheme'
import { chartTheme } from './chartTheme'

interface FloatingDrawingToolbarProps {
  drawingManager: DrawingManager | null
  selectedDrawingId: string | null
  onUpdate: () => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
}

const COLOR_PALETTE = [
  '#000000', '#1a1a2e', '#2d2d44', '#424258', '#5c5c72', '#78788c', '#9696a8', '#b4b4c2', '#d4d4dc', '#ffffff',
  '#b71c1c', '#c62828', '#d32f2f', '#e53935', '#ef5350', '#f44336', '#e57373', '#ef9a9a', '#ffcdd2', '#ffebee',
  '#e65100', '#ef6c00', '#f57c00', '#fb8c00', '#ff9800', '#ffa726', '#ffb74d', '#ffcc80', '#ffe0b2', '#fff3e0',
  '#f9a825', '#fbc02d', '#fdd835', '#ffee58', '#fff176', '#fff59d', '#fff9c4', '#fffde7', '#f0f4c3', '#dce775',
  '#1b5e20', '#2e7d32', '#388e3c', '#43a047', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9',
  '#004d40', '#00695c', '#00796b', '#00897b', '#009688', '#26a69a', '#4db6ac', '#80cbc4', '#b2dfdb', '#e0f2f1',
  '#0d47a1', '#1565c0', '#1976d2', '#1e88e5', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9', '#bbdefb', '#e3f2fd',
  '#4a148c', '#6a1b9a', '#7b1fa2', '#8e24aa', '#9c27b0', '#ab47bc', '#ba68c8', '#ce93d8', '#e1bee7', '#f3e5f5',
  '#880e4f', '#ad1457', '#c2185b', '#d81b60', '#e91e63', '#ec407a', '#f06292', '#f48fb1', '#f8bbd0', '#fce4ec',
  '#311b92', '#4527a0', '#512da8', '#5e35b1', '#673ab7', '#7e57c2', '#9575cd', '#b39ddb', '#d1c4e9', '#ede7f6',
]

const LINE_WIDTHS = [1, 2, 3, 4]

const LINE_STYLES: { label: string; value: number[] | undefined; svg: string }[] = [
  { label: 'Solid', value: undefined, svg: 'M2 6 L22 6' },
  { label: 'Dashed', value: [6, 4], svg: 'M2 6 L8 6 M12 6 L18 6' },
  { label: 'Dotted', value: [2, 3], svg: 'M2 6 L3 6 M7 6 L8 6 M12 6 L13 6 M17 6 L18 6' },
]

export default function FloatingDrawingToolbar({
  drawingManager,
  selectedDrawingId,
  onUpdate,
  onDelete,
  onDuplicate,
}: FloatingDrawingToolbarProps) {
  const { mode } = useMadhanTheme()
  const t = chartTheme[mode]
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showWidthStyle, setShowWidthStyle] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elX: number; elY: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = dragRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, elX: rect.left, elY: rect.top }
    const handleMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = ev.clientX - dragStartRef.current.mouseX
      const dy = ev.clientY - dragStartRef.current.mouseY
      setPos({ x: dragStartRef.current.elX + dx, y: dragStartRef.current.elY + dy })
    }
    const handleUp = () => {
      dragStartRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [])

  useEffect(() => {
    setPos(null)
  }, [selectedDrawingId])
  const colorRef = useRef<HTMLDivElement>(null)
  const widthStyleRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as HTMLElement)) setShowColorPicker(false)
      if (widthStyleRef.current && !widthStyleRef.current.contains(e.target as HTMLElement)) setShowWidthStyle(false)
      if (moreRef.current && !moreRef.current.contains(e.target as HTMLElement)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!drawingManager || !selectedDrawingId) return null

  const drawing = drawingManager.getDrawing(selectedDrawingId)
  if (!drawing) return null

  const lineColor = drawing.style.lineColor || t.textSecondary
  const lineWidth = drawing.style.lineWidth || 1
  const lineDash = drawing.style.lineDash
  const isLocked = drawing.options.locked === true

  const setColor = (color: string) => {
    drawing.updateStyle({ lineColor: color })
    drawing.requestUpdate()
    onUpdate()
    setShowColorPicker(false)
  }

  const setLineWidth = (w: number) => {
    drawing.updateStyle({ lineWidth: w })
    drawing.requestUpdate()
    onUpdate()
  }

  const setLineDash = (dash: number[] | undefined) => {
    drawing.updateStyle({ lineDash: dash })
    drawing.requestUpdate()
    onUpdate()
  }

  const toggleLock = () => {
    drawing.updateOptions({ locked: !isLocked })
    drawing.requestUpdate()
    onUpdate()
  }

  const currentLineStyle = LINE_STYLES.findIndex(
    (s) => JSON.stringify(s.value) === JSON.stringify(lineDash)
  )

  return (
    <div
      ref={dragRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg px-1 py-1 shadow-xl"
      style={{
        backgroundColor: t.panelDarker,
        border: `1px solid ${t.border}`,
        left: pos?.x ?? undefined,
        top: pos?.y ?? undefined,
        ...(pos ? {} : { left: '50%', top: 12, transform: 'translateX(-50%)' }),
      }}
    >
      {/* Drag handle */}
      <button
        className="flex h-7 w-5 cursor-grab items-center justify-center rounded active:cursor-grabbing"
        style={{ color: t.textSecondary }}
        title="Drag"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="mx-0.5 h-5 w-px" style={{ backgroundColor: t.border }} />

      {/* Color picker */}
      <div className="relative" ref={colorRef}>
        <button
          className="flex h-7 w-7 items-center justify-center rounded transition-colors"
          title="Color"
          onClick={() => { setShowColorPicker(!showColorPicker); setShowWidthStyle(false) }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
        >
          <span className="h-4 w-4 rounded-full border-2" style={{ backgroundColor: lineColor, borderColor: t.border }} />
        </button>
        {showColorPicker && (
          <div
            className="absolute left-0 top-full z-50 mt-1 rounded-lg p-2 shadow-xl"
            style={{ backgroundColor: t.panelDarker, border: `1px solid ${t.border}` }}
          >
            <div className="grid grid-cols-10 gap-0.5">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  className="h-4.5 w-4.5 rounded-sm transition-transform hover:scale-125"
                  style={{
                    backgroundColor: c,
                    border: lineColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.08)',
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: t.border }}>
              <span className="text-[10px]" style={{ color: t.textSecondary }}>Custom</span>
              <input
                type="color"
                className="h-5 w-8 cursor-pointer rounded bg-transparent"
                value={lineColor}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mx-0.5 h-5 w-px" style={{ backgroundColor: t.border }} />

      {/* Line width + style dropdown */}
      <div className="relative" ref={widthStyleRef}>
        <button
          className="flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors"
          style={{ color: t.text }}
          title="Width & Style"
          onClick={() => { setShowWidthStyle(!showWidthStyle); setShowColorPicker(false) }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
        >
          <span>{lineWidth}px</span>
          <svg viewBox="0 0 20 12" className="h-2.5 w-4" stroke={t.text} strokeWidth={lineWidth}>
            <path d={LINE_STYLES[currentLineStyle]?.svg || LINE_STYLES[0].svg} fill="none" />
          </svg>
        </button>
        {showWidthStyle && (
          <div
            className="absolute left-0 top-full z-50 mt-1 rounded-lg p-2 shadow-xl"
            style={{ backgroundColor: t.panelDarker, border: `1px solid ${t.border}` }}
          >
            <div className="mb-2 text-[10px] font-medium" style={{ color: t.textSecondary }}>Width</div>
            <div className="mb-3 flex gap-1">
              {LINE_WIDTHS.map((w) => (
                <button
                  key={w}
                  className="flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: lineWidth === w ? t.active : t.hover,
                    color: lineWidth === w ? '#fff' : t.text,
                  }}
                  onClick={() => setLineWidth(w)}
                >
                  {w}
                </button>
              ))}
            </div>
            <div className="mb-2 text-[10px] font-medium" style={{ color: t.textSecondary }}>Style</div>
            <div className="flex gap-1">
              {LINE_STYLES.map((style, i) => (
                <button
                  key={style.label}
                  className="flex h-7 w-12 items-center justify-center rounded transition-colors"
                  style={{
                    backgroundColor: currentLineStyle === i ? t.active : t.hover,
                    color: currentLineStyle === i ? '#fff' : t.text,
                  }}
                  title={style.label}
                  onClick={() => setLineDash(style.value)}
                >
                  <svg viewBox="0 0 20 12" className="h-3 w-5" stroke="currentColor" strokeWidth={lineWidth}>
                    <path d={style.svg} fill="none" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mx-0.5 h-5 w-px" style={{ backgroundColor: t.border }} />

      {/* Lock */}
      <button
        className="flex h-7 w-7 items-center justify-center rounded transition-colors"
        style={{ color: isLocked ? '#f59e0b' : t.textSecondary }}
        title={isLocked ? 'Unlock' : 'Lock'}
        onClick={toggleLock}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
      >
        {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
      </button>

      {/* Delete */}
      <button
        className="flex h-7 w-7 items-center justify-center rounded transition-colors"
        style={{ color: t.textSecondary }}
        title="Delete"
        onClick={() => onDelete(drawing.id)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.danger; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = t.textSecondary }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* More menu */}
      <div className="relative" ref={moreRef}>
        <button
          className="flex h-7 w-7 items-center justify-center rounded transition-colors"
          style={{ color: t.textSecondary }}
          title="More"
          onClick={() => setShowMoreMenu(!showMoreMenu)}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {showMoreMenu && (
          <div
            className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg py-1 shadow-xl"
            style={{ backgroundColor: t.panelDarker, border: `1px solid ${t.border}` }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition-colors"
              style={{ color: t.text }}
              onClick={() => { onDuplicate(drawing.id); setShowMoreMenu(false) }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
            >
              <Copy className="h-3 w-3" />
              Duplicate
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

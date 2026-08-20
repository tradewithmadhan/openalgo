import { useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts'
import { DrawingManager, getToolRegistry, type IDrawing } from 'lightweight-charts-drawing'
import { TEXT_DRAWING_TYPES } from './DrawingToolbar'

const FREEHAND_TOOLS = new Set(['brush', 'highlighter'])

interface UseDrawingSystemOptions {
  chart: IChartApi | null
  series: ISeriesApi<SeriesType> | null
  chartContainer: HTMLElement | null
  onChartClick?: (param: any) => void
}

export function useDrawingSystem({ chart, series, chartContainer, onChartClick }: UseDrawingSystemOptions) {
  const [showDrawingPanel, setShowDrawingPanel] = useState(false)
  const [drawingToolbarCollapsed, setDrawingToolbarCollapsed] = useState(false)
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [editingTextDrawing, setEditingTextDrawing] = useState<IDrawing | null>(null)
  const [, setTick] = useState(0)

  const drawingManagerRef = useRef<DrawingManager | null>(null)
  const drawingAnchorsRef = useRef<{ time: Time; price: number }[]>([])
  const drawingPreviewIdRef = useRef<string | null>(null)
  const activeDrawingToolRef = useRef<string | null>(null)
  const drawingColorRef = useRef('#3b82f6')
  const lineWidthRef = useRef(2)

  const chartRef = useRef<IChartApi | null>(chart)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(series)
  const containerRef = useRef<HTMLElement | null>(chartContainer)
  const onChartClickRef = useRef(onChartClick)
  chartRef.current = chart
  seriesRef.current = series
  containerRef.current = chartContainer
  onChartClickRef.current = onChartClick

  const handleToolSelect = useCallback((toolType: string | null) => {
    if (!drawingManagerRef.current) return
    if (drawingPreviewIdRef.current) {
      drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
      drawingPreviewIdRef.current = null
    }
    drawingAnchorsRef.current = []
    drawingManagerRef.current.setActiveTool(toolType)
    setActiveDrawingTool(toolType)
    if (chartRef.current) {
      try { chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: toolType == null } }) } catch {}
    }
  }, [])

  const selectDrawingFromList = useCallback((id: string) => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.selectDrawing(id)
  }, [])

  const deleteDrawingFromList = useCallback((id: string) => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.removeDrawing(id)
    setSelectedDrawingId((prev) => (prev === id ? null : prev))
  }, [])

  const duplicateDrawingFromList = useCallback((id: string) => {
    if (!drawingManagerRef.current) return
    const original = drawingManagerRef.current.getDrawing(id)
    if (!original) return
    const newId = `${original.type}-${Date.now()}`
    const clone = original.clone(newId)
    clone.setAnchors(original.anchors.map((a) => ({ ...a })))
    drawingManagerRef.current.addDrawing(clone)
    drawingManagerRef.current.selectDrawing(newId)
  }, [])

  const clearAllDrawingsFromList = useCallback(() => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.clearAll()
    setSelectedDrawingId(null)
  }, [])

  const handleTextEditorSave = useCallback(() => {
    setEditingTextDrawing(null)
    drawingManagerRef.current?.deselectAll()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId && drawingManagerRef.current) {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
        drawingManagerRef.current.removeDrawing(selectedDrawingId)
        setSelectedDrawingId(null)
      }
      if (e.key === 'Escape' && activeDrawingTool) {
        handleToolSelect(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedDrawingId, activeDrawingTool, handleToolSelect])

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool
    if (!activeDrawingTool) drawingAnchorsRef.current = []
  }, [activeDrawingTool])

  useEffect(() => {
    if (!chart || !series || !chartContainer) return
    if (drawingManagerRef.current) return

    const container = chartContainer

    const dm = new DrawingManager()
    dm.attach(chart, series, container)
    drawingManagerRef.current = dm
    setTick((n) => n + 1)

    dm.on('drawing:selected', (event) => {
      if (event.drawingId) {
        setSelectedDrawingId(event.drawingId)
        try { chart.applyOptions({ handleScroll: { pressedMouseMove: false } }) } catch {}
      }
    })
    dm.on('drawing:deselected', () => {
      setSelectedDrawingId(null)
      try { chart.applyOptions({ handleScroll: { pressedMouseMove: true } }) } catch {}
    })

    const padAnchors = (anchors: { time: Time; price: number }[], required: number) => {
      if (anchors.length >= required) return anchors
      const padded = [...anchors]
      const last = anchors[anchors.length - 1]
      while (padded.length < required) padded.push({ ...last })
      return padded
    }

    const createDrawingPreview = (toolType: string, id: string, anchors: { time: Time; price: number }[]) => {
      const registry = getToolRegistry()
      const toolDef = registry.get(toolType)
      const required = toolDef?.requiredAnchors ?? anchors.length
      const padded = padAnchors(anchors, required)
      const drawing = registry.createDrawing(toolType, id, padded, { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
      if (drawing) drawing.setState('editing' as any)
      return drawing
    }

    const finalizeDrawing = (toolType: string, id: string, anchors: { time: Time; price: number }[]) => {
      if (!drawingManagerRef.current) return
      const registry = getToolRegistry()
      const drawing = registry.createDrawing(toolType, id, anchors, { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
      if (drawing) {
        drawing.setState('normal' as any)
        drawingManagerRef.current.addDrawing(drawing)
      }
    }

    const handleDrawingClick = (param: any) => {
      const tool = activeDrawingToolRef.current
      if (!drawingManagerRef.current || !param?.point) return
      if (tool && FREEHAND_TOOLS.has(tool)) return
      if (!tool) {
        const hit = drawingManagerRef.current.hitTest({ x: param.point.x, y: param.point.y })
        if (hit) {
          drawingManagerRef.current.selectDrawing(hit.id)
        } else {
          drawingManagerRef.current.deselectAll()
        }
        return
      }
      if (param?.time == null) return
      const price = seriesRef.current?.coordinateToPrice(param.point.y)
      if (price == null) return
      const anchor = { time: param.time as Time, price }

      const registry = getToolRegistry()
      const toolDef = registry.get(tool)
      if (!toolDef) return
      const required = toolDef.requiredAnchors

      if (required === 1) {
        const drawing = registry.createDrawing(tool, `${tool}-${Date.now()}`, [anchor], { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
        if (drawing) {
          drawing.setState('normal' as any)
          drawingManagerRef.current.addDrawing(drawing)
        }
        drawingManagerRef.current.setActiveTool(null)
        setActiveDrawingTool(null)
        try { chart.applyOptions({ handleScroll: { pressedMouseMove: true } }) } catch {}
        return
      }

      drawingAnchorsRef.current.push(anchor)

      if (drawingAnchorsRef.current.length === 1 && required >= 2) {
        const previewId = `draw-preview-${Date.now()}`
        drawingPreviewIdRef.current = previewId
        const drawing = createDrawingPreview(tool, previewId, [anchor, anchor])
        if (drawing) drawingManagerRef.current.addDrawing(drawing)
        return
      }

      if (drawingAnchorsRef.current.length < required) {
        if (drawingPreviewIdRef.current) {
          drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
          drawingPreviewIdRef.current = null
        }
        const previewId = `draw-preview-${Date.now()}`
        drawingPreviewIdRef.current = previewId
        const drawing = createDrawingPreview(tool, previewId, [...drawingAnchorsRef.current, anchor])
        if (drawing) drawingManagerRef.current.addDrawing(drawing)
        return
      }

      if (drawingPreviewIdRef.current) {
        drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
        drawingPreviewIdRef.current = null
      }
      finalizeDrawing(tool, `${tool}-${Date.now()}`, [...drawingAnchorsRef.current])
      drawingAnchorsRef.current = []
      drawingManagerRef.current.setActiveTool(null)
      setActiveDrawingTool(null)
      try { chart.applyOptions({ handleScroll: { pressedMouseMove: true } }) } catch {}
    }

    const handleDrawingCrosshairMove = (param: any) => {
      const tool = activeDrawingToolRef.current
      if (!tool || !drawingManagerRef.current || !drawingPreviewIdRef.current || drawingAnchorsRef.current.length === 0 || !param?.point || param?.time == null) return
      const registry = getToolRegistry()
      const toolDef = registry.get(tool)
      if (!toolDef || toolDef.requiredAnchors < 2) return
      const price = seriesRef.current?.coordinateToPrice(param.point.y)
      if (price == null) return
      drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
      const previewAnchors = [...drawingAnchorsRef.current, { time: param.time as Time, price }]
      const drawing = createDrawingPreview(tool, drawingPreviewIdRef.current, previewAnchors)
      if (drawing) drawingManagerRef.current.addDrawing(drawing)
    }

    chart.subscribeCrosshairMove(handleDrawingCrosshairMove)

    let freehandDrawing: IDrawing | null = null
    let isFreehandDrawing = false

    const getChartCoords = (e: MouseEvent): { time: Time; price: number } | null => {
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const time = chart.timeScale().coordinateToTime(x)
      const price = series.coordinateToPrice(y)
      if (time == null || price == null) return null
      return { time: time as Time, price }
    }

    const handleFreehandMouseDown = (e: MouseEvent) => {
      const tool = activeDrawingToolRef.current
      if (!tool || !FREEHAND_TOOLS.has(tool)) return
      if (!drawingManagerRef.current) return
      const coords = getChartCoords(e)
      if (!coords) return
      e.preventDefault()
      e.stopPropagation()
      isFreehandDrawing = true
      const registry = getToolRegistry()
      const id = `draw-${tool}-${Date.now()}`
      const drawing = registry.createDrawing(tool, id, [coords], { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
      if (drawing) {
        drawing.setState('editing' as any)
        drawingManagerRef.current.addDrawing(drawing)
        freehandDrawing = drawing
      }
    }

    const handleFreehandMouseMove = (e: MouseEvent) => {
      if (!isFreehandDrawing || !freehandDrawing) return
      const coords = getChartCoords(e)
      if (!coords) return
      ;(freehandDrawing as any).addPoint(coords)
    }

    const handleFreehandMouseUp = () => {
      if (!isFreehandDrawing) return
      if (freehandDrawing) {
        freehandDrawing.setState('normal' as any)
      }
      isFreehandDrawing = false
      freehandDrawing = null
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setActiveTool(null)
      }
      setActiveDrawingTool(null)
      if (chartRef.current) {
        try { chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: true } }) } catch {}
      }
    }

    container.addEventListener('mousedown', handleFreehandMouseDown)
    container.addEventListener('mousemove', handleFreehandMouseMove)
    container.addEventListener('mouseup', handleFreehandMouseUp)

    const handleChartDblClick = (e: MouseEvent) => {
      const tool = activeDrawingToolRef.current
      if (tool) return
      if (!drawingManagerRef.current) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = drawingManagerRef.current.hitTest({ x, y })
      if (hit && TEXT_DRAWING_TYPES.includes(hit.type)) {
        e.preventDefault()
        e.stopPropagation()
        drawingManagerRef.current.selectDrawing(hit.id)
        setEditingTextDrawing(hit)
      }
    }
    container.addEventListener('dblclick', handleChartDblClick)

    const handleCombinedClick = (param: any) => {
      if (activeDrawingToolRef.current) {
        handleDrawingClick(param)
        return
      }
      onChartClickRef.current?.(param)
    }
    chart.subscribeClick(handleCombinedClick)

    return () => {
      try { chart.unsubscribeCrosshairMove(handleDrawingCrosshairMove) } catch {}
      try { chart.unsubscribeClick(handleCombinedClick) } catch {}
      container.removeEventListener('mousedown', handleFreehandMouseDown)
      container.removeEventListener('mousemove', handleFreehandMouseMove)
      container.removeEventListener('mouseup', handleFreehandMouseUp)
      container.removeEventListener('dblclick', handleChartDblClick)
      if (drawingManagerRef.current) {
        try { drawingManagerRef.current.detach() } catch {}
        drawingManagerRef.current = null
      }
    }
  }, [chart, series, chartContainer])

  return {
    showDrawingPanel, setShowDrawingPanel,
    drawingToolbarCollapsed, setDrawingToolbarCollapsed,
    activeDrawingTool,
    selectedDrawingId,
    editingTextDrawing, setEditingTextDrawing,
    drawingManagerRef,
    handleToolSelect,
    selectDrawingFromList,
    deleteDrawingFromList,
    duplicateDrawingFromList,
    clearAllDrawingsFromList,
    handleTextEditorSave,
    setTick,
  }
}

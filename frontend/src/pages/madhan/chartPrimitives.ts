import type { ISeriesApi, IChartApi, PrimitiveHoveredItem } from 'lightweight-charts'

// ─── Transparency Helpers ────────────────────────────────────────────────

export function transpToHexAlpha(transp: number): string {
  const alpha = Math.round(((100 - transp) / 100) * 255)
  return alpha.toString(16).padStart(2, '0').toUpperCase()
}

export function applyTransparency(color: string, transp: number): string {
  if (!transp || transp <= 0) return color
  const base = color.length === 9 ? color.slice(0, 7) : color.length === 7 ? color : color.slice(0, 7)
  return base + transpToHexAlpha(transp)
}

// ─── PlotFillPrimitive ───────────────────────────────────────────────────

export interface PlotFillBar {
  time: number
  upper: number
  lower: number
}

export class PlotFillPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _data: PlotFillBar[] = []
  _color: string
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any, color: string) {
    this._series = series
    this._timeScale = timeScale
    this._color = color
  }

  paneViews() {
    const self = this
    return [
      {
        zOrder() { return 'normal' as const },
        renderer() {
          return {
            draw(target: any) {
              if (!self._show || !self._data.length) return
              target.useMediaCoordinateSpace((scope: any) => {
                const ctx = scope.context
                const barWidth = (() => {
                  const range = self._timeScale.getVisibleLogicalRange()
                  if (!range) return 8
                  const count = range.to - range.from
                  if (count <= 0) return 8
                  return Math.max(1, scope.mediaSize.width / count)
                })()
                ctx.fillStyle = self._color
                for (const bar of self._data) {
                  const x = self._timeScale.timeToCoordinate(bar.time)
                  if (x == null) continue
                  const yUpper = self._series.priceToCoordinate(bar.upper)
                  const yLower = self._series.priceToCoordinate(bar.lower)
                  if (yUpper == null || yLower == null) continue
                  const top = Math.min(yUpper, yLower)
                  const bottom = Math.max(yUpper, yLower)
                  ctx.fillRect(x - barWidth / 2, top, barWidth, bottom - top)
                }
              })
            },
          }
        },
      },
    ]
  }

  setData(data: PlotFillBar[], color?: string) {
    this._data = data
    if (color) this._color = color
  }
  toggle() { this._show = !this._show; return this._show }
  setVisible(v: boolean) { this._show = v }
}

// ─── LineBrPrimitive ─────────────────────────────────────────────────────

export class LineBrPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _data: Array<{ time: number; value?: number }> = []
  _color: string
  _lineWidth: number
  _withSteps: boolean
  _lineStyle: number
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any, color: string, lineWidth: number, withSteps = false, lineStyle = 0) {
    this._series = series
    this._timeScale = timeScale
    this._color = color
    this._lineWidth = lineWidth
    this._withSteps = withSteps
    this._lineStyle = lineStyle
  }

  paneViews() {
    const self = this
    return [
      {
        zOrder() { return 'normal' as const },
        renderer() {
          return {
            draw(target: any) {
              if (!self._show || !self._data.length) return
              target.useMediaCoordinateSpace((scope: any) => {
                const ctx = scope.context
                ctx.strokeStyle = self._color
                ctx.lineWidth = self._lineWidth
                if (self._lineStyle === 1) { ctx.setLineDash([4, 4]) }
                else if (self._lineStyle === 2) { ctx.setLineDash([2, 2]) }
                else { ctx.setLineDash([]) }
                let drawing = false
                let prevY = 0
                for (const point of self._data) {
                  const isValNaN = point.value == null || !Number.isFinite(point.value)
                  if (isValNaN) {
                    if (drawing) { ctx.stroke(); drawing = false }
                    continue
                  }
                  const x = self._timeScale.timeToCoordinate(point.time)
                  const y = self._series.priceToCoordinate(point.value!)
                  if (x == null || y == null) {
                    if (drawing) { ctx.stroke(); drawing = false }
                    continue
                  }
                  if (!drawing) {
                    ctx.beginPath()
                    ctx.moveTo(x, y)
                    drawing = true
                  } else {
                    if (self._withSteps) ctx.lineTo(x, prevY)
                    ctx.lineTo(x, y)
                  }
                  prevY = y
                }
                if (drawing) ctx.stroke()
                ctx.setLineDash([])
              })
            },
          }
        },
      },
    ]
  }

  setData(data: Array<{ time: number; value?: number }>, color?: string, lineStyle?: number) {
    this._data = data
    if (color) this._color = color
    if (lineStyle != null) this._lineStyle = lineStyle
  }
  setVisible(v: boolean) { this._show = v }
}

// ─── ExtendedMarkerPrimitive ─────────────────────────────────────────────

export interface MarkerDatum {
  time: number
  position: string
  price: number
  shape: string
  color: string
  text?: string
  size?: number
}

export class ExtendedMarkerPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _markers: MarkerDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._markers.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              for (const marker of self._markers) {
                const x = self._timeScale.timeToCoordinate(marker.time)
                if (x == null) continue
                let baseY: number | null = null
                if (marker.position === 'aboveBar') {
                  const coord = self._series.priceToCoordinate(marker.price)
                  if (coord != null) baseY = coord - 10
                } else if (marker.position === 'belowBar') {
                  const coord = self._series.priceToCoordinate(marker.price)
                  if (coord != null) baseY = coord + 10
                } else {
                  baseY = self._series.priceToCoordinate(marker.price)
                }
                if (baseY == null) continue

                const size = (marker.size ?? 1) * 6
                ctx.fillStyle = marker.color
                ctx.strokeStyle = marker.color
                ctx.lineWidth = 2

                switch (marker.shape) {
                  case 'triangleUp':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY - size)
                    ctx.lineTo(x - size, baseY + size)
                    ctx.lineTo(x + size, baseY + size)
                    ctx.closePath()
                    ctx.fill()
                    break
                  case 'triangleDown':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY + size)
                    ctx.lineTo(x - size, baseY - size)
                    ctx.lineTo(x + size, baseY - size)
                    ctx.closePath()
                    ctx.fill()
                    break
                  case 'diamond':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY - size)
                    ctx.lineTo(x + size, baseY)
                    ctx.lineTo(x, baseY + size)
                    ctx.lineTo(x - size, baseY)
                    ctx.closePath()
                    ctx.fill()
                    break
                  case 'cross':
                    ctx.beginPath()
                    ctx.moveTo(x - size, baseY)
                    ctx.lineTo(x + size, baseY)
                    ctx.moveTo(x, baseY - size)
                    ctx.lineTo(x, baseY + size)
                    ctx.stroke()
                    break
                  case 'xcross':
                    ctx.beginPath()
                    ctx.moveTo(x - size, baseY - size)
                    ctx.lineTo(x + size, baseY + size)
                    ctx.moveTo(x + size, baseY - size)
                    ctx.lineTo(x - size, baseY + size)
                    ctx.stroke()
                    break
                  case 'flag':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY)
                    ctx.lineTo(x, baseY - size * 2)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(x, baseY - size * 2)
                    ctx.lineTo(x + size * 1.5, baseY - size * 1.5)
                    ctx.lineTo(x, baseY - size)
                    ctx.closePath()
                    ctx.fill()
                    break
                  case 'labelUp':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY - size * 2)
                    ctx.lineTo(x - size, baseY - size)
                    ctx.lineTo(x + size, baseY - size)
                    ctx.closePath()
                    ctx.fill()
                    break
                  case 'labelDown':
                    ctx.beginPath()
                    ctx.moveTo(x, baseY + size * 2)
                    ctx.lineTo(x - size, baseY + size)
                    ctx.lineTo(x + size, baseY + size)
                    ctx.closePath()
                    ctx.fill()
                    break
                }
                if (marker.text) {
                  ctx.fillStyle = marker.color
                  ctx.font = '11px sans-serif'
                  ctx.textAlign = 'center'
                  const textY = marker.position === 'aboveBar' ? baseY - size - 4 : baseY + size + 12
                  ctx.fillText(marker.text, x, textY)
                }
              }
            })
          },
        }
      },
    }]
  }

  setMarkers(markers: MarkerDatum[]) {
    this._markers = markers
  }
  setVisible(v: boolean) { this._show = v }
}

// ─── BgColorPrimitive ──────────────────────────────────────────────────

export interface BgColorDatum {
  time: number
  color: string
}

export class BgColorPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _data: BgColorDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'normal' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._data.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              const range = self._timeScale.getVisibleLogicalRange()
              if (!range) return
              const barWidth = Math.max(1, scope.mediaSize.width / (range.to - range.from))
              for (const bar of self._data) {
                const x = self._timeScale.timeToCoordinate(bar.time)
                if (x == null) continue
                ctx.fillStyle = bar.color
                ctx.fillRect(x - barWidth / 2, 0, barWidth, scope.mediaSize.height)
              }
            })
          },
        }
      },
    }]
  }

  setData(data: BgColorDatum[]) { this._data = data }
  setVisible(v: boolean) { this._show = v }
}

// ─── LabelPrimitive ────────────────────────────────────────────────────

export interface LabelDatum {
  time: number
  price: number
  text: string
  color?: string
  textColor?: string
  style?: 'label_up' | 'label_down' | 'label_left' | 'label_right' | 'label_center'
  size?: 'tiny' | 'small' | 'normal' | 'large' | 'huge'
}

const LABEL_FONT_SIZES: Record<string, number> = {
  tiny: 9, small: 11, normal: 13, large: 16, huge: 20,
}

export class LabelPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _labels: LabelDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._labels.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              for (const label of self._labels) {
                const x = self._timeScale.timeToCoordinate(label.time)
                const y = self._series.priceToCoordinate(label.price)
                if (x == null || y == null) continue
                const fontSize = LABEL_FONT_SIZES[label.size ?? 'normal'] ?? 13
                ctx.font = `${fontSize}px sans-serif`
                const textMetrics = ctx.measureText(label.text)
                const textWidth = textMetrics.width
                const padding = 4
                if (label.color) {
                  ctx.fillStyle = label.color
                  const rx = x - textWidth / 2 - padding
                  const ry = y - fontSize / 2 - padding
                  const rw = textWidth + padding * 2
                  const rh = fontSize + padding * 2
                  ctx.beginPath()
                  ctx.roundRect(rx, ry, rw, rh, 3)
                  ctx.fill()
                }
                ctx.fillStyle = label.textColor ?? '#ffffff'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(label.text, x, y)
              }
            })
          },
        }
      },
    }]
  }

  setLabels(labels: LabelDatum[]) { this._labels = labels }
  setVisible(v: boolean) { this._show = v }
}

// ─── BoxPrimitive ──────────────────────────────────────────────────────

export interface BoxDatum {
  time1: number
  price1: number
  time2: number
  price2: number
  bgColor?: string
  borderColor?: string
  borderWidth?: number
  borderStyle?: 'solid' | 'dashed' | 'dotted'
}

export class BoxPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _boxes: BoxDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._boxes.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              for (const box of self._boxes) {
                const x1 = self._timeScale.timeToCoordinate(box.time1)
                const y1 = self._series.priceToCoordinate(box.price1)
                const x2 = self._timeScale.timeToCoordinate(box.time2)
                const y2 = self._series.priceToCoordinate(box.price2)
                if (x1 == null || y1 == null || x2 == null || y2 == null) continue
                const left = Math.min(x1, x2)
                const top = Math.min(y1, y2)
                const width = Math.abs(x2 - x1)
                const height = Math.abs(y2 - y1)
                if (box.bgColor) {
                  ctx.fillStyle = box.bgColor
                  ctx.fillRect(left, top, width, height)
                }
                if (box.borderColor) {
                  ctx.strokeStyle = box.borderColor
                  ctx.lineWidth = box.borderWidth ?? 1
                  if (box.borderStyle === 'dashed') ctx.setLineDash([6, 3])
                  else if (box.borderStyle === 'dotted') ctx.setLineDash([2, 2])
                  else ctx.setLineDash([])
                  ctx.strokeRect(left, top, width, height)
                  ctx.setLineDash([])
                }
              }
            })
          },
        }
      },
    }]
  }

  setBoxes(boxes: BoxDatum[]) { this._boxes = boxes }
  setVisible(v: boolean) { this._show = v }
}

// ─── LineDrawingPrimitive ──────────────────────────────────────────────

export interface LineDrawingDatum {
  time1: number
  price1: number
  time2: number
  price2: number
  color?: string
  width?: number
  style?: 'solid' | 'dashed' | 'dotted'
  extend?: 'none' | 'left' | 'right' | 'both'
}

export class LineDrawingPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _lines: LineDrawingDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'normal' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._lines.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              for (const line of self._lines) {
                const x1 = self._timeScale.timeToCoordinate(line.time1)
                const y1 = self._series.priceToCoordinate(line.price1)
                const x2 = self._timeScale.timeToCoordinate(line.time2)
                const y2 = self._series.priceToCoordinate(line.price2)
                if (x1 == null || y1 == null || x2 == null || y2 == null) continue
                ctx.strokeStyle = line.color ?? '#2962FF'
                ctx.lineWidth = line.width ?? 1
                if (line.style === 'dashed') ctx.setLineDash([6, 3])
                else if (line.style === 'dotted') ctx.setLineDash([2, 2])
                else ctx.setLineDash([])
                let startX: number = x1, startY: number = y1, endX: number = x2, endY: number = y2
                const extend = line.extend ?? 'none'
                if (extend === 'left' || extend === 'both') {
                  const dx = x2 - x1, dy = y2 - y1
                  if (dx !== 0) { const t = -x1 / dx; startX = 0; startY = y1 + dy * t }
                }
                if (extend === 'right' || extend === 'both') {
                  const dx = x2 - x1, dy = y2 - y1
                  if (dx !== 0) { const t = (scope.mediaSize.width - x1) / dx; endX = scope.mediaSize.width; endY = y1 + dy * t }
                }
                ctx.beginPath()
                ctx.moveTo(startX, startY)
                ctx.lineTo(endX, endY)
                ctx.stroke()
                ctx.setLineDash([])
              }
            })
          },
        }
      },
    }]
  }

  setLines(lines: LineDrawingDatum[]) { this._lines = lines }
  setVisible(v: boolean) { this._show = v }
}

// ─── TablePrimitive (DOM overlay) ──────────────────────────────────────

export interface TableCell {
  row: number
  column: number
  text: string
  bgColor?: string
  textColor?: string
  textSize?: 'tiny' | 'small' | 'normal' | 'large' | 'huge'
}

export interface TableDatum {
  position: 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_center' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
  columns: number
  rows: number
  cells: TableCell[]
}

export class TablePrimitive {
  _container: HTMLElement | null = null
  _tableElement: HTMLElement | null = null

  constructor(container: HTMLElement) {
    this._container = container
  }

  setTable(table: TableDatum) {
    this.clearTable()
    if (!this._container) return
    const el = document.createElement('div')
    const positionStyles: Record<string, string> = {
      top_left: 'top:8px;left:8px', top_center: 'top:8px;left:50%;transform:translateX(-50%)',
      top_right: 'top:8px;right:8px', middle_left: 'top:50%;left:8px;transform:translateY(-50%)',
      middle_center: 'top:50%;left:50%;transform:translate(-50%,-50%)', middle_right: 'top:50%;right:8px;transform:translateY(-50%)',
      bottom_left: 'bottom:8px;left:8px', bottom_center: 'bottom:8px;left:50%;transform:translateX(-50%)',
      bottom_right: 'bottom:8px;right:8px',
    }
    el.style.cssText = `position:absolute;${positionStyles[table.position] ?? 'top:8px;right:8px'};z-index:10;pointer-events:none;background:rgba(30,34,45,0.9);border:1px solid #2b2b43;border-radius:4px;padding:4px;font-family:monospace;font-size:11px;color:#d1d4dc;`
    const grid: string[][] = Array.from({ length: table.rows }, () => Array.from({ length: table.columns }, () => ''))
    const cellStyles: Record<string, TableCell> = {}
    for (const cell of table.cells) {
      if (cell.row < table.rows && cell.column < table.columns) {
        grid[cell.row][cell.column] = cell.text
        cellStyles[`${cell.row}_${cell.column}`] = cell
      }
    }
    const fontSizes: Record<string, string> = { tiny: '9px', small: '10px', normal: '11px', large: '13px', huge: '16px' }
    let html = '<table style="border-collapse:collapse">'
    for (let r = 0; r < table.rows; r++) {
      html += '<tr>'
      for (let c = 0; c < table.columns; c++) {
        const cs = cellStyles[`${r}_${c}`]
        const bg = cs?.bgColor ? `background:${cs.bgColor};` : ''
        const tc = cs?.textColor ? `color:${cs.textColor};` : ''
        const fs = cs?.textSize ? `font-size:${fontSizes[cs.textSize] ?? '11px'};` : ''
        html += `<td style="padding:2px 6px;${bg}${tc}${fs}">${grid[r][c]}</td>`
      }
      html += '</tr>'
    }
    html += '</table>'
    el.innerHTML = html
    this._container.style.position = 'relative'
    this._container.appendChild(el)
    this._tableElement = el
  }

  clearTable() {
    if (this._tableElement) { this._tableElement.remove(); this._tableElement = null }
  }
}

// ─── Marker Data Helpers ─────────────────────────────────────────────────

const NATIVE_SHAPES = new Set(['circle', 'square', 'arrowUp', 'arrowDown'])

export function toMarkerData(
  plot: unknown,
  bars: Array<{ time: number }>,
  shape: string,
  defaultColor: string,
): { native: any[]; extended: MarkerDatum[] } {
  const native: any[] = []
  const extended: MarkerDatum[] = []
  if (!Array.isArray(plot)) return { native, extended }
  for (let index = 0; index < plot.length; index++) {
    const item = plot[index]
    const bar = bars[index]
    let marker: any = null
    if (item && typeof item === 'object' && 'time' in (item as any) && 'value' in (item as any)) {
      const point = item as any
      if (typeof point.value !== 'number' || !Number.isFinite(point.value)) continue
      const resolvedShape = NATIVE_SHAPES.has(shape) ? shape : 'circle'
      marker = {
        time: point.time,
        position: 'atPriceMiddle',
        price: point.value,
        shape: resolvedShape,
        color: typeof point.color === 'string' ? point.color : defaultColor,
        text: point.text,
      }
    } else if (typeof item === 'number' && Number.isFinite(item) && bar) {
      const resolvedShape = NATIVE_SHAPES.has(shape) ? shape : 'circle'
      marker = {
        time: bar.time,
        position: 'atPriceMiddle',
        price: item,
        shape: resolvedShape,
        color: defaultColor,
      }
    }
    if (!marker) continue
    if (NATIVE_SHAPES.has(shape)) {
      native.push(marker)
    } else {
      extended.push(marker)
    }
  }
  return { native, extended }
}

// ─── HlineFillPrimitive (fills between two horizontal lines) ────────────

export interface HlineFillDatum {
  time1: number
  price1: number
  time2: number
  price2: number
  color: string
}

export class HlineFillPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _fills: HlineFillDatum[] = []
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'normal' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._fills.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              for (const fill of self._fills) {
                const x1 = self._timeScale.timeToCoordinate(fill.time1)
                const y1 = self._series.priceToCoordinate(fill.price1)
                const x2 = self._timeScale.timeToCoordinate(fill.time2)
                const y2 = self._series.priceToCoordinate(fill.price2)
                if (x1 == null || y1 == null || x2 == null || y2 == null) continue
                const left = Math.min(x1, x2)
                const top = Math.min(y1, y2)
                const width = Math.abs(x2 - x1)
                const height = Math.abs(y2 - y1)
                ctx.fillStyle = fill.color
                ctx.fillRect(left, top, width, height)
              }
            })
          },
        }
      },
    }]
  }

  setFills(fills: HlineFillDatum[]) { this._fills = fills }
  setVisible(v: boolean) { this._show = v }
}

// ─── CrossPlotPrimitive ────────────────────────────────────────────────

export class CrossPlotPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _data: Array<{ time: number; value: number }> = []
  _color: string = '#2962FF'
  _size: number = 6
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any) {
    this._series = series
    this._timeScale = timeScale
  }

  setData(data: Array<{ time: number; value: number }>, color: string, size: number = 6) {
    this._data = data
    this._color = color
    this._size = size
  }

  paneViews(): any[] {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show) return
            const data = self._data
            if (!data || data.length === 0) return
            const series = self._series
            const ts = self._timeScale
            const color = self._color
            const half = self._size
            target.useMediaCoordinateSpace(({ context: ctx }: { context: CanvasRenderingContext2D }) => {
              ctx.strokeStyle = color
              ctx.lineWidth = 2
              for (const pt of data) {
                if (pt.value == null || Number.isNaN(pt.value)) continue
                const x = ts.timeToCoordinate(pt.time as any)
                const y = series.priceToCoordinate(pt.value)
                if (x == null || y == null) continue
                ctx.beginPath()
                ctx.moveTo(x - half, y - half)
                ctx.lineTo(x + half, y + half)
                ctx.moveTo(x + half, y - half)
                ctx.lineTo(x - half, y + half)
                ctx.stroke()
              }
            })
          },
        }
      },
    }]
  }

  setVisible(v: boolean) { this._show = v }
}

// ─── PositionLinePrimitive ───────────────────────────────────────────────

export interface PositionDatum {
  side: 'LONG' | 'SHORT'
  type: 'CE' | 'PE'
  qty: number
  entryPrice: number
  pnl: number
  symbol: string
  exchange: string
  product: string
}

export class PositionLinePrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _positions: PositionDatum[] = []
  _show = true
  _hidden = new Set<string>()
  _onClose?: (symbol: string) => void
  _container: HTMLDivElement | null = null
  _width = 0
  _lastHovered: string | null = null
  _hitAreas = new Map<string, { closeX: number; closeW: number; pillLeft: number; pillRight: number; pillY: number; pillH: number; y: number }>()

  constructor(series: ISeriesApi<any>, timeScale: any, onClose?: (symbol: string) => void) {
    this._series = series
    this._timeScale = timeScale
    this._onClose = onClose
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<any> }) {
    this._container = param.chart.chartElement()
    this._container.addEventListener('mousedown', this._onMouseDown)
    this._container.addEventListener('mousemove', this._onMouseMove)
    this._container.addEventListener('mouseleave', this._onMouseLeave)
  }

  detached() {
    this._container?.removeEventListener('mousedown', this._onMouseDown)
    this._container?.removeEventListener('mousemove', this._onMouseMove)
    this._container?.removeEventListener('mouseleave', this._onMouseLeave)
    this._container = null
  }

  _onMouseDown = (e: MouseEvent) => {
    if (!this._container) return
    const symbol = this._hitTestCloseBtn(e.offsetX, e.offsetY)
    if (symbol) {
      this._onClose?.(symbol)
      e.preventDefault()
      e.stopPropagation()
    }
  }

  _onMouseMove = (e: MouseEvent) => {
    if (!this._container) return
    const symbol = this._hitTestCloseBtn(e.offsetX, e.offsetY)
    if (symbol) {
      this._container.title = `Close ${symbol} position`
      this._container.style.cursor = 'pointer'
      this._lastHovered = symbol
    } else if (this._lastHovered) {
      this._container.title = ''
      this._container.style.cursor = ''
      this._lastHovered = null
    }
  }

  _onMouseLeave = () => {
    if (this._container) {
      this._container.title = ''
      this._container.style.cursor = ''
    }
    this._lastHovered = null
  }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._positions.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              const W = scope.mediaSize.width
              self._width = W
              const dark = document.documentElement.classList.contains('dark')
              const pillH = 22
              const renderedPills: Array<{ top: number; bottom: number }> = []
              for (const pos of self._positions) {
                if (self._hidden.has(pos.symbol)) continue
                const y = self._series.priceToCoordinate(pos.entryPrice)
                if (y == null) continue

                // Offset overlapping pills downward
                let pillY = y - pillH / 2
                for (const rp of renderedPills) {
                  if (pillY < rp.bottom && pillY + pillH > rp.top) {
                    pillY = rp.bottom + 2
                  }
                }
                renderedPills.push({ top: pillY, bottom: pillY + pillH })
                const isLong = pos.side === 'LONG'
                const lineColor = isLong
                  ? (dark ? 'rgba(52,211,153,0.6)' : 'rgba(52,211,153,0.5)')
                  : (dark ? 'rgba(192,132,252,0.6)' : 'rgba(192,132,252,0.5)')
                const badgeColor = isLong ? '#34d399' : '#c084fc'
                const pillBg = dark ? 'rgba(20,20,30,0.88)' : 'rgba(255,255,255,0.92)'
                const qtyBg = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'
                const qtyText = dark ? '#e5e7eb' : '#374151'
                const infoBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'
                const closeBorder = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'
                const closeX = dark ? '#9ca3af' : '#6b7280'

                // Dashed horizontal line across full width
                ctx.save()
                ctx.strokeStyle = lineColor
                ctx.lineWidth = 1
                ctx.setLineDash([6, 4])
                ctx.beginPath()
                ctx.moveTo(0, y)
                ctx.lineTo(W, y)
                ctx.stroke()
                ctx.restore()

                // Pill group positioned at far right, ending before price tag
                const tagW = 56
                const gap = 3

                // Measure segments first
                ctx.font = 'bold 11px sans-serif'
                const badgeText = `${pos.type}-${pos.side}`
                const badgeW = ctx.measureText(badgeText).width + 12
                const qtyText_ = String(pos.qty)
                const qtyW = ctx.measureText(qtyText_).width + 10
                const pnlSign = pos.pnl >= 0 ? '+' : '-'
                const pnlText = `@ ${pos.entryPrice.toFixed(2)}  ₹${pnlSign}${Math.abs(pos.pnl).toFixed(0)}`
                ctx.font = '11px sans-serif'
                const infoW = ctx.measureText(pnlText).width + 12
                const closeW = 20
                const totalW = badgeW + gap + qtyW + gap + infoW + gap + closeW
                const pillX = W - tagW - gap - totalW

                // Background
                ctx.fillStyle = pillBg
                ctx.beginPath()
                ctx.roundRect(pillX, pillY, totalW, pillH, 4)
                ctx.fill()

                const textY = pillY + pillH / 2
                let cx = pillX

                // Badge (CE-LONG / PE-SHORT etc.)
                ctx.fillStyle = badgeColor
                ctx.beginPath()
                ctx.roundRect(cx, pillY, badgeW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = '#fff'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(badgeText, cx + badgeW / 2, textY)

                // Quantity
                cx += badgeW + gap
                ctx.fillStyle = qtyBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, qtyW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = qtyText
                ctx.fillText(qtyText_, cx + qtyW / 2, textY)

                // Price + PnL
                cx += qtyW + gap
                ctx.fillStyle = infoBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, infoW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = pos.pnl >= 0 ? '#60a5fa' : '#f87171'
                ctx.textAlign = 'left'
                ctx.fillText(pnlText, cx + 6, textY)

                // Close button (X)
                cx += infoW + gap
                ctx.fillStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                ctx.beginPath()
                ctx.roundRect(cx, pillY, closeW, pillH, 4)
                ctx.fill()
                ctx.strokeStyle = closeBorder
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.roundRect(cx, pillY, closeW, pillH, 4)
                ctx.stroke()
                ctx.font = '12px sans-serif'
                ctx.fillStyle = closeX
                ctx.textAlign = 'center'
                ctx.fillText('×', cx + closeW / 2, textY)

                // Cache the actual rendered positions for hit testing
                self._hitAreas.set(pos.symbol, {
                  closeX: cx, closeW,
                  pillLeft: pillX, pillRight: pillX + totalW,
                  pillY, pillH, y,
                })
              }
            })
          },
        }
      },
    }]
  }

  setData(positions: PositionDatum[]) { this._positions = positions; try { (this as any).requestUpdate?.() } catch {} }
  setVisible(v: boolean) { this._show = v }

  hidePosition(symbol: string) { this._hidden.add(symbol) }
  showPosition(symbol: string) { this._hidden.delete(symbol) }

  _hitTestPill(x: number, y: number): string | null {
    for (const pos of this._positions) {
      if (this._hidden.has(pos.symbol)) continue
      const area = this._hitAreas.get(pos.symbol)
      if (!area) continue
      if (x >= area.pillLeft && x <= area.pillRight && y >= area.pillY && y <= area.pillY + area.pillH) {
        if (x >= area.closeX && x <= area.closeX + area.closeW) continue
        return pos.symbol
      }
    }
    return null
  }

  _hitTestCloseBtn(x: number, y: number): string | null {
    for (const pos of this._positions) {
      if (this._hidden.has(pos.symbol)) continue
      const area = this._hitAreas.get(pos.symbol)
      if (!area) continue
      if (y >= area.pillY && y <= area.pillY + area.pillH && x >= area.closeX && x <= area.closeX + area.closeW) {
        return pos.symbol
      }
    }
    return null
  }

  // Overloaded: hitTest(x, y) for lightweight-charts native, hitTest(x, y, W, H) for subscribeClick
  hitTest(x: number, y: number): PrimitiveHoveredItem | null
  hitTest(x: number, y: number, W: number, H: number): string | null
  hitTest(x: number, y: number, W?: number, _H?: number): PrimitiveHoveredItem | null | string | null {
    if (W == null) {
      const symbol = this._hitTestPill(x, y)
      if (symbol) {
        return {
          cursorStyle: 'pointer',
          externalId: `position:${symbol}`,
          zOrder: 'top',
        } as PrimitiveHoveredItem
      }
      return null
    }
    return this._hitTestCloseBtn(x, y)
  }
}

// ─── OrderLinePrimitive ───────────────────────────────────────────────

export interface OrderLineDatum {
  side: 'BUY' | 'SELL'
  type: 'CE' | 'PE'
  orderType: 'LIMIT' | 'SL' | 'SL-M' | 'MARKET'
  qty: number
  price: number
  triggerPrice: number
  symbol: string
  exchange: string
  product: string
  orderId: string
}

export class OrderLinePrimitive {
  _series: ISeriesApi<any>
  _orders: OrderLineDatum[] = []
  _show = true
  _hidden = new Set<string>()
  _onClose?: (orderId: string) => void
  _onModify?: (orderId: string, newPrice: number) => void

  _chart: IChartApi | null = null
  _container: HTMLDivElement | null = null
  _isDragging = false
  _dragOrderId: string | null = null
  _dragOriginalPrice = 0
  _dragCurrentPrice = 0
  _width = 0
  _lastHovered: string | null = null
  _hitAreas = new Map<string, { closeX: number; closeW: number; pillLeft: number; pillRight: number; pillY: number; pillH: number; y: number }>()

  constructor(
    series: ISeriesApi<any>,
    onClose?: (orderId: string) => void,
    onModify?: (orderId: string, newPrice: number) => void,
  ) {
    this._series = series
    this._onClose = onClose
    this._onModify = onModify
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<any> }) {
    this._chart = param.chart
    this._container = param.chart.chartElement()
    this._container.addEventListener('mousedown', this._onMouseDown)
    this._container.addEventListener('mousemove', this._onTooltip)
    this._container.addEventListener('mouseleave', this._onMouseLeave)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
  }

  detached() {
    this._container?.removeEventListener('mousedown', this._onMouseDown)
    this._container?.removeEventListener('mousemove', this._onTooltip)
    this._container?.removeEventListener('mouseleave', this._onMouseLeave)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    this._chart = null
    this._container = null
  }

  _hitTestPill(x: number, y: number): string | null {
    for (const ord of this._orders) {
      if (this._hidden.has(ord.orderId)) continue
      const area = this._hitAreas.get(ord.orderId)
      if (!area) continue
      if (x >= area.pillLeft && x <= area.pillRight && y >= area.pillY && y <= area.pillY + area.pillH) {
        if (x >= area.closeX && x <= area.closeX + area.closeW) continue
        return ord.orderId
      }
    }
    return null
  }

  _hitTestCloseBtn(x: number, y: number): string | null {
    for (const ord of this._orders) {
      if (this._hidden.has(ord.orderId)) continue
      const area = this._hitAreas.get(ord.orderId)
      if (!area) continue
      if (y >= area.pillY && y <= area.pillY + area.pillH && x >= area.closeX && x <= area.closeX + area.closeW) {
        return ord.orderId
      }
    }
    return null
  }

  _onMouseDown = (e: MouseEvent) => {
    if (!this._chart) return
    // If clicking the × close button, fire close directly and block everything else
    const closeHit = this._hitTestCloseBtn(e.offsetX, e.offsetY)
    if (closeHit) {
      this._onClose?.(closeHit)
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const orderId = this._hitTestPill(e.offsetX, e.offsetY)
    if (!orderId) return
    const ord = this._orders.find(o => o.orderId === orderId)
    if (!ord) return
    this._isDragging = true
    this._dragOrderId = orderId
    this._dragOriginalPrice = ord.price
    this._dragCurrentPrice = ord.price
    // Disable chart scroll so dragging the pill doesn't pan the chart
    this._chart.applyOptions({ handleScroll: false })
    e.preventDefault()
    e.stopPropagation()
  }

  _onTooltip = (e: MouseEvent) => {
    if (!this._container || this._isDragging) return
    const closeHit = this._hitTestCloseBtn(e.offsetX, e.offsetY)
    const pillHit = this._hitTestPill(e.offsetX, e.offsetY)
    if (closeHit) {
      this._container.title = `Cancel order ${closeHit}`
      this._container.style.cursor = 'pointer'
      this._lastHovered = closeHit
    } else if (pillHit) {
      this._container.title = `Drag to modify price`
      this._container.style.cursor = 'grab'
      this._lastHovered = null
    } else if (this._lastHovered) {
      this._container.title = ''
      this._container.style.cursor = ''
      this._lastHovered = null
    }
  }

  _onMouseLeave = () => {
    if (this._container) {
      this._container.title = ''
      this._container.style.cursor = ''
    }
    this._lastHovered = null
  }

  _onMouseMove = (e: MouseEvent) => {
    if (!this._container || !this._series) return
    if (this._isDragging && this._dragOrderId) {
      const rect = this._container.getBoundingClientRect()
      const localY = e.clientY - rect.top
      const newPrice = this._series.coordinateToPrice(localY)
      if (newPrice != null) {
        this._dragCurrentPrice = newPrice as number
        this.requestUpdate()
      }
      this._container.style.cursor = 'grabbing'
      e.preventDefault()
    }
  }

  _onMouseUp = (_e: MouseEvent) => {
    if (!this._isDragging || !this._dragOrderId) return
    const ord = this._orders.find(o => o.orderId === this._dragOrderId)
    if (ord && ord.price !== this._dragCurrentPrice) {
      this._onModify?.(this._dragOrderId, this._dragCurrentPrice)
    }
    this._isDragging = false
    this._dragOrderId = null
    // Re-enable chart scroll
    if (this._chart) {
      this._chart.applyOptions({ handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true, vertTouchDrag: true } })
    }
    this.requestUpdate()
  }

  requestUpdate() { try { (this as any).requestUpdate?.() } catch {} }

  paneViews() {
    const self = this
    return [{
      zOrder() { return 'top' as const },
      renderer() {
        return {
          draw(target: any) {
            if (!self._show || !self._orders.length) return
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context
              const W = scope.mediaSize.width
              self._width = W
              const dark = document.documentElement.classList.contains('dark')
              const pillH = 22
              const renderedPills: Array<{ top: number; bottom: number }> = []
              for (const ord of self._orders) {
                if (self._hidden.has(ord.orderId)) continue
                const isDragging = self._isDragging && self._dragOrderId === ord.orderId
                const displayPrice = isDragging ? self._dragCurrentPrice : ord.price
                const y = self._series.priceToCoordinate(displayPrice)
                if (y == null) continue

                // Offset overlapping pills downward
                let pillY = y - pillH / 2
                for (const rp of renderedPills) {
                  if (pillY < rp.bottom && pillY + pillH > rp.top) {
                    pillY = rp.bottom + 2
                  }
                }
                renderedPills.push({ top: pillY, bottom: pillY + pillH })
                const isBuy = ord.side === 'BUY'
                const isSl = ord.orderType === 'SL' || ord.orderType === 'SL-M'
                const lineColor = isBuy
                  ? (dark ? 'rgba(0,200,81,0.5)' : 'rgba(0,180,60,0.45)')
                  : (dark ? 'rgba(239,68,68,0.5)' : 'rgba(220,50,50,0.45)')
                const badgeColor = isBuy ? '#34d399' : '#fb7185'
                const typeColor = isSl ? '#F59E0B' : (dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                const typeTextColor = isSl ? '#000' : (dark ? '#e5e7eb' : '#374151')
                const pillBg = dark ? 'rgba(20,20,30,0.88)' : 'rgba(255,255,255,0.92)'
                const qtyBg = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'
                const qtyText = dark ? '#e5e7eb' : '#374151'
                const closeBorder = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'
                const closeX = dark ? '#9ca3af' : '#6b7280'

                // Ghost line at original price when dragging
                if (isDragging) {
                  const origY = self._series.priceToCoordinate(self._dragOriginalPrice)
                  if (origY != null) {
                    ctx.save()
                    ctx.strokeStyle = lineColor
                    ctx.lineWidth = 1
                    ctx.setLineDash([4, 4])
                    ctx.globalAlpha = 0.4
                    ctx.beginPath()
                    ctx.moveTo(0, origY)
                    ctx.lineTo(W, origY)
                    ctx.stroke()
                    ctx.restore()
                  }
                }

                // Dashed horizontal line at current position
                ctx.save()
                ctx.strokeStyle = lineColor
                ctx.lineWidth = 1
                ctx.setLineDash([6, 4])
                if (isDragging) {
                  ctx.lineWidth = 2
                  ctx.strokeStyle = isBuy
                    ? (dark ? 'rgba(0,200,81,0.8)' : 'rgba(0,180,60,0.75)')
                    : (dark ? 'rgba(239,68,68,0.8)' : 'rgba(220,50,50,0.75)')
                }
                ctx.beginPath()
                ctx.moveTo(0, y)
                ctx.lineTo(W, y)
                ctx.stroke()
                ctx.restore()

                // Measure segments
                ctx.font = 'bold 11px sans-serif'
                const sideText = `${ord.type} ${ord.side}`
                const sideW = ctx.measureText(sideText).width + 12
                const qtyStr = String(ord.qty)
                const qtyW = ctx.measureText(qtyStr).width + 10
                const typeText = isDragging
                  ? `@ ${displayPrice.toFixed(2)}`
                  : ord.orderType === 'SL-M' ? `SL-M @ ${ord.triggerPrice.toFixed(2)}` : ord.orderType === 'SL' ? `SL @ ${ord.triggerPrice.toFixed(2)}` : `LIMIT @ ${ord.price.toFixed(2)}`
                const typeW = ctx.measureText(typeText).width + 12
                const closeW = 20
                const gap = 3
                const tagW = 56
                const totalW = sideW + gap + qtyW + gap + typeW + gap + closeW
                const pillX = W - tagW - gap - totalW

                // Background
                ctx.fillStyle = isDragging ? (dark ? 'rgba(30,30,50,0.95)' : 'rgba(240,240,255,0.98)') : pillBg
                ctx.beginPath()
                ctx.roundRect(pillX, pillY, totalW, pillH, 4)
                ctx.fill()

                const textY = pillY + pillH / 2
                let cx = pillX

                // Side badge (CE SELL / PE BUY etc.)
                ctx.fillStyle = badgeColor
                ctx.beginPath()
                ctx.roundRect(cx, pillY, sideW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = '#fff'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(sideText, cx + sideW / 2, textY)

                // Quantity
                cx += sideW + gap
                ctx.fillStyle = qtyBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, qtyW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = qtyText
                ctx.fillText(qtyStr, cx + qtyW / 2, textY)

                // Order type — during drag shows @ price, otherwise LIMIT/SL/SL-M
                cx += qtyW + gap
                if (isDragging) {
                  // Highlight the new price during drag
                  ctx.fillStyle = dark ? 'rgba(250,204,21,0.2)' : 'rgba(234,179,8,0.15)'
                } else {
                  ctx.fillStyle = typeColor
                }
                ctx.beginPath()
                ctx.roundRect(cx, pillY, typeW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = isDragging ? '#facc15' : typeTextColor
                ctx.textAlign = 'center'
                ctx.fillText(typeText, cx + typeW / 2, textY)

                // Close button (X)
                cx += typeW + gap
                ctx.fillStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                ctx.beginPath()
                ctx.roundRect(cx, pillY, closeW, pillH, 4)
                ctx.fill()
                ctx.strokeStyle = closeBorder
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.roundRect(cx, pillY, closeW, pillH, 4)
                ctx.stroke()
                ctx.font = '12px sans-serif'
                ctx.fillStyle = closeX
                ctx.textAlign = 'center'
                ctx.fillText('×', cx + closeW / 2, textY)

                // Cache the actual rendered positions for hit testing
                self._hitAreas.set(ord.orderId, {
                  closeX: cx, closeW,
                  pillLeft: pillX, pillRight: pillX + totalW,
                  pillY, pillH, y,
                })
              }
            })
          },
        }
      },
    }]
  }

  setData(orders: OrderLineDatum[]) { this._orders = orders; this.requestUpdate() }
  setVisible(v: boolean) { this._show = v }

  hideOrder(orderId: string) { this._hidden.add(orderId); this.requestUpdate() }
  showOrder(orderId: string) { this._hidden.delete(orderId); this.requestUpdate() }

  // Overloaded: hitTest(x, y) for lightweight-charts native, hitTest(x, y, W, H) for subscribeClick
  hitTest(x: number, y: number): PrimitiveHoveredItem | null
  hitTest(x: number, y: number, W: number, H: number): string | null
  hitTest(x: number, y: number, W?: number, _H?: number): PrimitiveHoveredItem | null | string | null {
    if (W == null) {
      // Native lightweight-charts call — return PrimitiveHoveredItem for cursor
      const orderId = this._hitTestPill(x, y)
      if (orderId) {
        return {
          cursorStyle: this._isDragging ? 'grabbing' : 'grab',
          externalId: `order:${orderId}`,
          zOrder: 'top',
        } as PrimitiveHoveredItem
      }
      return null
    }
    // subscribeClick call — return orderId for × close button
    return this._hitTestCloseBtn(x, y)
  }
}

// ─── removeEmptyPanes ───────────────────────────────────────────────────

export function removeEmptyPanes(chart: any) {
  if (!chart || typeof chart.panes !== 'function') return
  const panes = chart.panes()
  if (!Array.isArray(panes)) return
  for (const pane of panes) {
    if (!pane || typeof pane !== 'object') continue
    const id = pane.paneIndex ?? pane.id
    if (id === 0) continue
    const seriesList = typeof pane.getSeries === 'function' ? pane.getSeries() : []
    if (!seriesList || seriesList.length === 0) {
      try { chart.removePane(pane) } catch {}
    }
  }
}

export class VolumeProfilePrimitive {
  _series: any
  _timeScale: any
  _pocPrice: number = 0
  _developingPoc: Array<{ time: number; price: number }> = []
  _prevPocPrice: number = 0
  _prevDevelopingPoc: Array<{ time: number; price: number }> = []
  _show = false
  _pocColor = '#FFD700'
  _devPocColor = '#FF8C00'
  _prevPocColor = 'rgba(255,215,0,0.35)'
  _prevDevPocColor = 'rgba(255,140,0,0.3)'
  _bucketSize: number

  constructor(series: any, timeScale: any, bucketSize = 10) {
    this._series = series
    this._timeScale = timeScale
    this._bucketSize = bucketSize
  }

  paneViews() {
    const self = this
    return [
      {
        zOrder() { return 'top' as const },
        renderer() {
          return {
            draw(target: any) {
              if (!self._show) return
              target.useMediaCoordinateSpace((scope: any) => {
                const ctx = scope.context
                const chartWidth = scope.mediaSize.width

                // Draw previous day developing POC (dimmed, drawn first so today's is on top)
                if (self._prevDevelopingPoc.length > 1) {
                  ctx.save()
                  ctx.strokeStyle = self._prevDevPocColor
                  ctx.lineWidth = 1
                  ctx.setLineDash([3, 3])
                  ctx.beginPath()
                  let started = false
                  let prevY: number | null = null
                  for (const pt of self._prevDevelopingPoc) {
                    const x = self._timeScale.timeToCoordinate(pt.time)
                    const y = self._series.priceToCoordinate(pt.price)
                    if (x == null || y == null) continue
                    if (!started) { ctx.moveTo(x, y); started = true }
                    else {
                      if (prevY != null && Math.abs(y - prevY) > 0.5) { ctx.lineTo(x, prevY); ctx.lineTo(x, y) }
                      else ctx.lineTo(x, y)
                    }
                    prevY = y
                  }
                  ctx.stroke()
                  ctx.setLineDash([])
                  ctx.restore()
                }

                // Draw previous day POC line (dimmed, dashed)
                if (self._prevPocPrice > 0) {
                  const pocY = self._series.priceToCoordinate(self._prevPocPrice)
                  if (pocY != null) {
                    ctx.save()
                    ctx.strokeStyle = self._prevPocColor
                    ctx.lineWidth = 1
                    ctx.setLineDash([6, 4])
                    ctx.beginPath()
                    ctx.moveTo(0, pocY)
                    ctx.lineTo(chartWidth, pocY)
                    ctx.stroke()
                    ctx.fillStyle = self._prevPocColor
                    ctx.font = '10px Arial'
                    ctx.textAlign = 'right'
                    ctx.fillText(`Prev ${self._prevPocPrice.toFixed(0)}`, chartWidth - 8, pocY - 5)
                    ctx.setLineDash([])
                    ctx.restore()
                  }
                }

                // Draw today developing POC (stepped line)
                if (self._developingPoc.length > 1) {
                  ctx.save()
                  ctx.strokeStyle = self._devPocColor
                  ctx.lineWidth = 1.5
                  ctx.setLineDash([4, 3])
                  ctx.beginPath()
                  let started = false
                  let prevY: number | null = null
                  for (const pt of self._developingPoc) {
                    const x = self._timeScale.timeToCoordinate(pt.time)
                    const y = self._series.priceToCoordinate(pt.price)
                    if (x == null || y == null) continue
                    if (!started) { ctx.moveTo(x, y); started = true }
                    else {
                      if (prevY != null && Math.abs(y - prevY) > 0.5) { ctx.lineTo(x, prevY); ctx.lineTo(x, y) }
                      else ctx.lineTo(x, y)
                    }
                    prevY = y
                  }
                  ctx.stroke()
                  ctx.setLineDash([])
                  ctx.restore()
                }

                // Draw today POC line (solid, full color)
                if (self._pocPrice > 0) {
                  const pocY = self._series.priceToCoordinate(self._pocPrice)
                  if (pocY != null) {
                    ctx.save()
                    ctx.strokeStyle = self._pocColor
                    ctx.lineWidth = 2
                    ctx.setLineDash([])
                    ctx.beginPath()
                    ctx.moveTo(0, pocY)
                    ctx.lineTo(chartWidth, pocY)
                    ctx.stroke()
                    ctx.fillStyle = self._pocColor
                    ctx.font = 'bold 11px Arial'
                    ctx.textAlign = 'right'
                    ctx.fillText(`POC ${self._pocPrice.toFixed(0)}`, chartWidth - 8, pocY - 6)
                    ctx.restore()
                  }
                }
              })
            },
          }
        },
      },
    ]
  }

  setData(pocPrice: number, developingPoc: Array<{ time: number; price: number }>, prevPocPrice = 0, prevDevelopingPoc: Array<{ time: number; price: number }> = []) {
    this._pocPrice = pocPrice
    this._developingPoc = developingPoc
    this._prevPocPrice = prevPocPrice
    this._prevDevelopingPoc = prevDevelopingPoc
  }

  setVisible(v: boolean) { this._show = v }
  toggle() { this._show = !this._show; return this._show }
}

import type { ISeriesApi } from 'lightweight-charts'

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
}

export class PositionLinePrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _positions: PositionDatum[] = []
  _show = true
  _hidden = new Set<string>()
  _onClose?: (symbol: string) => void

  constructor(series: ISeriesApi<any>, timeScale: any, onClose?: (symbol: string) => void) {
    this._series = series
    this._timeScale = timeScale
    this._onClose = onClose
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
              const dark = document.documentElement.classList.contains('dark')
              for (const pos of self._positions) {
                if (self._hidden.has(pos.symbol)) continue
                const y = self._series.priceToCoordinate(pos.entryPrice)
                if (y == null) continue
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
                const pillH = 22
                const pillY = y - pillH / 2

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
                ctx.fillText(badgeText, cx + badgeW / 2, y)

                // Quantity
                cx += badgeW + gap
                ctx.fillStyle = qtyBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, qtyW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = qtyText
                ctx.fillText(qtyText_, cx + qtyW / 2, y)

                // Price + PnL
                cx += qtyW + gap
                ctx.fillStyle = infoBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, infoW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = pos.pnl >= 0 ? '#60a5fa' : '#f87171'
                ctx.textAlign = 'left'
                ctx.fillText(pnlText, cx + 6, y)

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
                ctx.fillText('×', cx + closeW / 2, y + 1)

                // Price tag on right axis
                const tagH = 18
                const tagX = W - tagW
                const tagY = y - tagH / 2
                ctx.fillStyle = badgeColor
                ctx.beginPath()
                ctx.roundRect(tagX, tagY, tagW, tagH, 3)
                ctx.fill()
                ctx.font = 'bold 10px sans-serif'
                ctx.fillStyle = '#fff'
                ctx.textAlign = 'center'
                ctx.fillText(pos.entryPrice.toFixed(2), tagX + tagW / 2, y)
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

  hitTest(x: number, y: number, W: number, _H: number): string | null {
    for (const pos of this._positions) {
      if (this._hidden.has(pos.symbol)) continue
      const priceY = this._series.priceToCoordinate(pos.entryPrice)
      if (priceY == null) continue
      if (Math.abs(y - priceY) > 14) continue
      const pillH = 22
      const pillY = priceY - pillH / 2
      if (y < pillY || y > pillY + pillH) continue
      // Close button is always the last 20px before the price tag
      const closeBtnRight = W - 56 - 3
      const closeBtnLeft = closeBtnRight - 20
      if (x >= closeBtnLeft && x <= closeBtnRight) return pos.symbol
    }
    return null
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
  orderId: string
}

export class OrderLinePrimitive {
  _series: ISeriesApi<any>
  _orders: OrderLineDatum[] = []
  _show = true
  _hidden = new Set<string>()
  _onClose?: (orderId: string) => void

  constructor(series: ISeriesApi<any>, onClose?: (orderId: string) => void) {
    this._series = series
    this._onClose = onClose
  }

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
              const dark = document.documentElement.classList.contains('dark')
              for (const ord of self._orders) {
                if (self._hidden.has(ord.orderId)) continue
                const y = self._series.priceToCoordinate(ord.price)
                if (y == null) continue
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

                // Dashed horizontal line
                ctx.save()
                ctx.strokeStyle = lineColor
                ctx.lineWidth = 1
                ctx.setLineDash([6, 4])
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
                const typeText = ord.orderType === 'SL-M' ? `SL-M @ ${ord.triggerPrice.toFixed(2)}` : ord.orderType === 'SL' ? `SL @ ${ord.triggerPrice.toFixed(2)}` : `LIMIT @ ${ord.price.toFixed(2)}`
                const typeW = ctx.measureText(typeText).width + 12
                const closeW = 20
                const gap = 3
                const pillH = 22
                const pillY = y - pillH / 2
                const tagW = 56
                const totalW = sideW + gap + qtyW + gap + typeW + gap + closeW
                const pillX = W - tagW - gap - totalW

                // Background
                ctx.fillStyle = pillBg
                ctx.beginPath()
                ctx.roundRect(pillX, pillY, totalW, pillH, 4)
                ctx.fill()

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
                ctx.fillText(sideText, cx + sideW / 2, y)

                // Quantity
                cx += sideW + gap
                ctx.fillStyle = qtyBg
                ctx.beginPath()
                ctx.roundRect(cx, pillY, qtyW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = qtyText
                ctx.fillText(qtyStr, cx + qtyW / 2, y)

                // Order type (LIMIT / SL / SL-M)
                cx += qtyW + gap
                ctx.fillStyle = typeColor
                ctx.beginPath()
                ctx.roundRect(cx, pillY, typeW, pillH, 4)
                ctx.fill()
                ctx.font = 'bold 11px sans-serif'
                ctx.fillStyle = typeTextColor
                ctx.textAlign = 'center'
                ctx.fillText(typeText, cx + typeW / 2, y)

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
                ctx.fillText('×', cx + closeW / 2, y + 1)

                // Price tag on right axis
                const tagH = 18
                const tagX = W - tagW
                const tagY = y - tagH / 2
                ctx.fillStyle = badgeColor
                ctx.beginPath()
                ctx.roundRect(tagX, tagY, tagW, tagH, 3)
                ctx.fill()
                ctx.font = 'bold 10px sans-serif'
                ctx.fillStyle = '#fff'
                ctx.textAlign = 'center'
                ctx.fillText(ord.price.toFixed(2), tagX + tagW / 2, y)
              }
            })
          },
        }
      },
    }]
  }

  setData(orders: OrderLineDatum[]) { this._orders = orders; try { (this as any).requestUpdate?.() } catch {} }
  setVisible(v: boolean) { this._show = v }

  hideOrder(orderId: string) { this._hidden.add(orderId) }
  showOrder(orderId: string) { this._hidden.delete(orderId) }

  hitTest(x: number, y: number, W: number, _H: number): string | null {
    for (const ord of this._orders) {
      if (this._hidden.has(ord.orderId)) continue
      const priceY = this._series.priceToCoordinate(ord.price)
      if (priceY == null) continue
      const pillH = 22
      const pillY = priceY - pillH / 2
      if (y < pillY || y > pillY + pillH) continue
      const closeBtnRight = W - 56 - 3
      const closeBtnLeft = closeBtnRight - 20
      if (x >= closeBtnLeft && x <= closeBtnRight) return ord.orderId
    }
    return null
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

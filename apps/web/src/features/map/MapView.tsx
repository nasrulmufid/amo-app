import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { InventoryMapPointDTO } from '@amo/shared'

setWorkerUrl(mapLibreWorkerUrl)

/**
 * Peta perangkat (PRD §5.4).
 *
 * - Provider: OpenFreeMap / MapLibre GL — tanpa API key; data peta OpenStreetMap.
 * - Hanya perangkat dengan koordinat VALID yang diberi pin (PRD §3.4).
 * - Warna pin mengikuti status; legenda selalu disertai teks (bukan warna saja).
 */

const STATUS_COLOR: Record<string, string> = {
  online: '#16845b',
  offline: '#c23b45',
  unknown: '#617084',
  stale: '#a9680b',
  sync_error: '#c23b45',
}

export default function MapView({ points, focus }: { points: InventoryMapPointDTO[]; focus?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : [-2.99, 104.75]

  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [center[1], center[0]],
      zoom: 12,
      minZoom: 1,
      maxZoom: 19,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl(), 'top-left')
    mapRef.current = map
    map.once('load', () => setMapReady(true))

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      mapRef.current = null
      map.remove()
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = points.map((point) => {
      const popupContent = document.createElement('div')
      popupContent.className = 'grid gap-1'

      const link = document.createElement('a')
      link.href = `/inventory/${encodeURIComponent(point.uuid)}`
      link.className = 'font-semibold hover:underline'
      link.textContent = point.name
      popupContent.append(link)

      const details = [
        point.serialNumber ?? 'Serial belum ada',
        [point.manufacturer, point.model].filter(Boolean).join(' ') || '—',
        point.locationName ?? 'Lokasi belum diisi',
        point.displayStatus.replaceAll('_', ' '),
      ]
      for (const text of details) {
        const line = document.createElement('span')
        line.className = 'text-xs'
        line.textContent = text
        popupContent.append(line)
      }

      return new Marker({ color: STATUS_COLOR[point.displayStatus] ?? STATUS_COLOR.unknown })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(new Popup().setDOMContent(popupContent))
        .addTo(map)
    })

    const focused = focus ? points.find((point) => point.uuid === focus) : undefined
    if (focused) {
      map.easeTo({ center: [focused.longitude, focused.latitude], zoom: 15 })
    } else if (points.length === 1) {
      const only = points[0]!
      map.easeTo({ center: [only.longitude, only.latitude], zoom: 13 })
    } else if (points.length > 1) {
      const bounds = points.reduce(
        (result, point) => result.extend([point.longitude, point.latitude]),
        new LngLatBounds(),
      )
      map.fitBounds(bounds, { padding: 48, maxZoom: 13 })
    }
  }, [points, focus, mapReady])

  return (
    <div ref={containerRef} className="h-[32rem] w-full rounded-xl border" aria-label="Peta lokasi perangkat" />
  )
}

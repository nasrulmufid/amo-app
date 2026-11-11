import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DeviceDisplayStatus, InventoryMapPointDTO } from '@amo/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/features/auth/auth-context'
import { RemoteButton } from '@/features/remote/RemoteButton'

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

const STATUS_LABEL: Record<DeviceDisplayStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Unknown',
  stale: 'Stale',
  sync_error: 'Sync error',
}

const STATUS_BADGE_CLASS: Record<DeviceDisplayStatus, string> = {
  online: 'border-status-online/30 bg-status-online/10 text-status-online',
  offline: 'border-status-offline/30 bg-status-offline/10 text-status-offline',
  unknown: 'border-status-unknown/30 bg-status-unknown/10 text-status-unknown',
  stale: 'border-status-stale/30 bg-status-stale/10 text-status-stale',
  sync_error: 'border-status-offline/30 bg-status-offline/10 text-status-offline',
}

interface DevicePopupPortal {
  uuid: string
  container: HTMLElement
  popup: Popup
  point: InventoryMapPointDTO
}

export default function MapView({ points, focus }: { points: InventoryMapPointDTO[]; focus?: string }) {
  const { can } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [popupPortals, setPopupPortals] = useState<DevicePopupPortal[]>([])
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
      attributionControl: false,
    })
    map.addControl(new NavigationControl(), 'top-left')
    map.addControl(new AttributionControl({ compact: true }), 'top-right')
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
      const container = document.createElement('div')
      const popup = new Popup({ closeButton: false, className: 'amo-device-popup', maxWidth: 'none', offset: 12 }).setDOMContent(container)
      popup.on('open', () => {
        setPopupPortals((current) => [
          ...current.filter((item) => item.uuid !== point.uuid),
          { uuid: point.uuid, container, popup, point },
        ])
      })
      popup.on('close', () => {
        setPopupPortals((current) => current.filter((item) => item.uuid !== point.uuid))
      })

      return new Marker({ color: STATUS_COLOR[point.displayStatus] ?? STATUS_COLOR.unknown })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(popup)
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
    <>
      <div ref={containerRef} className="h-[32rem] w-full rounded-xl border" aria-label="Peta lokasi perangkat" />
      {popupPortals.map(({ uuid, container, popup, point }) =>
        createPortal(
          <Card size="sm" className="w-60 max-w-[calc(100vw-2rem)] overflow-hidden border-border/80 py-0 shadow-none">
            <CardHeader className="flex flex-row items-start justify-between gap-2 border-b px-3 py-1.5">
              <div className="min-w-0">
                <CardTitle className="truncate text-xs">
                  <Link
                    to={`/inventory/${point.uuid}`}
                    className="hover:text-primary hover:underline"
                    onClick={() => popup.remove()}
                  >
                    {point.name}
                  </Link>
                </CardTitle>
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {point.serialNumber ?? 'Serial belum ada'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup detail perangkat"
                onClick={() => popup.remove()}
                className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span aria-hidden>×</span>
              </button>
            </CardHeader>
            <CardContent className="grid gap-1.5 px-3 py-1.5">
              <div className="flex flex-wrap items-center">
                <Badge variant="outline" className={`${STATUS_BADGE_CLASS[point.displayStatus]} text-[10px]`}>
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {STATUS_LABEL[point.displayStatus]}
                </Badge>
              </div>
              <dl className="grid gap-1 text-[11px]">
                <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="min-w-0 truncate text-right font-medium">
                    {[point.manufacturer, point.model].filter(Boolean).join(' ') || '—'}
                  </dd>
                </div>
                <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
                  <dt className="text-muted-foreground">Lokasi</dt>
                  <dd className="min-w-0 truncate text-right font-medium">{point.locationName ?? 'Belum diisi'}</dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter className="flex gap-2 border-t px-3 py-1.5">
              {can('remote.open') && (
                <RemoteButton
                  uuid={point.uuid}
                  size="sm"
                  compact
                  className="min-w-0 flex-1 text-xs max-[480px]:size-8 max-[480px]:flex-none max-[480px]:px-0"
                />
              )}
              <Button
                asChild
                size="sm"
                variant="outline"
                className={`text-xs ${!can('remote.open') ? 'w-full' : 'max-[480px]:flex-1'}`}
              >
                <Link to={`/inventory/${point.uuid}`} onClick={() => popup.remove()}>
                  <ExternalLink aria-hidden />
                  Detail
                </Link>
              </Button>
            </CardFooter>
          </Card>,
          container,
          uuid,
        ),
      )}
    </>
  )
}

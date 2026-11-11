import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { InventoryMapPointDTO } from '@amo/shared'
import { StatusBadge } from '@/components/StatusBadge'

/**
 * Peta perangkat (PRD §5.4).
 *
 * - Provider: OpenStreetMap (Leaflet) — tanpa API key, sesuai PRD §17 "provider dipilih saat implementasi".
 * - Hanya perangkat dengan koordinat VALID yang diberi pin (PRD §3.4).
 * - Warna pin mengikuti status; legenda selalu disertai teks (bukan warna saja).
 */

/** Pin SVG sederhana (menghindari masalah aset default Leaflet di bundler). */
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'amo-pin',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.45)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  })
}

const STATUS_COLOR: Record<string, string> = {
  online: '#16845b',
  offline: '#c23b45',
  unknown: '#617084',
  stale: '#a9680b',
  sync_error: '#c23b45',
}

/** Sesuaikan viewport ke semua pin (atau ke satu perangkat bila `focus` diberikan). */
function FitBounds({ points, focus }: { points: InventoryMapPointDTO[]; focus?: string }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const focused = focus ? points.find((p) => p.uuid === focus) : undefined
    if (focused) {
      map.setView([focused.latitude, focused.longitude], 15)
      return
    }
    if (points.length === 1) {
      const only = points[0]!
      map.setView([only.latitude, only.longitude], 13)
      return
    }
    map.fitBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]), { padding: [32, 32] })
  }, [map, points, focus])
  return null
}

export default function MapView({ points, focus }: { points: InventoryMapPointDTO[]; focus?: string }) {
  const icons = useMemo(
    () => Object.fromEntries(Object.entries(STATUS_COLOR).map(([k, v]) => [k, pinIcon(v)])),
    [],
  )
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : [-2.99, 104.75]

  return (
    <MapContainer center={center} zoom={12} className="h-[32rem] w-full rounded-xl border" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} focus={focus} />
      {points.map((p) => (
        <Marker key={p.uuid} position={[p.latitude, p.longitude]} icon={icons[p.displayStatus] ?? icons.unknown}>
          <Popup>
            <div className="grid gap-1">
              <Link to={`/inventory/${p.uuid}`} className="font-semibold hover:underline">
                {p.name}
              </Link>
              <span className="text-xs text-muted-foreground">{p.serialNumber ?? 'Serial belum ada'}</span>
              <span className="text-xs">{[p.manufacturer, p.model].filter(Boolean).join(' ') || '—'}</span>
              <span className="text-xs">{p.locationName ?? 'Lokasi belum diisi'}</span>
              <StatusBadge status={p.displayStatus} />
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

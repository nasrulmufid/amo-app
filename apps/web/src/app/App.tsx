import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import AuditLogPage from '@/features/audit/AuditLogPage'
import LoginPage from '@/features/auth/LoginPage'
import { RequireAuth, RequirePermission } from '@/features/auth/guards'
import DashboardPage from '@/features/dashboard/DashboardPage'
import InventoryDetailPage from '@/features/inventory/InventoryDetailPage'
import InventoryPage from '@/features/inventory/InventoryPage'
import MapPage from '@/features/map/MapPage'
import SettingsPage from '@/features/settings/SettingsPage'
import UsersPage from '@/features/users/UsersPage'

/**
 * PETA ROUTE aplikasi.
 *   /login                    publik
 *   <RequireAuth>             semua di bawahnya wajib login
 *     <AppLayout>             sidebar + konten
 *       <RequirePermission>   gerbang per-izin (UX; API tetap menegakkan)
 * Menambah halaman: buat di features/<nama>/, daftarkan di sini, tambahkan ke nav-items.ts.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route element={<RequirePermission permission="dashboard.read" />}>
            <Route path="dashboard" element={<DashboardPage />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.read" />}>
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="inventory/:uuid" element={<InventoryDetailPage />} />
            <Route path="map" element={<MapPage />} />
          </Route>
          <Route element={<RequirePermission permission="settings.manage" />}>
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route element={<RequirePermission permission="users.manage" />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit.read" />}>
            <Route path="audit" element={<AuditLogPage />} />
          </Route>

          <Route
            path="*"
            element={
              <div className="py-16 text-center">
                <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
              </div>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}

import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { toast } from 'sonner'
import { LogOut, Menu, Router } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/features/auth/auth-context'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './nav-items'

const ROLE_LABEL = { admin: 'Administrator', operator: 'Operator', viewer: 'Viewer' } as const

/** Daftar menu — dipakai bersama oleh sidebar desktop dan sidenav mobile. */
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav aria-label="Navigasi utama" className="grid gap-1">
      {NAV_ITEMS.filter((i) => can(i.permission)).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground/80 hover:bg-accent hover:text-accent-foreground',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Router className="size-4" aria-hidden />
      </div>
      <span className="font-semibold tracking-tight">AMO</span>
    </div>
  )
}

/** Kotak pengguna + tombol keluar (dipakai di sidebar desktop & sidenav mobile). */
function UserBox({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth()
  return (
    <div className="grid gap-2 border-t border-sidebar-border p-3">
      <div className="px-1 text-sm">
        <div className="truncate font-medium">{user?.name}</div>
        <div className="text-xs text-muted-foreground">{user ? ROLE_LABEL[user.role] : ''}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onLogout}>
        <LogOut aria-hidden /> Keluar
      </Button>
    </div>
  )
}

/**
 * Shell aplikasi.
 *  - Desktop (≥ md): sidebar tetap di kiri.
 *  - Mobile (< md): top bar + SIDENAV geser dari kiri (bukan dropdown), berisi menu
 *    lengkap + kotak pengguna, sehingga navigasi terasa sama seperti di desktop.
 * Konten halaman dirender di <Outlet />.
 */
export function AppLayout() {
  const { logout } = useAuth()
  const [navOpen, setNavOpen] = useState(false)

  const onLogout = async () => {
    try {
      await logout()
    } catch {
      // Cookie HttpOnly hanya bisa dihapus server → bila gagal, sesi bisa muncul lagi saat reload.
      toast.error('Gagal mencabut sesi di server. Coba keluar lagi; jangan tinggalkan perangkat ini.')
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 border-r border-sidebar-border bg-sidebar py-4 md:flex">
        <div className="px-3">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavList />
        </div>
        <UserBox onLogout={onLogout} />
      </aside>

      {/* Top bar mobile */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Buka menu navigasi">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
            <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
              <SheetTitle className="sr-only">Navigasi utama</SheetTitle>
              <SheetDescription className="sr-only">Pilih halaman yang ingin dibuka.</SheetDescription>
              <Brand />
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">
              <NavList onNavigate={() => setNavOpen(false)} />
            </div>
            <UserBox onLogout={onLogout} />
          </SheetContent>
        </Sheet>
        <div className="px-1">
          <Brand />
        </div>
      </header>

      <main className="min-w-0 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}

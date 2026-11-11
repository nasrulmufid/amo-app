/**
 * Footer aplikasi — tampil di SEMUA halaman (login & halaman setelah login).
 * Simpel: copyright tahun berjalan + kredit pengembang.
 */
export function AppFooter({ className }: { className?: string }) {
  const year = new Date().getFullYear()
  return (
    <footer className={className}>
      <div className="border-t py-3 text-center text-xs text-muted-foreground">
        © {year} · Developed by Nasrul Mufid
      </div>
    </footer>
  )
}

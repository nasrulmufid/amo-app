import { Construction } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Placeholder halaman yang BELUM dikerjakan. Hapus pemakaiannya saat halaman asli dibuat.
 * `todo` menjelaskan apa yang harus dibangun (rujukan PRD) agar developer tahu langkah berikutnya.
 */
export function ComingSoon({ title, sprint, todo }: { title: string; sprint: number; todo: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="size-5 text-status-stale" aria-hidden />
            <CardTitle>Belum diimplementasikan</CardTitle>
            <Badge variant="secondary">Sprint {sprint}</Badge>
          </div>
          <CardDescription>Kerangka halaman sudah tersedia di starter kit. Yang perlu dibangun:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {todo.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

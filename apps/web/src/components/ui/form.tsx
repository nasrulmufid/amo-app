import * as React from 'react'
import { cn } from '@/lib/utils'

/** shadcn/ui Form primitives (tanpa react-hook-form context — dipakai bersama useForm). */
function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="form-item" className={cn('grid gap-2', className)} {...props} />
}
function FormLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="form-label"
      className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
      {...props}
    />
  )
}
function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="form-description" className={cn('text-xs text-muted-foreground', className)} {...props} />
}
function FormMessage({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (!children) return null
  return (
    <p data-slot="form-message" role="alert" className={cn('text-xs text-destructive', className)} {...props}>
      {children}
    </p>
  )
}

export { FormItem, FormLabel, FormDescription, FormMessage }

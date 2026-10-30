import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'link'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white font-semibold hover:bg-accent-strong disabled:opacity-60',
  secondary:
    'border border-line bg-surface text-ink hover:bg-subtle disabled:opacity-60',
  link: 'text-accent font-semibold hover:text-accent-strong hover:underline',
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const size = variant === 'link' ? 'px-0' : 'min-h-11 rounded-lg px-4'
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 ${size} ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

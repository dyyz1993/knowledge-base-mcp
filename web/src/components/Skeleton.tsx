import { useTheme } from "../theme"

export function DocSkeleton() {
  const { theme } = useTheme()
  const skelBg = theme === "dark" ? "bg-zinc-800" : "bg-gray-200"
  return (
    <div className="animate-pulse space-y-4 p-4">
      <div className={`h-6 ${skelBg} rounded w-3/4`} />
      <div className={`h-4 ${skelBg} rounded w-full`} />
      <div className={`h-4 ${skelBg} rounded w-5/6`} />
      <div className={`h-4 ${skelBg} rounded w-2/3`} />
      <div className={`h-64 ${skelBg} rounded w-full`} />
      <div className={`h-4 ${skelBg} rounded w-full`} />
      <div className={`h-4 ${skelBg} rounded w-4/5`} />
    </div>
  )
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  const { theme } = useTheme()
  const skelBg = theme === "dark" ? "bg-zinc-800" : "bg-gray-200"
  return (
    <div className="animate-pulse space-y-2 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <div className={`h-4 ${skelBg} rounded w-2/3`} />
        </div>
      ))}
    </div>
  )
}

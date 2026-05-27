import { Input, Button, Tag } from "antd"
import { FolderSearch } from "lucide-react"
import { useTheme } from "../../theme"

interface SkillPathsSectionProps {
  skillPaths: string[]
  newPath: string
  scanning: boolean
  scanResult: { total: number; imported: number; skipped: number; errors: string[] } | null
  onNewPathChange: (v: string) => void
  onAddPath: () => void
  onRemovePath: (p: string) => void
  onScanSkills: () => void
}

export function SkillPathsSection({
  skillPaths,
  newPath,
  scanning,
  scanResult,
  onNewPathChange,
  onAddPath,
  onRemovePath,
  onScanSkills,
}: SkillPathsSectionProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <section className={`rounded-lg border p-4 space-y-4 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
        <FolderSearch size={13} className={isDark ? "text-zinc-500" : "text-gray-400"} />
        Skill 路径管理
      </div>

      <div className="space-y-2">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Scanned Paths</label>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {skillPaths.length === 0 && (
            <span className={`text-xs ${isDark ? "text-zinc-600" : "text-gray-400"}`}>No paths configured</span>
          )}
          {skillPaths.map(p => (
            <Tag
              key={p}
              closable
              onClose={() => onRemovePath(p)}
              style={{
                background: isDark ? "#27272a" : "#f4f4f5",
                border: isDark ? "1px solid #3f3f46" : "1px solid #d4d4d8",
                color: isDark ? "#a1a1aa" : "#52525b",
              }}
            >
              {p}
            </Tag>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <Input
          size="small"
          value={newPath}
          onChange={e => onNewPathChange(e.target.value)}
          placeholder="~/path/to/skills"
          className="flex-1"
          onPressEnter={onAddPath}
        />
        <Button size="small" onClick={onAddPath}>
          Add
        </Button>
      </div>

      <Button
        icon={<FolderSearch size={13} />}
        onClick={onScanSkills}
        loading={scanning}
        block
        className={`flex items-center justify-center gap-1.5 ${isDark ? "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 hover:text-gray-900"}`}
      >
        Scan Skills
      </Button>

      {scanResult && (
        <div className={`rounded border p-3 text-xs space-y-1 ${isDark ? "border-zinc-800 bg-zinc-900/50" : "border-gray-200 bg-gray-50"}`}>
          <div className="flex items-center justify-between">
            <span className={isDark ? "text-zinc-400" : "text-gray-500"}>Total scanned:</span>
            <span className={isDark ? "text-zinc-200" : "text-gray-800"}>{scanResult.total}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-green-400">Imported:</span>
            <span className="text-green-300">{scanResult.imported}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-yellow-400">Skipped:</span>
            <span className="text-yellow-300">{scanResult.skipped}</span>
          </div>
          {scanResult.errors.length > 0 && (
            <div className={`mt-2 pt-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
              <span className="text-red-400">Errors:</span>
              <ul className="mt-1 space-y-0.5 text-red-300/80 list-disc list-inside">
                {scanResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

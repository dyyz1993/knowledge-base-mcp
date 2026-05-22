import { Input, Button, Tag } from "antd"
import { FolderSearch } from "lucide-react"

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
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
        <FolderSearch size={13} className="text-zinc-500" />
        Skill 路径管理
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Scanned Paths</label>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {skillPaths.length === 0 && (
            <span className="text-xs text-zinc-600">No paths configured</span>
          )}
          {skillPaths.map(p => (
            <Tag
              key={p}
              closable
              onClose={() => onRemovePath(p)}
              style={{ background: "#27272a", border: "1px solid #3f3f46", color: "#a1a1aa" }}
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
        className="flex items-center justify-center gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
      >
        Scan Skills
      </Button>

      {scanResult && (
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Total scanned:</span>
            <span className="text-zinc-200">{scanResult.total}</span>
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
            <div className="mt-2 pt-2 border-t border-zinc-800">
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

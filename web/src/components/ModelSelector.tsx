import { Select } from "antd"
import { useChatStore } from "../stores/chat"

export default function ModelSelector({ className }: { className?: string }) {
  const { models, currentModel, setModel } = useChatStore()

  const nameCounts = models.reduce<Record<string, number>>((acc, m) => {
    const name = m.name || m.id
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})

  const grouped = models.reduce<Record<string, { value: string; label: string }[]>>((acc, m) => {
    const key = m.provider
    if (!acc[key]) acc[key] = []
    const name = m.name || m.id
    const label = nameCounts[name] > 1 ? `${name} (${m.provider})` : name
    acc[key].push({ value: `${m.provider}|${m.id}`, label })
    return acc
  }, {})

  const options = Object.entries(grouped).map(([provider, items]) => ({
    label: provider.charAt(0).toUpperCase() + provider.slice(1),
    options: items,
  }))

  const currentValue = currentModel ? `${currentModel.provider}|${currentModel.id}` : undefined

  return (
    <Select
      value={currentValue}
      placeholder="Select model"
      aria-label="选择模型"
      options={options}
      onChange={(val: string) => {
        const [provider, id] = val.split("|")
        setModel(provider, id)
      }}
      size="small"
      className={`min-w-[180px] ${className || ""}`}
      popupMatchSelectWidth={false}
    />
  )
}

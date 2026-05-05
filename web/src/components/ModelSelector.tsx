import { Select } from "antd"
import { useChatStore } from "../stores/chat"

export default function ModelSelector() {
  const { models, currentModel, setModel } = useChatStore()

  const grouped = models.reduce<Record<string, { value: string; label: string }[]>>((acc, m) => {
    const key = m.provider
    if (!acc[key]) acc[key] = []
    acc[key].push({ value: `${m.provider}|${m.id}`, label: m.name || m.id })
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
      options={options}
      onChange={(val: string) => {
        const [provider, id] = val.split("|")
        setModel(provider, id)
      }}
      size="small"
      className="min-w-[180px]"
      popupMatchSelectWidth={false}
    />
  )
}

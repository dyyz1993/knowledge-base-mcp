# 模块：Theme System (主题系统)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-TH-01: 默认主题应为 Light 模式（header bg-white, body bg-gray-50）
- [x] TC-TH-02: 主题切换按钮应显示 Moon 图标（aria-label="Switch to dark theme"）
- [x] TC-TH-03: 点击主题按钮切换到 Dark 模式
- [x] TC-TH-04: Dark 模式下 body 应为 bg-zinc-950, text-zinc-100
- [x] TC-TH-05: Dark 模式下切换按钮应显示 Sun 图标（aria-label="Switch to light theme"）
- [x] TC-TH-06: 再点击切换回 Light 模式，恢复原始样式
- [x] TC-TH-07: 主题选择应持久化到 localStorage
- [x] TC-TH-08: 刷新页面后主题应保持（Dark → 刷新 → 仍是 Dark）
- [x] TC-TH-09: Dark 模式下 KB sidebar 应为 bg-zinc-950 border-zinc-800
- [x] TC-TH-10: Dark 模式下所有边框应为 border-zinc-800
- [x] TC-TH-11: Dark 模式下 Settings Drawer 也应用暗色主题
- [x] TC-TH-12: Dark 模式下 Search Palette 应为 bg-zinc-900 border-zinc-700
- [x] TC-TH-13: 切换主题不应影响当前 Tab 选择
- [x] TC-TH-14: 切换主题不应影响文档选择状态
- [x] TC-TH-15: 连续快速切换 5 次不应崩溃

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-TH-01 | ✅ PASS | - | - | 默认 Light (data-theme="light") |
| TC-TH-02 | ✅ PASS | - | - | Moon icon, aria-label 正确 |
| TC-TH-03 | ✅ PASS | - | - | Dark mode 切换成功 |
| TC-TH-04 | ✅ PASS | - | - | bg-zinc-950 text-zinc-100 |
| TC-TH-05 | ✅ PASS | - | - | Sun icon 显示 |
| TC-TH-06 | ✅ PASS | - | - | 回到 Light 模式 |
| TC-TH-07 | ✅ PASS | - | - | localStorage kb-theme 持久化 |
| TC-TH-08 | ✅ PASS | - | - | 刷新后 Dark 保持 |
| TC-TH-09 | ✅ PASS | - | - | Sidebar 暗色主题正确 |
| TC-TH-10 | ✅ PASS | - | - | 所有边框 zinc-800/zinc-700 |
| TC-TH-11 | ✅ PASS | - | - | Settings Drawer 暗色 |
| TC-TH-12 | ✅ PASS | - | - | Search Palette bg-zinc-900 |
| TC-TH-13 | ✅ PASS | - | - | Tab 选择不受影响 |
| TC-TH-14 | ✅ PASS | - | - | 文档选择不受影响 |
| TC-TH-15 | ✅ PASS | - | - | 5次快速切换无崩溃 |

## 发现的问题
无。所有 15 个测试用例全部通过。

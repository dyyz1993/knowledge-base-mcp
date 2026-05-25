# 模块：Document Viewer (文档查看器)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-DV-01: 未选择文档时应显示空状态（Tag 图标 + "Select a document to view"）
- [x] TC-DV-02: 选中文档后顶部工具栏应显示（sticky top-0）
- [x] TC-DV-03: 工具栏应显示文档标题（截断显示）
- [x] TC-DV-04: 工具栏应显示文档 ID（短 hash，如 "ylox4ir49r"）
- [x] TC-DV-05: 工具栏应有 "Copy Reference" 按钮（aria-label="复制文档引用"）
- [x] TC-DV-06: 点击 Copy Reference 应复制 kb_read 代码片段到剪贴板
- [x] TC-DV-07: 应显示文档 H1 标题
- [x] TC-DV-08: 应显示文档日期（Clock 图标 + 日期）
- [x] TC-DV-09: 应显示项目链接（ExternalLink 图标）
- [x] TC-DV-10: 应显示标签 badges（主标签 cyan 色，其他标签 zinc 色）
- [x] TC-DV-11: 应显示关键词行（"Keywords: ..."）
- [x] TC-DV-12: 文档内容应以 Markdown 渲染
- [x] TC-DV-13: 代码块应有语法高亮
- [x] TC-DV-14: Mermaid 图表应渲染为 SVG
- [x] TC-DV-15: 长文档应可正常滚动
- [x] TC-DV-16: 切换文档后内容应完全更新（不留旧内容）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-DV-01 | ✅ PASS | - | - | "Select a document to view" |
| TC-DV-02 | ✅ PASS | - | - | Sticky toolbar 显示 |
| TC-DV-03 | ✅ PASS | - | - | 截断标题显示 |
| TC-DV-04 | ✅ PASS | - | - | 短 hash ID |
| TC-DV-05 | ✅ PASS | - | - | Copy Reference 按钮 |
| TC-DV-06 | ✅ PASS | - | - | 复制 kb_read 片段 |
| TC-DV-07 | ✅ PASS | - | - | H1 标题 |
| TC-DV-08 | ✅ PASS | - | - | Clock 图标 + 日期 |
| TC-DV-09 | ✅ PASS | - | - | ExternalLink 项目链接 |
| TC-DV-10 | ✅ PASS | - | - | 彩色标签 badges |
| TC-DV-11 | ✅ PASS | - | - | Keywords 行 |
| TC-DV-12 | ✅ PASS | - | - | Markdown 渲染正常 |
| TC-DV-13 | ✅ PASS | - | - | 代码块语法高亮 |
| TC-DV-14 | ⏭ SKIP | - | - | KB 中无 mermaid 文档 |
| TC-DV-15 | ✅ PASS | - | - | 长文档滚动正常 |
| TC-DV-16 | ⚠ BUG | - | #1 | 切换文档后滚动位置未重置 |

## 发现的问题

### Bug #1: 切换文档后滚动位置未重置 (P3-轻微)
- **复现**: 选择长文档 A → 滚动到底部 → 选择文档 B
- **预期**: 文档 B 从顶部开始显示
- **实际**: 仍然停留在之前的滚动位置

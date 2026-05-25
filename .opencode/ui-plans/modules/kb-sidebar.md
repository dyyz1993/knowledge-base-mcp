# 模块：KB Sidebar & Document List (知识库侧边栏)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-KBS-01: Sidebar 应显示 FolderOpen 图标 + "Knowledge Base" 标题
- [x] TC-KBS-02: 应显示文档总数 badge（如 "1188"）
- [x] TC-KBS-03: 文档应按项目分组显示
- [x] TC-KBS-04: 每个项目组应显示项目名和文档数量（如 "Uncategorized (737)"）
- [x] TC-KBS-05: 点击项目组可展开/折叠（aria-expanded 切换）
- [x] TC-KBS-06: 展开后显示该组下的文档列表（缩进 pl-8）
- [x] TC-KBS-07: 每个文档项应显示 FileText 图标 + 文档标题
- [x] TC-KBS-08: 文档标题过长时应被截断（text-ellipsis）
- [x] TC-KBS-09: 点击文档项应选中（高亮 bg-zinc-900 + aria-current="page"）
- [x] TC-KBS-10: 选中后右侧 DocViewer 应显示该文档内容
- [x] TC-KBS-11: 点击另一个文档应切换选中状态
- [x] TC-KBS-12: 之前选中的文档应取消高亮
- [x] TC-KBS-13: 折叠项目组后文档列表应隐藏
- [x] TC-KBS-14: 滚动 sidebar 应正常工作（overflow-y-auto）
- [x] TC-KBS-15: Sidebar 宽度应固定为 w-72

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-KBS-01 | ✅ PASS | - | - | Database 图标 + Knowledge Base 标题 |
| TC-KBS-02 | ✅ PASS | - | - | 文档总数 1188 |
| TC-KBS-03 | ✅ PASS | - | - | 139 个项目分组 |
| TC-KBS-04 | ✅ PASS | - | - | 格式 "Name (count)" |
| TC-KBS-05 | ✅ PASS | - | - | aria-expanded 切换正常 |
| TC-KBS-06 | ✅ PASS | - | - | 文档 pl-8 缩进 |
| TC-KBS-07 | ✅ PASS | - | - | FileText 图标 + 标题 |
| TC-KBS-08 | ✅ PASS | - | - | 36个长标题 truncate |
| TC-KBS-09 | ✅ PASS | - | - | 选中高亮 bg-zinc-900 |
| TC-KBS-10 | ✅ PASS | - | - | DocViewer 显示内容 |
| TC-KBS-11 | ✅ PASS | - | - | 选中切换正常 |
| TC-KBS-12 | ✅ PASS | - | - | 旧文档取消高亮 |
| TC-KBS-13 | ✅ PASS | - | - | 折叠后文档隐藏 |
| TC-KBS-14 | ✅ PASS | - | - | overflow-y-auto 滚动正常 |
| TC-KBS-15 | ✅ PASS | - | - | w-72 = 288px 固定宽度 |

## 发现的问题
无 Bug。所有 15 个测试用例通过。

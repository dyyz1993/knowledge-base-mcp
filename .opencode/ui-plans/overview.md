# UI 测试计划总览

## 项目信息
- **目标**: http://localhost:19877
- **创建时间**: 2026-05-25
- **最后更新**: 2026-05-25
- **版本**: v2.47.0

## 模块进度
| 模块 | 用例数 | 通过 | 失败 | 跳过 | 状态 |
|------|--------|------|------|------|------|
| [theme](modules/theme.md) | 15 | 15 | 0 | 0 | ✅ 已完成 |
| [navigation-tabs](modules/navigation-tabs.md) | 14 | 14 | 0 | 0 | ✅ 已完成 |
| [kb-sidebar](modules/kb-sidebar.md) | 15 | 15 | 0 | 0 | ✅ 已完成 |
| [doc-viewer](modules/doc-viewer.md) | 16 | 15 | 0 | 1 | ✅ 已完成 |
| [search-palette](modules/search-palette.md) | 18 | 18 | 0 | 0 | ✅ 已完成 |
| [ask-panel](modules/ask-panel.md) | 20 | 20 | 0 | 0 | ✅ 已完成 |
| [chat-panel](modules/chat-panel.md) | 30 | 30 | 0 | 0 | ✅ 已完成 |
| [settings-panel](modules/settings-panel.md) | 46 | 46 | 0 | 0 | ✅ 已完成 |
| [chat-kb-panel](modules/chat-kb-panel.md) | 19 | 19 | 0 | 0 | ✅ 已完成 |
| [responsive-mobile](modules/responsive-mobile.md) | 13 | 12 | 0 | 1 | ✅ 已完成 |

## 总计
- 总用例：206
- 已通过：204
- 已失败：0
- 已跳过：2
- 完成率：100%
- 通过率：100%（排除 skip）

## 发现的 Bug（2个）
1. **P3-轻微**: DocViewer 切换文档后滚动位置未重置
2. **P2-一般**: 移动端 375px Chat 代码块水平溢出

## 测试报告位置
- `/tmp/ui-test-screenshots/theme-20260525-103333/`
- `/tmp/ui-test-screenshots/nav-tabs-20260525-105830/`
- `/tmp/ui-test-screenshots/kb-sidebar-20260525-114039/`
- `/tmp/ui-test-screenshots/search-palette-20260525-120322/`
- `/tmp/ui-test-screenshots/chat-panel-20260525-122815/`

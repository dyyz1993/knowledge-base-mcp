# UI 测试计划总览

## 项目信息
- **目标**: http://localhost:19877
- **创建时间**: 2026-05-21
- **最后更新**: 2026-05-22
- **版本**: v2.42.0

## 模块进度
| 模块 | 用例数 | 通过 | 失败 | 跳过 | 状态 |
|------|--------|------|------|------|------|
| navigation | 4 | 4 | 0 | 0 | ✅ |
| kb-browse | 8 | 8 | 0 | 0 | ✅ |
| search | 6 | 6 | 0 | 0 | ✅ |
| ask-query | 8 | 8 | 0 | 0 | ✅ |
| ask-research | 4 | 4 | 0 | 0 | ✅ |
| chat | 8 | 8 | 0 | 0 | ✅ |
| settings | 6 | 6 | 0 | 0 | ✅ |
| responsive | 4 | 4 | 0 | 0 | ✅ |
| edge-cases | 10 | 10 | 0 | 0 | ✅ |
| stress | 6 | 6 | 0 | 0 | ✅ |
| session-advanced | 4 | 4 | 0 | 0 | ✅ |
| kb-panel | 4 | 4 | 0 | 0 | ✅ |
| ask-advanced | 8 | 8 | 0 | 0 | ✅ |
| docviewer | 4 | 3 | 1 | 0 | ✅ |
| settings-advanced | 4 | 4 | 0 | 0 | ✅ |
| chat-advanced | 4 | 4 | 0 | 0 | ✅ |
| keyboard | 1 | 1 | 0 | 0 | ✅ |

## 总计
- 总用例：93
- 已通过：92
- 已失败：1（DV-02: 文档截断指示器后端永远返回 truncated:false）
- 完成率：100%
- 通过率：98.9%

## 发现并修复的 Bug（12个）
1. SR-03: 搜索 API 响应格式不匹配
2. AQ-02: Ask 查询文本重复
3. AQ-05: Ask 结果截断无展开/折叠按钮
4. 安全-1: 静态文件路径遍历漏洞
5. 安全-2: SSRF 绕过
6. 安全-3: 零安全响应头
7. Bug-A: Tailwind 动态 class 不编译
8. Bug-B: Test Connection 调错端点（新增 /api/embedding/test）
9. Bug-C: SearchPalette 搜索无防抖
10. Bug-D: 删除会话无确认对话框
11. Bug-E: Tab 刷新后不记住
12. 可靠性: callLlm 静默失败 + SSE 心跳泄漏 + SSE 断连不中止

## 已知问题
- DV-02: 文档截断指示器后端不激活（readDoc 传 truncated=false）
- CP-02: Suggestion 按钮在当前查询下不出现（N/A）

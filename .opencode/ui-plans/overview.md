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
| docviewer | 4 | 4 | 0 | 0 | ✅ |
| settings-advanced | 4 | 4 | 0 | 0 | ✅ |
| chat-advanced | 4 | 4 | 0 | 0 | ✅ |
| keyboard | 1 | 1 | 0 | 0 | ✅ |

## 总计
- 总用例：93
- 已通过：93
- 已失败：0
- 完成率：100%
- 通过率：100%

## 发现并修复的 Bug（28个）

### 安全漏洞（3）
1. 静态文件路径遍历漏洞
2. SSRF 绕过（web-read/deep-read 未校验 URL）
3. 零安全响应头

### 可靠性（7）
4. callLlm 静默失败返回空字符串
5. SSE 心跳 interval 泄漏
6. SSE 断连不中止研究操作
7. 搜索 fallback 错误被吞掉
8. NaN parseInt 无 fallback
9. POST body 无类型验证（/api/docs/write、/api/ingest-site）
10. /api/stats/usage 同步 curl 阻塞事件循环

### 前端 Bug（11）
11. 搜索 API 响应格式不匹配
12. Ask 查询文本重复（isComposing + 竞态）
13. Ask 结果截断无展开/折叠按钮
14. Tailwind 动态 class 编译后不存在
15. Test Connection 调错端点（新增 /api/embedding/test）
16. SearchPalette 搜索无防抖
17. 删除会话无确认对话框
18. Tab 刷新后不记住
19. 文档截断指示器后端未激活
20. Ask textarea 无自动调整高度
21. 搜索结果无数量提示

### 可访问性（4）
22. SearchPalette 关闭按钮缺 aria-label
23. App 汉堡菜单/设置按钮缺 aria-label
24. ChatPanel 发送/停止按钮缺 aria-label
25. SessionList 删除按钮缺 aria-label

### UX（3）
26. SearchPalette 无 Escape 关闭
27. SearchPalette 无焦点管理
28. Config PUT 丢失未知 source 类型

## 代码质量审计清单（低优先级，未修）
- handle-api.ts 巨型函数（1050 行），建议拆分
- 深度读取逻辑重复 3 处，建议抽共享工具
- LRU Cache O(n) 淘汰，建议改双向链表
- readBody 销毁后残留监听器

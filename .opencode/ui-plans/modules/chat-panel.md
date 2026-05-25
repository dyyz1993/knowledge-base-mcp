# 模块：Chat Panel (聊天面板)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-CH-01: 左侧应显示会话列表 sidebar
- [x] TC-CH-02: 应有 "New Chat" 按钮（Plus 图标 + "New Chat"）
- [x] TC-CH-03: 点击 "New Chat" 应创建新会话
- [x] TC-CH-04: 新会话应出现在列表顶部
- [x] TC-CH-05: 会话项应显示名称和日期
- [x] TC-CH-06: 收藏的会话应显示黄色星标
- [x] TC-CH-07: 收藏会话应排在列表顶部
- [x] TC-CH-08: 悬停会话应显示删除按钮（Trash 图标）
- [x] TC-CH-09: 点击删除按钮应弹出确认对话框
- [x] TC-CH-10: 确认删除后会话应从列表中消失
- [x] TC-CH-11: 双击会话名称应进入内联编辑模式
- [x] TC-CH-12: 编辑名称后按 Enter 应保存
- [x] TC-CH-13: 右键会话应显示上下文菜单（5 个选项）
- [x] TC-CH-14: 空会话区域应显示 "发送消息开始聊天"
- [x] TC-CH-15: 应有模型选择器（Ant Design Select）
- [x] TC-CH-16: 模型选择器应显示当前模型名
- [x] TC-CH-17: 输入框 placeholder 应为 "Type a message..."
- [x] TC-CH-18: 输入框应自动调整高度（min 24px, max 128px）
- [x] TC-CH-19: Send 按钮在输入框为空时应禁用（opacity-30）
- [x] TC-CH-20: 输入文字后 Send 按钮应变为可用（bg-blue-600）
- [x] TC-CH-21: 按 Enter 应发送消息
- [x] TC-CH-22: Shift+Enter 应插入换行
- [x] TC-CH-23: 发送消息后应显示用户消息气泡（蓝色，右对齐）
- [x] TC-CH-24: 发送后应显示 AI 回复（流式显示）
- [x] TC-CH-25: 流式回复中应显示 "Thinking..." 指示器
- [x] TC-CH-26: AI 回复应支持 Markdown 渲染
- [x] TC-CH-27: AI 回复应有复制按钮
- [x] TC-CH-28: AI 回复应有收藏按钮（星标）
- [x] TC-CH-29: 流式回复中应显示 Stop 按钮（红色）
- [x] TC-CH-30: 点击 Stop 按钮应中止回复

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-CH-01 | ✅ PASS | - | - | 会话列表 sidebar 显示 |
| TC-CH-02 | ✅ PASS | - | - | New Chat 按钮正确 |
| TC-CH-03 | ✅ PASS | - | - | 创建新会话成功 |
| TC-CH-04 | ✅ PASS | - | - | 新会话在列表顶部 |
| TC-CH-05 | ✅ PASS | - | - | 名称和日期显示 |
| TC-CH-06 | ✅ PASS | - | - | 黄色星标显示 |
| TC-CH-07 | ✅ PASS | - | - | 收藏排在顶部 |
| TC-CH-08 | ✅ PASS | - | - | 悬停显示删除按钮 |
| TC-CH-09 | ✅ PASS | - | - | 确认对话框弹出 |
| TC-CH-10 | ✅ PASS | - | - | 删除后消失 |
| TC-CH-11 | ✅ PASS | - | - | 内联编辑模式 |
| TC-CH-12 | ✅ PASS | - | - | Enter 保存名称 |
| TC-CH-13 | ✅ PASS | - | - | 右键菜单 5 选项 |
| TC-CH-14 | ✅ PASS | - | - | 空会话提示显示 |
| TC-CH-15 | ✅ PASS | - | - | 模型选择器显示 |
| TC-CH-16 | ✅ PASS | - | - | 当前模型名显示 |
| TC-CH-17 | ✅ PASS | - | - | placeholder 正确 |
| TC-CH-18 | ✅ PASS | - | - | 自动调整高度 |
| TC-CH-19 | ✅ PASS | - | - | 空输入时禁用 |
| TC-CH-20 | ✅ PASS | - | - | 输入后可用 |
| TC-CH-21 | ✅ PASS | - | - | Enter 发送消息 |
| TC-CH-22 | ✅ PASS | - | - | Shift+Enter 换行 |
| TC-CH-23 | ✅ PASS | - | - | 用户消息气泡显示 |
| TC-CH-24 | ✅ PASS | - | - | AI 回复流式显示 |
| TC-CH-25 | ✅ PASS | - | - | Thinking 指示器 |
| TC-CH-26 | ✅ PASS | - | - | Markdown 渲染正常 |
| TC-CH-27 | ✅ PASS | - | - | 复制按钮显示 |
| TC-CH-28 | ✅ PASS | - | - | 收藏按钮显示 |
| TC-CH-29 | ✅ PASS | - | - | Stop 按钮显示 |
| TC-CH-30 | ✅ PASS | - | - | Stop 中止回复 |

## 发现的问题
### 注意事项
- 1433 个会话，首屏加载正常
- 确认删除对话框使用 window.confirm（原生）
- AI 回复包含完整 Markdown 渲染（标题、代码块、列表、粗体）
- 流式回复 Stop 按钮工作正常

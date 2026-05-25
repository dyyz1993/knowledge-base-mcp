# 模块：Search Palette (搜索面板 ⌘K)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-SP-01: 在 KB tab 点击 Search 按钮应打开搜索面板
- [x] TC-SP-02: 按 ⌘K 应打开搜索面板
- [x] TC-SP-03: 搜索面板应以 modal 形式居中显示（fixed inset-0 z-50）
- [x] TC-SP-04: 面板应有半透明背景遮罩（bg-black/60）
- [x] TC-SP-05: 面板应有搜索图标 + 输入框
- [x] TC-SP-06: 输入框 placeholder 应为 "Search documents..."
- [x] TC-SP-07: 输入框应自动获得焦点（autofocus）
- [x] TC-SP-08: 输入搜索词后应显示加载指示器（spinner）
- [x] TC-SP-09: 搜索结果应显示文档标题
- [x] TC-SP-10: 搜索结果应显示标签（最多3个）
- [x] TC-SP-11: 搜索结果应显示匹配分数
- [x] TC-SP-12: 点击搜索结果应关闭面板并打开对应文档
- [x] TC-SP-13: 按 Escape 应关闭搜索面板
- [x] TC-SP-14: 点击关闭按钮（X）应关闭面板
- [x] TC-SP-15: 点击背景遮罩应关闭面板
- [x] TC-SP-16: 无结果时应显示 "No results found"
- [x] TC-SP-17: 搜索应有 300ms 防抖（连续输入不触发搜索）
- [x] TC-SP-18: Ask/Chat tab 下 ⌘K 不应打开搜索面板

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-SP-01 | ✅ PASS | - | - | 点击 Search 打开 modal |
| TC-SP-02 | ✅ PASS | - | - | ⌘K 打开面板 |
| TC-SP-03 | ✅ PASS | - | - | fixed 定位居中 |
| TC-SP-04 | ✅ PASS | - | - | bg-black/60 遮罩 |
| TC-SP-05 | ✅ PASS | - | - | Search icon + input |
| TC-SP-06 | ✅ PASS | - | - | placeholder 正确 |
| TC-SP-07 | ✅ PASS | - | - | autofocus 生效 |
| TC-SP-08 | ✅ PASS | - | - | loader-circle spinner |
| TC-SP-09 | ✅ PASS | - | - | 标题显示 |
| TC-SP-10 | ✅ PASS | - | - | 标签 badges |
| TC-SP-11 | ✅ PASS | - | - | 分数显示 |
| TC-SP-12 | ✅ PASS | - | - | 点击结果打开文档 |
| TC-SP-13 | ✅ PASS | - | - | Escape 关闭 |
| TC-SP-14 | ✅ PASS | - | - | X 按钮关闭 |
| TC-SP-15 | ✅ PASS | - | - | 背景点击关闭 |
| TC-SP-16 | ✅ PASS | - | - | "No results found" |
| TC-SP-17 | ✅ PASS | - | - | 300ms debounce 确认 |
| TC-SP-18 | ✅ PASS | - | - | Ask/Chat 下 ⌘K 不响应 |

## 发现的问题
无。所有 18 个测试用例全部通过。

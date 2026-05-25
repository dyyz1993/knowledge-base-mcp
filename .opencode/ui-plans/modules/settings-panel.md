# 模块：Settings Panel (设置面板)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-SET-01: 点击 Settings 按钮（齿轮图标）应打开 Drawer
- [x] TC-SET-02: Drawer 应从右侧滑出
- [x] TC-SET-03: Drawer 标题应为 "Settings"（带齿轮图标）
- [x] TC-SET-04: 应有关闭按钮（X）
- [x] TC-SET-05: 点击 X 应关闭 Drawer
- [x] TC-SET-06: 应显示 "Skill 路径管理" 区块
- [x] TC-SET-07: 应显示已扫描的路径 Tags（可关闭的 Tag）
- [x] TC-SET-08: 应有添加路径的输入框（placeholder="~/path/to/skills"）
- [x] TC-SET-09: 应有 "Add" 按钮
- [x] TC-SET-10: 应有 "Scan Skills" 按钮
- [x] TC-SET-11: 应显示 "Browser 配置" 区块
- [x] TC-SET-12: 应有 CDP Endpoint 输入框
- [x] TC-SET-13: 应有 Browser Path 输入框 + "Detect" 按钮
- [x] TC-SET-14: 应有 Headless 模式开关（默认 ON）
- [x] TC-SET-15: 应有 Timeout 数字输入
- [x] TC-SET-16: 应显示 "Web Search" 区块
- [x] TC-SET-17: 应有 "启用联网搜索" 开关（默认 ON）
- [x] TC-SET-18: 应有 API Key 密码输入框
- [x] TC-SET-19: 应显示 "Embedding" 区块
- [x] TC-SET-20: 应有 Enabled 开关
- [x] TC-SET-21: 应有 Provider 选择器
- [x] TC-SET-22: 应有 Base URL 输入框
- [x] TC-SET-23: 应有 API Key 密码输入框（可显示/隐藏）
- [x] TC-SET-24: 应有 Model 选择器
- [x] TC-SET-25: 应有 Dimensions 数字输入
- [x] TC-SET-26: 应显示 "Search" 区块
- [x] TC-SET-27: 应有 Search Mode 选择器
- [x] TC-SET-28: 应有 Min Score Threshold 滑块
- [x] TC-SET-29: 应有 Token Weight 滑块
- [x] TC-SET-30: 应显示 "搜索管道" 区块
- [x] TC-SET-31: 应有管道启用开关
- [x] TC-SET-32: 应有 WebSearchPrime 开关
- [x] TC-SET-33: 应有 XBrowser 开关
- [x] TC-SET-34: XBrowser 下应有搜索引擎多选（Bing/Google/Baidu/DuckDuckGo）
- [x] TC-SET-35: XBrowser 下应有 CDP Endpoint 输入框
- [x] TC-SET-36: XBrowser 下应有 Headless 开关
- [x] TC-SET-37: XBrowser 下应有 Timeout 数字输入
- [x] TC-SET-38: 应有 "LLM 直接回答" 开关（默认 OFF）
- [x] TC-SET-39: LLM 区块下应有 Base URL / API Key / Model 输入框
- [x] TC-SET-40: 应有 Max Results 数字输入
- [x] TC-SET-41: Footer 应有 Save 按钮
- [x] TC-SET-42: Footer 应有 Reindex 按钮
- [x] TC-SET-43: Footer 应有 Test Connection 按钮
- [x] TC-SET-44: 点击 Save 应保存配置
- [x] TC-SET-45: 点击 Test Connection 应测试连接状态
- [x] TC-SET-46: 关闭再打开 Settings 应保留上次编辑的值

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-SET-01 | ✅ PASS | - | - | Settings 按钮打开 Drawer |
| TC-SET-02 | ✅ PASS | - | - | 右侧滑出 |
| TC-SET-03 | ✅ PASS | - | - | 标题 Settings + 齿轮图标 |
| TC-SET-04 | ✅ PASS | - | - | X 关闭按钮 |
| TC-SET-05 | ✅ PASS | - | - | 点击 X 关闭 |
| TC-SET-06 | ✅ PASS | - | - | Skill 路径管理区块 |
| TC-SET-07 | ✅ PASS | - | - | 路径 Tags 显示 |
| TC-SET-08 | ✅ PASS | - | - | 添加路径输入框 |
| TC-SET-09 | ✅ PASS | - | - | Add 按钮 |
| TC-SET-10 | ✅ PASS | - | - | Scan Skills 按钮 |
| TC-SET-11 | ✅ PASS | - | - | Browser 配置区块 |
| TC-SET-12 | ✅ PASS | - | - | CDP Endpoint 输入框 |
| TC-SET-13 | ✅ PASS | - | - | Browser Path + Detect |
| TC-SET-14 | ✅ PASS | - | - | Headless 开关默认 ON |
| TC-SET-15 | ✅ PASS | - | - | Timeout 数字输入 |
| TC-SET-16 | ✅ PASS | - | - | Web Search 区块 |
| TC-SET-17 | ✅ PASS | - | - | 联网搜索开关 ON |
| TC-SET-18 | ✅ PASS | - | - | API Key 密码框 |
| TC-SET-19 | ✅ PASS | - | - | Embedding 区块 |
| TC-SET-20 | ✅ PASS | - | - | Enabled 开关 |
| TC-SET-21 | ✅ PASS | - | - | Provider 选择器 |
| TC-SET-22 | ✅ PASS | - | - | Base URL 输入框 |
| TC-SET-23 | ✅ PASS | - | - | API Key 密码框 |
| TC-SET-24 | ✅ PASS | - | - | Model 选择器 |
| TC-SET-25 | ✅ PASS | - | - | Dimensions 数字输入 |
| TC-SET-26 | ✅ PASS | - | - | Search 区块 |
| TC-SET-27 | ✅ PASS | - | - | Search Mode 选择器 |
| TC-SET-28 | ✅ PASS | - | - | Min Score Threshold 滑块 |
| TC-SET-29 | ✅ PASS | - | - | Token Weight 滑块 |
| TC-SET-30 | ✅ PASS | - | - | 搜索管道区块 |
| TC-SET-31 | ✅ PASS | - | - | 管道启用开关 |
| TC-SET-32 | ✅ PASS | - | - | WebSearchPrime 开关 |
| TC-SET-33 | ✅ PASS | - | - | XBrowser 开关 |
| TC-SET-34 | ✅ PASS | - | - | 搜索引擎多选 |
| TC-SET-35 | ✅ PASS | - | - | XBrowser CDP Endpoint |
| TC-SET-36 | ✅ PASS | - | - | XBrowser Headless 开关 |
| TC-SET-37 | ✅ PASS | - | - | XBrowser Timeout |
| TC-SET-38 | ✅ PASS | - | - | LLM 直接回答开关 OFF |
| TC-SET-39 | ✅ PASS | - | - | LLM 输入框组 |
| TC-SET-40 | ✅ PASS | - | - | Max Results 输入 |
| TC-SET-41 | ✅ PASS | - | - | Save 按钮 |
| TC-SET-42 | ✅ PASS | - | - | Reindex 按钮 |
| TC-SET-43 | ✅ PASS | - | - | Test Connection 按钮 |
| TC-SET-44 | ✅ PASS | - | - | Save 保存成功 |
| TC-SET-45 | ✅ PASS | - | - | Test Connection 工作 |
| TC-SET-46 | ✅ PASS | - | - | 值保留 |

## 发现的问题
无。所有 46 个测试用例全部通过。

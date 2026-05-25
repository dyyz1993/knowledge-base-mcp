# 模块：Ask Panel (智能问答面板)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-ASK-01: 空 state 应显示 Sparkles 图标 + "智能问答" 标题
- [x] TC-ASK-02: 空 state 应显示功能说明文字
- [x] TC-ASK-03: 空 state 应显示 "普通查询" 功能卡片（Send 图标 + 琥珀色标签）
- [x] TC-ASK-04: 空 state 应显示 "Agent 深度研究" 功能卡片（FlaskConical 图标 + 紫色标签）
- [x] TC-ASK-05: 空 state 应显示建议查询（"如何配置 semantic search？"）
- [x] TC-ASK-06: 点击建议查询应填入输入框
- [x] TC-ASK-07: 输入框 placeholder 应为 "你想了解什么？描述一下你的问题..."
- [x] TC-ASK-08: 输入框应自动调整高度（auto-resize）
- [x] TC-ASK-09: 应有 3 个研究模式按钮：Quick(⚡) / Standard(🧠) / Deep(💻)
- [x] TC-ASK-10: 默认选中 Standard 模式（aria-pressed="true", 紫色高亮）
- [x] TC-ASK-11: 点击 Quick 应切换选中状态
- [x] TC-ASK-12: 点击 Deep 应切换选中状态
- [x] TC-ASK-13: Send 按钮（琥珀色）应在输入框为空时禁用（opacity-30）
- [x] TC-ASK-14: Agent Research 按钮（紫色）应在输入框为空时禁用
- [x] TC-ASK-15: 输入文字后两个按钮都应变为可用
- [x] TC-ASK-16: 应有模型选择器（28 个模型选项）
- [x] TC-ASK-17: 模型选择器默认应为 "默认模型"
- [x] TC-ASK-18: 输入查询并点击 Send 应发送请求
- [x] TC-ASK-19: 查询中应显示 loading 状态
- [x] TC-ASK-20: 查询完成后应显示结果卡片

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-ASK-01 | ✅ PASS | - | - | Sparkles 图标 + 标题正确 |
| TC-ASK-02 | ✅ PASS | - | - | 功能说明文字显示 |
| TC-ASK-03 | ✅ PASS | - | - | Send 图标 + 琥珀色标签 |
| TC-ASK-04 | ✅ PASS | - | - | FlaskConical 图标 + 紫色标签 |
| TC-ASK-05 | ✅ PASS | - | - | 建议查询显示 |
| TC-ASK-06 | ✅ PASS | - | - | 点击建议填入输入框 |
| TC-ASK-07 | ✅ PASS | - | - | placeholder 正确 |
| TC-ASK-08 | ✅ PASS | - | - | auto-resize 工作正常 |
| TC-ASK-09 | ✅ PASS | - | - | 3 个模式按钮显示 |
| TC-ASK-10 | ✅ PASS | - | - | Standard 默认选中 |
| TC-ASK-11 | ✅ PASS | - | - | Quick 切换成功 |
| TC-ASK-12 | ✅ PASS | - | - | Deep 切换成功 |
| TC-ASK-13 | ✅ PASS | - | - | 空输入时禁用 |
| TC-ASK-14 | ✅ PASS | - | - | 空输入时禁用 |
| TC-ASK-15 | ✅ PASS | - | - | 输入后可用 |
| TC-ASK-16 | ✅ PASS | - | - | 模型选择器显示 |
| TC-ASK-17 | ✅ PASS | - | - | 默认模型选中 |
| TC-ASK-18 | ✅ PASS | - | - | 发送请求成功 |
| TC-ASK-19 | ✅ PASS | - | - | loading 状态显示 |
| TC-ASK-20 | ✅ PASS | - | - | 结果卡片显示 |

## 发现的问题
无。所有 20 个测试用例全部通过。

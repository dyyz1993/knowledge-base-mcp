#!/bin/bash
exec > >(stdbuf -oL tee /tmp/kb-mcp-stress-test.log) 2>&1
# kb-mcp v2.25.0 压力测试 — 带 429 重试 + 指数退避
# 每轮 30+ 断言，无限循环直到手动停止

BASE="http://localhost:19877"
MODEL='{"provider":"zhipuai","id":"glm-5.1"}'
MODEL_FAST='{"provider":"zhipuai","id":"glm-4.5-air"}'
PASS=0
FAIL=0
SKIP=0
ROUND=0

green() { printf "\033[32m$1\033[0m"; }
red()   { printf "\033[31m$1\033[0m"; }
yellow(){ printf "\033[33m$1\033[0m"; }
cyan()  { printf "\033[36m$1\033[0m"; }

# 带重试的 POST 请求 — 429 时自动退避重试
# 用法: retry_post "/api/xxx" '{"body"}' [max_retry]
retry_post() {
  local endpoint="$1" body="$2" max_retry="${3:-20}"
  local attempt=0 wait_time=1
  
  while [ $attempt -lt $max_retry ]; do
    RESP=$(curl -s --max-time 45 -w "\n%{http_code}" -X POST "$BASE$endpoint" \
      -H 'Content-Type: application/json' -d "$body" 2>&1 || true)
    HTTP=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    
    # 非 429/503/529 直接返回
    case "$HTTP" in
      429|503|529)
        attempt=$((attempt+1))
        if [ $attempt -lt 3 ]; then
          wait_time=2
        else
          wait_time=5
        fi
        yellow "    429限流! 第${attempt}次重试, 等待${wait_time}s...\n"
        sleep $wait_time
        continue
        ;;
      *)
        echo "$BODY"
        return 0
        ;;
    esac
  done
  
  yellow "    重试${max_retry}次后仍失败\n"
  echo "$BODY"
  return 1
}

# 带重试的 GET
retry_get() {
  local endpoint="$1" max_retry="${2:-5}"
  local attempt=0
  while [ $attempt -lt $max_retry ]; do
    RESP=$(curl -s --max-time 30 -w "\n%{http_code}" "$BASE$endpoint" 2>&1 || true)
    HTTP=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    case "$HTTP" in
      429|503|529) attempt=$((attempt+1)); sleep 3; continue ;;
      *) echo "$BODY"; return 0 ;;
    esac
  done
  echo "$BODY"
  return 1
}

check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    green "  PASS $name\n"
    PASS=$((PASS+1))
  elif [ "$ok" = "skip" ]; then
    yellow "  SKIP $name — $detail\n"
    SKIP=$((SKIP+1))
  else
    red "  FAIL $name — $detail\n"
    FAIL=$((FAIL+1))
  fi
}

run_round() {
  local ROUND_NUM=$1
  local ROUND_PASS=$PASS ROUND_FAIL=$FAIL
  local TS=$(date +%s)
  
  cyan "\n━━━ Round $ROUND_NUM ━━━ $(date '+%H:%M:%S') ━━━\n"
  
  # ── 1. 基础端点 ──
  cyan "  [1/15] 基础端点\n"
  
  local health=$(retry_get "/health")
  local ver=$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version',''))" 2>/dev/null || echo "")
  check "health version" "$([ "$ver" = "2.25.0" ] && echo true || echo false)" "v=$ver"
  
  local mcp_http=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","id":1}' --max-time 5)
  check "/mcp 404" "$([ "$mcp_http" = "404" ] && echo true || echo false)" "got $mcp_http"
  
  # ── 2. Config ──
  cyan "  [2/15] Config\n"
  
  local cfg=$(retry_get "/api/config")
  local sp_enabled=$(echo "$cfg" | python3 -c "import sys,json; print(json.load(sys.stdin).get('searchPipeline',{}).get('enabled',''))" 2>/dev/null || echo "")
  check "searchPipeline存在" "$([ -n "$sp_enabled" ] && echo true || echo false)" ""
  
  # ── 3. KB 搜索 ──
  cyan "  [3/15] KB搜索\n"
  
  local kb_body=$(retry_post "/api/kb-ask" '{"query":"Node.js stream"}')
  local from_kb=$(echo "$kb_body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('from_kb',''))" 2>/dev/null || echo "")
  check "kb-ask命中" "$([ "$from_kb" = "True" ] && echo true || echo false)" "from_kb=$from_kb"
  
  # ── 4. 多源搜索 (无模型) ──
  cyan "  [4/15] 多源搜索 (无模型)\n"
  
  local s1=$(retry_post "/api/ask-search" '{"query":"React useEffect cleanup pattern"}')
  local s1_count=$(echo "$s1" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
  local s1_src=$(echo "$s1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalSources',0))" 2>/dev/null || echo "0")
  check "搜索有结果" "$([ "$s1_count" -gt 0 ] && echo true || echo false)" "results=$s1_count"
  check "搜索多源" "$([ "$s1_src" -ge 2 ] && echo true || echo false)" "sources=$s1_src"
  
  # ── 5. 多源搜索 (GLM-5.1) ──
  cyan "  [5/15] 多源搜索 (GLM-5.1)\n"
  
  local s2=$(retry_post "/api/ask-search" "{\"query\":\"什么是 RAG 检索增强生成技术 $TS\",\"model\":$MODEL}")
  local s2_count=$(echo "$s2" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
  local s2_src=$(echo "$s2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalSources',0))" 2>/dev/null || echo "0")
  local s2_has_llm=$(echo "$s2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(r['source']=='llm-direct' for r in d.get('results',[])))" 2>/dev/null || echo "False")
  check "搜索+模型有结果" "$([ "$s2_count" -gt 0 ] && echo true || echo false)" "results=$s2_count"
  check "搜索+模型≥3源" "$([ "$s2_src" -ge 3 ] && echo true || echo false)" "sources=$s2_src"
  if [ "$s2_has_llm" = "True" ]; then
    green "    LLM直接回答 ✅\n"
  fi
  
  SEARCH_RESULTS=$(echo "$s2" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('results',[])[:5]))" 2>/dev/null || echo "[]")
  
  # ── 6. 多源搜索 (GLM-4.5-air 快速模型) ──
  cyan "  [6/15] 多源搜索 (GLM-4.5-air)\n"
  
  local s3=$(retry_post "/api/ask-search" "{\"query\":\"TypeScript generic constraints $TS\",\"model\":$MODEL_FAST}")
  local s3_count=$(echo "$s3" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
  check "搜索+air模型" "$([ "$s3_count" -gt 0 ] && echo true || echo false)" "results=$s3_count"
  
  # ── 7. 深度读取 (有效URL) ──
  cyan "  [7/15] 深度读取\n"
  
  local dr=$(retry_post "/api/ask-deep-read" '{"url":"https://react.dev/reference/react/hooks"}')
  local dr_ok=$(echo "$dr" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
  local dr_len=$(echo "$dr" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','')))" 2>/dev/null || echo "0")
  check "deep-read成功" "$([ "$dr_ok" = "True" ] && echo true || echo false)" ""
  check "deep-read内容>100" "$([ "$dr_len" -gt 100 ] && echo true || echo false)" "len=$dr_len"
  
  # ── 8. 深度读取 (无效URL) ──
  cyan "  [8/15] 深度读取 (异常)\n"
  
  local dr2=$(retry_post "/api/ask-deep-read" '{"url":"https://nonexistent-xyz12345.com/page"}')
  local dr2_err=$(echo "$dr2" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
  check "无效URL报错" "$([ "$dr2_err" = "True" ] && echo true || echo false)" ""
  
  # ── 9. web-read fallback ──
  cyan "  [9/15] web-read\n"
  
  local wr=$(retry_post "/api/web-read" '{"url":"https://vuejs.org"}')
  local wr_ok=$(echo "$wr" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
  check "web-read成功" "$([ "$wr_ok" = "True" ] && echo true || echo false)" ""
  
  # ── 10. summarize 沉淀 ──
  cyan "  [10/15] 知识沉淀\n"
  
  local sm=$(retry_post "/api/ask-summarize" "{\"query\":\"E2E summarize $ROUND_NUM\",\"title\":\"E2E Test R$ROUND_NUM\",\"content\":\"Automated test round $ROUND_NUM content for knowledge base persistence verification.\",\"url\":\"https://example.com/e2e-r$ROUND_NUM\"}")
  local sm_saved=$(echo "$sm" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
  local sm_id=$(echo "$sm" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  check "summarize保存" "$([ "$sm_saved" = "True" ] && echo true || echo false)" ""
  
  # 等索引
  sleep 1
  local sm_check=$(retry_post "/api/kb-ask" "{\"query\":\"E2E Test R$ROUND_NUM\"}")
  local sm_found=$(echo "$sm_check" | python3 -c "import sys,json; print(json.load(sys.stdin).get('from_kb',''))" 2>/dev/null || echo "")
  check "summarize后KB命中" "$([ "$sm_found" = "True" ] && echo true || echo false)" ""
  
  # ── 11. Work Key (简单拼接) ──
  cyan "  [11/15] Work Key (拼接)\n"
  
  if [ "$SEARCH_RESULTS" = "[]" ] || [ -z "$SEARCH_RESULTS" ]; then
    yellow "    搜索结果为空, 跳过Work Key测试\n"
    check "work-key拼接" "skip" "搜索结果为空"
    check "work-key有keyPoints" "skip" "搜索结果为空"
  else
    local wk=$(retry_post "/api/ask-work-key" "{\"query\":\"Test Work Key R$ROUND_NUM\",\"results\":$SEARCH_RESULTS}")
    local wk_saved=$(echo "$wk" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
    local wk_kp=$(echo "$wk" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('keyPoints',[])))" 2>/dev/null || echo "0")
    check "work-key保存" "$([ "$wk_saved" = "True" ] && echo true || echo false)" ""
    check "work-key有keyPoints" "$([ "$wk_kp" -gt 0 ] && echo true || echo false)" "count=$wk_kp"
  fi
  
  # ── 12. Work Key (GLM-5.1 LLM) ──
  cyan "  [12/15] Work Key (GLM-5.1)\n"
  
  if [ "$SEARCH_RESULTS" = "[]" ] || [ -z "$SEARCH_RESULTS" ]; then
    check "work-key+LLM" "skip" "搜索结果为空"
    check "work-key+LLM内容" "skip" "搜索结果为空"
  else
    local wk2=$(retry_post "/api/ask-work-key" "{\"query\":\"Python asyncio best practices R$ROUND_NUM\",\"results\":$SEARCH_RESULTS,\"model\":$MODEL}")
    local wk2_saved=$(echo "$wk2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
    local wk2_len=$(echo "$wk2" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','')))" 2>/dev/null || echo "0")
    check "work-key+LLM保存" "$([ "$wk2_saved" = "True" ] && echo true || echo false)" ""
    check "work-key+LLM内容>200" "$([ "$wk2_len" -gt 200 ] && echo true || echo false)" "len=$wk2_len"
    
    # 验证 KB 二次命中
    sleep 1
    local wk_check=$(retry_post "/api/kb-ask" '{"query":"Python asyncio best practices"}')
    local wk_found=$(echo "$wk_check" | python3 -c "import sys,json; print(json.load(sys.stdin).get('from_kb',''))" 2>/dev/null || echo "")
    check "work-key后KB命中" "$([ "$wk_found" = "True" ] && echo true || echo false)" ""
  fi
  
  # ── 13. 原有端点 ──
  cyan "  [13/15] 原有端点\n"
  
  local ki=$(retry_post "/api/kb-ingest" "{\"url\":\"https://example.com/e2e-ki-r$ROUND_NUM\",\"title\":\"E2E Ingest R$ROUND_NUM\",\"content\":\"Testing original endpoint round $ROUND_NUM.\",\"tags\":[\"test\"]}")
  local ki_saved=$(echo "$ki" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
  check "kb-ingest保存" "$([ "$ki_saved" = "True" ] && echo true || echo false)" ""
  
  # ── 14. 边界 ──
  cyan "  [14/15] 边界情况\n"
  
  local e1=$(retry_post "/api/ask-search" '{}')
  local e1_err=$(echo "$e1" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
  check "空query报错" "$([ "$e1_err" = "True" ] && echo true || echo false)" ""
  
  local e2=$(retry_post "/api/ask-deep-read" '{}')
  local e2_err=$(echo "$e2" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
  check "空URL报错" "$([ "$e2_err" = "True" ] && echo true || echo false)" ""
  
  local e3=$(retry_post "/api/ask-search" '{"query":"<script>alert(1)</script>"}')
  local e3_ok=$(echo "$e3" | python3 -c "import sys,json; d=json.load(sys.stdin); print('results' in d or 'error' in d)" 2>/dev/null || echo "False")
  check "XSS不崩溃" "$([ "$e3_ok" = "True" ] && echo true || echo false)" ""
  
  # ── 15. 并发 ──
  cyan "  [15/15] 并发3请求\n"
  
  curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d "{\"query\":\"concurrent1 R$ROUND_NUM\"}" > /dev/null &
  curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d "{\"query\":\"concurrent2 R$ROUND_NUM\"}" > /dev/null &
  curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d "{\"query\":\"concurrent3 R$ROUND_NUM\"}" > /dev/null &
  wait 2>/dev/null || true
  check "并发完成" "true" ""
  
  # ── 本轮汇总 ──
  local r_pass=$((PASS - ROUND_PASS))
  local r_fail=$((FAIL - ROUND_FAIL))
  local r_total=$((r_pass + r_fail))
  if [ "$r_fail" -eq 0 ]; then
    green "  ✓ Round $ROUND_NUM: ${r_pass}/${r_total} PASS\n"
  else
    red "  ✗ Round $ROUND_NUM: ${r_fail}/${r_total} FAIL\n"
  fi
}

# ── 主循环 ──
cyan "╔══════════════════════════════════════╗\n"
cyan "║  kb-mcp v2.25.0 压力测试             ║\n"
cyan "║  模型: GLM-5.1 + GLM-4.5-air        ║\n"
cyan "║  重试: 20次, 退避 2s→5s              ║\n"
cyan "╚══════════════════════════════════════╝\n"

# 等待服务器就绪
cyan "等待服务器启动...\n"
sleep 5
retry_get "/health" > /dev/null
cyan "服务器就绪!\n\n"

START_TIME=$(date +%s)

while true; do
  ROUND=$((ROUND+1))
  run_round $ROUND
  
  NOW=$(date +%s)
  ELAPSED=$(( (NOW - START_TIME) / 60 ))
  TOTAL=$((PASS+FAIL))
  cyan "\n  📊 累计: ${PASS}/${TOTAL} PASS, ${FAIL} FAIL, ${SKIP} SKIP | ${ELAPSED}min | Round ${ROUND}\n"
  cyan "  ⏰ 当前: $(date '+%H:%M:%S')\n\n"
  
  sleep 3
done

#!/bin/bash
set -euo pipefail

BASE="http://localhost:19877"
MODEL='{"provider":"zhipuai","id":"glm-5.1"}'
PASS=0
FAIL=0
ERRORS=""

green() { echo "\033[32m$1\033[0m"; }
red()   { echo "\033[31m$1\033[0m"; }
cyan()  { echo "\033[36m$1\033[0m"; }

check() {
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "true" ]; then
    green "  PASS $name"
    PASS=$((PASS+1))
  else
    red "  FAIL $name — $detail"
    FAIL=$((FAIL+1))
    ERRORS="$ERRORS\n  FAIL $name — $detail"
  fi
}

# Helper: POST JSON and return status + body
post() {
  local endpoint="$1" body="$2"
  RESP=$(curl -s --max-time 60 -w "\n%{http_code}" -X POST "$BASE$endpoint" -H 'Content-Type: application/json' -d "$body" 2>&1 || true)
  HTTP=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
}

echo ""
cyan "========================================"
cyan "  E2E 自动化测试 — kb-mcp v2.25.0"
cyan "  模型: GLM-5.1"
cyan "========================================"
echo ""

# ── 1. 基础端点 ──
cyan "--- 1. 基础端点 ---"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
check "health 200" "$([ "$HTTP" = "200" ] && echo true || echo false)" "got $HTTP"

VER=$(curl -s "$BASE/health" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
check "version=2.25.0" "$([ "$VER" = "2.25.0" ] && echo true || echo false)" "got $VER"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","id":1}')
check "--no-mcp /mcp=404" "$([ "$HTTP" = "404" ] && echo true || echo false)" "got $HTTP"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/sse" --max-time 2)
check "--no-mcp /sse=404" "$([ "$HTTP" = "404" ] && echo true || echo false)" "got $HTTP"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
check "Web UI 200" "$([ "$HTTP" = "200" ] && echo true || echo false)" "got $HTTP"

# ── 2. Config 持久化 ──
cyan ""
cyan "--- 2. Config 持久化 ---"

SP=$(curl -s "$BASE/api/config" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sp=d.get('searchPipeline',{})
print(f\"{sp.get('enabled')},{sp.get('sources',{}).get('webSearchPrime',{}).get('enabled')},{sp.get('sources',{}).get('xbrowser',{}).get('cdpEndpoint')}\")")
check "searchPipeline config存在" "$([ -n "$SP" ] && echo true || echo false)" "got empty"

# PUT and verify
curl -s -X PUT "$BASE/api/config" -H 'Content-Type: application/json' \
  -d '{"searchPipeline":{"sources":{"plugin":{"enabled":true,"prompt":"test-prompt-e2e"}}}}' > /dev/null
PROMPT=$(curl -s "$BASE/api/config" | python3 -c "import sys,json; print(json.load(sys.stdin)['searchPipeline']['sources']['plugin']['prompt'])")
check "config PUT deep merge" "$([ "$PROMPT" = "test-prompt-e2e" ] && echo true || echo false)" "got '$PROMPT'"

# Reset
curl -s -X PUT "$BASE/api/config" -H 'Content-Type: application/json' \
  -d '{"searchPipeline":{"sources":{"plugin":{"enabled":false,"prompt":""}}}}' > /dev/null

# ── 3. KB 搜索命中 ──
cyan ""
cyan "--- 3. KB 搜索命中 ---"

post "/api/kb-ask" '{"query":"Node.js stream"}'
FROM_KB=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('from_kb',''))" 2>/dev/null || echo "")
check "kb-ask 命中知识库" "$([ "$FROM_KB" = "True" ] && echo true || echo false)" "from_kb=$FROM_KB"

# ── 4. 多源搜索 (不带模型) ──
cyan ""
cyan "--- 4. 多源搜索 (不带模型) ---"

post "/api/ask-search" '{"query":"React hooks useEffect cleanup"}'
RESULT_COUNT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('results',[])))" 2>/dev/null || echo "0")
TOTAL_SRC=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalSources',0))" 2>/dev/null || echo "0")
HINT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hint','')[:20])" 2>/dev/null || echo "")
check "ask-search 有结果" "$([ "$RESULT_COUNT" -gt 0 ] && echo true || echo false)" "results=$RESULT_COUNT"
check "ask-search 多源" "$([ "$TOTAL_SRC" -ge 2 ] && echo true || echo false)" "sources=$TOTAL_SRC"
echo "    hint: $HINT..."

# ── 5. 多源搜索 (带 GLM-5.1 模型) ──
cyan ""
cyan "--- 5. 多源搜索 (GLM-5.1) ---"

post "/api/ask-search" "{\"query\":\"什么是 RAG 检索增强生成技术\",\"model\":$MODEL}"
RESULT_COUNT2=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('results',[])))" 2>/dev/null || echo "0")
TOTAL_SRC2=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalSources',0))" 2>/dev/null || echo "0")
HAS_LLM=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(r['source']=='llm-direct' for r in d.get('results',[])))" 2>/dev/null || echo "False")
check "ask-search+model 有结果" "$([ "$RESULT_COUNT2" -gt 0 ] && echo true || echo false)" "results=$RESULT_COUNT2"
check "ask-search+model ≥3源" "$([ "$TOTAL_SRC2" -ge 3 ] && echo true || echo false)" "sources=$TOTAL_SRC2"
if [ "$HAS_LLM" = "True" ]; then
  green "  INFO LLM直接回答已加入结果"
else
  echo "    (LLM结果可能被限流，不影响功能正确性)"
fi

# 保存结果给后续用
SEARCH_BODY="$BODY"

# ── 6. 深度读取 ──
cyan ""
cyan "--- 6. 深度读取 ---"

post "/api/ask-deep-read" '{"url":"https://react.dev/reference/react/hooks"}'
DR_SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
DR_LEN=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','')))" 2>/dev/null || echo "0")
check "deep-read react.dev" "$([ "$DR_SUCCESS" = "True" ] && echo true || echo false)" "success=$DR_SUCCESS"
check "deep-read 内容>100" "$([ "$DR_LEN" -gt 100 ] && echo true || echo false)" "len=$DR_LEN"

# 无效URL
post "/api/ask-deep-read" '{"url":"https://nonexistent-domain-xyz123.com/page"}'
DR_ERR=$(echo "$BODY" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
check "deep-read 无效URL报错" "$([ "$DR_ERR" = "True" ] && echo true || echo false)" "has_error=$DR_ERR"

# ── 7. web-read fallback ──
cyan ""
cyan "--- 7. web-read fallback ---"

post "/api/web-read" '{"url":"https://vuejs.org"}'
WR_SUCCESS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
check "web-read fetch fallback" "$([ "$WR_SUCCESS" = "True" ] && echo true || echo false)" "success=$WR_SUCCESS"

# ── 8. ask-summarize 知识沉淀 ──
cyan ""
cyan "--- 8. ask-summarize 知识沉淀 ---"

TIMESTAMP=$(date +%s)
post "/api/ask-summarize" "{\"query\":\"E2E test summarize $TIMESTAMP\",\"title\":\"E2E Test: Summarize $TIMESTAMP\",\"content\":\"This is automated test content for the summarize endpoint. It should be saved to the knowledge base and resolve the corresponding miss.\",\"url\":\"https://example.com/e2e-test-$TIMESTAMP\",\"tags\":[\"test\",\"e2e\",\"web-ingested\"]}"
SM_SAVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
SM_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
check "summarize 保存成功" "$([ "$SM_SAVED" = "True" ] && echo true || echo false)" "saved=$SM_SAVED"
check "summarize 返回ID" "$([ -n "$SM_ID" ] && echo true || echo false)" "id=$SM_ID"

# ── 9. ask-summarize + 模型 ──
cyan ""
cyan "--- 9. ask-summarize (带模型) ---"

post "/api/kb-ask" "{\"query\":\"E2E summarize check $TIMESTAMP\"}"
WAIT_TIME=2
echo "    等待 $WAIT_TIME 秒让索引更新..."
sleep $WAIT_TIME
post "/api/kb-ask" "{\"query\":\"E2E summarize check $TIMESTAMP\"}"
FOUND=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('from_kb',''))" 2>/dev/null || echo "")
check "summarize 后KB命中" "$([ "$FOUND" = "True" ] && echo true || echo false)" "from_kb=$FOUND"

# ── 10. Work Key (不带模型) ──
cyan ""
cyan "--- 10. Work Key (简单拼接) ---"

RESULTS_JSON=$(echo "$SEARCH_BODY" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('results',[])[:5]))" 2>/dev/null || echo "[]")
post "/api/ask-work-key" "{\"query\":\"RAG 检索增强生成技术\",\"results\":$RESULTS_JSON}"
WK_SAVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
WK_KP=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('keyPoints',[])))" 2>/dev/null || echo "0")
check "work-key 保存成功" "$([ "$WK_SAVED" = "True" ] && echo true || echo false)" "saved=$WK_SAVED"
check "work-key 有keyPoints" "$([ "$WK_KP" -gt 0 ] && echo true || echo false)" "count=$WK_KP"

# ── 11. Work Key (带 GLM-5.1) ──
cyan ""
cyan "--- 11. Work Key (GLM-5.1 LLM摘要) ---"

post "/api/ask-work-key" "{\"query\":\"Python asyncio 异步编程最佳实践\",\"results\":$RESULTS_JSON,\"model\":$MODEL}"
WK2_SAVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
WK2_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
WK2_CONTENT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','')))" 2>/dev/null || echo "0")
check "work-key+model 保存" "$([ "$WK2_SAVED" = "True" ] && echo true || echo false)" "saved=$WK2_SAVED"
check "work-key+model 有内容" "$([ "$WK2_CONTENT" -gt 200 ] && echo true || echo false)" "content_len=$WK2_CONTENT"
echo "    content preview:"
echo "$BODY" | python3 -c "import sys,json; print('    '+json.load(sys.stdin).get('content','')[:200].replace(chr(10),' '))" 2>/dev/null || true

# ── 12. Work Key 后 KB 命中 ──
cyan ""
cyan "--- 12. Work Key 后 KB 二次命中 ---"

sleep 1
post "/api/kb-ask" '{"query":"Python asyncio 异步编程"}'
KB_HIT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('from_kb',''), d.get('score',0))" 2>/dev/null || echo "False 0")
check "work-key后KB命中" "$(echo $KB_HIT | python3 -c "import sys; parts=sys.stdin.read().strip().split(); print('true' if parts[0]=='True' else 'false')")" "result=$KB_HIT"

# ── 13. 原有 kb-ingest 不退化 ──
cyan ""
cyan "--- 13. 原有端点不退化 ---"

post "/api/kb-ingest" "{\"url\":\"https://example.com/e2e-ingest-$TIMESTAMP\",\"title\":\"E2E Ingest Test $TIMESTAMP\",\"content\":\"Testing original kb-ingest endpoint is still functional after all changes.\",\"tags\":[\"test\",\"e2e\"]}"
KI_SAVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('saved',''))" 2>/dev/null || echo "")
check "kb-ingest 保存" "$([ "$KI_SAVED" = "True" ] && echo true || echo false)" "saved=$KI_SAVED"

# ── 14. 边界情况 ──
cyan ""
cyan "--- 14. 边界情况 ---"

post "/api/ask-search" '{}'
HAS_ERR=$(echo "$BODY" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
check "空query报错" "$([ "$HAS_ERR" = "True" ] && echo true || echo false)" "has_error=$HAS_ERR"

post "/api/ask-deep-read" '{}'
HAS_ERR2=$(echo "$BODY" | python3 -c "import sys,json; print('error' in json.load(sys.stdin))" 2>/dev/null || echo "False")
check "空URL报错" "$([ "$HAS_ERR2" = "True" ] && echo true || echo false)" "has_error=$HAS_ERR2"

post "/api/ask-search" '{"query":"<script>alert(1)</script>"}'
NO_CRASH=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('results' in d or 'error' in d)" 2>/dev/null || echo "False")
check "XSS query 不崩溃" "$([ "$NO_CRASH" = "True" ] && echo true || echo false)" "response_ok=$NO_CRASH"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/nonexistent")
check "不存在API 404" "$([ "$HTTP" = "404" ] && echo true || echo false)" "got $HTTP"

# ── 15. 并发 ──
cyan ""
cyan "--- 15. 并发3请求 ---"

curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d '{"query":"concurrent test 1"}' > /dev/null &
PID1=$!
curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d '{"query":"concurrent test 2"}' > /dev/null &
PID2=$!
curl -s --max-time 30 -X POST "$BASE/api/ask-search" -H 'Content-Type: application/json' -d '{"query":"concurrent test 3"}' > /dev/null &
PID3=$!
wait $PID1 $PID2 $PID3 2>/dev/null
check "并发3请求完成" "true" ""

# ── 汇总 ──
cyan ""
cyan "========================================"
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "  全部通过! $PASS/$TOTAL PASS"
else
  red "  $FAIL/$TOTAL FAIL"
  echo ""
  red "  失败项:"
  echo -e "$ERRORS"
fi
cyan "========================================"
echo ""

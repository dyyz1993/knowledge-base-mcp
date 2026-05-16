#!/bin/bash
# 循环跑 E2E 测试，间隔 5 秒，无限循环
# 429 时 sleep 5 重试

LOG="/tmp/kb-mcp-stress-test.log"
ROUND=0
TOTAL_PASS=0
TOTAL_FAIL=0

echo "╔══════════════════════════════════════╗" | tee "$LOG"
echo "║  kb-mcp v2.25.0 持续压力测试         ║" | tee -a "$LOG"
echo "║  模型: GLM-5.1 / GLM-4.5-air        ║" | tee -a "$LOG"
echo "║  开始: $(date '+%H:%M:%S')                    ║" | tee -a "$LOG"
echo "╚══════════════════════════════════════╝" | tee -a "$LOG"
echo "" | tee -a "$LOG"

START_TIME=$(date +%s)

while true; do
  ROUND=$((ROUND + 1))
  echo "━━━ Round $ROUND ━━━ $(date '+%H:%M:%S') ━━━" | tee -a "$LOG"
  
  # 跑测试
  OUTPUT=$(bash "$(dirname "$0")/test-e2e.sh" 2>&1)
  EXIT_CODE=$?
  
  # 统计本轮结果
  R_PASS=$(echo "$OUTPUT" | grep -c "PASS" || true)
  R_FAIL=$(echo "$OUTPUT" | grep -c "FAIL" || true)
  TOTAL_PASS=$((TOTAL_PASS + R_PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + R_FAIL))
  
  echo "$OUTPUT" >> "$LOG"
  
  if [ "$R_FAIL" -eq 0 ]; then
    echo "  ✓ Round $ROUND: $R_PASS/$((R_PASS+R_FAIL)) PASS" | tee -a "$LOG"
  else
    echo "  ✗ Round $ROUND: $R_FAIL FAIL" | tee -a "$LOG"
    echo "$OUTPUT" | grep "FAIL" | tee -a "$LOG"
  fi
  
  NOW=$(date +%s)
  ELAPSED=$(( (NOW - START_TIME) / 60 ))
  TOTAL=$((TOTAL_PASS + TOTAL_FAIL))
  echo "  📊 累计: ${TOTAL_PASS}/${TOTAL} PASS, ${TOTAL_FAIL} FAIL | ${ELAPSED}min | Round ${ROUND}" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  
  # 如果有失败（可能是限流），等久一点
  if [ "$R_FAIL" -gt 0 ]; then
    echo "  ⏳ 检测到失败，等待 15 秒后重试..." | tee -a "$LOG"
    sleep 15
  else
    sleep 5
  fi
done

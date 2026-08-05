#!/bin/bash
# verify-endpoints.sh
# Quick 8-endpoint smoke test for the deployed Poetry Garden API.
# Usage: ./verify-endpoints.sh [BASE_URL]
# Default BASE_URL: https://poetry-garden-api.luyanzhou2023.workers.dev

set -o pipefail

BASE="${1:-https://poetry-garden-api.luyanzhou2023.workers.dev}"

# Use python (3+) for JSON parsing without jq dependency
py_extract_status() {
  python3 -c "import sys, json
raw = sys.stdin.read()
# Strip any 'HTTP_STATUS=...' trailers
body = raw.rsplit('HTTP_STATUS=', 1)[0]
try:
    print(json.loads(body).get('success'))
except Exception:
    print('NOT_JSON')"
}

py_count_items() {
  python3 -c "import sys, json
raw = sys.stdin.read()
body = raw.rsplit('HTTP_STATUS=', 1)[0]
try:
    j = json.loads(body)
    d = j.get('data') or {}
    if isinstance(d, list):
        print('len=' + str(len(d)))
    elif isinstance(d, dict):
        print('total=' + str(d.get('total', '?')) + ' items=' + str(len(d.get('items') or [])))
    else:
        print('no-data')
except Exception as e:
    print('parse-err:' + str(e))"
}

check() {
  local label="$1"
  local url="$2"
  local expect_status="$3"
  local extra_check="${4:-}"
  echo "--- $label"
  echo "    GET $url"
  local res
  res=$(curl -s -w "\nHTTP_STATUS=%{http_code}" "$url" 2>&1)
  local status
  status=$(echo "$res" | grep -E '^HTTP_STATUS=' | tail -1 | sed 's/HTTP_STATUS=//')
  local ok="OK"
  if [ "$status" != "$expect_status" ]; then
    ok="FAIL (got $status, want $expect_status)"
  fi
  echo "    status=$status => $ok"
  if [ -n "$extra_check" ]; then
    local data
    data=$(echo "$res" | py_extract_status)
    local items
    items=$(echo "$res" | py_count_items)
    echo "    success=$data  $items"
  fi
  echo
}

check_id() {
  local label="$1"
  local url="$2"
  local id_var="$3"
  echo "--- $label"
  echo "    GET $url"
  local res
  res=$(curl -s -w "\nHTTP_STATUS=%{http_code}" "$url" 2>&1)
  local status
  status=$(echo "$res" | grep -E '^HTTP_STATUS=' | tail -1 | sed 's/HTTP_STATUS=//')
  echo "    status=$status"
  if [ "$status" = "200" ]; then
    local out
    out=$(echo "$res" | python3 -c "import sys, json; raw = sys.stdin.read().rsplit('HTTP_STATUS=', 1)[0]; j = json.loads(raw); d = j.get('data') or {}; items = d.get('items') or []; print(len(items)) if items else print('empty'); print(items[0].get('id')) if items else None")
    echo "    result: $out"
    # Capture an id if we got one
    local captured
    captured=$(echo "$res" | python3 -c "import sys, json; raw = sys.stdin.read().rsplit('HTTP_STATUS=', 1)[0]; j = json.loads(raw); items = j.get('data', {}).get('items') or []; print(items[0].get('id','')) if items else print('')" 2>/dev/null)
    if [ -n "$captured" ]; then
      eval "$id_var='$captured'"
      echo "    captured $id_var=$captured"
    fi
  fi
  echo
}

echo "============================================================"
echo " Poetry Garden endpoint smoke test against $BASE"
echo "============================================================"
echo

# 1. health
check "1. health" "$BASE/api/health" "200"

# 2. dynasties
check "2. dynasties" "$BASE/api/dynasties" "200" "data"

# 3. works list (老 endpoint, 应有 total)
check "3. works 老 list" "$BASE/api/works?page=1&page_size=1" "200" "data"

# 4. compact list (新 endpoint)
check "4. compact works 新 list" "$BASE/api/compact/works?page=1&page_size=3" "200" "data"

# 5. popular 老
check "5. popular 老" "$BASE/api/works/popular?kind=poetry&page_size=2" "200" "data"

# 6. popular compact
check "6. popular compact" "$BASE/api/compact/works/popular?kind=poetry&page_size=3" "200" "data"

# 7. random (works 老)
check "7. random" "$BASE/api/works/random" "200" "data"

# 8. 拿一首诗的 id,测 /api/works/{id}
id_check_url="$BASE/api/works?page=1&page_size=1"
check_id "8. fetch a work id" "$id_check_url" FIRST_ID
if [ -n "${FIRST_ID:-}" ]; then
  check "8a. /api/works/{id}" "$BASE/api/works/$FIRST_ID" "200" "data"
fi

# 9. authors (use URL-encoded Tang so curl sends CJK bytes correctly)
check "9. authors" "$BASE/api/authors?dynasty=%E5%94%90" "200" "data"

# 10. search
check "10. search ?q=李白" "$BASE/api/search?q=%E6%9D%8E%E7%99%BD&page=1&page_size=3" "200" "data"

# 11. library collections
check "11. library collections" "$BASE/api/library/collections" "200" "data"

echo "============================================================"
echo " Done."
echo "============================================================"

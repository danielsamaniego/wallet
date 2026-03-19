#!/usr/bin/env bash
# ============================================================================
# WALLET API — COMPREHENSIVE SECURITY AUDIT SCRIPT
# ============================================================================
set -uo pipefail

BASE="http://localhost:3000"
API_KEY="testkey.supersecret123"
ATTACKER_KEY="attackerkey.attackersecret"
PASS=0
FAIL=0
WARN=0
RESULTS=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

uuid() { python3 -c "import uuid; print(uuid.uuid4())"; }
jq_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null; }

log_pass() { PASS=$((PASS+1)); RESULTS+="PASS | $1\n"; echo -e "  ${GREEN}PASS${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); RESULTS+="FAIL | $1\n"; echo -e "  ${RED}FAIL${NC} $1"; }
log_warn() { WARN=$((WARN+1)); RESULTS+="WARN | $1\n"; echo -e "  ${YELLOW}WARN${NC} $1"; }

http() {
  local method=$1 path=$2 key=${3:-$API_KEY} idem=${4:-$(uuid)} body=${5:-}
  if [ "$method" = "GET" ]; then
    curl -s -w "\n%{http_code}" "$BASE$path" -H "X-API-Key: $key"
  else
    curl -s -w "\n%{http_code}" "$BASE$path" -X "$method" \
      -H "Content-Type: application/json" -H "X-API-Key: $key" \
      -H "Idempotency-Key: $idem" -d "$body"
  fi
}

http_status() { echo "$1" | tail -1; }
http_body() { echo "$1" | sed '$d'; }

echo -e "\n${CYAN}============================================================${NC}"
echo -e "${CYAN}  WALLET API SECURITY AUDIT${NC}"
echo -e "${CYAN}============================================================${NC}"

# ============================================================================
echo -e "\n${CYAN}[1] AUTHENTICATION ATTACKS${NC}"
# ============================================================================

# 1.1 No API key
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
[ "$(http_status "$resp")" = "401" ] && log_pass "1.1 Missing API key returns 401" || log_fail "1.1 Missing API key returns $(http_status "$resp")"

# 1.2 Invalid API key format (no dot)
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: invalidkey_no_dot" -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
[ "$(http_status "$resp")" = "401" ] && log_pass "1.2 Malformed API key returns 401" || log_fail "1.2 Malformed key returns $(http_status "$resp")"

# 1.3 Valid key ID, wrong secret
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: testkey.wrongsecret" -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
[ "$(http_status "$resp")" = "401" ] && log_pass "1.3 Wrong secret returns 401" || log_fail "1.3 Wrong secret returns $(http_status "$resp")"

# 1.4 Empty API key
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: " -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
[ "$(http_status "$resp")" = "401" ] && log_pass "1.4 Empty API key returns 401" || log_fail "1.4 Empty API key returns $(http_status "$resp")"

# 1.5 SQL injection in API key
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: testkey' OR '1'='1.secret" -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
[ "$(http_status "$resp")" = "401" ] && log_pass "1.5 SQL injection in API key returns 401" || log_fail "1.5 SQLi in API key returns $(http_status "$resp")"

# 1.6 Oversized API key
long_key=$(python3 -c "print('a' * 10000 + '.secret')")
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets" -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: $long_key" -H "Idempotency-Key: $(uuid)" -d '{"owner_id":"test","currency_code":"USD"}')
s=$(http_status "$resp"); [[ "$s" =~ ^(401|413|400)$ ]] && log_pass "1.6 Oversized API key rejected ($s)" || log_fail "1.6 Oversized key returns $s"

# ============================================================================
echo -e "\n${CYAN}[2] SETUP${NC}"
# ============================================================================

# Create user wallet A (system wallet auto-created)
resp=$(http POST "/v1/wallets" "$API_KEY" "setup-user-a" '{"owner_id":"user-alice","currency_code":"USD"}')
s=$(http_status "$resp"); b=$(http_body "$resp")
if [ "$s" = "201" ]; then
  WALLET_A=$(echo "$b" | jq_field wallet_id)
  log_pass "2.1 Wallet A created: $WALLET_A"
else
  echo -e "  ${RED}CRITICAL: Wallet A creation failed ($s): $b${NC}"; exit 1
fi

# Get system wallet ID
SYS_WALLET=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "SELECT id FROM wallets WHERE is_system = true AND currency_code = 'USD' LIMIT 1" | tr -d '[:space:]')
echo -e "  System wallet: $SYS_WALLET"

# Create user wallet B
resp=$(http POST "/v1/wallets" "$API_KEY" "setup-user-b" '{"owner_id":"user-bob","currency_code":"USD"}')
WALLET_B=$(echo "$(http_body "$resp")" | jq_field wallet_id)
log_pass "2.2 Wallet B created: $WALLET_B"

# Create attacker platform wallets
resp=$(http POST "/v1/wallets" "$ATTACKER_KEY" "setup-atk-user" '{"owner_id":"attacker","currency_code":"USD"}')
ATTACKER_WALLET=$(echo "$(http_body "$resp")" | jq_field wallet_id)
log_pass "2.3 Attacker wallet created: $ATTACKER_WALLET"

# Deposit initial funds
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "setup-dep-a" '{"amount_cents":100000}')
[ "$(http_status "$resp")" = "201" ] && log_pass "2.4 Deposited \$1000 to A" || log_fail "2.4 Deposit A failed: $(http_status "$resp")"

resp=$(http POST "/v1/wallets/$WALLET_B/deposit" "$API_KEY" "setup-dep-b" '{"amount_cents":50000}')
[ "$(http_status "$resp")" = "201" ] && log_pass "2.5 Deposited \$500 to B" || log_fail "2.5 Deposit B failed"

resp=$(http POST "/v1/wallets/$ATTACKER_WALLET/deposit" "$ATTACKER_KEY" "setup-dep-atk" '{"amount_cents":10000}')
[ "$(http_status "$resp")" = "201" ] && log_pass "2.6 Deposited \$100 to attacker" || log_fail "2.6 Deposit ATK failed"

# ============================================================================
echo -e "\n${CYAN}[3] INPUT VALIDATION ATTACKS${NC}"
# ============================================================================

# 3.1 Negative deposit
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":-5000}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.1 Negative deposit rejected ($s)" || log_fail "3.1 Negative deposit returns $s"

# 3.2 Zero deposit
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":0}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.2 Zero deposit rejected ($s)" || log_fail "3.2 Zero deposit returns $s"

# 3.3 Float amount
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":100.5}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.3 Float amount rejected ($s)" || log_fail "3.3 Float amount returns $s"

# 3.4 String amount
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":"1000"}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.4 String amount rejected ($s)" || log_fail "3.4 String amount returns $s"

# 3.5 Massive amount (overflow)
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":99999999999999999}')
s=$(http_status "$resp")
if [[ "$s" =~ ^(201|200)$ ]]; then
  log_warn "3.5 Massive deposit accepted ($s) — check BigInt overflow behavior"
else
  log_pass "3.5 Massive deposit rejected ($s)"
fi

# 3.6 Invalid currency code (4 chars)
resp=$(http POST "/v1/wallets" "$API_KEY" "$(uuid)" '{"owner_id":"test-inv-curr","currency_code":"XXXX"}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.6 Invalid currency rejected ($s)" || log_fail "3.6 Invalid currency returns $s"

# 3.7 XSS payload in reference
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":100,"reference":"<script>alert(1)</script>"}')
s=$(http_status "$resp")
if [[ "$s" =~ ^(201|200)$ ]]; then
  log_warn "3.7 XSS payload accepted in reference — stored as-is (OK if API-only, risk if rendered)"
else
  log_pass "3.7 XSS in reference rejected ($s)"
fi

# 3.8 SQL injection in path
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets/'; DROP TABLE wallets; --" -H "X-API-Key: $API_KEY")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|400)$ ]] && log_pass "3.8 SQLi in path param handled ($s)" || log_fail "3.8 SQLi in path returns $s"

# 3.9 Missing required fields
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.9 Missing fields rejected ($s)" || log_fail "3.9 Missing fields returns $s"

# 3.10 Prototype pollution attempt
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":100,"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}')
s=$(http_status "$resp")
[[ "$s" =~ ^(201|200)$ ]] && log_pass "3.10 Prototype pollution in body ignored (deposit OK)" || log_warn "3.10 Proto pollution caused error: $s"

# 3.11 Oversized reference (>500 chars)
long_ref=$(python3 -c "print('A' * 600)")
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" "{\"amount_cents\":100,\"reference\":\"$long_ref\"}")
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.11 Oversized reference rejected ($s)" || log_fail "3.11 Oversized reference returns $s"

# 3.12 Negative integer that JS could interpret weirdly
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":-0}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "3.12 Negative zero rejected ($s)" || log_fail "3.12 -0 returns $s"

# ============================================================================
echo -e "\n${CYAN}[4] CROSS-TENANT ISOLATION${NC}"
# ============================================================================

# 4.1 Attacker reads victim wallet
resp=$(http GET "/v1/wallets/$WALLET_A" "$ATTACKER_KEY")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.1 Attacker cannot read victim wallet ($s)" || log_fail "4.1 Attacker CAN read victim wallet ($s)"

# 4.2 Attacker deposits to victim
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$ATTACKER_KEY" "$(uuid)" '{"amount_cents":1000}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.2 Attacker cannot deposit to victim ($s)" || log_fail "4.2 Attacker CAN deposit to victim ($s)"

# 4.3 Attacker withdraws from victim
resp=$(http POST "/v1/wallets/$WALLET_A/withdraw" "$ATTACKER_KEY" "$(uuid)" '{"amount_cents":1000}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.3 Attacker cannot withdraw from victim ($s)" || log_fail "4.3 Attacker CAN withdraw from victim ($s)"

# 4.4 Attacker transfers victim -> attacker
resp=$(http POST "/v1/transfers" "$ATTACKER_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"$ATTACKER_WALLET\",\"amount_cents\":50000}")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.4 Attacker cannot steal via transfer ($s)" || log_fail "4.4 Attacker CAN steal via transfer ($s)"

# 4.5 Attacker transfers own -> victim (cross-platform)
resp=$(http POST "/v1/transfers" "$ATTACKER_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$ATTACKER_WALLET\",\"target_wallet_id\":\"$WALLET_A\",\"amount_cents\":100}")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.5 Cross-platform transfer blocked ($s)" || log_fail "4.5 Cross-platform transfer ALLOWED ($s)"

# 4.6 Attacker places hold on victim
resp=$(http POST "/v1/holds" "$ATTACKER_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":10000}")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.6 Attacker cannot hold victim funds ($s)" || log_fail "4.6 Attacker CAN hold victim funds ($s)"

# 4.7 Attacker freezes victim
resp=$(http POST "/v1/wallets/$WALLET_A/freeze" "$ATTACKER_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.7 Attacker cannot freeze victim ($s)" || log_fail "4.7 Attacker CAN freeze victim ($s)"

# 4.8 Attacker closes victim
resp=$(http POST "/v1/wallets/$WALLET_A/close" "$ATTACKER_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "4.8 Attacker cannot close victim ($s)" || log_fail "4.8 Attacker CAN close victim ($s)"

# ============================================================================
echo -e "\n${CYAN}[5] BALANCE MANIPULATION${NC}"
# ============================================================================

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
bal_a=$(echo "$(http_body "$resp")" | jq_field balance_cents)
echo "  Wallet A balance: $bal_a cents"

# 5.1 Overdraft withdrawal
resp=$(http POST "/v1/wallets/$WALLET_A/withdraw" "$API_KEY" "$(uuid)" '{"amount_cents":999999999}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "5.1 Overdraft rejected (INSUFFICIENT_FUNDS)" || log_fail "5.1 Overdraft returned $s"

# 5.2 Overdraft transfer
resp=$(http POST "/v1/transfers" "$API_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"$WALLET_B\",\"amount_cents\":999999999}")
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "5.2 Transfer overdraft rejected" || log_fail "5.2 Transfer overdraft returned $s"

# 5.3 Self-transfer
resp=$(http POST "/v1/transfers" "$API_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"$WALLET_A\",\"amount_cents\":100}")
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "5.3 Self-transfer rejected ($s)" || log_fail "5.3 Self-transfer returned $s"

# 5.4 Withdraw from frozen wallet
resp=$(http POST "/v1/wallets/$WALLET_B/freeze" "$API_KEY" "freeze-b1-$(uuid)" '{}')
resp=$(http POST "/v1/wallets/$WALLET_B/withdraw" "$API_KEY" "$(uuid)" '{"amount_cents":100}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "5.4 Withdraw from frozen wallet rejected" || log_fail "5.4 Frozen withdrawal returned $s"
http POST "/v1/wallets/$WALLET_B/unfreeze" "$API_KEY" "unfreeze-b1-$(uuid)" '{}' > /dev/null

# 5.5 Deposit to frozen wallet
resp=$(http POST "/v1/wallets/$WALLET_B/freeze" "$API_KEY" "freeze-b2-$(uuid)" '{}')
resp=$(http POST "/v1/wallets/$WALLET_B/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":100}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "5.5 Deposit to frozen wallet rejected" || log_fail "5.5 Frozen deposit returned $s"
http POST "/v1/wallets/$WALLET_B/unfreeze" "$API_KEY" "unfreeze-b2-$(uuid)" '{}' > /dev/null

# 5.6 Transfer from frozen wallet
resp=$(http POST "/v1/wallets/$WALLET_B/freeze" "$API_KEY" "freeze-b3-$(uuid)" '{}')
resp=$(http POST "/v1/transfers" "$API_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_B\",\"target_wallet_id\":\"$WALLET_A\",\"amount_cents\":100}")
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "5.6 Transfer from frozen wallet rejected" || log_fail "5.6 Frozen transfer returned $s"
http POST "/v1/wallets/$WALLET_B/unfreeze" "$API_KEY" "unfreeze-b3-$(uuid)" '{}' > /dev/null

# ============================================================================
echo -e "\n${CYAN}[6] IDEMPOTENCY ATTACKS${NC}"
# ============================================================================

# 6.1 Same key returns cached response
IDEM_KEY="test-idem-$(uuid)"
resp1=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$IDEM_KEY" '{"amount_cents":100}')
s1=$(http_status "$resp1"); b1=$(http_body "$resp1")
resp2=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$IDEM_KEY" '{"amount_cents":100}')
s2=$(http_status "$resp2"); b2=$(http_body "$resp2")
[ "$s1" = "$s2" ] && [ "$b1" = "$b2" ] && log_pass "6.1 Idempotent replay returns cached response" || log_fail "6.1 Replay returns different response"

# 6.2 Same key, different body
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$IDEM_KEY" '{"amount_cents":999}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "6.2 Payload mismatch detected (422)" || log_fail "6.2 Payload mismatch NOT detected ($s)"

# 6.3 Missing idempotency key
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets/$WALLET_A/deposit" -X POST \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -d '{"amount_cents":100}')
s=$(http_status "$resp"); [ "$s" = "400" ] && log_pass "6.3 Missing idempotency key rejected (400)" || log_fail "6.3 Missing idem key returns $s"

# 6.4 Same idem key on different endpoint (method:path changes hash)
IDEM_CROSS="cross-$(uuid)"
resp=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$IDEM_CROSS" '{"amount_cents":100}')
resp=$(http POST "/v1/wallets/$WALLET_A/withdraw" "$API_KEY" "$IDEM_CROSS" '{"amount_cents":100}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "6.4 Cross-endpoint idem key rejected (422)" || log_warn "6.4 Cross-endpoint idem key returns $s"

# 6.5 Idempotency key reuse across platforms (should be independent)
IDEM_PLAT="plat-$(uuid)"
resp1=$(http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$IDEM_PLAT" '{"amount_cents":100}')
resp2=$(http POST "/v1/wallets/$ATTACKER_WALLET/deposit" "$ATTACKER_KEY" "$IDEM_PLAT" '{"amount_cents":100}')
s1=$(http_status "$resp1"); s2=$(http_status "$resp2")
if [ "$s1" = "201" ] && [ "$s2" = "201" ]; then
  log_pass "6.5 Idem keys scoped per platform (both accepted)"
elif [ "$s2" = "422" ]; then
  log_warn "6.5 Idem keys shared globally — same key rejected on different platform"
else
  log_warn "6.5 Idem key cross-platform: platform1=$s1, platform2=$s2"
fi

# ============================================================================
echo -e "\n${CYAN}[7] CONCURRENCY / RACE CONDITIONS${NC}"
# ============================================================================

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
balance_before=$(echo "$(http_body "$resp")" | jq_field balance_cents)
echo "  Balance A before: $balance_before"

# 7.1 10 concurrent deposits of $10
echo "  Running 10 concurrent deposits of \$10..."
pids=()
for i in $(seq 1 10); do
  curl -s -o /dev/null "$BASE/v1/wallets/$WALLET_A/deposit" -X POST \
    -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
    -H "Idempotency-Key: conc-dep-$i-$(uuid)" -d '{"amount_cents":1000}' &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
sleep 1

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
balance_after=$(echo "$(http_body "$resp")" | jq_field balance_cents)
expected=$((balance_before + 10000))
echo "  Balance after: $balance_after (expected: $expected)"
[ "$balance_after" = "$expected" ] && log_pass "7.1 Concurrent deposits: balance correct" || log_fail "7.1 Concurrent deposits: INCONSISTENT ($balance_after != $expected)"

# 7.2 Concurrent withdrawals — try to drain more than available
resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
curr_bal=$(echo "$(http_body "$resp")" | jq_field balance_cents)
echo "  Balance A: $curr_bal. Running 20 concurrent withdrawals of \$50..."

rm -f /tmp/wallet_conc_wd.txt
for i in $(seq 1 20); do
  (
    r=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets/$WALLET_A/withdraw" -X POST \
      -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
      -H "Idempotency-Key: conc-wd-$i-$(uuid)" -d '{"amount_cents":5000}')
    echo "$(http_status "$r")" >> /tmp/wallet_conc_wd.txt
  ) &
done
wait; sleep 1

if [ -f /tmp/wallet_conc_wd.txt ]; then
  wd_ok=$(grep -c "^201$" /tmp/wallet_conc_wd.txt 2>/dev/null || echo 0)
  wd_fail=$(grep -c "^422$" /tmp/wallet_conc_wd.txt 2>/dev/null || echo 0)
  wd_conflict=$(grep -c "^409$" /tmp/wallet_conc_wd.txt 2>/dev/null || echo 0)
  echo "  Results: $wd_ok success, $wd_fail insufficient, $wd_conflict conflict"
  rm -f /tmp/wallet_conc_wd.txt
fi

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
final_bal=$(echo "$(http_body "$resp")" | jq_field balance_cents)
echo "  Final balance A: $final_bal"
[ "$final_bal" -ge 0 ] 2>/dev/null && log_pass "7.2 Concurrent withdrawals: balance non-negative ($final_bal)" || log_fail "7.2 NEGATIVE BALANCE ($final_bal)!"

# 7.3 Bidirectional transfers (deadlock test)
# Refill wallets
http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":50000}' > /dev/null
http POST "/v1/wallets/$WALLET_B/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":50000}' > /dev/null

echo "  Running 10 concurrent A->B and B->A transfers..."
rm -f /tmp/wallet_dl.txt
for i in $(seq 1 10); do
  (
    r=$(curl -s -w "\n%{http_code}" "$BASE/v1/transfers" -X POST \
      -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
      -H "Idempotency-Key: dl-ab-$i-$(uuid)" \
      -d "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"$WALLET_B\",\"amount_cents\":100}")
    echo "AB:$(http_status "$r")" >> /tmp/wallet_dl.txt
  ) &
  (
    r=$(curl -s -w "\n%{http_code}" "$BASE/v1/transfers" -X POST \
      -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
      -H "Idempotency-Key: dl-ba-$i-$(uuid)" \
      -d "{\"source_wallet_id\":\"$WALLET_B\",\"target_wallet_id\":\"$WALLET_A\",\"amount_cents\":100}")
    echo "BA:$(http_status "$r")" >> /tmp/wallet_dl.txt
  ) &
done
wait; sleep 1

if [ -f /tmp/wallet_dl.txt ]; then
  dl_500=$(grep -c "500" /tmp/wallet_dl.txt 2>/dev/null || echo 0)
  dl_ok=$(grep -c "201" /tmp/wallet_dl.txt 2>/dev/null || echo 0)
  dl_409=$(grep -c "409" /tmp/wallet_dl.txt 2>/dev/null || echo 0)
  echo "  Results: $dl_ok success, $dl_409 conflict, $dl_500 errors"
  rm -f /tmp/wallet_dl.txt
  [ "$dl_500" = "0" ] && log_pass "7.3 No deadlocks in bidirectional transfers" || log_fail "7.3 $dl_500 deadlock errors"
fi

# ============================================================================
echo -e "\n${CYAN}[8] HOLD EXPLOITATION${NC}"
# ============================================================================

# Ensure wallet A has funds
http POST "/v1/wallets/$WALLET_A/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":100000}' > /dev/null

# 8.1 Hold prevents withdrawal of held amount
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":50000}")
s=$(http_status "$resp"); b=$(http_body "$resp")
HOLD_ID=$(echo "$b" | jq_field hold_id)
echo "  Hold placed: $HOLD_ID for \$500"

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
full_bal=$(echo "$(http_body "$resp")" | jq_field balance_cents)
resp=$(http POST "/v1/wallets/$WALLET_A/withdraw" "$API_KEY" "$(uuid)" "{\"amount_cents\":$full_bal}")
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "8.1 Cannot withdraw held funds" || log_fail "8.1 Withdrew held funds ($s)"

# 8.2 Double capture
resp=$(http POST "/v1/holds/$HOLD_ID/capture" "$API_KEY" "cap1-$(uuid)" '{}')
s1=$(http_status "$resp")
resp=$(http POST "/v1/holds/$HOLD_ID/capture" "$API_KEY" "cap2-$(uuid)" '{}')
s2=$(http_status "$resp")
[[ "$s2" =~ ^(422|409)$ ]] && log_pass "8.2 Double capture rejected ($s2)" || log_fail "8.2 Double capture ALLOWED ($s2)"

# 8.3 Capture after void
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":1000}")
HOLD2=$(echo "$(http_body "$resp")" | jq_field hold_id)
http POST "/v1/holds/$HOLD2/void" "$API_KEY" "void-$(uuid)" '{}' > /dev/null
resp=$(http POST "/v1/holds/$HOLD2/capture" "$API_KEY" "cap-void-$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(422|409)$ ]] && log_pass "8.3 Cannot capture voided hold ($s)" || log_fail "8.3 Captured voided hold ($s)"

# 8.4 Hold with past expiry
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":1000,\"expires_at\":1000}")
s=$(http_status "$resp")
if [[ "$s" =~ ^(400|422)$ ]]; then
  log_pass "8.4 Hold with past expiry rejected ($s)"
else
  # If accepted, it should expire immediately
  if [ "$s" = "201" ]; then
    PAST_HOLD=$(echo "$(http_body "$resp")" | jq_field hold_id)
    resp=$(http POST "/v1/holds/$PAST_HOLD/capture" "$API_KEY" "$(uuid)" '{}')
    cs=$(http_status "$resp")
    [[ "$cs" =~ ^(422|409)$ ]] && log_warn "8.4 Past-expiry hold accepted but expired on capture ($cs)" || log_fail "8.4 Past-expiry hold capturable ($cs)"
  else
    log_warn "8.4 Past expiry hold returns $s"
  fi
fi

# 8.5 Oversized hold (more than balance)
resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
avail=$(echo "$(http_body "$resp")" | jq_field available_balance_cents)
oversized=$((avail + 100000))
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":$oversized}")
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "8.5 Oversized hold rejected" || log_fail "8.5 Oversized hold accepted ($s)"

# 8.6 Concurrent hold placement (race to exhaust)
echo "  Running 20 concurrent holds of \$20..."
rm -f /tmp/wallet_ch.txt
for i in $(seq 1 20); do
  (
    r=$(curl -s -w "\n%{http_code}" "$BASE/v1/holds" -X POST \
      -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
      -H "Idempotency-Key: ch-$i-$(uuid)" \
      -d "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":2000}")
    echo "$(http_status "$r")" >> /tmp/wallet_ch.txt
  ) &
done
wait; sleep 1

if [ -f /tmp/wallet_ch.txt ]; then
  ch_ok=$(grep -c "^201$" /tmp/wallet_ch.txt 2>/dev/null || echo 0)
  ch_fail=$(grep -c "^422$" /tmp/wallet_ch.txt 2>/dev/null || echo 0)
  echo "  Results: $ch_ok accepted, $ch_fail rejected"
  rm -f /tmp/wallet_ch.txt
fi

resp=$(http GET "/v1/wallets/$WALLET_A" "$API_KEY")
fb=$(echo "$(http_body "$resp")" | jq_field balance_cents)
[ "$fb" -ge 0 ] 2>/dev/null && log_pass "8.6 Concurrent holds: no over-reservation (balance: $fb)" || log_fail "8.6 Concurrent holds: negative balance!"

# 8.7 Void hold from different platform (attacker voids victim's hold)
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":1000}")
VICTIM_HOLD=$(echo "$(http_body "$resp")" | jq_field hold_id)
resp=$(http POST "/v1/holds/$VICTIM_HOLD/void" "$ATTACKER_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "8.7 Attacker cannot void victim's hold ($s)" || log_fail "8.7 Attacker voided victim's hold ($s)"
# Clean up: void it with correct key
http POST "/v1/holds/$VICTIM_HOLD/void" "$API_KEY" "$(uuid)" '{}' > /dev/null

# 8.8 Capture hold from different platform
resp=$(http POST "/v1/holds" "$API_KEY" "$(uuid)" "{\"wallet_id\":\"$WALLET_A\",\"amount_cents\":1000}")
VICTIM_HOLD2=$(echo "$(http_body "$resp")" | jq_field hold_id)
resp=$(http POST "/v1/holds/$VICTIM_HOLD2/capture" "$ATTACKER_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [[ "$s" =~ ^(404|403)$ ]] && log_pass "8.8 Attacker cannot capture victim's hold ($s)" || log_fail "8.8 Attacker captured victim's hold ($s)"
http POST "/v1/holds/$VICTIM_HOLD2/void" "$API_KEY" "$(uuid)" '{}' > /dev/null

# ============================================================================
echo -e "\n${CYAN}[9] WALLET LIFECYCLE${NC}"
# ============================================================================

# 9.1 Close with balance
resp=$(http POST "/v1/wallets/$WALLET_A/close" "$API_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "9.1 Cannot close wallet with balance" || log_fail "9.1 Closed wallet with balance ($s)"

# 9.2 Freeze system wallet
resp=$(http POST "/v1/wallets/$SYS_WALLET/freeze" "$API_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "9.2 Cannot freeze system wallet" || log_fail "9.2 Froze system wallet ($s)"

# 9.3 Double freeze
resp=$(http POST "/v1/wallets/$WALLET_B/freeze" "$API_KEY" "df-1-$(uuid)" '{}')
resp=$(http POST "/v1/wallets/$WALLET_B/freeze" "$API_KEY" "df-2-$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "9.3 Double freeze rejected" || log_fail "9.3 Double freeze allowed ($s)"
http POST "/v1/wallets/$WALLET_B/unfreeze" "$API_KEY" "uf-$(uuid)" '{}' > /dev/null

# 9.4 Unfreeze non-frozen wallet
resp=$(http POST "/v1/wallets/$WALLET_B/unfreeze" "$API_KEY" "uf2-$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "9.4 Unfreeze non-frozen rejected" || log_fail "9.4 Unfroze non-frozen ($s)"

# 9.5 Duplicate wallet creation
resp=$(http POST "/v1/wallets" "$API_KEY" "$(uuid)" '{"owner_id":"user-alice","currency_code":"USD"}')
s=$(http_status "$resp"); [[ "$s" =~ ^(409|422)$ ]] && log_pass "9.5 Duplicate wallet rejected ($s)" || log_fail "9.5 Duplicate wallet created ($s)"

# 9.6 Close system wallet
resp=$(http POST "/v1/wallets/$SYS_WALLET/close" "$API_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "422" ] && log_pass "9.6 Cannot close system wallet" || log_fail "9.6 Closed system wallet ($s)"

# ============================================================================
echo -e "\n${CYAN}[10] LEDGER INTEGRITY VERIFICATION${NC}"
# ============================================================================

# 10.1 All movements have zero-sum entries
bad=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "SELECT COUNT(*) FROM (SELECT movement_id, SUM(amount_cents) AS net FROM ledger_entries GROUP BY movement_id HAVING SUM(amount_cents) != 0) bad")
bad=$(echo "$bad" | tr -d '[:space:]')
[ "$bad" = "0" ] && log_pass "10.1 All movements are zero-sum in ledger" || log_fail "10.1 $bad movements with non-zero sum!"

# 10.2 Cached balance matches ledger
bad=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "SELECT COUNT(*) FROM (SELECT w.id, w.cached_balance_cents, COALESCE(SUM(le.amount_cents),0) AS ledger FROM wallets w LEFT JOIN ledger_entries le ON le.wallet_id=w.id GROUP BY w.id, w.cached_balance_cents HAVING w.cached_balance_cents != COALESCE(SUM(le.amount_cents),0)) m")
bad=$(echo "$bad" | tr -d '[:space:]')
[ "$bad" = "0" ] && log_pass "10.2 All cached balances match ledger sums" || log_fail "10.2 $bad wallets with balance/ledger mismatch!"

# 10.3 No negative non-system balances
neg=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "SELECT COUNT(*) FROM wallets WHERE cached_balance_cents < 0 AND is_system = false")
neg=$(echo "$neg" | tr -d '[:space:]')
[ "$neg" = "0" ] && log_pass "10.3 No negative non-system balances" || log_fail "10.3 $neg wallets with negative balance!"

# 10.4 All transaction amounts positive
bad=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "SELECT COUNT(*) FROM transactions WHERE amount_cents <= 0")
bad=$(echo "$bad" | tr -d '[:space:]')
[ "$bad" = "0" ] && log_pass "10.4 All transaction amounts positive" || log_fail "10.4 $bad transactions with non-positive amount!"

# 10.5 Immutable trigger blocks UPDATE
res=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A 2>&1 -c \
  "UPDATE ledger_entries SET amount_cents = 999999 WHERE id = (SELECT id FROM ledger_entries LIMIT 1)")
echo "$res" | grep -q "append-only" && log_pass "10.5 Ledger immutability: UPDATE blocked" || log_fail "10.5 Ledger UPDATE NOT blocked!"

# 10.6 Immutable trigger blocks DELETE
res=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A 2>&1 -c \
  "DELETE FROM ledger_entries WHERE id = (SELECT id FROM ledger_entries LIMIT 1)")
echo "$res" | grep -q "append-only" && log_pass "10.6 Ledger immutability: DELETE blocked" || log_fail "10.6 Ledger DELETE NOT blocked!"

# 10.7 DB constraint blocks negative balance via direct SQL
res=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A 2>&1 -c \
  "UPDATE wallets SET cached_balance_cents = -1 WHERE is_system = false LIMIT 1")
# PostgreSQL doesn't support LIMIT on UPDATE, use subquery
res=$(docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A 2>&1 -c \
  "UPDATE wallets SET cached_balance_cents = -1 WHERE id = (SELECT id FROM wallets WHERE is_system = false LIMIT 1)")
echo "$res" | grep -qi "violates\|constraint\|check" && log_pass "10.7 DB constraint blocks negative balance" || log_fail "10.7 Direct SQL set negative balance!"
# Restore
docker exec -i wallet-postgres-1 psql -U wallet -d wallet -t -A -c \
  "UPDATE wallets SET cached_balance_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_entries WHERE wallet_id = wallets.id) WHERE is_system = false" > /dev/null 2>&1

# ============================================================================
echo -e "\n${CYAN}[11] EDGE CASES & BOUNDARY VALUES${NC}"
# ============================================================================

# 11.1 Minimum deposit (1 cent)
resp=$(http POST "/v1/wallets/$WALLET_B/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":1}')
s=$(http_status "$resp"); [[ "$s" =~ ^(201|200)$ ]] && log_pass "11.1 Minimum deposit (1 cent) accepted" || log_fail "11.1 Minimum deposit rejected ($s)"

# 11.2 Cross-currency transfer
resp=$(http POST "/v1/wallets" "$API_KEY" "$(uuid)" '{"owner_id":"user-alice","currency_code":"EUR"}')
EUR_WALLET=$(echo "$(http_body "$resp")" | jq_field wallet_id)
http POST "/v1/wallets/$EUR_WALLET/deposit" "$API_KEY" "$(uuid)" '{"amount_cents":10000}' > /dev/null

resp=$(http POST "/v1/transfers" "$API_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"$EUR_WALLET\",\"amount_cents\":100}")
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "11.2 Cross-currency transfer rejected ($s)" || log_fail "11.2 Cross-currency transfer ALLOWED ($s)"

# 11.3 Non-existent wallet
resp=$(http GET "/v1/wallets/00000000-0000-0000-0000-000000000000" "$API_KEY")
s=$(http_status "$resp"); [ "$s" = "404" ] && log_pass "11.3 Non-existent wallet returns 404" || log_fail "11.3 Non-existent wallet returns $s"

# 11.4 Invalid UUID in path
resp=$(http GET "/v1/wallets/not-a-uuid" "$API_KEY")
s=$(http_status "$resp"); [[ "$s" =~ ^(404|400)$ ]] && log_pass "11.4 Invalid UUID handled ($s)" || log_fail "11.4 Invalid UUID returns $s"

# 11.5 Empty body on POST
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets/$WALLET_A/deposit" -X POST \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -H "Idempotency-Key: $(uuid)")
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "11.5 Empty body rejected ($s)" || log_fail "11.5 Empty body accepted ($s)"

# 11.6 Malformed JSON
resp=$(curl -s -w "\n%{http_code}" "$BASE/v1/wallets/$WALLET_A/deposit" -X POST \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -H "Idempotency-Key: $(uuid)" -d '{invalid}')
s=$(http_status "$resp"); [[ "$s" =~ ^(400|422)$ ]] && log_pass "11.6 Malformed JSON rejected ($s)" || log_fail "11.6 Malformed JSON accepted ($s)"

# 11.7 Transfer to non-existent wallet
resp=$(http POST "/v1/transfers" "$API_KEY" "$(uuid)" \
  "{\"source_wallet_id\":\"$WALLET_A\",\"target_wallet_id\":\"00000000-0000-0000-0000-000000000000\",\"amount_cents\":100}")
s=$(http_status "$resp"); [ "$s" = "404" ] && log_pass "11.7 Transfer to non-existent wallet rejected" || log_fail "11.7 Transfer to non-existent returns $s"

# 11.8 Capture non-existent hold
resp=$(http POST "/v1/holds/00000000-0000-0000-0000-000000000000/capture" "$API_KEY" "$(uuid)" '{}')
s=$(http_status "$resp"); [ "$s" = "404" ] && log_pass "11.8 Capture non-existent hold returns 404" || log_fail "11.8 Non-existent hold capture returns $s"

# ============================================================================
echo -e "\n${CYAN}[12] INFORMATION DISCLOSURE${NC}"
# ============================================================================

# 12.1 Errors don't leak internals
resp=$(curl -s "$BASE/v1/nonexistent" -H "X-API-Key: $API_KEY")
echo "$resp" | grep -qi "stack\|trace\|prisma\|postgres\|internal_error_detail" && log_fail "12.1 Error leaks internals" || log_pass "12.1 Errors don't leak internal details"

# 12.2 Framework header
headers=$(curl -sI "$BASE/health")
echo "$headers" | grep -qi "x-powered-by" && log_warn "12.2 Server reveals framework via X-Powered-By" || log_pass "12.2 No framework disclosure in headers"

# 12.3 Consistent 404 for existing vs non-existing (no wallet enumeration)
resp1=$(curl -s "$BASE/v1/wallets/$WALLET_A" -H "X-API-Key: $ATTACKER_KEY")
resp2=$(curl -s "$BASE/v1/wallets/00000000-0000-0000-0000-000000000000" -H "X-API-Key: $ATTACKER_KEY")
e1=$(echo "$resp1" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "?")
e2=$(echo "$resp2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "?")
[ "$e1" = "$e2" ] && log_pass "12.3 No wallet enumeration (consistent error codes)" || log_warn "12.3 Different errors for existing/non-existing wallet"

# ============================================================================
echo -e "\n${CYAN}============================================================${NC}"
echo -e "${CYAN}  AUDIT SUMMARY${NC}"
echo -e "${CYAN}============================================================${NC}"
echo -e "  ${GREEN}PASSED: $PASS${NC}"
echo -e "  ${RED}FAILED: $FAIL${NC}"
echo -e "  ${YELLOW}WARNINGS: $WARN${NC}"
TOTAL=$((PASS + FAIL + WARN))
echo -e "  TOTAL: $TOTAL tests"
echo ""
[ "$FAIL" -gt 0 ] && echo -e "  ${RED}CRITICAL ISSUES FOUND${NC}"
echo -e "\n${CYAN}Detailed Results:${NC}"
echo -e "$RESULTS"

#!/usr/bin/env bash
# Demo HA: Round-robin qua Nginx, stop instance-1, traffic vẫn qua instance-2.
set -euo pipefail

LB="${LB_URL:-http://127.0.0.1:8080}"
N="${REQUESTS:-12}"

echo "==> Health qua LB ($LB) — thấy X-Gateway-Instance xen kẽ"
for i in $(seq 1 "$N"); do
  curl -sS -D - -o /dev/null "$LB/health" 2>/dev/null | grep -i 'x-gateway-instance' || true
done

echo ""
echo "==> Stop middleware-instance-1 (kịch bản hội đồng)"
docker stop middleware-instance-1

sleep 2
echo "==> Sau khi stop instance-1 (chỉ còn instance-2)"
OK=0
for i in $(seq 1 "$N"); do
  if curl -sf -D /tmp/ha-hdr.txt -o /tmp/ha-body.json "$LB/health"; then
    inst=$(grep -i '^x-gateway-instance:' /tmp/ha-hdr.txt | awk '{print $2}' | tr -d '\r')
    echo "  request $i: OK instance=$inst"
    OK=$((OK + 1))
  else
    echo "  request $i: FAIL"
  fi
done

echo ""
if [[ "$OK" -eq "$N" ]]; then
  echo "PASS: LB failover — $OK/$N request OK khi instance-1 down"
else
  echo "WARN: chỉ $OK/$N OK — kiểm tra docker compose -f docker-compose.ha.yml ps"
fi

echo ""
echo "==> Start lại instance-1"
docker start middleware-instance-1
sleep 2
curl -sS "$LB/health" | head -c 200
echo ""

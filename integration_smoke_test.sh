#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "== 1. Starting local chain =="
setsid npx hardhat node < /dev/null > /tmp/hh_node.log 2>&1 &
sleep 4

echo "== 2. Deploying contracts =="
npx hardhat run scripts/deploy.js --network localhost --no-compile

echo "== 3. Starting backend API =="
setsid node backend/server.js < /dev/null > /tmp/backend.log 2>&1 &
sleep 3
cat /tmp/backend.log

BASE="http://localhost:4000/api"

echo "== 4. Health check =="
curl -s $BASE/health; echo

echo "== 5. Wallet directory =="
WALLETS=$(curl -s $BASE/wallets)
echo $WALLETS
ADMIN=$(echo $WALLETS | python3 -c "import json,sys; print(json.load(sys.stdin)['admin'])")
A=$(echo $WALLETS | python3 -c "import json,sys; print(json.load(sys.stdin)['wallets'][1]['address'])")
B=$(echo $WALLETS | python3 -c "import json,sys; print(json.load(sys.stdin)['wallets'][2]['address'])")
C=$(echo $WALLETS | python3 -c "import json,sys; print(json.load(sys.stdin)['wallets'][3]['address'])")
D=$(echo $WALLETS | python3 -c "import json,sys; print(json.load(sys.stdin)['wallets'][4]['address'])")
echo "Owner A=$A  Member B=$B  Member C=$C  Member D=$D"

echo "== 6. Register members A, B, C, D =="
curl -s -X POST $BASE/members -H "Content-Type: application/json" -d "{\"address\":\"$A\",\"name\":\"Owner A\"}"; echo
curl -s -X POST $BASE/members -H "Content-Type: application/json" -d "{\"address\":\"$B\",\"name\":\"Member B\"}"; echo
curl -s -X POST $BASE/members -H "Content-Type: application/json" -d "{\"address\":\"$C\",\"name\":\"Member C\"}"; echo
curl -s -X POST $BASE/members -H "Content-Type: application/json" -d "{\"address\":\"$D\",\"name\":\"Member D\"}"; echo

echo "== 7. Onboard Company A (Citadelle Ltd) =="
curl -s -X POST $BASE/companies -H "Content-Type: application/json" -d "{\"name\":\"Citadelle Ltd\",\"jurisdiction\":\"Hong Kong\",\"ownerAddress\":\"$A\"}"; echo

echo "== 8. Verify Pillars 1 & 2 (KYB + Owner KYC) =="
curl -s -X POST $BASE/companies/COMP-0001/verify-kyb; echo
curl -s -X POST $BASE/companies/COMP-0001/verify-owner-kyc; echo

echo "== 9. Deploy + issue the lien token (1000 units to Owner A) =="
LIEN=$(curl -s -X POST $BASE/liens -H "Content-Type: application/json" -d "{\"companyCode\":\"COMP-0001\",\"lienId\":\"LIEN-COMP-0001-01\",\"tokenName\":\"Citadelle Lien Token\",\"tokenSymbol\":\"CIT-L1\",\"maxSupply\":\"1000\",\"ownerAddress\":\"$A\"}")
echo $LIEN
TOKEN=$(echo $LIEN | python3 -c "import json,sys; print(json.load(sys.stdin)['tokenAddress'])")
echo "Token deployed at $TOKEN"

echo "== 10. Balance of A right after issuance =="
curl -s $BASE/tokens/$TOKEN/balance/$A; echo

echo "== 11. Transfer chain: A -> B -> C -> D =="
curl -s -X POST $BASE/tokens/$TOKEN/transfer -H "Content-Type: application/json" -d "{\"from\":\"$A\",\"to\":\"$B\",\"amount\":\"1000\"}"; echo
curl -s -X POST $BASE/tokens/$TOKEN/transfer -H "Content-Type: application/json" -d "{\"from\":\"$B\",\"to\":\"$C\",\"amount\":\"1000\"}"; echo
curl -s -X POST $BASE/tokens/$TOKEN/transfer -H "Content-Type: application/json" -d "{\"from\":\"$C\",\"to\":\"$D\",\"amount\":\"1000\"}"; echo

echo "== 12. Balance of D after chain, and A's voting rights still intact =="
curl -s $BASE/tokens/$TOKEN/balance/$D; echo
curl -s $BASE/companies/COMP-0001; echo

echo "== 13. D requests redemption =="
REDEEM=$(curl -s -X POST $BASE/tokens/$TOKEN/redeem -H "Content-Type: application/json" -d "{\"holder\":\"$D\",\"amount\":\"1000\"}")
echo $REDEEM
RID=$(echo $REDEEM | python3 -c "import json,sys; print(json.load(sys.stdin)['redemptionId'])")

echo "== 14. Compliance executes redemption + moves voting rights to D =="
curl -s -X POST $BASE/tokens/$TOKEN/redemptions/$RID/execute -H "Content-Type: application/json" -d "{\"note\":\"Shares transferred to Member D via registrar\"}"; echo
curl -s -X POST $BASE/companies/COMP-0001/transfer-voting -H "Content-Type: application/json" -d "{\"newHolder\":\"$D\",\"reason\":\"Full redemption by MEM-0004\"}"; echo

echo "== 15. Final state: D balance = 0, voting rights = D =="
curl -s $BASE/tokens/$TOKEN/balance/$D; echo
curl -s $BASE/companies/COMP-0001; echo

echo "== 16. Security check: reject transfer to an unregistered wallet =="
STRANGER="0x000000000000000000000000000000000000dEaD"
curl -s -X POST $BASE/tokens/$TOKEN/transfer -H "Content-Type: application/json" -d "{\"from\":\"$A\",\"to\":\"$STRANGER\",\"amount\":\"1\"}"; echo

echo "== DONE =="

# Borderless Securities — Working Prototype

A tokenized share-lien and transfer platform. This matches exactly the model
we designed together:

1. **Owner A liens shares of Company A** with the platform and receives tokens
   representing a claim on exactly those shares.
2. **Tokens move freely** between KYC-verified members: A → B → C → D.
3. **Voting rights stay with A** the entire time. A token only carries the
   economic claim, never control.
4. **Any holder can request redemption.** The platform burns their tokens and
   compliance releases the real, previously-blocked shares to them — at which
   point voting rights move too.
5. **Each company has its own separate token.** Never pooled or blended.

This has been built, compiled, and tested end-to-end — see "Proof it works"
below for the actual test run.

---

## What's in here

```
contracts/            Solidity smart contracts
  IdentityRegistry.sol     KYC whitelist, assigns unique member codes (MEM-0001...)
  CompanyRegistry.sol      Company onboarding (KYB + owner KYC), voting rights tracking
  ShareLienToken.sol       One token per lien issuance. Fixed supply, KYC-gated
                           transfers, redemption/burn logic
  TokenFactory.sol         Deploys a fresh, isolated token for every lien

scripts/
  deploy.js                Deploys the three core contracts, saves addresses
  artifacts.js              Helper to load compiled contract artifacts

test/
  test.js                   12 tests covering the full lifecycle + security checks

backend/
  server.js                 REST API wrapping the contracts (Express + ethers.js)

frontend/
  index.html                 Demo UI — Setup / Members / Company / Lien / Transfer / Redeem tabs

compile.js               Compiles contracts via solc-js (see note below on why)
hardhat.config.js
package.json
integration_smoke_test.sh  Automated script that exercises the entire flow via curl
deployment.json            Written by deploy.js — contract addresses (git-ignore this)
```

## Why `compile.js` instead of `npx hardhat compile`

Hardhat's default compile task downloads the Solidity compiler binary from
`binaries.soliditylang.org`. In some sandboxed/restricted network environments
that host isn't reachable. `compile.js` uses the `solc` npm package (pure
JS/WASM compiler, installed like any other dependency) to compile the same
contracts with identical settings. If your environment can reach
`binaries.soliditylang.org` fine, you're welcome to switch back to
`npx hardhat compile` — the contracts don't change either way.

---

## Running it yourself

### 1. Install dependencies
```bash
npm install
cd backend && npm install && cd ..
```

### 2. Compile the contracts
```bash
node compile.js
```
This writes ABI + bytecode into `artifacts-custom/`.

### 3. Start a local chain
```bash
npx hardhat node
```
Leave this running. It prints 20 funded test accounts — these stand in for
real wallets in this prototype (see security note below).

### 4. Deploy the contracts (in a new terminal)
```bash
npm run deploy
```
This writes `deployment.json` with the three contract addresses.

### 5. Start the backend API (in a new terminal)
```bash
cd backend
npm start
```
Runs on `http://localhost:4000`.

### 6. Open the frontend
Open `frontend/index.html` directly in a browser (no build step needed).

### 7. Try the full flow
Setup tab → load wallets → Members tab (register 4+ members) → Company tab
(onboard + verify both pillars) → Lien & Token tab (deploy + issue) →
Transfer tab (move tokens A→B→C→D) → Redeem tab (request + execute +
transfer voting rights).

### Or just run the automated end-to-end test
```bash
bash integration_smoke_test.sh
```
This does everything above via curl and prints every response. This is the
exact script used to verify the system while building it.

---

## Proof it works

**Unit tests — 12/12 passing:**
```
Borderless Securities — Share Lien Platform
  IdentityRegistry
    ✔ registers members with unique sequential codes
    ✔ prevents double registration
    ✔ freezing a member removes eligibility without deregistering
    ✔ only COMPLIANCE_ROLE can register members
  CompanyRegistry
    ✔ registers a company and requires both pillars before flagging verified
    ✔ voting rights default to the original owner
  Full lifecycle: onboard → lien → mint → transfer chain → redeem
    ✔ deploys an isolated token, issues fixed supply, and moves through A→B→C→D→redeem
    ✔ blocks transfers to or from non-KYC wallets
    ✔ blocks transfers from a frozen wallet
    ✔ prevents the same lien from being tokenized twice
    ✔ pauses transfers in an emergency
    ✔ cannot redeem more than current balance

  12 passing
```
Run it yourself: `npx hardhat test --no-compile`

**Live integration run** (real contracts, real chain, real API calls) proved:
- Members registered → MEM-0001 through MEM-0004
- Company onboarded → COMP-0001, both pillars verified
- Lien token deployed, 1,000 tokens issued to Owner A
- Transfer chain A → B → C → D — every hop succeeded
- **Voting rights confirmed still with Owner A** after the full transfer chain
- Member D requested redemption — tokens burned, balance → 0
- Compliance executed the redemption and **voting rights moved to D**
- Security check: a transfer to an unregistered wallet was **correctly rejected**

---

## Security design

- **KYC gating on every transfer.** `ShareLienToken._update()` checks both
  sender and recipient against `IdentityRegistry.isEligible()` on every mint,
  transfer, and burn. This can't be bypassed by calling the token directly.
- **Freeze, not just revoke.** Compliance can freeze a specific wallet without
  destroying its registration history — useful for a hack, a subpoena, or a
  dispute, without permanently deregistering someone.
- **Fixed supply per issuance.** `issue()` can only be called once per token
  contract (`already issued` guard) — no silent dilution after the fact.
- **One lien, one token, forever.** `TokenFactory` will not deploy a second
  token for a `lienId` that's already been tokenized.
- **Pausable.** Compliance can halt all transfers on a specific company's
  token in an emergency without touching any other company's token.
- **ReentrancyGuard on redemption.** `requestRedemption()` follows
  checks-effects-interactions and is guarded against reentrancy.
- **Role separation.** `DEFAULT_ADMIN_ROLE`, `COMPLIANCE_ROLE`, and
  `MINTER_ROLE` are distinct — in production these should be separate
  multisigs, not one EOA.
- **Voting rights are a deliberate, separate on-chain action** — never
  automatic. Redemption burns tokens; a human/compliance step explicitly
  moves voting rights afterward. This avoids ambiguity if a company's supply
  is redeemed by multiple different holders in fragments.

## What's intentionally simplified for this prototype (read before going live)

This is a strong, working foundation — not a finished production system.
Before launching with real money and real shares, you still need:

1. **Real custody, not backend-held keys.** The demo backend signs
   transactions using well-known local test private keys for convenience.
   In production, members must control their own keys (MetaMask /
   WalletConnect / institutional custody), and admin/compliance actions
   should go through a multisig (e.g. Safe), not a single key.
2. **A licensed custodian holding the actual liened shares** — the smart
   contract's job is the token and the audit trail; a real custodian/trustee
   or registrar needs to actually hold and release the underlying shares.
3. **Security audit.** Get these contracts professionally audited (Trail of
   Bits, Hacken, ConsenSys Diligence, etc.) before any mainnet deployment
   handling real value.
4. **Legal wrapper.** Subscription/lien agreements, terms of service, and a
   jurisdiction (see the pitch deck) — the smart contract enforces the rules,
   but a court needs a legal agreement to enforce, too.
5. **Off-chain KYC/AML integration.** `IdentityRegistry.registerMember()` is
   called here directly; in production this is gated behind a real KYC
   provider (e.g. Sumsub) and only called after a human/automated check
   passes.
6. **Full-voting share classes need extra structuring** — this prototype
   assumes voting can cleanly stay with the original owner, which is
   simplest for non-voting/preferred shares. Full-voting shares need a
   lawyer-drafted proxy/voting agreement layered on top.

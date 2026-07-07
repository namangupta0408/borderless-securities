/**
 * Borderless Securities — API layer
 *
 * Wraps the on-chain contracts (IdentityRegistry, CompanyRegistry, TokenFactory,
 * ShareLienToken) with a simple REST API so the frontend doesn't need a wallet
 * extension for this demo. In production, replace the demo signer map below
 * with real user-controlled wallets (WalletConnect / MetaMask) or an
 * institutional custody/MPC signing service — a backend holding private keys
 * for end users is a DEMO-ONLY pattern, not a production security model.
 */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const deploymentPath = path.join(__dirname, "..", "deployment.json");
const artifactsDir = path.join(__dirname, "..", "artifacts-custom");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(artifactsDir, name + ".json"), "utf8"));
}

function loadDeployment() {
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      "deployment.json not found. Run `npx hardhat node` then `npm run deploy` from the project root first."
    );
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

// Hardhat's well-known default local test accounts (index 0-19).
// DEMO ONLY — never use these keys or this pattern outside a local sandbox.
const HARDHAT_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];

const rawWallets = HARDHAT_KEYS.map((k) => new ethers.Wallet(k, provider));
// NonceManager tracks nonces locally instead of re-querying the node on every
// call, which avoids a nonce race when several transactions from the same
// signer are submitted in quick succession (a real issue we hit and fixed
// during testing — worth knowing about if you see "nonce too low" errors).
const managedSigners = rawWallets.map((w) => new ethers.NonceManager(w));
// wallets[0] is always the deployer/admin (matches scripts/deploy.js signer #0)
const adminWallet = rawWallets[0];
const adminSigner = managedSigners[0];

function walletForAddress(address) {
  const idx = rawWallets.findIndex((w) => w.address.toLowerCase() === address.toLowerCase());
  if (idx === -1) throw new Error("No demo signer available for address " + address);
  return managedSigners[idx];
}

let deployment, identityRegistry, companyRegistry, tokenFactory;

function initContracts() {
  deployment = loadDeployment();
  const idArt = loadArtifact("IdentityRegistry");
  const compArt = loadArtifact("CompanyRegistry");
  const factArt = loadArtifact("TokenFactory");

  identityRegistry = new ethers.Contract(deployment.identityRegistry, idArt.abi, adminSigner);
  companyRegistry = new ethers.Contract(deployment.companyRegistry, compArt.abi, adminSigner);
  tokenFactory = new ethers.Contract(deployment.tokenFactory, factArt.abi, adminSigner);
}

function tokenContract(address, signer) {
  const art = loadArtifact("ShareLienToken");
  return new ethers.Contract(address, art.abi, signer || adminSigner);
}

// ---------- demo wallet directory (for the UI to show "who is who") ----------
const demoDirectory = rawWallets.map((w, i) => ({ index: i, address: w.address }));

// ============================= ROUTES =============================

app.get("/api/health", (req, res) => {
  res.json({ ok: true, rpc: RPC_URL, deployed: fs.existsSync(deploymentPath) });
});

app.get("/api/wallets", (req, res) => {
  res.json({ wallets: demoDirectory, admin: adminWallet.address });
});

app.get("/api/deployment", (req, res) => {
  res.json(deployment);
});

// ---- Members ----
app.post("/api/members", async (req, res) => {
  try {
    const { address, name } = req.body;
    const tx = await identityRegistry.registerMember(address, name);
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return identityRegistry.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "MemberRegistered");
    res.json({ ok: true, code: ev.args.code, txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.get("/api/members/:address", async (req, res) => {
  try {
    const m = await identityRegistry.members(req.params.address);
    res.json({
      code: m.code,
      name: m.name,
      verified: m.verified,
      frozen: m.frozen,
      registeredAt: m.registeredAt.toString(),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/members/:address/freeze", async (req, res) => {
  try {
    const { frozen } = req.body;
    const tx = await identityRegistry.setFrozen(req.params.address, frozen);
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

// ---- Companies ----
app.post("/api/companies", async (req, res) => {
  try {
    const { name, jurisdiction, ownerAddress } = req.body;
    const tx = await companyRegistry.registerCompany(name, jurisdiction, ownerAddress);
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return companyRegistry.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "CompanyRegistered");
    res.json({ ok: true, code: ev.args.code, txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.get("/api/companies/:code", async (req, res) => {
  try {
    const c = await companyRegistry.getCompany(req.params.code);
    res.json({
      code: c.code,
      name: c.name,
      jurisdiction: c.jurisdiction,
      owner: c.owner,
      kybVerified: c.kybVerified,
      ownerKycVerified: c.ownerKycVerified,
      votingRightsHolder: c.votingRightsHolder,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.get("/api/companies", async (req, res) => {
  try {
    const codes = await companyRegistry.getAllCompanyCodes();
    const list = await Promise.all(
      codes.map(async (code) => {
        const c = await companyRegistry.getCompany(code);
        return {
          code: c.code, name: c.name, jurisdiction: c.jurisdiction, owner: c.owner,
          kybVerified: c.kybVerified, ownerKycVerified: c.ownerKycVerified,
          votingRightsHolder: c.votingRightsHolder,
        };
      })
    );
    res.json({ companies: list });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/companies/:code/verify-kyb", async (req, res) => {
  try {
    const tx = await companyRegistry.verifyKYB(req.params.code);
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/companies/:code/verify-owner-kyc", async (req, res) => {
  try {
    const tx = await companyRegistry.verifyOwnerKYC(req.params.code);
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/companies/:code/transfer-voting", async (req, res) => {
  try {
    const { newHolder, reason } = req.body;
    const tx = await companyRegistry.transferVotingRights(req.params.code, newHolder, reason || "");
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

// ---- Liens / Tokens ----
app.post("/api/liens", async (req, res) => {
  try {
    const { companyCode, lienId, tokenName, tokenSymbol, maxSupply, ownerAddress } = req.body;

    const pillarsOk = await companyRegistry.isPillar12Verified(companyCode);
    if (!pillarsOk) {
      return res.status(400).json({ ok: false, error: "Pillars 1 & 2 (KYB + Owner KYC) not verified yet" });
    }

    const tx = await tokenFactory.deployLienToken(
      tokenName, tokenSymbol, companyCode, lienId, BigInt(maxSupply), adminWallet.address
    );
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return tokenFactory.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "TokenDeployed");
    const tokenAddress = ev.args.token;

    const token = tokenContract(tokenAddress, adminSigner);
    const issueTx = await token.issue(ownerAddress);
    await issueTx.wait();

    res.json({ ok: true, tokenAddress, lienId, txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.get("/api/tokens/:address", async (req, res) => {
  try {
    const token = tokenContract(req.params.address);
    const [name, symbol, totalSupply, maxSupply, companyCode, lienId, issued] = await Promise.all([
      token.name(), token.symbol(), token.totalSupply(), token.maxSupply(),
      token.companyCode(), token.lienId(), token.issued(),
    ]);
    res.json({
      address: req.params.address, name, symbol,
      totalSupply: totalSupply.toString(), maxSupply: maxSupply.toString(),
      companyCode, lienId, issued,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/tokens/:address/balance/:owner", async (req, res) => {
  try {
    const token = tokenContract(req.params.address);
    const bal = await token.balanceOf(req.params.owner);
    res.json({ balance: bal.toString() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/tokens/:address/transfer", async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    const signer = walletForAddress(from);
    const token = tokenContract(req.params.address, signer);
    const tx = await token.transfer(to, BigInt(amount));
    const receipt = await tx.wait();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/tokens/:address/redeem", async (req, res) => {
  try {
    const { holder, amount } = req.body;
    const signer = walletForAddress(holder);
    const token = tokenContract(req.params.address, signer);
    const tx = await token.requestRedemption(BigInt(amount));
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return token.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "RedemptionRequested");
    res.json({ ok: true, redemptionId: ev.args.redemptionId.toString(), txHash: receipt.hash });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/tokens/:address/redemptions/:id/execute", async (req, res) => {
  try {
    const { note } = req.body;
    const token = tokenContract(req.params.address, adminSigner);
    const tx = await token.executeRedemption(req.params.id, note || "");
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/tokens/:address/pause", async (req, res) => {
  try {
    const token = tokenContract(req.params.address, adminSigner);
    const tx = await token.pause();
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

app.post("/api/tokens/:address/unpause", async (req, res) => {
  try {
    const token = tokenContract(req.params.address, adminSigner);
    const tx = await token.unpause();
    await tx.wait();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.reason || e.message });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  try {
    initContracts();
    console.log(`Borderless Securities API listening on http://localhost:${PORT}`);
    console.log(`Connected to chain at ${RPC_URL}`);
    console.log(`Admin wallet: ${adminWallet.address}`);
  } catch (e) {
    console.error("Startup error:", e.message);
    console.error("Make sure you ran `npx hardhat node` and `npm run deploy` first.");
  }
});

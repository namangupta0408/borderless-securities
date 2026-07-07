const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts-custom");

function loadArtifact(name) {
  const p = path.join(ARTIFACTS_DIR, name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function getFactory(hre, name, signer) {
  const art = loadArtifact(name);
  return new hre.ethers.ContractFactory(art.abi, art.bytecode, signer);
}

module.exports = { loadArtifact, getFactory };

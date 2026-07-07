const hre = require("hardhat");
const { getFactory } = require("./artifacts");
const fs = require("fs");
const path = require("path");

async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log("Deploying with admin:", admin.address);

  const IdentityRegistry = await getFactory(hre, "IdentityRegistry", admin);
  const identityRegistry = await IdentityRegistry.deploy(admin.address);
  await identityRegistry.waitForDeployment();
  console.log("IdentityRegistry:", await identityRegistry.getAddress());

  const CompanyRegistry = await getFactory(hre, "CompanyRegistry", admin);
  const companyRegistry = await CompanyRegistry.deploy(admin.address);
  await companyRegistry.waitForDeployment();
  console.log("CompanyRegistry:", await companyRegistry.getAddress());

  const TokenFactory = await getFactory(hre, "TokenFactory", admin);
  const tokenFactory = await TokenFactory.deploy(admin.address, await identityRegistry.getAddress());
  await tokenFactory.waitForDeployment();
  console.log("TokenFactory:", await tokenFactory.getAddress());

  const deployment = {
    network: hre.network.name,
    admin: admin.address,
    identityRegistry: await identityRegistry.getAddress(),
    companyRegistry: await companyRegistry.getAddress(),
    tokenFactory: await tokenFactory.getAddress(),
  };

  const outPath = path.join(__dirname, "..", "deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\nSaved deployment addresses to", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

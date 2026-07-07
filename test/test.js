const { expect } = require("chai");
const hre = require("hardhat");
const { getFactory } = require("../scripts/artifacts");

describe("Borderless Securities — Share Lien Platform", function () {
  let admin, ownerA, memberB, memberC, memberD, stranger;
  let identityRegistry, companyRegistry, tokenFactory;

  beforeEach(async function () {
    [admin, ownerA, memberB, memberC, memberD, stranger] = await hre.ethers.getSigners();

    const IdentityRegistry = await getFactory(hre, "IdentityRegistry", admin);
    identityRegistry = await IdentityRegistry.deploy(admin.address);
    await identityRegistry.waitForDeployment();

    const CompanyRegistry = await getFactory(hre, "CompanyRegistry", admin);
    companyRegistry = await CompanyRegistry.deploy(admin.address);
    await companyRegistry.waitForDeployment();

    const TokenFactory = await getFactory(hre, "TokenFactory", admin);
    tokenFactory = await TokenFactory.deploy(admin.address, await identityRegistry.getAddress());
    await tokenFactory.waitForDeployment();
  });

  describe("IdentityRegistry", function () {
    it("registers members with unique sequential codes", async function () {
      const tx1 = await identityRegistry.registerMember(ownerA.address, "Owner A");
      await tx1.wait();
      const tx2 = await identityRegistry.registerMember(memberB.address, "Member B");
      await tx2.wait();

      const m1 = await identityRegistry.members(ownerA.address);
      const m2 = await identityRegistry.members(memberB.address);
      expect(m1.code).to.equal("MEM-0001");
      expect(m2.code).to.equal("MEM-0002");
      expect(await identityRegistry.isEligible(ownerA.address)).to.equal(true);
    });

    it("prevents double registration", async function () {
      await identityRegistry.registerMember(ownerA.address, "Owner A");
      await expect(
        identityRegistry.registerMember(ownerA.address, "Owner A Again")
      ).to.be.revertedWith("already registered");
    });

    it("freezing a member removes eligibility without deregistering", async function () {
      await identityRegistry.registerMember(ownerA.address, "Owner A");
      await identityRegistry.setFrozen(ownerA.address, true);
      expect(await identityRegistry.isEligible(ownerA.address)).to.equal(false);
      await identityRegistry.setFrozen(ownerA.address, false);
      expect(await identityRegistry.isEligible(ownerA.address)).to.equal(true);
    });

    it("only COMPLIANCE_ROLE can register members", async function () {
      await expect(
        identityRegistry.connect(stranger).registerMember(memberB.address, "Nope")
      ).to.be.reverted;
    });
  });

  describe("CompanyRegistry", function () {
    it("registers a company and requires both pillars before flagging verified", async function () {
      await companyRegistry.registerCompany("Citadelle Ltd", "Hong Kong", ownerA.address);
      expect(await companyRegistry.isPillar12Verified("COMP-0001")).to.equal(false);

      await companyRegistry.verifyKYB("COMP-0001");
      expect(await companyRegistry.isPillar12Verified("COMP-0001")).to.equal(false);

      await companyRegistry.verifyOwnerKYC("COMP-0001");
      expect(await companyRegistry.isPillar12Verified("COMP-0001")).to.equal(true);
    });

    it("voting rights default to the original owner", async function () {
      await companyRegistry.registerCompany("Citadelle Ltd", "Hong Kong", ownerA.address);
      const c = await companyRegistry.getCompany("COMP-0001");
      expect(c.votingRightsHolder).to.equal(ownerA.address);
    });
  });

  describe("Full lifecycle: onboard → lien → mint → transfer chain → redeem", function () {
    beforeEach(async function () {
      // Register members
      await identityRegistry.registerMember(ownerA.address, "Owner A");
      await identityRegistry.registerMember(memberB.address, "Member B");
      await identityRegistry.registerMember(memberC.address, "Member C");
      await identityRegistry.registerMember(memberD.address, "Member D");

      // Onboard company + verify pillars 1 & 2
      await companyRegistry.registerCompany("Citadelle Ltd", "Hong Kong", ownerA.address);
      await companyRegistry.verifyKYB("COMP-0001");
      await companyRegistry.verifyOwnerKYC("COMP-0001");
    });

    it("deploys an isolated token, issues fixed supply, and moves through A→B→C→D→redeem", async function () {
      // Pillars 3 & 4 verified off-chain/administratively, then deploy + issue the lien token
      const tx = await tokenFactory.deployLienToken(
        "Citadelle Lien Token",
        "CIT-L1",
        "COMP-0001",
        "LIEN-COMP-0001-01",
        1000n,
        admin.address
      );
      const receipt = await tx.wait();
      const deployedEvent = receipt.logs
        .map((l) => {
          try {
            return tokenFactory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "TokenDeployed");
      const tokenAddr = deployedEvent.args.token;

      const ShareLienToken = await getFactory(hre, "ShareLienToken", admin);
      const token = ShareLienToken.attach(tokenAddr);

      // Issue fixed supply to owner A
      await token.issue(ownerA.address);
      expect(await token.balanceOf(ownerA.address)).to.equal(1000n);
      expect(await token.totalSupply()).to.equal(1000n);

      // Cannot issue twice
      await expect(token.issue(ownerA.address)).to.be.revertedWith("already issued");

      // A -> B -> C -> D
      await token.connect(ownerA).transfer(memberB.address, 1000n);
      expect(await token.balanceOf(memberB.address)).to.equal(1000n);

      await token.connect(memberB).transfer(memberC.address, 1000n);
      await token.connect(memberC).transfer(memberD.address, 1000n);
      expect(await token.balanceOf(memberD.address)).to.equal(1000n);

      // Voting rights should still be with A throughout
      let company = await companyRegistry.getCompany("COMP-0001");
      expect(company.votingRightsHolder).to.equal(ownerA.address);

      // D requests redemption
      const redeemTx = await token.connect(memberD).requestRedemption(1000n);
      const redeemReceipt = await redeemTx.wait();
      const requestedEvent = redeemReceipt.logs
        .map((l) => {
          try {
            return token.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "RedemptionRequested");
      const redemptionId = requestedEvent.args.redemptionId;

      expect(await token.balanceOf(memberD.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);

      // Compliance executes real-world share release + updates voting rights
      await token.executeRedemption(redemptionId, "Shares transferred to Member D via registrar");
      await companyRegistry.transferVotingRights("COMP-0001", memberD.address, "Full redemption by MEM-0004");

      company = await companyRegistry.getCompany("COMP-0001");
      expect(company.votingRightsHolder).to.equal(memberD.address);
    });

    it("blocks transfers to or from non-KYC wallets", async function () {
      const tx = await tokenFactory.deployLienToken(
        "Citadelle Lien Token", "CIT-L1", "COMP-0001", "LIEN-COMP-0001-01", 1000n, admin.address
      );
      const receipt = await tx.wait();
      const deployedEvent = receipt.logs.map((l) => { try { return tokenFactory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenDeployed");
      const ShareLienToken = await getFactory(hre, "ShareLienToken", admin);
      const token = ShareLienToken.attach(deployedEvent.args.token);
      await token.issue(ownerA.address);

      // stranger is not registered in IdentityRegistry
      await expect(
        token.connect(ownerA).transfer(stranger.address, 100n)
      ).to.be.revertedWith("recipient not KYC-eligible");
    });

    it("blocks transfers from a frozen wallet", async function () {
      const tx = await tokenFactory.deployLienToken(
        "Citadelle Lien Token", "CIT-L1", "COMP-0001", "LIEN-COMP-0001-01", 1000n, admin.address
      );
      const receipt = await tx.wait();
      const deployedEvent = receipt.logs.map((l) => { try { return tokenFactory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenDeployed");
      const ShareLienToken = await getFactory(hre, "ShareLienToken", admin);
      const token = ShareLienToken.attach(deployedEvent.args.token);
      await token.issue(ownerA.address);

      await identityRegistry.setFrozen(ownerA.address, true);
      await expect(
        token.connect(ownerA).transfer(memberB.address, 100n)
      ).to.be.revertedWith("sender not KYC-eligible");
    });

    it("prevents the same lien from being tokenized twice", async function () {
      await tokenFactory.deployLienToken(
        "Citadelle Lien Token", "CIT-L1", "COMP-0001", "LIEN-COMP-0001-01", 1000n, admin.address
      );
      await expect(
        tokenFactory.deployLienToken(
          "Citadelle Lien Token 2", "CIT-L1b", "COMP-0001", "LIEN-COMP-0001-01", 500n, admin.address
        )
      ).to.be.revertedWith("lien already tokenized");
    });

    it("pauses transfers in an emergency", async function () {
      const tx = await tokenFactory.deployLienToken(
        "Citadelle Lien Token", "CIT-L1", "COMP-0001", "LIEN-COMP-0001-01", 1000n, admin.address
      );
      const receipt = await tx.wait();
      const deployedEvent = receipt.logs.map((l) => { try { return tokenFactory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenDeployed");
      const ShareLienToken = await getFactory(hre, "ShareLienToken", admin);
      const token = ShareLienToken.attach(deployedEvent.args.token);
      await token.issue(ownerA.address);

      await token.pause();
      await expect(
        token.connect(ownerA).transfer(memberB.address, 100n)
      ).to.be.reverted;

      await token.unpause();
      await token.connect(ownerA).transfer(memberB.address, 100n);
      expect(await token.balanceOf(memberB.address)).to.equal(100n);
    });

    it("cannot redeem more than current balance", async function () {
      const tx = await tokenFactory.deployLienToken(
        "Citadelle Lien Token", "CIT-L1", "COMP-0001", "LIEN-COMP-0001-01", 1000n, admin.address
      );
      const receipt = await tx.wait();
      const deployedEvent = receipt.logs.map((l) => { try { return tokenFactory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenDeployed");
      const ShareLienToken = await getFactory(hre, "ShareLienToken", admin);
      const token = ShareLienToken.attach(deployedEvent.args.token);
      await token.issue(ownerA.address);

      await expect(
        token.connect(ownerA).requestRedemption(5000n)
      ).to.be.revertedWith("insufficient balance");
    });
  });
});

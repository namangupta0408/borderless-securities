// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IIdentityRegistry {
    function isEligible(address wallet) external view returns (bool);
}

/// @title ShareLienToken
/// @notice One token contract per company lien issuance. NEVER pooled across
///         companies. Fixed supply, minted once at issuance directly to the
///         original owner. Freely transferable between KYC-verified members.
///         Any holder may request redemption (burn) to claim the real,
///         previously-blocked shares; compliance executes the real-world
///         transfer off-chain and confirms it on-chain for the audit trail.
contract ShareLienToken is ERC20, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IIdentityRegistry public immutable identityRegistry;
    string public companyCode;   // e.g. COMP-0001
    string public lienId;        // e.g. LIEN-COMP-0001-01
    uint256 public immutable maxSupply;
    bool public issued;
    uint256 public redemptionCount;

    struct Redemption {
        address holder;
        uint256 amount;
        bool executed;
        string note;
    }
    mapping(uint256 => Redemption) public redemptions;

    event Issued(address indexed to, uint256 amount, string lienId);
    event RedemptionRequested(uint256 indexed redemptionId, address indexed holder, uint256 amount);
    event RedemptionExecuted(uint256 indexed redemptionId, address indexed holder, uint256 amount, string note);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory companyCode_,
        string memory lienId_,
        uint256 maxSupply_,
        address identityRegistry_,
        address admin
    ) ERC20(name_, symbol_) {
        require(identityRegistry_ != address(0), "zero registry");
        require(admin != address(0), "zero admin");
        require(maxSupply_ > 0, "zero supply");

        companyCode = companyCode_;
        lienId = lienId_;
        maxSupply = maxSupply_;
        identityRegistry = IIdentityRegistry(identityRegistry_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @notice One-time issuance of the full fixed supply to the original owner.
    function issue(address to) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(!issued, "already issued");
        require(identityRegistry.isEligible(to), "recipient not KYC-eligible");
        issued = true;
        _mint(to, maxSupply);
        emit Issued(to, maxSupply, lienId);
    }

    function pause() external onlyRole(COMPLIANCE_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(COMPLIANCE_ROLE) {
        _unpause();
    }

    /// @notice Any current holder may request to redeem (burn) tokens in
    ///         exchange for the real, previously-liened shares.
    function requestRedemption(uint256 amount) external nonReentrant whenNotPaused returns (uint256 redemptionId) {
        require(amount > 0, "zero amount");
        require(balanceOf(msg.sender) >= amount, "insufficient balance");

        _burn(msg.sender, amount);
        redemptionCount += 1;
        redemptionId = redemptionCount;
        redemptions[redemptionId] = Redemption({
            holder: msg.sender,
            amount: amount,
            executed: false,
            note: ""
        });
        emit RedemptionRequested(redemptionId, msg.sender, amount);
    }

    /// @notice Compliance confirms the real-world share transfer has been
    ///         completed for a given redemption request. This is the on-chain
    ///         audit trail entry, not itself a share transfer mechanism.
    function executeRedemption(uint256 redemptionId, string calldata note) external onlyRole(COMPLIANCE_ROLE) {
        Redemption storage r = redemptions[redemptionId];
        require(r.holder != address(0), "unknown redemption");
        require(!r.executed, "already executed");
        r.executed = true;
        r.note = note;
        emit RedemptionExecuted(redemptionId, r.holder, r.amount, note);
    }

    /// @dev Enforce KYC eligibility on every transfer, mint, and burn leg.
    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (from != address(0)) {
            require(identityRegistry.isEligible(from), "sender not KYC-eligible");
        }
        if (to != address(0)) {
            require(identityRegistry.isEligible(to), "recipient not KYC-eligible");
        }
        super._update(from, to, value);
    }
}

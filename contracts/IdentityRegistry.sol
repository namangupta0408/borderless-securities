// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title IdentityRegistry
/// @notice Whitelist of KYC-verified members. Every wallet that ever holds or
///         transfers a ShareLienToken must be registered and "eligible" here.
///         Assigns a unique human-readable member code (MEM-0001, MEM-0002, ...).
contract IdentityRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    struct Member {
        string code;
        string name;
        bool verified;
        bool frozen;
        uint256 registeredAt;
    }

    mapping(address => Member) public members;
    address[] public memberList;
    uint256 public memberCount;

    event MemberRegistered(address indexed wallet, string code, string name);
    event MemberFrozen(address indexed wallet, bool frozen);
    event MemberVerificationRevoked(address indexed wallet);
    event MemberReverified(address indexed wallet);

    constructor(address admin) {
        require(admin != address(0), "zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    /// @notice Register a new member and assign them a unique code.
    function registerMember(address wallet, string calldata name)
        external
        onlyRole(COMPLIANCE_ROLE)
        returns (string memory code)
    {
        require(wallet != address(0), "zero address");
        require(bytes(members[wallet].code).length == 0, "already registered");

        memberCount += 1;
        code = string(abi.encodePacked("MEM-", _pad4(memberCount)));
        members[wallet] = Member({
            code: code,
            name: name,
            verified: true,
            frozen: false,
            registeredAt: block.timestamp
        });
        memberList.push(wallet);
        emit MemberRegistered(wallet, code, name);
    }

    function setFrozen(address wallet, bool frozen) external onlyRole(COMPLIANCE_ROLE) {
        require(bytes(members[wallet].code).length != 0, "not registered");
        members[wallet].frozen = frozen;
        emit MemberFrozen(wallet, frozen);
    }

    function revokeVerification(address wallet) external onlyRole(COMPLIANCE_ROLE) {
        require(bytes(members[wallet].code).length != 0, "not registered");
        members[wallet].verified = false;
        emit MemberVerificationRevoked(wallet);
    }

    function reverify(address wallet) external onlyRole(COMPLIANCE_ROLE) {
        require(bytes(members[wallet].code).length != 0, "not registered");
        members[wallet].verified = true;
        emit MemberReverified(wallet);
    }

    /// @notice A wallet is eligible to send/receive lien tokens only if verified and not frozen.
    function isEligible(address wallet) external view returns (bool) {
        Member memory m = members[wallet];
        return m.verified && !m.frozen;
    }

    function getMemberCount() external view returns (uint256) {
        return memberList.length;
    }

    // ---- internal: zero-padded decimal string, e.g. 7 -> "0007" ----
    function _pad4(uint256 n) internal pure returns (string memory) {
        if (n < 10) return string(abi.encodePacked("000", _toString(n)));
        if (n < 100) return string(abi.encodePacked("00", _toString(n)));
        if (n < 1000) return string(abi.encodePacked("0", _toString(n)));
        return _toString(n);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

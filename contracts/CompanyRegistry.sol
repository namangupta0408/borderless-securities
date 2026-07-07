// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CompanyRegistry
/// @notice Tracks onboarded companies (Pillars 1 & 2: KYB + owner KYC) and,
///         critically, WHO currently holds voting rights over the company.
///         Voting rights default to the original owner and only move when
///         compliance confirms a full, real-world share transfer to a redeemer.
contract CompanyRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    struct Company {
        string code;                 // COMP-0001
        string name;
        string jurisdiction;
        address owner;               // original owner at onboarding
        bool kybVerified;             // Pillar 1
        bool ownerKycVerified;        // Pillar 2
        address votingRightsHolder;   // starts == owner, moves on redemption
        bool exists;
    }

    mapping(bytes32 => Company) private companies;
    string[] public companyCodes;
    uint256 public companyCount;

    event CompanyRegistered(string code, string name, address indexed owner);
    event PillarVerified(string code, string pillar);
    event VotingRightsTransferred(string code, address indexed from, address indexed to, string reason);

    constructor(address admin) {
        require(admin != address(0), "zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    function registerCompany(string calldata name, string calldata jurisdiction, address owner)
        external
        onlyRole(COMPLIANCE_ROLE)
        returns (string memory code)
    {
        require(owner != address(0), "zero owner");
        companyCount += 1;
        code = string(abi.encodePacked("COMP-", _pad4(companyCount)));
        bytes32 key = keccak256(bytes(code));

        companies[key] = Company({
            code: code,
            name: name,
            jurisdiction: jurisdiction,
            owner: owner,
            kybVerified: false,
            ownerKycVerified: false,
            votingRightsHolder: owner,
            exists: true
        });
        companyCodes.push(code);
        emit CompanyRegistered(code, name, owner);
    }

    function verifyKYB(string calldata code) external onlyRole(COMPLIANCE_ROLE) {
        Company storage c = _get(code);
        c.kybVerified = true;
        emit PillarVerified(code, "KYB");
    }

    function verifyOwnerKYC(string calldata code) external onlyRole(COMPLIANCE_ROLE) {
        Company storage c = _get(code);
        c.ownerKycVerified = true;
        emit PillarVerified(code, "OwnerKYC");
    }

    /// @notice Called by compliance once a redemption has been executed and the
    ///         real-world shares have actually changed hands to the redeemer.
    function transferVotingRights(string calldata code, address newHolder, string calldata reason)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        Company storage c = _get(code);
        address old = c.votingRightsHolder;
        c.votingRightsHolder = newHolder;
        emit VotingRightsTransferred(code, old, newHolder, reason);
    }

    function isPillar12Verified(string calldata code) external view returns (bool) {
        Company memory c = companies[keccak256(bytes(code))];
        return c.exists && c.kybVerified && c.ownerKycVerified;
    }

    function getCompany(string calldata code) external view returns (Company memory) {
        Company memory c = companies[keccak256(bytes(code))];
        require(c.exists, "unknown company");
        return c;
    }

    function companyExists(string calldata code) external view returns (bool) {
        return companies[keccak256(bytes(code))].exists;
    }

    function getAllCompanyCodes() external view returns (string[] memory) {
        return companyCodes;
    }

    function _get(string calldata code) internal view returns (Company storage) {
        Company storage c = companies[keccak256(bytes(code))];
        require(c.exists, "unknown company");
        return c;
    }

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

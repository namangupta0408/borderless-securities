// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./ShareLienToken.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title TokenFactory
/// @notice Deploys a fresh, isolated ShareLienToken contract for every lien
///         issuance. Enforces that a given lien can never be tokenized twice
///         and keeps a registry of every token ever deployed.
contract TokenFactory is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    address public immutable identityRegistry;
    address[] public allTokens;
    mapping(string => address) public tokenByLienId;

    event TokenDeployed(string lienId, address indexed token, string companyCode, uint256 maxSupply);

    constructor(address admin, address identityRegistry_) {
        require(admin != address(0), "zero admin");
        require(identityRegistry_ != address(0), "zero registry");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        identityRegistry = identityRegistry_;
    }

    function deployLienToken(
        string calldata name_,
        string calldata symbol_,
        string calldata companyCode_,
        string calldata lienId_,
        uint256 maxSupply_,
        address tokenAdmin
    ) external onlyRole(COMPLIANCE_ROLE) returns (address tokenAddr) {
        require(tokenByLienId[lienId_] == address(0), "lien already tokenized");

        ShareLienToken t = new ShareLienToken(
            name_,
            symbol_,
            companyCode_,
            lienId_,
            maxSupply_,
            identityRegistry,
            tokenAdmin
        );
        tokenAddr = address(t);
        tokenByLienId[lienId_] = tokenAddr;
        allTokens.push(tokenAddr);
        emit TokenDeployed(lienId_, tokenAddr, companyCode_, maxSupply_);
    }

    function allTokensCount() external view returns (uint256) {
        return allTokens.length;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PositionToken — ERC-1155 outcome shares (§27).
/// @notice tokenId = keccak256(marketId, outcomeIndex). One share pays 1.00
///         USDC (1e6 units) if its outcome wins. Only the Exchange mints and
///         moves shares during settlement; only the CollateralVault burns at
///         claim time. Holders can also transfer freely (standard ERC-1155),
///         which keeps positions portable across wallets (§20).
contract PositionToken is ERC1155Supply, AccessControl {
    bytes32 public constant EXCHANGE_ROLE = keccak256("EXCHANGE_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    constructor(address admin) ERC1155("https://api.pickmaster.do/positions/{id}.json") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function positionId(bytes32 marketId, uint8 outcomeIndex) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(marketId, outcomeIndex)));
    }

    /// @notice MINT leg (§16): a matched YES buyer + NO buyer receive one full
    ///         set backed by 1.00 USDC locked in the vault.
    function mintPair(bytes32 marketId, address yesTo, address noTo, uint256 amount)
        external
        onlyRole(EXCHANGE_ROLE)
    {
        _mint(yesTo, positionId(marketId, 0), amount, "");
        _mint(noTo, positionId(marketId, 1), amount, "");
    }

    /// @notice TRANSFER leg (§16): shares change hands during a matched trade.
    function operatorTransfer(bytes32 marketId, uint8 outcomeIndex, address from, address to, uint256 amount)
        external
        onlyRole(EXCHANGE_ROLE)
    {
        _safeTransferFrom(from, to, positionId(marketId, outcomeIndex), amount, "");
    }

    /// @notice Burned by the vault when paying out (claim/void redemption).
    function burnFrom(bytes32 marketId, uint8 outcomeIndex, address from, uint256 amount)
        external
        onlyRole(VAULT_ROLE)
    {
        _burn(from, positionId(marketId, outcomeIndex), amount);
    }

    // ------------------------------------------------------------- overrides

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

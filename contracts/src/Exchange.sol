// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MarketRegistry} from "./MarketRegistry.sol";
import {PositionToken} from "./PositionToken.sol";
import {CollateralVault} from "./CollateralVault.sol";

/// @title Exchange — on-chain settlement of off-chain-matched EIP-712 orders (§16).
/// @notice Users sign structured orders with their own wallet (no custody of
///         private keys); the backend CLOB matches them and an OPERATOR_ROLE
///         relayer settles matches here in batches (§18, §43 MEV strategy:
///         off-chain matching + batched settlement + signed orders).
///
///         Two settlement legs, mirroring the Phase 1 matching engine:
///          - settleMint:     BUY YES @ p  ×  BUY NO @ (100-p) → full set
///                            minted, 1.00 USDC/share locked in the vault.
///          - settleTransfer: BUY o @ p    ×  SELL o @ p'≤p    → shares move,
///                            buyer pays seller.
///         Prices are integer cents in (0,100); one share pays 1.00 USDC.
///
///         Fees (§18): a single transparent feeBps on notional, charged to
///         each paying side, sent to the treasury. Never hidden — the client
///         shows "network fee + PickMaster fee = total" before signing (AC-005).
contract Exchange is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant UNIT = 1e6; // 1.00 USDC
    uint256 public constant PRICE_DENOM = 100; // prices are cents
    uint256 public constant CENT = UNIT / PRICE_DENOM; // 0.01 USDC
    uint16 public constant MAX_FEE_BPS = 100; // hard cap 1%

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,bytes32 marketId,uint8 outcomeIndex,bool isBuy,uint64 priceCents,uint128 quantity,uint64 expiry,uint256 salt)"
    );

    struct Order {
        address maker;
        bytes32 marketId;
        uint8 outcomeIndex; // 0 = YES, 1 = NO
        bool isBuy;
        uint64 priceCents; // limit price, integer in (0, 100)
        uint128 quantity; // shares
        uint64 expiry; // unix seconds
        uint256 salt;
    }

    IERC20 public immutable collateral;
    MarketRegistry public immutable registry;
    PositionToken public immutable positions;
    CollateralVault public immutable vault;
    address public immutable treasury;
    uint16 public feeBps;

    mapping(bytes32 => uint256) public filled; // order hash → filled shares
    mapping(bytes32 => bool) public cancelled;

    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event MintSettled(
        bytes32 indexed marketId, address yesBuyer, address noBuyer, uint64 yesPriceCents, uint128 quantity
    );
    event TransferSettled(
        bytes32 indexed marketId,
        uint8 outcomeIndex,
        address buyer,
        address seller,
        uint64 priceCents,
        uint128 quantity
    );
    event FeeCharged(bytes32 indexed marketId, address indexed payer, uint256 amount);

    error InvalidOrder(string reason);
    error BadSignature();
    error Overfill();

    constructor(
        address admin,
        IERC20 collateral_,
        MarketRegistry registry_,
        PositionToken positions_,
        CollateralVault vault_,
        address treasury_,
        uint16 feeBps_
    ) EIP712("PickMaster Exchange", "1") {
        require(feeBps_ <= MAX_FEE_BPS, "fee too high");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        collateral = collateral_;
        registry = registry_;
        positions = positions_;
        vault = vault_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ------------------------------------------------------------- orders

    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.maker,
                    order.marketId,
                    order.outcomeIndex,
                    order.isBuy,
                    order.priceCents,
                    order.quantity,
                    order.expiry,
                    order.salt
                )
            )
        );
    }

    function cancelOrder(Order calldata order) external {
        require(msg.sender == order.maker, "not maker");
        cancelled[hashOrder(order)] = true;
        emit OrderCancelled(hashOrder(order), order.maker);
    }

    function _validate(Order calldata order, bytes calldata signature, uint128 fillQty)
        private
        view
        returns (bytes32 orderHash)
    {
        orderHash = hashOrder(order);
        if (ECDSA.recover(orderHash, signature) != order.maker) revert BadSignature();
        if (cancelled[orderHash]) revert InvalidOrder("cancelled");
        if (block.timestamp > order.expiry) revert InvalidOrder("expired");
        if (order.priceCents == 0 || order.priceCents >= PRICE_DENOM) revert InvalidOrder("price");
        if (order.outcomeIndex >= 2) revert InvalidOrder("outcome");
        if (filled[orderHash] + fillQty > order.quantity) revert Overfill();
    }

    // ------------------------------------------------------------- settlement

    /// @notice Settle a MINT match: complementary buyers fund one full set.
    /// @param yesPriceCents execution price for the YES side; the NO side pays
    ///        the complement. Must respect both limits (price improvement goes
    ///        to the taker, decided off-chain by price-time priority).
    function settleMint(
        Order calldata buyYes,
        bytes calldata yesSig,
        Order calldata buyNo,
        bytes calldata noSig,
        uint128 quantity,
        uint64 yesPriceCents
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        registry.requireTradeable(buyYes.marketId);
        if (buyYes.marketId != buyNo.marketId) revert InvalidOrder("market mismatch");
        if (!buyYes.isBuy || !buyNo.isBuy) revert InvalidOrder("both must be buys");
        if (buyYes.outcomeIndex != 0 || buyNo.outcomeIndex != 1) revert InvalidOrder("outcome sides");
        if (buyYes.maker == buyNo.maker) revert InvalidOrder("self trade");
        if (yesPriceCents == 0 || yesPriceCents >= PRICE_DENOM) revert InvalidOrder("price");
        if (yesPriceCents > buyYes.priceCents) revert InvalidOrder("yes limit");
        if (PRICE_DENOM - yesPriceCents > buyNo.priceCents) revert InvalidOrder("no limit");

        bytes32 yesHash = _validate(buyYes, yesSig, quantity);
        bytes32 noHash = _validate(buyNo, noSig, quantity);
        filled[yesHash] += quantity;
        filled[noHash] += quantity;

        uint256 yesCost = uint256(quantity) * yesPriceCents * CENT;
        uint256 noCost = uint256(quantity) * (PRICE_DENOM - yesPriceCents) * CENT;

        // Lock 1.00 USDC per share in the vault, fees to treasury.
        collateral.safeTransferFrom(buyYes.maker, address(vault), yesCost);
        collateral.safeTransferFrom(buyNo.maker, address(vault), noCost);
        vault.recordLock(buyYes.marketId, yesCost + noCost);
        _chargeFee(buyYes.marketId, buyYes.maker, yesCost);
        _chargeFee(buyNo.marketId, buyNo.maker, noCost);

        positions.mintPair(buyYes.marketId, buyYes.maker, buyNo.maker, quantity);
        emit MintSettled(buyYes.marketId, buyYes.maker, buyNo.maker, yesPriceCents, quantity);
    }

    /// @notice Settle a TRANSFER match: existing shares change hands.
    function settleTransfer(
        Order calldata buy,
        bytes calldata buySig,
        Order calldata sell,
        bytes calldata sellSig,
        uint128 quantity,
        uint64 priceCents
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        registry.requireTradeable(buy.marketId);
        if (buy.marketId != sell.marketId) revert InvalidOrder("market mismatch");
        if (buy.outcomeIndex != sell.outcomeIndex) revert InvalidOrder("outcome mismatch");
        if (!buy.isBuy || sell.isBuy) revert InvalidOrder("sides");
        if (buy.maker == sell.maker) revert InvalidOrder("self trade");
        if (priceCents == 0 || priceCents >= PRICE_DENOM) revert InvalidOrder("price");
        if (priceCents > buy.priceCents || priceCents < sell.priceCents) revert InvalidOrder("limits");

        bytes32 buyHash = _validate(buy, buySig, quantity);
        bytes32 sellHash = _validate(sell, sellSig, quantity);
        filled[buyHash] += quantity;
        filled[sellHash] += quantity;

        uint256 notional = uint256(quantity) * priceCents * CENT;
        collateral.safeTransferFrom(buy.maker, sell.maker, notional);
        _chargeFee(buy.marketId, buy.maker, notional);
        _chargeFee(sell.marketId, sell.maker, notional);

        positions.operatorTransfer(buy.marketId, buy.outcomeIndex, sell.maker, buy.maker, quantity);
        emit TransferSettled(buy.marketId, buy.outcomeIndex, buy.maker, sell.maker, priceCents, quantity);
    }

    function _chargeFee(bytes32 marketId, address payer, uint256 notional) private {
        if (feeBps == 0) return;
        uint256 fee = (notional * feeBps) / 10_000;
        if (fee == 0) return;
        collateral.safeTransferFrom(payer, treasury, fee);
        emit FeeCharged(marketId, payer, fee);
    }

    // ------------------------------------------------------------- admin

    function setFeeBps(uint16 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= MAX_FEE_BPS, "fee too high");
        feeBps = newFeeBps;
    }
}

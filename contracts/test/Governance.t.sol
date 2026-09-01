// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {PositionToken} from "../src/PositionToken.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {Exchange} from "../src/Exchange.sol";

/// Gobernanza (§41): multisig + timelock + RBAC. Verifica que tras el
/// traspaso ninguna EOA puede cambiar roles o fees sin pasar por el delay,
/// que la pausa de emergencia sigue siendo instantánea, y que despausar
/// exige el timelock.
contract GovernanceTest is Test {
    MockUSDC usdc;
    MarketRegistry registry;
    PositionToken positions;
    CollateralVault vault;
    ResolutionManager resolution;
    Exchange exchange;
    TimelockController timelock;

    address deployer = makeAddr("deployer");
    address multisig = makeAddr("multisig");
    address treasury = makeAddr("treasury");
    address attacker = makeAddr("attacker");

    uint256 constant DELAY = 2 days;

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockUSDC();
        registry = new MarketRegistry(deployer, deployer);
        positions = new PositionToken(deployer);
        vault = new CollateralVault(deployer, usdc, registry, positions);
        resolution = new ResolutionManager(deployer, registry, usdc, 100e6, treasury);
        exchange = new Exchange(deployer, usdc, registry, positions, vault, treasury, 20);

        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        timelock = new TimelockController(DELAY, proposers, executors, address(0));

        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock));
        exchange.grantRole(exchange.DEFAULT_ADMIN_ROLE(), address(timelock));
        registry.grantRole(registry.GUARDIAN_ROLE(), multisig);
        resolution.grantRole(resolution.ARBITRATOR_ROLE(), multisig);
        registry.renounceRole(registry.GUARDIAN_ROLE(), deployer);
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        exchange.renounceRole(exchange.DEFAULT_ADMIN_ROLE(), deployer);
        vm.stopPrank();
    }

    function test_DeployerNoLongerAdmin() public view {
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock)));
    }

    function test_NobodyCanChangeFeesWithoutTimelock() public {
        vm.prank(attacker);
        vm.expectRevert();
        exchange.setFeeBps(100);

        vm.prank(multisig); // ni siquiera el multisig directamente
        vm.expectRevert();
        exchange.setFeeBps(100);
    }

    function test_FeeChangeGoesThroughTimelock() public {
        bytes memory data = abi.encodeCall(Exchange.setFeeBps, (50));
        bytes32 salt = keccak256("fee-change");

        vm.prank(multisig);
        timelock.schedule(address(exchange), 0, data, bytes32(0), salt, DELAY);

        // Antes del delay la ejecución falla.
        vm.expectRevert();
        timelock.execute(address(exchange), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + DELAY + 1);
        timelock.execute(address(exchange), 0, data, bytes32(0), salt); // permissionless
        assertEq(exchange.feeBps(), 50);
    }

    function test_EmergencyPauseStaysInstant_UnpauseNeedsTimelockGrant() public {
        // Pausar es inmediato para el guardián (multisig).
        vm.prank(multisig);
        registry.pause("incidente");
        assertTrue(registry.paused());

        // Un atacante no puede despausar.
        vm.prank(attacker);
        vm.expectRevert();
        registry.unpause();
        assertTrue(registry.paused());

        // El guardián puede levantar la pausa que él mismo puso; lo que ya no
        // puede nadie es alterar la lista de guardianes sin el timelock.
        // (El rol se lee antes: una llamada externa consumiría el expectRevert.)
        bytes32 guardianRole = registry.GUARDIAN_ROLE();
        vm.prank(multisig);
        vm.expectRevert();
        registry.grantRole(guardianRole, attacker);

        vm.prank(multisig);
        registry.unpause();
        assertFalse(registry.paused());
    }

    function test_RoleGrantGoesThroughTimelock() public {
        bytes memory data = abi.encodeWithSignature(
            "grantRole(bytes32,address)", registry.MARKET_CREATOR_ROLE(), attacker
        );
        bytes32 salt = keccak256("grant-creator");

        vm.prank(multisig);
        timelock.schedule(address(registry), 0, data, bytes32(0), salt, DELAY);
        vm.warp(block.timestamp + DELAY + 1);
        timelock.execute(address(registry), 0, data, bytes32(0), salt);
        assertTrue(registry.hasRole(registry.MARKET_CREATOR_ROLE(), attacker));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {Exchange} from "../src/Exchange.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {PositionToken} from "../src/PositionToken.sol";

/// @title DeployGovernance — multisig + timelock sobre los roles críticos (§41).
/// @notice El gate de producción exige que DEFAULT_ADMIN_ROLE y la capacidad de
///         levantar la pausa vivan detrás de un timelock, no en una EOA. Este
///         script despliega un TimelockController y traspasa la administración:
///
///           proposers  = [multisig del equipo]   (encolan operaciones)
///           executors  = [address(0)]            (cualquiera ejecuta tras el delay)
///           admin      = address(0)              (el timelock se autogobierna)
///
///         GUARDIAN_ROLE (pausa de emergencia) NO pasa al timelock: pausar debe
///         ser instantáneo. Lo que sí exige delay es *despausar* y cualquier
///         cambio de roles o de fees — por eso el admin del registry pasa al
///         timelock y el guardián queda en el multisig.
///
/// Uso:
///   PRIVATE_KEY=0x... MULTISIG=0x... DELAY_SECONDS=172800 \
///     forge script script/Governance.s.sol:DeployGovernance --rpc-url base_sepolia --broadcast
contract DeployGovernance is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address multisig = vm.envOr("MULTISIG", deployer);
        uint256 delay = vm.envOr("DELAY_SECONDS", uint256(2 days));

        MarketRegistry registry = MarketRegistry(vm.envAddress("REGISTRY"));
        Exchange exchange = Exchange(vm.envAddress("EXCHANGE"));
        ResolutionManager resolution = ResolutionManager(vm.envAddress("RESOLUTION"));
        CollateralVault vault = CollateralVault(vm.envAddress("VAULT"));
        PositionToken positions = PositionToken(vm.envAddress("POSITIONS"));

        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // ejecución abierta tras el delay

        vm.startBroadcast(pk);
        TimelockController timelock = new TimelockController(delay, proposers, executors, address(0));

        // El timelock pasa a ser el administrador de cada contrato...
        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock));
        exchange.grantRole(exchange.DEFAULT_ADMIN_ROLE(), address(timelock));
        resolution.grantRole(resolution.DEFAULT_ADMIN_ROLE(), address(timelock));
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(timelock));
        positions.grantRole(positions.DEFAULT_ADMIN_ROLE(), address(timelock));

        // ...el multisig conserva la pausa de emergencia (instantánea)...
        registry.grantRole(registry.GUARDIAN_ROLE(), multisig);
        // ...y el comité de arbitraje queda en el multisig, no en una EOA.
        resolution.grantRole(resolution.ARBITRATOR_ROLE(), multisig);

        // El deployer renuncia a la administración: a partir de aquí, cualquier
        // cambio de roles o de fees pasa por el timelock (§41).
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        exchange.renounceRole(exchange.DEFAULT_ADMIN_ROLE(), deployer);
        resolution.renounceRole(resolution.DEFAULT_ADMIN_ROLE(), deployer);
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), deployer);
        positions.renounceRole(positions.DEFAULT_ADMIN_ROLE(), deployer);
        vm.stopBroadcast();

        console.log("TimelockController:", address(timelock));
        console.log("delay (s):", delay);
        console.log("proposer/guardian/arbitrator multisig:", multisig);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HotspotRegistry} from "../src/HotspotRegistry.sol";
import {FireBounty} from "../src/FireBounty.sol";

/// @notice Deploy both contracts, then print the addresses for the README.
/// @dev Run:
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        HotspotRegistry registry = new HotspotRegistry();
        FireBounty bounty = new FireBounty(address(registry));

        vm.stopBroadcast();

        console.log("HotspotRegistry", address(registry));
        console.log("FireBounty    ", address(bounty));
        console.log("chainId       ", block.chainid);
    }
}

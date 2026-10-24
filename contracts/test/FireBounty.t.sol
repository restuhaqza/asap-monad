// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HotspotRegistry} from "../src/HotspotRegistry.sol";
import {FireBounty} from "../src/FireBounty.sol";

contract FireBountyTest is Test {
    HotspotRegistry registry;
    FireBounty bounty;

    address backer = address(0xBACA);
    address responder = address(0xD00D);
    address v1 = address(0xB0B);
    address v2 = address(0xCA71);

    // Hotspot near Pelalawan, Riau — the FRP 289 MW detection from the live FIRMS feed.
    int32 constant LAT = -1423340;
    int32 constant LON = 104082950;
    uint32 constant ACQ = 1_761_200_000;
    uint32 constant TTL = 6 hours;

    function setUp() public {
        registry = new HotspotRegistry();
        bounty = new FireBounty(address(registry));

        registry.setPublisher(address(this), true);
        bounty.setVerifier(v1, true);
        bounty.setVerifier(v2, true);

        HotspotRegistry.HotspotInput[] memory inputs = new HotspotRegistry.HotspotInput[](1);
        inputs[0] = HotspotRegistry.HotspotInput({
            latE6: LAT,
            lonE6: LON,
            frpDeci: 2896,
            acqTime: ACQ,
            confidence: 2
        });

        bytes32 batchId = registry.commitBatch(keccak256("firms-csv-bytes"), "https://firms.example/csv", 1);
        registry.publish(batchId, inputs);

        vm.warp(ACQ + 1 hours);
    }

    function _openBounty() internal returns (uint256 id) {
        vm.deal(backer, 10 ether);
        vm.prank(backer);
        id = bounty.openBounty{value: 1 ether}(1, TTL);
    }

    function testHappyPathPaysResponder() public {
        uint256 id = _openBounty();

        vm.deal(responder, 10 ether);
        vm.prank(responder);
        uint256 claimId = bounty.claim{value: 1 ether}(
            id, "ipfs://bafy-evidence", LAT + 1000, LON + 1000, ACQ + 30 minutes
        );

        vm.prank(v1);
        bounty.attest(claimId, true);
        vm.prank(v2);
        bounty.attest(claimId, true);

        FireBounty.Claim memory c = bounty.getClaim(claimId);
        FireBounty.Bounty memory b = bounty.getBounty(id);

        assertTrue(c.settled, "claim settled");
        assertEq(uint256(b.status), uint256(FireBounty.Status.Verified), "bounty verified");
        assertEq(b.pool, 0, "pool drained");
        assertEq(address(bounty).balance, 0, "contract holds nothing");
        // responder got pool + bond - 10% verifier reward = 1.9 ETH
        assertEq(responder.balance, 10 ether + 0.9 ether, "responder payout");
    }

    function testBondMustCoverPool() public {
        uint256 id = _openBounty();
        vm.deal(responder, 10 ether);

        vm.prank(responder);
        vm.expectRevert(abi.encodeWithSelector(FireBounty.BondTooSmall.selector, 1 ether));
        bounty.claim{value: 0.5 ether}(id, "ipfs://x", LAT, LON, ACQ + 1 minutes);
    }

    function testEvidenceMustBeInsideRadius() public {
        uint256 id = _openBounty();
        vm.deal(responder, 10 ether);

        // ~55 km away (0.5 degree of latitude)
        int32 farLat = LAT + 500_000;

        vm.prank(responder);
        vm.expectRevert(FireBounty.OutsideRadius.selector);
        bounty.claim{value: 1 ether}(id, "ipfs://x", farLat, LON, ACQ + 1 minutes);
    }

    function testEvidenceCannotPredateSatellitePass() public {
        uint256 id = _openBounty();
        vm.deal(responder, 10 ether);

        vm.prank(responder);
        vm.expectRevert(FireBounty.BadTimestamp.selector);
        bounty.claim{value: 1 ether}(id, "ipfs://x", LAT, LON, ACQ - 1 hours);
    }

    function testRejectionSlashesBondAndReopens() public {
        uint256 id = _openBounty();
        vm.deal(responder, 10 ether);
        vm.prank(responder);
        uint256 claimId = bounty.claim{value: 1 ether}(id, "ipfs://fake", LAT, LON, ACQ + 1 minutes);

        vm.prank(v1);
        bounty.attest(claimId, false);
        vm.prank(v2);
        bounty.attest(claimId, false);

        FireBounty.Bounty memory b = bounty.getBounty(id);
        assertEq(uint256(b.status), uint256(FireBounty.Status.Open), "bounty reopened");
        assertEq(b.pool, 1 ether, "pool untouched");
        assertTrue(bounty.getClaim(claimId).settled, "claim closed");
        // half the slashed bond went back to the backer, half to the two rejecters
        assertEq(backer.balance, 9 ether + 0.5 ether, "backer got half the bond");
        assertEq(address(bounty).balance, 1 ether, "only the pool remains");
    }

    function testExpireRefundsBackerWhenNobodyAnswers() public {
        uint256 id = _openBounty();

        vm.warp(ACQ + 1 hours + TTL + 1);

        bounty.expire(id);

        FireBounty.Bounty memory b = bounty.getBounty(id);
        assertEq(uint256(b.status), uint256(FireBounty.Status.Expired), "expired");
        assertEq(backer.balance, 10 ether, "backer refunded");
    }

    function testVerifierCannotAttestOwnClaim() public {
        uint256 id = _openBounty();
        vm.deal(v1, 10 ether);

        vm.prank(v1);
        uint256 claimId = bounty.claim{value: 1 ether}(id, "ipfs://x", LAT, LON, ACQ + 1 minutes);

        vm.prank(v1);
        vm.expectRevert(FireBounty.SelfAttest.selector);
        bounty.attest(claimId, true);
    }
}

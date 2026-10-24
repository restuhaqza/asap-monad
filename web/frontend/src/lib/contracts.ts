/**
 * Contract ABIs, transcribed from `contracts/src/HotspotRegistry.sol` and
 * `contracts/src/FireBounty.sol`. Kept as `parseAbi` output so viem types the
 * return values (`getHotspot` → named struct fields, `pool` → bigint).
 *
 * Note: there are deliberately no `event` entries — the app never calls
 * `eth_getLogs`; the public RPC caps it at 100 blocks and Multicall3 returned
 * inconsistent results, so state is read id by id in paced waves instead.
 */

import { parseAbi } from 'viem';

export const registryAbi = parseAbi([
  'function hotspotCount() view returns (uint256)',
  'function getHotspot(uint256 id) view returns ((int32 latE6, int32 lonE6, uint16 frpDeci, uint32 acqTime, uint8 confidence, bool exists, bytes32 batchId))',
]);

export const bountyAbi = parseAbi([
  'function bountyCount() view returns (uint256)',
  'function getBounty(uint256 bountyId) view returns ((uint256 hotspotId, address backer, uint96 pool, uint64 deadline, uint256 activeClaim, uint8 status))',
  'function getClaim(uint256 claimId) view returns ((uint256 bountyId, address responder, uint96 bond, int32 latE6, int32 lonE6, uint32 capturedAt, bytes32 evidenceHash, uint16 approvals, uint16 rejections, bool settled))',
  'function requiredBond(uint256 bountyId) view returns (uint256)',
  'function isVerifier(address who) view returns (bool)',
  'function openBounty(uint256 hotspotId, uint32 ttl) payable returns (uint256)',
  'function claim(uint256 bountyId, string evidenceCid, int32 latE6, int32 lonE6, uint32 capturedAt) payable returns (uint256)',
  'function attest(uint256 claimId, bool approve)',
]);

export type RegistryAbi = typeof registryAbi;
export type BountyAbi = typeof bountyAbi;

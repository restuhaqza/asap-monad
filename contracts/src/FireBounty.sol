// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHotspotRegistry {
    function exists(uint256 id) external view returns (bool);

    function getHotspot(uint256 id)
        external
        view
        returns (
            int32 latE6,
            int32 lonE6,
            uint16 frpDeci,
            uint32 acqTime,
            uint8 confidence,
            bool existsFlag,
            bytes32 batchId
        );
}

/// @title FireBounty
/// @notice Escrow + responder bonds + verifier quorum for satellite fire hotspots.
/// @dev Bounties are denominated in native MON. A responder must post a bond equal to the
///      bounty pool, so spamming fake evidence always costs more than it can earn.
contract FireBounty {
    enum Status {
        None,
        Open,
        Claimed,
        Verified,
        Expired
    }

    struct Bounty {
        uint256 hotspotId;
        address backer;
        uint96 pool;
        uint64 deadline;
        uint256 activeClaim;
        Status status;
    }

    struct Claim {
        uint256 bountyId;
        address responder;
        uint96 bond;
        int32 latE6;
        int32 lonE6;
        uint32 capturedAt;
        bytes32 evidenceHash; // keccak256 of the IPFS CID string
        uint16 approvals;
        uint16 rejections;
        bool settled;
    }

    uint16 private constant BPS = 10_000;
    uint32 public constant ATTESTATION_GRACE = 24 hours;
    uint32 public constant MAX_TTL = 24 hours;
    uint32 public constant CLOCK_SKEW = 5 minutes;

    IHotspotRegistry public immutable registry;
    address public owner;

    // --- tunable parameters (owner) ---
    uint16 public verifierQuorum = 2; // approvals needed to pay out
    uint16 public rejectQuorum = 2; // rejections needed to slash
    uint16 public verifierRewardBps = 1_000; // 10% of the pool goes to approvers
    uint16 public minBondBps = 10_000; // bond must be >= 100% of the pool
    uint32 public radiusMeters = 25_000; // evidence must be this close to the hotspot

    mapping(address => bool) public isVerifier;

    uint256 public bountyCount;
    uint256 public claimCount;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Claim) private _claims;
    mapping(uint256 => mapping(address => bool)) public hasVoted; // claimId => verifier
    mapping(uint256 => address[]) private _approvers;
    mapping(uint256 => address[]) private _rejecters;

    bool private _locked;

    event VerifierSet(address indexed verifier, bool allowed);
    event ParamsUpdated(uint16 verifierQuorum, uint16 rejectQuorum, uint16 verifierRewardBps, uint32 radiusMeters);

    event BountyOpened(
        uint256 indexed bountyId,
        uint256 indexed hotspotId,
        address indexed backer,
        uint96 pool,
        uint64 deadline
    );
    event BountyFunded(uint256 indexed bountyId, address indexed funder, uint96 amount, uint96 pool);

    event ClaimSubmitted(
        uint256 indexed claimId,
        uint256 indexed bountyId,
        address indexed responder,
        string evidenceCid,
        int32 latE6,
        int32 lonE6,
        uint32 capturedAt,
        uint96 bond
    );
    event ClaimAttested(uint256 indexed claimId, address indexed verifier, bool approve);
    event ClaimVerified(uint256 indexed claimId, address indexed responder, uint256 payout, uint256 verifierReward);
    event ClaimRejected(uint256 indexed claimId, address indexed responder, uint96 slashed);
    event BountyExpired(uint256 indexed bountyId, uint256 indexed hotspotId, uint96 refunded);

    error NotOwner();
    error NotVerifier();
    error UnknownBounty();
    error UnknownClaim();
    error UnknownHotspot();
    error WrongStatus();
    error PastDeadline();
    error BadTtl();
    error NoValue();
    error BondTooSmall(uint256 required);
    error OutsideRadius();
    error BadTimestamp();
    error AlreadyVoted();
    error SelfAttest();
    error AlreadySettled();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address registry_) {
        registry = IHotspotRegistry(registry_);
        owner = msg.sender;
        isVerifier[msg.sender] = true;
        emit VerifierSet(msg.sender, true);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setVerifier(address verifier, bool allowed) external onlyOwner {
        isVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    function setParams(
        uint16 verifierQuorum_,
        uint16 rejectQuorum_,
        uint16 verifierRewardBps_,
        uint32 radiusMeters_
    ) external onlyOwner {
        require(verifierQuorum_ > 0 && rejectQuorum_ > 0, "quorum=0");
        require(verifierRewardBps_ <= 3_000, "reward too high");
        verifierQuorum = verifierQuorum_;
        rejectQuorum = rejectQuorum_;
        verifierRewardBps = verifierRewardBps_;
        radiusMeters = radiusMeters_;
        emit ParamsUpdated(verifierQuorum_, rejectQuorum_, verifierRewardBps_, radiusMeters_);
    }

    function setMinBondBps(uint16 bps) external onlyOwner {
        require(bps >= BPS, "bond < pool");
        minBondBps = bps;
    }

    // ---------------------------------------------------------------------
    // Bounties
    // ---------------------------------------------------------------------

    /// @notice Open a bounty for a registered hotspot. Anyone with skin in the game can fund it:
    ///         a concession holder, a carbon project, a CSR budget, or a BPBD.
    function openBounty(uint256 hotspotId, uint32 ttl) external payable returns (uint256 bountyId) {
        if (!registry.exists(hotspotId)) revert UnknownHotspot();
        if (msg.value == 0) revert NoValue();
        if (ttl == 0 || ttl > MAX_TTL) revert BadTtl();

        unchecked {
            bountyId = ++bountyCount;
        }

        _bounties[bountyId] = Bounty({
            hotspotId: hotspotId,
            backer: msg.sender,
            pool: uint96(msg.value),
            deadline: uint64(block.timestamp + ttl),
            activeClaim: 0,
            status: Status.Open
        });

        emit BountyOpened(bountyId, hotspotId, msg.sender, uint96(msg.value), uint64(block.timestamp + ttl));
    }

    /// @notice Top up an existing open bounty.
    function fund(uint256 bountyId) external payable {
        Bounty storage b = _bounties[bountyId];
        if (b.status == Status.None) revert UnknownBounty();
        if (b.status != Status.Open) revert WrongStatus();
        if (msg.value == 0) revert NoValue();

        b.pool += uint96(msg.value);
        emit BountyFunded(bountyId, msg.sender, uint96(msg.value), b.pool);
    }

    // ---------------------------------------------------------------------
    // Response
    // ---------------------------------------------------------------------

    /// @notice Submit geotagged evidence for a hotspot. Requires a bond >= the current pool.
    function claim(
        uint256 bountyId,
        string calldata evidenceCid,
        int32 latE6,
        int32 lonE6,
        uint32 capturedAt
    ) external payable returns (uint256 claimId) {
        Bounty storage b = _bounties[bountyId];
        if (b.status == Status.None) revert UnknownBounty();
        if (b.status != Status.Open) revert WrongStatus();
        if (block.timestamp > b.deadline) revert PastDeadline();

        uint256 required = (uint256(b.pool) * minBondBps) / BPS;
        if (msg.value < required) revert BondTooSmall(required);

        (int32 hLat, int32 hLon, , uint32 acqTime, , , ) = registry.getHotspot(b.hotspotId);

        // Evidence cannot predate the satellite pass, and cannot come from the future.
        if (capturedAt < acqTime || capturedAt > block.timestamp + CLOCK_SKEW) revert BadTimestamp();
        if (!_withinRadius(hLat, hLon, latE6, lonE6, radiusMeters)) revert OutsideRadius();

        unchecked {
            claimId = ++claimCount;
        }

        _claims[claimId] = Claim({
            bountyId: bountyId,
            responder: msg.sender,
            bond: uint96(msg.value),
            latE6: latE6,
            lonE6: lonE6,
            capturedAt: capturedAt,
            evidenceHash: keccak256(bytes(evidenceCid)),
            approvals: 0,
            rejections: 0,
            settled: false
        });

        b.activeClaim = claimId;
        b.status = Status.Claimed;

        emit ClaimSubmitted(claimId, bountyId, msg.sender, evidenceCid, latE6, lonE6, capturedAt, uint96(msg.value));
    }

    /// @notice Verifier attestation. Reaching the quorum settles the claim immediately.
    function attest(uint256 claimId, bool approve) external {
        if (!isVerifier[msg.sender]) revert NotVerifier();

        Claim storage c = _claims[claimId];
        if (c.bountyId == 0) revert UnknownClaim();
        if (c.settled) revert AlreadySettled();
        if (msg.sender == c.responder) revert SelfAttest();
        if (hasVoted[claimId][msg.sender]) revert AlreadyVoted();

        hasVoted[claimId][msg.sender] = true;
        emit ClaimAttested(claimId, msg.sender, approve);

        if (approve) {
            c.approvals += 1;
            _approvers[claimId].push(msg.sender);
            if (c.approvals >= verifierQuorum) _settleApproved(claimId);
        } else {
            c.rejections += 1;
            _rejecters[claimId].push(msg.sender);
            if (c.rejections >= rejectQuorum) _settleRejected(claimId);
        }
    }

    /// @notice Anyone can close a stuck bounty once its windows have elapsed.
    /// @dev This is the accountability feed: a BountyExpired event means nobody credible showed up.
    function expire(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounties[bountyId];
        if (b.status == Status.None) revert UnknownBounty();
        if (b.status == Status.Verified || b.status == Status.Expired) revert WrongStatus();

        if (b.status == Status.Open) {
            if (block.timestamp <= b.deadline) revert PastDeadline();
            b.status = Status.Expired;
            uint96 refundOpen = b.pool;
            b.pool = 0;
            _send(b.backer, refundOpen);
            emit BountyExpired(bountyId, b.hotspotId, refundOpen);
            return;
        }

        // status == Claimed: the verifiers never reached a quorum in time.
        if (block.timestamp <= uint256(b.deadline) + ATTESTATION_GRACE) revert PastDeadline();
        Claim storage c = _claims[b.activeClaim];
        c.settled = true;
        uint96 bondBack = c.bond;
        c.bond = 0;
        b.status = Status.Expired;
        uint96 refundClaimed = b.pool;
        b.pool = 0;

        _send(c.responder, bondBack); // do not punish the responder for verifier inaction
        _send(b.backer, refundClaimed);
        emit BountyExpired(bountyId, b.hotspotId, refundClaimed);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    function _settleApproved(uint256 claimId) private nonReentrant {
        Claim storage c = _claims[claimId];
        Bounty storage b = _bounties[c.bountyId];

        c.settled = true;
        b.status = Status.Verified;

        uint256 total = uint256(b.pool) + uint256(c.bond);
        uint256 verifierReward = (uint256(b.pool) * verifierRewardBps) / BPS;
        uint256 payout = total - verifierReward;

        b.pool = 0;
        c.bond = 0;

        _send(c.responder, payout);
        _splitEqually(_approvers[claimId], verifierReward);

        emit ClaimVerified(claimId, c.responder, payout, verifierReward);
    }

    function _settleRejected(uint256 claimId) private nonReentrant {
        Claim storage c = _claims[claimId];
        Bounty storage b = _bounties[c.bountyId];

        c.settled = true;
        uint96 slashed = c.bond;
        c.bond = 0;

        uint256 toBacker = uint256(slashed) / 2;
        uint256 toVerifiers = uint256(slashed) - toBacker;

        _send(b.backer, toBacker);
        _splitEqually(_rejecters[claimId], toVerifiers);

        // The bounty reopens so a real responder can still claim it before the deadline.
        if (block.timestamp <= b.deadline) {
            b.activeClaim = 0;
            b.status = Status.Open;
        } else {
            uint96 refund = b.pool;
            b.pool = 0;
            b.status = Status.Expired;
            _send(b.backer, refund);
            emit BountyExpired(c.bountyId, b.hotspotId, refund);
        }

        emit ClaimRejected(claimId, c.responder, slashed);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _bounties[bountyId];
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    function approversOf(uint256 claimId) external view returns (address[] memory) {
        return _approvers[claimId];
    }

    function rejectersOf(uint256 claimId) external view returns (address[] memory) {
        return _rejecters[claimId];
    }

    /// @notice Bond a responder must post to claim this bounty right now.
    function requiredBond(uint256 bountyId) external view returns (uint256) {
        return (uint256(_bounties[bountyId].pool) * minBondBps) / BPS;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Flat-earth radius check. Within 8 degrees of the equator cos(lat) >= 0.990,
    ///      so a degree box is within ~1% of a true circle. Fine for a 25 km response radius.
    function _withinRadius(int32 lat1, int32 lon1, int32 lat2, int32 lon2, uint32 radius) private pure returns (bool) {
        int256 dLat = int256(int64(lat1)) - int256(int64(lat2));
        int256 dLon = int256(int64(lon1)) - int256(int64(lon2));

        // 1e-6 degree of latitude ~= 0.11132 m  =>  microdeg * 111_320 / 1e6 = metres
        int256 mLat = (dLat * 111_320) / 1e6;
        int256 mLon = (dLon * 111_320) / 1e6;

        int256 r = int256(uint256(radius));
        return (mLat * mLat) + (mLon * mLon) <= (r * r);
    }

    function _splitEqually(address[] storage recipients, uint256 amount) private {
        uint256 n = recipients.length;
        if (n == 0 || amount == 0) return;
        uint256 share = amount / n;
        if (share == 0) return;
        for (uint256 i = 0; i < n; ) {
            _send(recipients[i], share);
            unchecked {
                ++i;
            }
        }
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

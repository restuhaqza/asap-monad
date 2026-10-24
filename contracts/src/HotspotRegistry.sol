// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HotspotRegistry
/// @notice Append-only, provenance-anchored record of satellite fire hotspots on Monad.
/// @dev Every batch is anchored to the keccak256 hash of the raw NASA FIRMS CSV it was parsed
///      from, so anyone can re-download that exact file and prove the on-chain record was not
///      tampered with. Coordinates are stored as micro-degrees (value * 1e6) to avoid floats.
contract HotspotRegistry {
    struct Hotspot {
        int32 latE6;        // latitude  * 1e6
        int32 lonE6;        // longitude * 1e6
        uint16 frpDeci;     // Fire Radiative Power (MW) * 10
        uint32 acqTime;     // satellite acquisition time, unix seconds
        uint8 confidence;   // 0 = low, 1 = nominal, 2 = high
        bool exists;
        bytes32 batchId;    // provenance anchor
    }

    struct HotspotInput {
        int32 latE6;
        int32 lonE6;
        uint16 frpDeci;
        uint32 acqTime;
        uint8 confidence;
    }

    address public owner;
    uint256 public hotspotCount;

    mapping(address => bool) public isPublisher;
    mapping(bytes32 => bool) public batchCommitted;
    mapping(uint256 => Hotspot) private _hotspots;
    mapping(bytes32 => bool) private _seen; // keccak(latE6, lonE6, acqTime) — dedupe

    event PublisherSet(address indexed publisher, bool allowed);

    event BatchCommitted(
        bytes32 indexed batchId,
        bytes32 fileHash,
        string fileUrl,
        uint32 declaredCount,
        uint32 publishedAt
    );

    event HotspotPublished(
        uint256 indexed id,
        int32 latE6,
        int32 lonE6,
        uint16 frpDeci,
        uint32 acqTime,
        uint8 confidence,
        bytes32 indexed batchId
    );

    error NotOwner();
    error NotPublisher();
    error BatchAlreadyCommitted();
    error UnknownBatch();
    error BadConfidence();
    error DuplicateHotspot();
    error EmptyBatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPublisher() {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        _;
    }

    constructor() {
        owner = msg.sender;
        isPublisher[msg.sender] = true;
        emit PublisherSet(msg.sender, true);
    }

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    /// @notice Anchor a satellite data batch before publishing its parsed rows.
    /// @param fileHash keccak256 of the raw source file (e.g. the FIRMS CSV bytes)
    /// @param fileUrl  public URL of that exact file, so anyone can verify it
    /// @param count    number of rows the publisher intends to write
    function commitBatch(bytes32 fileHash, string calldata fileUrl, uint32 count)
        external
        onlyPublisher
        returns (bytes32 batchId)
    {
        batchId = keccak256(abi.encode(fileHash, count));
        if (batchCommitted[batchId]) revert BatchAlreadyCommitted();
        batchCommitted[batchId] = true;
        emit BatchCommitted(batchId, fileHash, fileUrl, count, uint32(block.timestamp));
    }

    /// @notice Publish parsed hotspots for a committed batch.
    /// @dev Keep batches to ~200 rows per transaction. Each hotspot occupies two storage slots
    ///      (packed metadata + batchId), so a 400-row tx costs roughly double the gas and gains
    ///      nothing except one fewer signature.
    function publish(bytes32 batchId, HotspotInput[] calldata inputs) external onlyPublisher {
        if (!batchCommitted[batchId]) revert UnknownBatch();
        if (inputs.length == 0) revert EmptyBatch();

        uint256 len = inputs.length;
        for (uint256 i = 0; i < len; ) {
            HotspotInput calldata h = inputs[i];
            if (h.confidence > 2) revert BadConfidence();

            bytes32 key = keccak256(abi.encode(h.latE6, h.lonE6, h.acqTime));
            if (_seen[key]) revert DuplicateHotspot();
            _seen[key] = true;

            unchecked {
                ++hotspotCount;
            }
            uint256 id = hotspotCount;

            _hotspots[id] = Hotspot({
                latE6: h.latE6,
                lonE6: h.lonE6,
                frpDeci: h.frpDeci,
                acqTime: h.acqTime,
                confidence: h.confidence,
                exists: true,
                batchId: batchId
            });

            emit HotspotPublished(id, h.latE6, h.lonE6, h.frpDeci, h.acqTime, h.confidence, batchId);

            unchecked {
                ++i;
            }
        }
    }

    function getHotspot(uint256 id)
        external
        view
        returns (Hotspot memory)
    {
        return _hotspots[id];
    }

    function exists(uint256 id) external view returns (bool) {
        return _hotspots[id].exists;
    }
}

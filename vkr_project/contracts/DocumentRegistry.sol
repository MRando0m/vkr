// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title VCRegistry
 * @notice On-chain registry for W3C Verifiable Credentials 2.0.
 *
 * Stores ONLY:
 *   1. Trusted issuer addresses (issuer registry).
 *   2. Revocation status keyed by credentialId.
 *   3. One active credentialId per holder (one DID = one document).
 *
 * No personal data (PII) is stored on-chain.
 *
 * credentialId is computed off-chain as:
 *   keccak256(abi.encodePacked(issuerAddress, holderAddress, fileHash))
 * where fileHash is the SHA-256 hash of the PDF document (bytes32).
 *
 * DID method: did:pkh:eip155:11155111:<address>
 * VC proof format: EcdsaSecp256k1RecoverySignature2020
 * VC payload is stored locally by the holder only.
 */
contract VCRegistry {

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Whether an address is a trusted credential issuer.
    mapping(address => bool) public isIssuer;

    /// @notice credentialId → address of the issuer who registered it.
    ///         Zero address means the credential has never been registered.
    mapping(bytes32 => address) public credentialIssuer;

    /// @notice credentialId → revocation flag.
    mapping(bytes32 => bool) public isRevoked;

    /// @notice holder address → credentialId of their current/last credential.
    ///         Enforces one DID = one document.
    ///         Re-issue is allowed only after the previous credential is revoked.
    mapping(address => bytes32) public holderCredential;

    // ── Events ────────────────────────────────────────────────────────────

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);

    /// @notice Emitted when an issuer anchors a new credential on-chain.
    ///         No personal data is included.
    event CredentialRegistered(
        bytes32 indexed credentialId,
        address indexed issuer,
        address indexed holder
    );

    /// @notice Emitted when an issuer revokes a credential.
    event CredentialRevoked(
        bytes32 indexed credentialId,
        address indexed revokedBy,
        uint256 timestamp
    );

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyIssuer() {
        require(isIssuer[msg.sender], "Not issuer");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address[] memory _initialIssuers) {
        owner = msg.sender;
        for (uint256 i = 0; i < _initialIssuers.length; i++) {
            isIssuer[_initialIssuers[i]] = true;
            emit IssuerAdded(_initialIssuers[i]);
        }
    }

    // ── Issuer management ─────────────────────────────────────────────────

    /// @notice Add a trusted issuer. Only the contract owner can call this.
    function addIssuer(address _issuer) external onlyOwner {
        require(_issuer != address(0), "Invalid address");
        require(!isIssuer[_issuer], "Already issuer");
        isIssuer[_issuer] = true;
        emit IssuerAdded(_issuer);
    }

    /// @notice Remove a trusted issuer. Only the contract owner can call this.
    function removeIssuer(address _issuer) external onlyOwner {
        require(isIssuer[_issuer], "Not an issuer");
        isIssuer[_issuer] = false;
        emit IssuerRemoved(_issuer);
    }

    // ── Credential registration ───────────────────────────────────────────

    /**
     * @notice Anchor a new credential on-chain.
     *         The VC itself is stored off-chain by the holder.
     *         Called by the issuer after signing the VC off-chain.
     *
     * @param credentialId  keccak256(abi.encodePacked(issuer, holder, fileHash))
     * @param holder        Ethereum address of the credential holder (student).
     */
    function registerCredential(bytes32 credentialId, address holder)
        external
        onlyIssuer
    {
        require(credentialId != bytes32(0), "Invalid credentialId");
        require(holder != address(0), "Invalid holder");
        require(
            credentialIssuer[credentialId] == address(0),
            "Credential already registered"
        );

        // One DID = one document.
        // Re-issue is allowed only after the previous credential is revoked.
        bytes32 existing = holderCredential[holder];
        require(
            existing == bytes32(0) || isRevoked[existing],
            "Holder already has active credential"
        );

        credentialIssuer[credentialId] = msg.sender;
        holderCredential[holder] = credentialId;

        emit CredentialRegistered(credentialId, msg.sender, holder);
    }

    // ── Revocation ────────────────────────────────────────────────────────

    /**
     * @notice Revoke a credential.
     *
     * Normal path  — called by the issuer who originally registered the credential.
     * Emergency path — called by owner when the issuer key is compromised or
     *                  removed, unlocking the holder for re-issuance (fixes lockout).
     *
     * @param credentialId  The credential to revoke.
     */
    function revokeCredential(bytes32 credentialId) external {
        require(
            isIssuer[msg.sender] || msg.sender == owner,
            "Not issuer or owner"
        );
        require(
            credentialIssuer[credentialId] != address(0),
            "Credential not found"
        );
        // Owner can revoke any credential; issuers only their own.
        if (msg.sender != owner) {
            require(
                credentialIssuer[credentialId] == msg.sender,
                "Not the issuer of this credential"
            );
        }
        require(!isRevoked[credentialId], "Already revoked");

        isRevoked[credentialId] = true;
        emit CredentialRevoked(credentialId, msg.sender, block.timestamp);
    }

    // ── View helpers ──────────────────────────────────────────────────────

    /**
     * @notice Check whether a credential has been revoked.
     * @return True if revoked, false otherwise.
     */
    function checkRevocation(bytes32 credentialId)
        external
        view
        returns (bool)
    {
        return isRevoked[credentialId];
    }
}

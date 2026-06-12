/**
 * VCUtils — base helpers for the VC 2.0 layer.
 *
 * Exposes: window.VCUtils
 *
 * Dependencies: ethers v6 (loaded via CDN before this script).
 */
(function (global) {
    'use strict';

    // ── DID helpers ───────────────────────────────────────────────────────────

    /**
     * Build a did:pkh DID for a Sepolia address.
     * Format: did:pkh:eip155:11155111:<address_lowercase>
     *
     * @param {string} address  Ethereum address
     * @returns {string}
     */
    function buildDID(address) {
        return 'did:pkh:eip155:11155111:' + address.toLowerCase();
    }

    /**
     * Extract the Ethereum address from a did:pkh:eip155:11155111:<address> DID.
     * Returns the address in lowercase.
     *
     * @param {string} did
     * @returns {string}  Lowercase Ethereum address, or '' on malformed input.
     */
    function extractAddressFromDID(did) {
        if (!did || typeof did !== 'string') return '';
        const parts = did.split(':');
        return parts[parts.length - 1].toLowerCase();
    }

    // ── File hashing ──────────────────────────────────────────────────────────

    /**
     * Compute SHA-256 of a File and return a 0x-prefixed bytes32 hex string.
     *
     * The result is directly usable as:
     *   - credentialSubject.fileHash in the VC
     *   - the fileHash argument to computeCredentialId()
     *   - a bytes32 value passed to Solidity via ethers.js
     *
     * @param {File} file
     * @returns {Promise<string>}  "0x" + 64 hex chars
     */
    async function computeFileHash(file) {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ── credentialId ──────────────────────────────────────────────────────────

    /**
     * Compute credentialId — mirrors VCRegistry.sol exactly:
     *   keccak256(abi.encodePacked(issuerAddress, holderAddress, fileHash))
     *
     * Both issuer and holder are Ethereum addresses (address type in Solidity).
     * fileHash is a 32-byte value (SHA-256 of the PDF).
     *
     * @param {string} issuerAddress   Ethereum address
     * @param {string} holderAddress   Ethereum address
     * @param {string} fileHashHex     "0x" + 64 hex chars  (SHA-256 of the PDF)
     * @returns {string}               "0x" + 64 hex chars  (bytes32)
     */
    function computeCredentialId(issuerAddress, holderAddress, fileHashHex) {
        return ethers.keccak256(
            ethers.solidityPacked(
                ['address', 'address', 'bytes32'],
                [issuerAddress, holderAddress, fileHashHex]
            )
        );
    }

    // ── Canonical serialization ───────────────────────────────────────────────

    /**
     * Recursively sort all object keys.
     * Arrays keep element order; only object keys are sorted.
     * Used to produce a deterministic representation for signing.
     *
     * @param {*} value
     * @returns {*}
     */
    function sortKeys(value) {
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(sortKeys);
        return Object.fromEntries(
            Object.keys(value).sort().map(k => [k, sortKeys(value[k])])
        );
    }

    /**
     * Return a canonical JSON string suitable for signing.
     * Keys are sorted at every nesting level; no extra whitespace.
     *
     * Both the signer (vc-issue.js) and the verifier (vc-verify.js) use this
     * function, so the signed bytes are always reproducible from the VC object.
     *
     * @param {object} obj
     * @returns {string}
     */
    function canonicalSerialize(obj) {
        return JSON.stringify(sortKeys(obj));
    }

    // ── Export ────────────────────────────────────────────────────────────────

    global.VCUtils = {
        buildDID,
        extractAddressFromDID,
        computeFileHash,
        computeCredentialId,
        sortKeys,
        canonicalSerialize,
    };

})(window);

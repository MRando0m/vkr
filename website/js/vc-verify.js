/**
 * VCVerify — verify a W3C Verifiable Credential 2.0.
 *
 * Exposes: window.VCVerify
 *
 * Dependencies:
 *   - window.VCUtils   (vc-utils.js, must be loaded first)
 *   - ethers v6        (CDN global)
 *
 * Checks (per CLAUDE.md verification rules):
 *   1. signature    — recover signer from proof.proofValue, compare to issuer DID address
 *   2. issuerTrusted — contract.isIssuer(issuerAddress) === true
 *   3. notRevoked   — contract.checkRevocation(vc.id) === false
 *   4. notExpired   — vc.validUntil > now  (if validUntil is set)
 *   5. fileHash     — SHA-256(pdfFile) === credentialSubject.fileHash
 *
 * Usage in Phase 4:
 *
 *   const vc  = await VCStorage.parseVCFile(vcJsonFile);
 *   const res = await VCVerify.verifyVC(vc, pdfFile, contract);
 *
 *   res.valid            // boolean — all 5 checks pass
 *   res.checks           // { signature, issuerTrusted, notRevoked, notExpired, fileHash }
 *   res.credentialId     // bytes32 hex (= vc.id)
 *   res.issuerAddress    // extracted from issuer DID
 *   res.holderAddress    // extracted from credentialSubject DID
 *   res.error            // string | null
 */
(function (global) {
    'use strict';

    // ── Main verification function ────────────────────────────────────────────

    /**
     * @typedef {object} VerifyResult
     * @property {boolean} valid
     * @property {{ signature: boolean, issuerTrusted: boolean, notRevoked: boolean,
     *              notExpired: boolean, fileHash: boolean }} checks
     * @property {string|null} credentialId
     * @property {string|null} issuerAddress
     * @property {string|null} holderAddress
     * @property {string|null} error      — first error encountered, or null
     */

    /**
     * Verify a Verifiable Credential 2.0.
     *
     * All five checks are run independently so the caller can see which ones
     * failed.  `result.valid` is true only when ALL checks pass.
     *
     * @param {object}  vc         Parsed VC object (with proof field)
     * @param {File}    pdfFile    The original PDF document
     * @param {object}  contract   ethers.Contract instance of VCRegistry (read-only OK)
     * @returns {Promise<VerifyResult>}
     */
    async function verifyVC(vc, pdfFile, contract) {
        var result = {
            valid: false,
            checks: {
                signature: false,
                issuerTrusted: false,
                notRevoked: false,
                notExpired: false,
                fileHash: false,
            },
            credentialId: null,
            issuerAddress: null,
            holderAddress: null,
            error: null,
        };

        try {
            // ── Structural guards ──────────────────────────────────────────────
            if (!vc || typeof vc !== 'object') {
                result.error = 'VC is not an object';
                return result;
            }
            if (!vc.proof || !vc.proof.proofValue) {
                result.error = 'VC proof or proofValue is missing';
                return result;
            }
            if (!vc.issuer || !vc.issuer.id) {
                result.error = 'VC issuer.id is missing';
                return result;
            }
            if (!vc.credentialSubject || !vc.credentialSubject.fileHash) {
                result.error = 'credentialSubject.fileHash is missing';
                return result;
            }
            if (!vc.id) {
                result.error = 'VC id (credentialId) is missing';
                return result;
            }

            var extractAddress = VCUtils.extractAddressFromDID;
            var computeFileHash = VCUtils.computeFileHash;
            var canonicalSerialize = VCUtils.canonicalSerialize;

            // ── Extract addresses ──────────────────────────────────────────────
            var issuerAddress = extractAddress(vc.issuer.id);
            var holderAddress = vc.credentialSubject.id
                ? extractAddress(vc.credentialSubject.id)
                : null;

            result.issuerAddress = issuerAddress;
            result.holderAddress = holderAddress;
            result.credentialId = vc.id;

            // ── 1. Signature ───────────────────────────────────────────────────
            // Re-produce the exact bytes that were signed:
            //   canonicalSerialize(vc without proof)
            // ethers.verifyMessage() undoes the MetaMask personal_sign prefix.
            var proof = vc.proof;
            var vcWithoutProof = Object.assign({}, vc);
            delete vcWithoutProof.proof;

            var message = canonicalSerialize(vcWithoutProof);

            try {
                var recovered = ethers.verifyMessage(message, proof.proofValue);
                result.checks.signature = (
                    recovered.toLowerCase() === issuerAddress.toLowerCase()
                );
            } catch (sigErr) {
                result.checks.signature = false;
                result.error = 'Signature recovery failed: ' + sigErr.message;
                // Hard stop — remaining checks are meaningless without a valid signature.
                return result;
            }

            // ── 2. Issuer trusted ──────────────────────────────────────────────
            try {
                result.checks.issuerTrusted = await contract.isIssuer(issuerAddress);
            } catch (e) {
                result.error = 'contract.isIssuer() failed: ' + e.message;
                return result;
            }

            // ── 3. Revocation ──────────────────────────────────────────────────
            // checkRevocation(credentialId) returns true if revoked.
            // vc.id holds the credentialId as a 0x-prefixed bytes32 hex string.
            try {
                var isRevoked = await contract.checkRevocation(vc.id);
                result.checks.notRevoked = !isRevoked;
            } catch (e) {
                result.error = 'contract.checkRevocation() failed: ' + e.message;
                return result;
            }

            // ── 4. Expiry ──────────────────────────────────────────────────────
            if (vc.validUntil) {
                result.checks.notExpired = (new Date(vc.validUntil) > new Date());
            } else {
                // No expiry date → credential is valid indefinitely.
                result.checks.notExpired = true;
            }

            // ── 5. File hash ───────────────────────────────────────────────────
            var computedHash = await computeFileHash(pdfFile);
            result.checks.fileHash = (
                computedHash.toLowerCase() === vc.credentialSubject.fileHash.toLowerCase()
            );

            // ── Overall result ─────────────────────────────────────────────────
            result.valid = Object.values(result.checks).every(Boolean);

        } catch (err) {
            result.error = err.message;
        }

        return result;
    }

    // ── Export ────────────────────────────────────────────────────────────────

    global.VCVerify = {
        verifyVC,
    };

})(window);

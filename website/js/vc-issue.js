/**
 * VCIssue — build and sign a W3C Verifiable Credential 2.0.
 *
 * Exposes: window.VCIssue
 *
 * Dependencies:
 *   - window.VCUtils   (vc-utils.js, must be loaded first)
 *   - ethers v6        (CDN global)
 *   - window.ethereum  (MetaMask)
 *
 * Usage in Phase 4:
 *
 *   const { vc, credentialId } = await VCIssue.issueVC({
 *       issuerAddress,
 *       holderAddress,
 *       fileHashHex,
 *       credentialSubject: { studentName, documentNumber, institution, issueDate, degree },
 *       validUntil,        // optional ISO-8601, defaults to +3 years
 *   });
 *
 *   // 1. Anchor on-chain:
 *   await contract.registerCredential(credentialId, holderAddress);
 *
 *   // 2. Deliver the VC file to the student:
 *   VCStorage.downloadVC(vc);
 *
 *   // 3. Optionally cache:
 *   await VCStorage.saveToIndexedDB(vc);
 */
(function (global) {
    'use strict';

    // W3C VC 2.0 base context + EcdsaSecp256k1RecoverySignature2020 context
    var CONTEXT = [
        'https://www.w3.org/ns/credentials/v2',
        'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
    ];

    // ── VC payload builder ────────────────────────────────────────────────────

    /**
     * Build a W3C VC 2.0 JSON-LD object without the proof field.
     *
     * Structure follows the VC Data Model 2.0 spec:
     *   https://www.w3.org/TR/vc-data-model-2.0/
     *
     * The vc.id field is set to the credentialId (bytes32 hex) so the on-chain
     * record links directly to this VC without storing any PII.
     *
     * @param {object} p
     * @param {string} p.credentialId   bytes32 hex (output of VCUtils.computeCredentialId)
     * @param {string} p.issuerAddress
     * @param {string} p.holderAddress
     * @param {string} p.fileHashHex    SHA-256 of the PDF, "0x" + 64 hex chars
     * @param {object} p.credentialSubject
     *   { studentName, documentNumber, institution, issueDate, degree? }
     * @param {string} p.validFrom      ISO-8601
     * @param {string} p.validUntil     ISO-8601
     * @returns {object}  VC JSON-LD (no proof)
     */
    function buildVCPayload(p) {
        var buildDID = VCUtils.buildDID;
        return {
            '@context': CONTEXT,
            'id': p.credentialId,
            'type': ['VerifiableCredential', 'DocumentCredential'],
            'issuer': {
                'id': buildDID(p.issuerAddress),
            },
            'validFrom': p.validFrom,
            'validUntil': p.validUntil,
            'credentialSubject': {
                'id': buildDID(p.holderAddress),
                'studentName': p.credentialSubject.studentName || '',
                'documentNumber': p.credentialSubject.documentNumber || '',
                'institution': p.credentialSubject.institution || '',
                'issueDate': p.credentialSubject.issueDate || '',
                'degree': p.credentialSubject.degree || '',
                'fileHash': p.fileHashHex,
            },
        };
    }

    // ── Signing ───────────────────────────────────────────────────────────────

    /**
     * Sign a VC payload with MetaMask using personal_sign.
     *
     * The signed message is the canonical (sorted-keys, compact) JSON of the
     * payload *without* the proof field.  MetaMask adds the standard Ethereum
     * prefix internally; ethers.verifyMessage() removes it on verification.
     *
     * Proof format: EcdsaSecp256k1RecoverySignature2020
     *
     * @param {object} vcPayload        VC object without proof
     * @param {string} issuerAddress
     * @returns {Promise<object>}       Complete VC with proof attached
     */
    async function signVC(vcPayload, issuerAddress) {
        var buildDID = VCUtils.buildDID;
        var canonicalSerialize = VCUtils.canonicalSerialize;

        var message = canonicalSerialize(vcPayload);

        // personal_sign: MetaMask prefixes "\x19Ethereum Signed Message:\n<len>"
        var signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, issuerAddress],
        });

        var proof = {
            'type': 'EcdsaSecp256k1RecoverySignature2020',
            'created': new Date().toISOString(),
            'verificationMethod': buildDID(issuerAddress) + '#blockchainAccountId',
            'proofPurpose': 'assertionMethod',
            'proofValue': signature,
        };

        // Spread payload, then add proof at the end so the key order is stable
        return Object.assign({}, vcPayload, { proof: proof });
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    /**
     * Issue a signed VC 2.0 for a student document.
     *
     * Does NOT touch the blockchain — that is the caller's responsibility.
     * Does NOT trigger the download — call VCStorage.downloadVC(vc) after.
     *
     * @param {object}  params
     * @param {string}  params.issuerAddress
     * @param {string}  params.holderAddress
     * @param {string}  params.fileHashHex       SHA-256 of PDF, "0x" + 64 hex chars
     * @param {object}  params.credentialSubject  { studentName, documentNumber,
     *                                              institution, issueDate, degree? }
     * @param {string}  [params.validUntil]       ISO-8601; default = now + 3 years
     * @returns {Promise<{ vc: object, credentialId: string }>}
     *    vc           — the complete signed VC (store + download this)
     *    credentialId — bytes32 hex; pass to contract.registerCredential()
     */
    async function issueVC(params) {
        var computeCredentialId = VCUtils.computeCredentialId;

        var credentialId = computeCredentialId(
            params.issuerAddress,
            params.holderAddress,
            params.fileHashHex
        );

        var validFrom = new Date().toISOString();
        var validUntil = params.validUntil ||
            new Date(Date.now() + 3 * 365.25 * 24 * 3600 * 1000).toISOString();

        var payload = buildVCPayload({
            credentialId: credentialId,
            issuerAddress: params.issuerAddress,
            holderAddress: params.holderAddress,
            fileHashHex: params.fileHashHex,
            credentialSubject: params.credentialSubject,
            validFrom: validFrom,
            validUntil: validUntil,
        });

        var vc = await signVC(payload, params.issuerAddress);

        return { vc: vc, credentialId: credentialId };
    }

    // ── Export ────────────────────────────────────────────────────────────────

    global.VCIssue = {
        buildVCPayload,
        signVC,
        issueVC,
    };

})(window);

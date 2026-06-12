import { expect } from "chai";
import { network } from "hardhat";

/**
 * Тесты контракта VCRegistry.
 *
 * credentialId вычисляется как:
 *   keccak256(abi.encodePacked(issuerAddress, holderAddress, fileHash))
 * Совпадает с вычислением в VC-слое на стороне браузера.
 */
describe("VCRegistry", function () {
    let registry, ethers;
    let owner, issuer1, issuer2, nonIssuer, holder;
    let credentialId;

    // Helper: build a credentialId the same way the contract expects.
    function buildCredentialId(issuer, holderAddr, fileHashHex) {
        return ethers.keccak256(
            ethers.solidityPacked(
                ["address", "address", "bytes32"],
                [issuer, holderAddr, fileHashHex]
            )
        );
    }

    beforeEach(async function () {
        ({ ethers } = await network.create());

        [owner, issuer1, issuer2, nonIssuer, holder] =
            await ethers.getSigners();

        const VCRegistry = await ethers.getContractFactory("VCRegistry");
        registry = await VCRegistry.deploy([issuer1.address]);
        await registry.waitForDeployment();

        // Base credential used across most tests.
        const fileHash = ethers.keccak256(
            ethers.toUtf8Bytes("test-document.pdf")
        );
        credentialId = buildCredentialId(
            issuer1.address,
            holder.address,
            fileHash
        );
    });

    // ─── Deployment ───────────────────────────────────────────────────────

    describe("Deployment", function () {
        it("sets the correct owner", async function () {
            expect(await registry.owner()).to.equal(owner.address);
        });

        it("registers initial issuers", async function () {
            expect(await registry.isIssuer(issuer1.address)).to.be.true;
        });

        it("non-initial address is not an issuer", async function () {
            expect(await registry.isIssuer(nonIssuer.address)).to.be.false;
        });

        it("does not expose string fields in its ABI (no PII on-chain)", async function () {
            // Any string input/output in the ABI would indicate potential PII storage.
            const iface = registry.interface;
            let hasStringField = false;

            for (const fragment of iface.fragments) {
                for (const input of fragment.inputs ?? []) {
                    if (input.type === "string") hasStringField = true;
                }
                for (const output of fragment.outputs ?? []) {
                    if (output.type === "string") hasStringField = true;
                }
            }

            expect(hasStringField).to.be.false;
        });
    });

    // ─── Issuer management ────────────────────────────────────────────────

    describe("Issuer management", function () {
        it("allows owner to add an issuer", async function () {
            await registry.addIssuer(issuer2.address);
            expect(await registry.isIssuer(issuer2.address)).to.be.true;
        });

        it("emits IssuerAdded event", async function () {
            await expect(registry.addIssuer(issuer2.address))
                .to.emit(registry, "IssuerAdded")
                .withArgs(issuer2.address);
        });

        it("reverts when non-owner tries to add issuer", async function () {
            await expect(
                registry.connect(issuer1).addIssuer(issuer2.address)
            ).to.be.revertedWith("Not owner");
        });

        it("reverts when adding zero address", async function () {
            await expect(
                registry.addIssuer(ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid address");
        });

        it("reverts when adding already registered issuer", async function () {
            await expect(
                registry.addIssuer(issuer1.address)
            ).to.be.revertedWith("Already issuer");
        });

        it("allows owner to remove an issuer", async function () {
            await registry.removeIssuer(issuer1.address);
            expect(await registry.isIssuer(issuer1.address)).to.be.false;
        });

        it("emits IssuerRemoved event", async function () {
            await expect(registry.removeIssuer(issuer1.address))
                .to.emit(registry, "IssuerRemoved")
                .withArgs(issuer1.address);
        });

        it("reverts when removing a non-issuer address", async function () {
            await expect(
                registry.removeIssuer(nonIssuer.address)
            ).to.be.revertedWith("Not an issuer");
        });

        it("removed issuer can no longer register credentials", async function () {
            await registry.removeIssuer(issuer1.address);
            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(credentialId, holder.address)
            ).to.be.revertedWith("Not issuer");
        });
    });

    // ─── Credential registration ──────────────────────────────────────────

    describe("Credential registration", function () {
        it("allows issuer to register a credential", async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);

            expect(
                await registry.credentialIssuer(credentialId)
            ).to.equal(issuer1.address);

            expect(
                await registry.holderCredential(holder.address)
            ).to.equal(credentialId);
        });

        it("emits CredentialRegistered event", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(credentialId, holder.address)
            )
                .to.emit(registry, "CredentialRegistered")
                .withArgs(credentialId, issuer1.address, holder.address);
        });

        it("reverts when non-issuer tries to register", async function () {
            await expect(
                registry
                    .connect(nonIssuer)
                    .registerCredential(credentialId, holder.address)
            ).to.be.revertedWith("Not issuer");
        });

        it("reverts when credentialId is zero", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(ethers.ZeroHash, holder.address)
            ).to.be.revertedWith("Invalid credentialId");
        });

        it("reverts when holder address is zero", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(credentialId, ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid holder");
        });

        it("reverts on duplicate credentialId", async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);

            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(credentialId, holder.address)
            ).to.be.revertedWith("Credential already registered");
        });

        // ── One DID = one document ─────────────────────────────────────────

        it("enforces one DID = one document (blocks second active credential)", async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);

            // Same holder, different file — new credentialId
            const fileHash2 = ethers.keccak256(
                ethers.toUtf8Bytes("another-document.pdf")
            );
            const credentialId2 = buildCredentialId(
                issuer1.address,
                holder.address,
                fileHash2
            );

            await expect(
                registry
                    .connect(issuer1)
                    .registerCredential(credentialId2, holder.address)
            ).to.be.revertedWith("Holder already has active credential");
        });

        it("allows re-registration for the same holder after revocation", async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);

            // Revoke the first credential.
            await registry.connect(issuer1).revokeCredential(credentialId);

            // Issue a renewed credential — must succeed without reverting.
            const fileHash2 = ethers.keccak256(
                ethers.toUtf8Bytes("renewed-document.pdf")
            );
            const credentialId2 = buildCredentialId(
                issuer1.address,
                holder.address,
                fileHash2
            );

            await registry
                .connect(issuer1)
                .registerCredential(credentialId2, holder.address);

            // holderCredential must now point to the renewed credential.
            expect(
                await registry.holderCredential(holder.address)
            ).to.equal(credentialId2);
        });
    });

    // ─── Revocation ───────────────────────────────────────────────────────

    describe("Revocation", function () {
        beforeEach(async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);
        });

        it("allows the issuing issuer to revoke their credential", async function () {
            await registry.connect(issuer1).revokeCredential(credentialId);

            expect(await registry.isRevoked(credentialId)).to.be.true;
            expect(await registry.checkRevocation(credentialId)).to.be.true;
        });

        it("emits CredentialRevoked event", async function () {
            await expect(
                registry.connect(issuer1).revokeCredential(credentialId)
            )
                .to.emit(registry, "CredentialRevoked")
                .withArgs(
                    credentialId,
                    issuer1.address,
                    (value) => typeof value === "bigint"
                );
        });

        it("reverts on double revocation", async function () {
            await registry.connect(issuer1).revokeCredential(credentialId);

            await expect(
                registry.connect(issuer1).revokeCredential(credentialId)
            ).to.be.revertedWith("Already revoked");
        });

        it("reverts when a non-issuer / non-owner tries to revoke (unauthorized)", async function () {
            await expect(
                registry.connect(nonIssuer).revokeCredential(credentialId)
            ).to.be.revertedWith("Not issuer or owner");
        });

        it("reverts when a different issuer tries to revoke (unauthorized)", async function () {
            await registry.addIssuer(issuer2.address);

            await expect(
                registry.connect(issuer2).revokeCredential(credentialId)
            ).to.be.revertedWith("Not the issuer of this credential");
        });

        it("reverts when credential does not exist", async function () {
            const fakeId = ethers.keccak256(
                ethers.toUtf8Bytes("nonexistent-credential")
            );

            await expect(
                registry.connect(issuer1).revokeCredential(fakeId)
            ).to.be.revertedWith("Credential not found");
        });

        it("checkRevocation returns false for an unrevoked credential", async function () {
            expect(await registry.checkRevocation(credentialId)).to.be.false;
        });
    });

    // ─── Owner emergency revoke ───────────────────────────────────────────

    describe("Owner emergency revoke", function () {
        beforeEach(async function () {
            // Register a credential issued by issuer1.
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);
        });

        it("owner can revoke any credential directly", async function () {
            // owner is NOT an issuer of this credential, but should still revoke.
            await registry.revokeCredential(credentialId);
            expect(await registry.isRevoked(credentialId)).to.be.true;
        });

        it("owner revoke emits CredentialRevoked with owner as revokedBy", async function () {
            await expect(registry.revokeCredential(credentialId))
                .to.emit(registry, "CredentialRevoked")
                .withArgs(
                    credentialId,
                    owner.address,
                    (v) => typeof v === "bigint"
                );
        });

        it("owner can revoke after issuer is removed (compromise scenario)", async function () {
            // Simulate compromise: remove the issuer.
            await registry.removeIssuer(issuer1.address);

            // Removed issuer can no longer revoke.
            await expect(
                registry.connect(issuer1).revokeCredential(credentialId)
            ).to.be.revertedWith("Not issuer or owner");

            // Owner can still revoke as emergency recovery.
            await registry.revokeCredential(credentialId);
            expect(await registry.isRevoked(credentialId)).to.be.true;
        });

        it("owner revoke unlocks holder for re-issuance (fixes lockout)", async function () {
            // Remove compromised issuer, then owner revokes the fraudulent credential.
            await registry.removeIssuer(issuer1.address);
            await registry.revokeCredential(credentialId);

            // Add a new trusted issuer.
            await registry.addIssuer(issuer2.address);

            // Holder can now receive a new legitimate credential.
            const fileHash2 = ethers.keccak256(
                ethers.toUtf8Bytes("legitimate-new-document.pdf")
            );
            const credentialId2 = buildCredentialId(
                issuer2.address,
                holder.address,
                fileHash2
            );

            await registry
                .connect(issuer2)
                .registerCredential(credentialId2, holder.address);

            expect(
                await registry.holderCredential(holder.address)
            ).to.equal(credentialId2);
        });

        it("double revoke by owner still reverts Already revoked", async function () {
            await registry.revokeCredential(credentialId);
            await expect(
                registry.revokeCredential(credentialId)
            ).to.be.revertedWith("Already revoked");
        });

        it("regular issuer still revokes their own credential normally", async function () {
            await registry.connect(issuer1).revokeCredential(credentialId);
            expect(await registry.isRevoked(credentialId)).to.be.true;
        });
    });

    // ─── Edge cases and invariants ────────────────────────────────────────────

    describe("Edge cases and invariants", function () {
        it("checkRevocation returns false for a credentialId that was never registered", async function () {
            const unknownId = ethers.keccak256(ethers.toUtf8Bytes("unknown-credential"));
            // Mapping default is false; must not revert.
            expect(await registry.checkRevocation(unknownId)).to.be.false;
        });

        it("owner who is not an issuer cannot call registerCredential", async function () {
            // owner deploys the contract but is not in the initial issuer list.
            await expect(
                registry.registerCredential(credentialId, holder.address)
            ).to.be.revertedWith("Not issuer");
        });

        it("credentialIssuer mapping retains the original issuer address after revocation", async function () {
            await registry
                .connect(issuer1)
                .registerCredential(credentialId, holder.address);

            await registry.connect(issuer1).revokeCredential(credentialId);

            // Historical record is not erased on revocation.
            expect(
                await registry.credentialIssuer(credentialId)
            ).to.equal(issuer1.address);
        });
    });
});

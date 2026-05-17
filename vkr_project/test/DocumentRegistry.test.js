import { expect } from "chai";
import { network } from "hardhat";

describe("DocumentRegistry", function () {
    let registry, ethers;
    let owner, issuer1, issuer2, nonIssuer;
    let docHash, metadata;

    beforeEach(async function () {
        ({ ethers } = await network.create());

        [owner, issuer1, issuer2, nonIssuer] = await ethers.getSigners();

        const DocumentRegistry = await ethers.getContractFactory("DocumentRegistry");
        registry = await DocumentRegistry.deploy([issuer1.address]);
        await registry.waitForDeployment();

        const docText = "test-doc";
        docHash = ethers.keccak256(ethers.toUtf8Bytes(docText));
        metadata = '{"studentName":"Test","docNumber":"123"}';
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await registry.owner())
                .to.equal(owner.address);
        });

        it("Should add initial issuers", async function () {
            expect(
                await registry.isIssuer(issuer1.address)
            ).to.be.true;
        });
    });

    describe("Issuer management (only owner)", function () {
        it("Should allow owner to add issuer", async function () {
            await registry.addIssuer(issuer2.address);

            expect(
                await registry.isIssuer(issuer2.address)
            ).to.be.true;
        });

        it("Should emit IssuerAdded event", async function () {
            await expect(
                registry.addIssuer(issuer2.address)
            )
                .to.emit(registry, "IssuerAdded")
                .withArgs(issuer2.address);
        });

        it("Should revert when non-owner tries to add issuer", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .addIssuer(issuer2.address)
            ).to.be.revertedWith(
                "Only contract owner can call this"
            );
        });

        it("Should allow owner to remove issuer", async function () {
            await registry.addIssuer(issuer2.address);

            await registry.removeIssuer(issuer2.address);

            expect(
                await registry.isIssuer(issuer2.address)
            ).to.be.false;
        });
    });

    describe("Register document", function () {
        it("Should allow issuer to register a document", async function () {
            await registry
                .connect(issuer1)
                .registerDocument(docHash, metadata);

            const doc =
                await registry.documents(docHash);

            expect(doc.issuer)
                .to.equal(issuer1.address);

            expect(doc.metadata)
                .to.equal(metadata);

            expect(doc.isActive)
                .to.be.true;

            expect(doc.timestamp)
                .to.be.gt(0);
        });

        it("Should emit DocumentRegistered event", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .registerDocument(docHash, metadata)
            )
                .to.emit(
                    registry,
                    "DocumentRegistered"
                )
                .withArgs(
                    docHash,
                    issuer1.address,
                    metadata,
                    (value) => typeof value === "bigint"
                );
        });

        it("Should revert if non-issuer tries to register", async function () {
            await expect(
                registry
                    .connect(nonIssuer)
                    .registerDocument(docHash, metadata)
            ).to.be.revertedWith(
                "Caller is not an issuer"
            );
        });

        it("Should revert if registering same hash twice", async function () {
            await registry
                .connect(issuer1)
                .registerDocument(docHash, metadata);

            await expect(
                registry
                    .connect(issuer1)
                    .registerDocument(docHash, "other")
            ).to.be.revertedWith(
                "Document already registered"
            );
        });

        it("Should revert if hash is zero", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .registerDocument(
                        ethers.ZeroHash,
                        metadata
                    )
            ).to.be.revertedWith(
                "Hash cannot be empty"
            );
        });
    });

    describe("Verify document", function () {
        beforeEach(async function () {
            await registry
                .connect(issuer1)
                .registerDocument(docHash, metadata);
        });

        it("Should return correct info for existing document", async function () {
            const result =
                await registry.verifyDocument(docHash);

            const [
                exists,
                issuer,
                returnedMetadata,
                timestamp,
                isActive,
            ] = result;

            expect(exists).to.be.true;

            expect(issuer)
                .to.equal(issuer1.address);

            expect(returnedMetadata)
                .to.equal(metadata);

            expect(isActive).to.be.true;
        });

        it("Should return false for non-existent document", async function () {
            const fakeHash = ethers.keccak256(
                ethers.toUtf8Bytes("fake")
            );

            const [exists] =
                await registry.verifyDocument(fakeHash);

            expect(exists).to.be.false;
        });
    });

    describe("Revoke document", function () {
        beforeEach(async function () {
            await registry
                .connect(issuer1)
                .registerDocument(docHash, metadata);
        });

        it("Should allow issuer to revoke own document", async function () {
            await registry
                .connect(issuer1)
                .revokeDocument(docHash);

            const doc =
                await registry.documents(docHash);

            expect(doc.isActive)
                .to.be.false;
        });

        it("Should emit DocumentRevoked event", async function () {
            await expect(
                registry
                    .connect(issuer1)
                    .revokeDocument(docHash)
            )
                .to.emit(
                    registry,
                    "DocumentRevoked"
                )
                .withArgs(
                    docHash,
                    issuer1.address,
                    (value) => typeof value === "bigint"
                );
        });

        it("Should revert if not issuer of that document", async function () {
            await registry.addIssuer(
                issuer2.address
            );

            await expect(
                registry
                    .connect(issuer2)
                    .revokeDocument(docHash)
            ).to.be.revertedWith(
                "Only the issuer can revoke this document"
            );
        });

        it("Should revert if document does not exist", async function () {
            const fakeHash = ethers.keccak256(
                ethers.toUtf8Bytes("none")
            );

            await expect(
                registry
                    .connect(issuer1)
                    .revokeDocument(fakeHash)
            ).to.be.revertedWith(
                "Document does not exist"
            );
        });

        it("Should revert if already revoked", async function () {
            await registry
                .connect(issuer1)
                .revokeDocument(docHash);

            await expect(
                registry
                    .connect(issuer1)
                    .revokeDocument(docHash)
            ).to.be.revertedWith(
                "Document already revoked"
            );
        });
    });
});
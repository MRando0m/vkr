import { network } from "hardhat";

async function main() {
    const { ethers } = await network.create("sepolia");

    const initialIssuers = [
        process.env.INITIAL_ISSUER || "0xF34b4C711A57eDbde2A066BbE1fdBCD36b1c457F",
    ];

    const VCRegistry = await ethers.getContractFactory("VCRegistry");

    const contract = await VCRegistry.deploy(initialIssuers);

    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();

    console.log("VCRegistry deployed to:", contractAddress);
    console.log("Owner:", await contract.owner());
    console.log("Initial issuers:");

    for (const addr of initialIssuers) {
        console.log(`  - ${addr} : ${await contract.isIssuer(addr)}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

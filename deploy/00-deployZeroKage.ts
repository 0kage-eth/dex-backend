import { HardhatRuntimeEnvironment } from "hardhat/types"
import { networkConfig } from "../helper-hardhat-config"

const deployZeroKage = async (hre: HardhatRuntimeEnvironment) => {
    const { ethers, network, deployments, getNamedAccounts } = hre

    const chainId = network.config.chainId

    const { log, deploy } = deployments
    const { deployer } = await getNamedAccounts()

    // deploy zerokage mock only when on local chain
    if (chainId && chainId === 31337) {
        log("Local connection detected...")
        log("Deploying Zero Kage Mock..")
        const txResponse = await deploy("ZeroKageMock", {
            from: deployer,
            args: [ethers.utils.parseEther("1000000")],
            log: true,
            waitConfirmations: networkConfig[chainId].blockConfirmations,
        })

        log("Zero Kage Mock deployed...")
    }
}

export default deployZeroKage

deployZeroKage.tags = ["all", "zKage"]

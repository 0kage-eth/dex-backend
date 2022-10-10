import { HardhatRuntimeEnvironment } from "hardhat/types"
import { GOERLI_ZEROKAGE_ADDRESS } from "../constants"
import { networkConfig, developmentChains, DEX_FEES } from "../helper-hardhat-config"
import { verify } from "../utils/verify"

const deployDEX = async (hre: HardhatRuntimeEnvironment) => {
    const { ethers, network, getNamedAccounts, deployments } = hre

    const { deployer } = await getNamedAccounts()

    const { log, deploy } = deployments
    const chainId = network.config.chainId
    const fees = ethers.utils.parseEther(DEX_FEES) // 0.03% is current Uniswap fees
    let zKageAddress = ""

    if (chainId) {
        if (chainId === 31337) {
            log("Detected local network")
            log("Getting zero kage mock contract token address")
            const zKageTokenContract = await ethers.getContract("ZeroKageMock")
            zKageAddress = zKageTokenContract.address
        } else {
            zKageAddress = GOERLI_ZEROKAGE_ADDRESS
        }

        log("deploying DEX contract...")
        const deployDEX = await deploy("DEX", {
            from: deployer,
            log: true,
            args: [zKageAddress, fees],
            waitConfirmations: networkConfig[chainId].blockConfirmations,
        })

        log("DEX deployed successfully")
        log("---------------------------")

        if (!developmentChains.includes(network.name)) {
            log("Verifying DEX contract")
            await verify(deployDEX.address, [zKageAddress, fees])
            log("---------------------------")
        }
    }
}

export default deployDEX

deployDEX.tags = ["all", "dex"]

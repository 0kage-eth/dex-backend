import { mine } from "@nomicfoundation/hardhat-network-helpers"
import { ethers } from "hardhat"

/**
 * @notice Function shifts blocks and sleeps for a specific duration. Note that sleep time is optional
 * @param numBlocks number of blocks to shift block chain (only applicable locally)
 * @param sleepMilliSeconds number of milli seconds to sleep
 */
export const moveBlocks = async (
  numBlocks: number,
  sleepMilliSeconds: number = 0
) => {
  console.log("Initializing moving blocks")
  for (let i = 0; i < numBlocks; i++) {
    await mine(1)
    // await network.provider.request({ method: "evm_mine", params: [] })
    sleepMilliSeconds > 0 && (await sleep(sleepMilliSeconds)) // sleeps for 0.5 seconds
  }

  console.log(`Moved ${numBlocks} blocks on chain`)
}

/**
 *
 * @param timeInMilliSeconds time in milli seconds - chain sleeps for such time. No new blocks are minted
 * @returns
 */
export const sleep = async (timeInMilliSeconds: number) => {
  console.log(`Sleeping for ${timeInMilliSeconds}`)
  return new Promise((resolve) => setTimeout(resolve, timeInMilliSeconds))
}

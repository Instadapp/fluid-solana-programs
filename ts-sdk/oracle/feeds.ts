const FEEDS = {
  // "SOL/USD": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", // 8 decimals Pyth
  // "WBTC/USD": "9gNX5vguzarZZPjTnE1hWze3s6UsZ7dsU3UnAmKPnMHG", // Pyth
  "ETH/USD": "42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC",
  "EUR/USD": "Fu76ChamBDjE8UuGLV6GP2AcPPSU6gjhkNhAyuoPm7ny", // 5 decimals
  // "EURC/USD": "HyBsZY1UiGttbQ3ppBmnFVss9rmDAEvEbtYxdfjNAqBZ", // 8 decimals
  "JUPSOL/SOL": "D7UqeBmCEmhGXGYfi2y9RfoCa7t1Xw5iZLBeYZ3sxFSe", // 8 decimals
  "JITOSOL/USD": "AxaxyeDT8JnWERSaTKvFXvPKkEdxnamKSqpWbsSjYg1g", // 8 decimals
  "SYRUPUSDC/USDC": "GWdwWDhYFUc8ZD6uCTtEAAwx97V1ZCsxPWGL7vhSha6w", // 8 decimals
  "JLP/USD": "2TTGSRSezqFzeLUH8JwRUbtN66XLLaymfYsWRTMjfiMw", // 8 decimals
  "BTC/USD": "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo", // 8 decimals
  "USDT/USD": "HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM", // 8 decimals
  "USDC/USD": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX", // 8 decimals
  "JUP/USD": "7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5", // 8 decimals
  "LBTC/USD": "HENev4WeM2VhJ2b9tFCQsWdHGU6fTvgW68MsvBeYpxYn", // 8 decimals
  "INF/SOL": "4MbCk4vH47K2gHee6nTg62KScpGu2bV3YDeTZtpQm3ro", // 8 decimals
  "PST/USD": "CBGwQddTeYn3KdvxGWtU95fqCcavzHK9XPFBLENDF5JR", // 8 decimals
  "WBTC/USD": "Cv4T27XbjVoKUYwP72NQQanvZeA7W4YF9L4EnYT9kx5o", // 8 decimals chainlink
  "EURC/USD": "6GAPXtBGkRY81eUPevQpyhmm6oyT7tdFnHHHLxvZ8SAT", // 8 decimals chainlink
  "SOL/USD": "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt", // 8 decimals chainlink
};

const STAKING_POOLS = {
  "JITOSOL/SOL": "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
  "MSOL/SOL": "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC",
  "FWDSOL/SOL": "2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa",
  "DFDVSOl/SOL": "pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP",
};

const SINGLE_POOLS = {
  "HELIUS/SOL": {
    stake: "BTST6Wy5XeDoM8UxSdGgqRkQXuae2i7jzF8CJpcr56v1",
    mint: "2k79y8CApbU9jAvWhLS2j6uRbaVjpLJTUzstBTho9vGq",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
  "JUPITER/SOL": {
    stake: "6Ff5x2bBDKXC3sdnMManfUjpKgtFSYTAGjfgEaW5CKrQ",
    mint: "98B1NMLYaNJQNxiQGr53vbjNFMNTYFmDqoCgj7qD9Vhm",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
  "NANSEN/SOL": {
    stake: "D41RqNXhP2fM9mV9gV2D8GzscQ2kTwqoNwAc7qZubDjQ",
    mint: "9yQLxEzusZ7QiZNafDNdzbEaTCPuJToGjMhLRJtZbgsd",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
  "EMERALD/SOL": {
    stake: "3hoeLpYL2bL91SrQHG8ciz3h6iMmZfkLx6j6P9TsZbWg",
    mint: "38ZUTefZnKSUJU3wxpUe3xpiw2j5WQPnmzSTNbS1JqLA",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
  "SHIFT/SOL": {
    stake: "38KWgsh4yRrnZuKzfPUYveUWHQMw8aFN5YwnReTcDQnX",
    mint: "C1KwBJZNwUaodUcP5kXqD52NCuZzThNAG2cw3vt5H6iE",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
  "KILN/SOL": {
    stake: "9cVM7z5AwmH1Dd5aatYyUoGaus8RtM2r3jf557NCtfGB",
    mint: "PhxXAYTkFZS23ZWvFcz6H6Uq4VnVBMa6hniiAyudjaW",
    stakeProgram: "Stake11111111111111111111111111111111111111",
  },
};

const JUPLEND_POOLS = {
  JUPUSD: {
    lending: "papYEgeG5uPE4niUWZhihUUzVVotJn1mAWbYo2UBSHi",
    reserve: "2tQE8jVR5ezDw3PDa21BNzfyQ14Ug5cTf6n3swJNjkod",
    reward_model: "E3U32h49TL9Qof3NeLja9qJxTrGYpY1o1NQPtrSLJjcc",
    f_token: "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",
  },
};

export const getFeeds = (key: string) => {
  return FEEDS[key];
};

export const getStakingPools = (key: string) => {
  return STAKING_POOLS[key];
};

export const getSinglePoolSources = (key: string) => {
  return SINGLE_POOLS[key];
};

export const getJupLendPools = (key: string) => {
  return JUPLEND_POOLS[key];
};

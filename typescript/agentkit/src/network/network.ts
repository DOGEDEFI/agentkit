import {
  Chain,
  mainnet,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  base,
  arbitrum,
  optimism,
  polygonMumbai,
  polygon,
} from "viem/chains";
import { defineChain } from "viem";
import * as chains from "viem/chains";

/**
 * Maps EVM chain IDs to Coinbase network IDs
 */
export const CHAIN_ID_TO_NETWORK_ID: Record<number, string> = {
  1: "ethereum-mainnet",
  11155111: "ethereum-sepolia",
  137: "polygon-mainnet",
  80001: "polygon-mumbai",
  8453: "base-mainnet",
  84532: "base-sepolia",
  42161: "arbitrum-mainnet",
  421614: "arbitrum-sepolia",
  10: "optimism-mainnet",
  11155420: "optimism-sepolia",
  6281971: "dogeos-testnet",
  4663: "robinhood-mainnet",
  5042: "arc-mainnet",
  5042002: "arc-testnet",
};

const dogeosTestnet = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: {
    name: "Doge",
    symbol: "DOGE",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.dogeos.com"],
    },
    public: {
      http: ["https://rpc.testnet.dogeos.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "DogeOS Explorer",
      url: "https://blockscout.testnet.dogeos.com",
    },
  },
});

const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
    },
    public: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.arc.io"],
    },
    public: {
      http: ["https://rpc.mainnet.arc.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.io",
    },
  },
});

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.io"],
    },
    public: {
      http: ["https://rpc.testnet.arc.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Testnet Explorer",
      url: "https://testnet.arcscan.app",
    },
  },
});

/**
 * Maps Coinbase network IDs to EVM chain IDs
 */
export const NETWORK_ID_TO_CHAIN_ID: Record<string, string> = Object.entries(
  CHAIN_ID_TO_NETWORK_ID,
).reduce(
  (acc, [chainId, networkId]) => {
    acc[networkId] = String(chainId);
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Maps Coinbase network IDs to Viem chain objects
 */
export const NETWORK_ID_TO_VIEM_CHAIN: Record<string, Chain> = {
  "ethereum-mainnet": mainnet,
  "ethereum-sepolia": sepolia,
  "polygon-mainnet": polygon,
  "polygon-mumbai": polygonMumbai,
  "base-mainnet": base,
  "base-sepolia": baseSepolia,
  "arbitrum-mainnet": arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  "optimism-mainnet": optimism,
  "optimism-sepolia": optimismSepolia,
  "dogeos-testnet": dogeosTestnet,
  "robinhood-mainnet": robinhoodMainnet,
  "arc-mainnet": arcMainnet,
  "arc-testnet": arcTestnet,
};

/**
 * Get a chain from the viem chains object
 *
 * @param id - The chain ID
 * @returns The chain
 */
export const getChain = (id: string): Chain => {
  const chainId = parseInt(id, 10);

  // Fast path: built-in Viem chain registry.
  const viemChain = Object.values(chains).find((chain) => chain.id === chainId);
  if (viemChain) return viemChain as Chain;

  // Fallback path: custom chains defined in this module (e.g. DogeOS).
  const networkId = CHAIN_ID_TO_NETWORK_ID[chainId];
  if (!networkId) return undefined as unknown as Chain;
  return NETWORK_ID_TO_VIEM_CHAIN[networkId] as Chain;
};

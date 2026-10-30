import { parseAbi } from "viem";

export const MUCHVEST_CHAIN_ID = 6281971;
export const MUCHVEST_FACTORY = "0x141672B2C2cd5E3a18E2b85558F8af3f85C5ea0c" as const;
export const MUCHVEST_EXPLORER = "https://dogeos-testnet.l2scan.co";
export const NATIVE_DOGE = "0x530000000000000000000000000000000000d09e";
export const FACTORY_ABI = parseAbi([
  "function createVesting(address token,address beneficiary,uint256 amount,uint64 start,uint64 duration,uint64 cliffDuration) returns (address wallet)",
  "function isVesting(address wallet) view returns (bool)",
  "function creatorVestingCount(address creator) view returns (uint256)",
  "function creatorVestingAt(address creator,uint256 index) view returns (address)",
  "function beneficiaryVestingCount(address beneficiary) view returns (uint256)",
  "function beneficiaryVestingAt(address beneficiary,uint256 index) view returns (address)",
  "event VestingCreated(address indexed wallet,address indexed creator,address indexed beneficiary,address token,uint256 amount,uint64 start,uint64 duration,uint64 cliffDuration)",
]);
export const VESTING_ABI = parseAbi([
  "function token() view returns (address)",
  "function beneficiary() view returns (address)",
  "function creator() view returns (address)",
  "function totalAllocation() view returns (uint256)",
  "function start() view returns (uint256)",
  "function duration() view returns (uint256)",
  "function cliff() view returns (uint256)",
  "function end() view returns (uint256)",
  "function released(address token) view returns (uint256)",
  "function claimable() view returns (uint256)",
  "function claim()",
]);
export const MUCHVEST_TERMS = [
  "DogeOS Chikyu testnet only. Native DOGE pays gas; native DOGE cannot be vested.",
  "Funding is irrevocable. The beneficiary, token, allocation and schedule cannot be changed.",
  "Vesting accrues from start; the cliff gates claims, so the accrued allocation unlocks at the cliff.",
  "Only standard fixed-balance ERC20 tokens are supported. Fee-on-transfer, rebasing and malicious tokens are unsupported.",
  "Extra deposits do not increase allocation and cannot be recovered. Do not transfer tokens directly to vesting wallets.",
];

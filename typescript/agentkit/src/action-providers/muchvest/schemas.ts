import { z } from "zod";
import { isAddress, zeroAddress } from "viem";

export const AddressSchema = z
  .string()
  .refine(
    value => isAddress(value) && value.toLowerCase() !== zeroAddress,
    "Expected a nonzero EVM address",
  );
const SecondsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ListPlansSchema = z
  .object({
    account: AddressSchema.optional().describe("Account to inspect; defaults to the caller wallet"),
    role: z.enum(["creator", "beneficiary"]).default("beneficiary"),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const GetPlanSchema = z
  .object({ wallet: AddressSchema.describe("Factory-registered vesting wallet") })
  .strict();
export const CreateVestingSchema = z
  .object({
    token: AddressSchema.describe("Standard ERC20 token contract; native DOGE is unsupported"),
    beneficiary: AddressSchema.describe("Immutable recipient; confirm this address with the user"),
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .max(256)
      .describe("Exact token units, e.g. '100.25'; never wei or scientific notation"),
    start: SecondsSchema.describe("Future start as Unix seconds"),
    duration: SecondsSchema.refine(value => value > 0, "Duration must be positive").describe(
      "Total vesting duration in seconds, including the cliff",
    ),
    cliffDuration: SecondsSchema.describe("Cliff seconds from start, no greater than duration"),
  })
  .strict();
export const ConfirmCreateSchema = CreateVestingSchema.extend({
  confirm: z
    .literal(true)
    .describe(
      "Set only after user confirms the exact token, amount, recipient, schedule and irrevocable terms",
    ),
});
export const ConfirmClaimSchema = GetPlanSchema.extend({
  confirm: z
    .literal(true)
    .describe(
      "Set only after user authorizes paying DOGE gas to release tokens to the fixed beneficiary",
    ),
});

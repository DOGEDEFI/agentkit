import { z } from "zod";
import {
  Address,
  encodeFunctionData,
  decodeFunctionResult,
  erc20Abi,
  getAddress,
  Hex,
  maxUint256,
  parseUnits,
  PublicClient,
} from "viem";
import { ActionProvider } from "../actionProvider";
import { CreateAction } from "../actionDecorator";
import { EvmWalletProvider } from "../../wallet-providers/evmWalletProvider";
import { Network } from "../../network";
import {
  AddressSchema,
  ConfirmClaimSchema,
  ConfirmCreateSchema,
  CreateVestingSchema,
  GetPlanSchema,
  ListPlansSchema,
} from "./schemas";
import {
  FACTORY_ABI,
  MUCHVEST_CHAIN_ID,
  MUCHVEST_EXPLORER,
  MUCHVEST_FACTORY,
  MUCHVEST_TERMS,
  NATIVE_DOGE,
  VESTING_ABI,
} from "./constants";

type Context = { client: PublicClient; account: Address; blockNumber: bigint; timestamp: bigint };
type PreparedTransaction = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string;
  purpose: string;
};

/**
 * Serializes exact blockchain integers without converting them to JavaScript numbers.
 *
 * @param value - The response data.
 * @returns JSON with bigint values represented by decimal strings.
 */
function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

/**
 * Direct ABI adapter for Much Vest's fixed deployment on DogeOS Chikyu testnet.
 */
export class MuchvestActionProvider extends ActionProvider<EvmWalletProvider> {
  /** Initializes the provider without credentials or private keys. */
  constructor() {
    super("muchvest", []);
  }

  /**
   * Reads the factory registry with bounded pagination, without fetching token metadata.
   *
   * @param walletProvider - Caller wallet provider.
   * @param input - Account, registry and bounded page.
   * @returns The page of vesting wallet addresses.
   */
  @CreateAction({
    name: "muchvest_list_plans",
    description:
      "List Much Vest registered vesting wallets on DogeOS testnet. Defaults to the caller's beneficiary registry. Offset pagination, maximum 50 addresses. Call muchvest_get_plan for details.",
    schema: ListPlansSchema,
  })
  async listPlans(
    walletProvider: EvmWalletProvider,
    input: z.input<typeof ListPlansSchema>,
  ): Promise<string> {
    const args = ListPlansSchema.parse(input);
    const context = await this.context(walletProvider);
    const account = getAddress(args.account ?? context.account);
    const count = await context.client.readContract({
      address: MUCHVEST_FACTORY,
      abi: FACTORY_ABI,
      functionName: args.role === "creator" ? "creatorVestingCount" : "beneficiaryVestingCount",
      args: [account],
      blockNumber: context.blockNumber,
    });
    const start = BigInt(args.offset);
    const length = Number(
      count > start
        ? count - start < BigInt(args.limit)
          ? count - start
          : BigInt(args.limit)
        : 0n,
    );
    const wallets: Address[] = [];
    for (let i = 0; i < length; i++) {
      wallets.push(
        await context.client.readContract({
          address: MUCHVEST_FACTORY,
          abi: FACTORY_ABI,
          functionName: args.role === "creator" ? "creatorVestingAt" : "beneficiaryVestingAt",
          args: [account, start + BigInt(i)],
          blockNumber: context.blockNumber,
        }),
      );
    }
    const nextOffset = start + BigInt(length);
    return json({
      chainId: MUCHVEST_CHAIN_ID,
      factory: MUCHVEST_FACTORY,
      blockNumber: context.blockNumber,
      account,
      role: args.role,
      total: count,
      wallets,
      nextOffset: nextOffset < count ? nextOffset : null,
    });
  }

  /**
   * Reads a registered plan at one block, retaining exact raw amounts.
   *
   * @param walletProvider - Caller wallet provider.
   * @param input - Vesting wallet.
   * @returns The immutable plan and current claimable amount.
   */
  @CreateAction({
    name: "muchvest_get_plan",
    description:
      "Read a registered Much Vest grant: fixed beneficiary, creator, token, raw allocation, released and claimable amounts, Unix-second start/cliff/end. Amounts are raw integer strings; no token symbol is treated as trusted text.",
    schema: GetPlanSchema,
  })
  async getPlan(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof GetPlanSchema>,
  ): Promise<string> {
    const args = GetPlanSchema.parse(input);
    const context = await this.context(walletProvider);
    return json({
      ...(await this.plan(context, getAddress(args.wallet))),
      chainId: MUCHVEST_CHAIN_ID,
      blockNumber: context.blockNumber,
      terms: MUCHVEST_TERMS,
    });
  }

  /**
   * Builds exact approvals and grant calldata without signing.
   *
   * @param walletProvider - Caller wallet provider.
   * @param input - Immutable grant terms.
   * @returns Ordered unsigned steps and simulation status.
   */
  @CreateAction({
    name: "muchvest_prepare_create",
    description:
      "Prepare an irrevocable Much Vest grant without signing. Reads token decimals, checks exact precision/balance/future schedule, and returns exact allowance reset/approval steps plus create calldata. An approval does not create the grant. The create simulation is deferred until allowance is exact. Show all immutable terms to the user.",
    schema: CreateVestingSchema,
  })
  async prepareCreate(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof CreateVestingSchema>,
  ): Promise<string> {
    const context = await this.context(walletProvider);
    return json(await this.prepare(context, CreateVestingSchema.parse(input)));
  }

  /**
   * Builds a claim only for a factory-registered plan.
   *
   * @param walletProvider - Caller wallet provider.
   * @param input - Vesting wallet.
   * @returns Simulated unsigned claim and fixed destination.
   */
  @CreateAction({
    name: "muchvest_prepare_claim",
    description:
      "Prepare and simulate a Much Vest claim without signing. Anyone may pay DOGE gas, but tokens always go to the plan's fixed beneficiary. Rejects unrelated wallets and zero-claim plans.",
    schema: GetPlanSchema,
  })
  async prepareClaim(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof GetPlanSchema>,
  ): Promise<string> {
    const context = await this.context(walletProvider);
    return json(
      await this.claimPreparation(context, getAddress(GetPlanSchema.parse(input).wallet)),
    );
  }

  /**
   * Sets the exact funding allowance as a separate user-authorized write.
   *
   * @param walletProvider - Caller-controlled execution wallet.
   * @param input - Full grant terms and explicit confirmation.
   * @returns Approval receipts, or a submitted transaction requiring reconciliation.
   */
  @CreateAction({
    name: "muchvest_approve_funding",
    description:
      "WRITE: approve exactly one proposed Much Vest allocation to the fixed factory, resetting an existing different allowance to zero first. Requires confirmed full grant terms. Does not create/fund the grant. Uses caller wallet, never a service key. Stop on submitted/unknown receipt and reconcile its hash before retrying.",
    schema: ConfirmCreateSchema,
  })
  async approveFunding(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof ConfirmCreateSchema>,
  ): Promise<string> {
    const { confirm: _confirm, ...args } = ConfirmCreateSchema.parse(input);
    const context = await this.context(walletProvider);
    const prepared = await this.prepare(context, args);
    const receipts: unknown[] = [];
    for (const transaction of prepared.transactions.slice(0, -1)) {
      const approvalSimulation = await context.client.call({
        account: context.account,
        to: transaction.to,
        data: transaction.data,
      });
      if (
        approvalSimulation.data &&
        approvalSimulation.data !== "0x" &&
        !decodeFunctionResult({
          abi: erc20Abi,
          functionName: "approve",
          data: approvalSimulation.data,
        })
      )
        throw new Error("ERC20 approval simulation returned false; transaction was not sent");
      const result = await this.submit(walletProvider, context, transaction);
      receipts.push(result);
      if (result.status !== "confirmed")
        return json({ status: result.status, receipts, grantCreated: false });
    }
    const allowance = await context.client.readContract({
      address: getAddress(args.token),
      abi: erc20Abi,
      functionName: "allowance",
      args: [context.account, MUCHVEST_FACTORY],
    });
    if (allowance !== BigInt(prepared.amountRaw))
      throw new Error("Allowance did not become the exact allocation; do not create the grant");
    return json({
      status: "approved",
      amountRaw: prepared.amountRaw,
      receipts,
      grantCreated: false,
      nextAction: "muchvest_create_vesting",
    });
  }

  /**
   * Creates and atomically funds a grant after separate exact approval.
   *
   * @param walletProvider - Caller-controlled execution wallet.
   * @param input - Confirmed immutable grant terms.
   * @returns Confirmed receipt or submitted hash for reconciliation.
   */
  @CreateAction({
    name: "muchvest_create_vesting",
    description:
      "WRITE: atomically create and fund an irrevocable Much Vest ERC20 grant. Requires exact pre-existing factory allowance; use muchvest_approve_funding separately. Simulates and rechecks caller/chain before sending. Beneficiary/schedule cannot be changed or revoked. Never retry a submitted/unknown transaction before checking its hash.",
    schema: ConfirmCreateSchema,
  })
  async createVesting(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof ConfirmCreateSchema>,
  ): Promise<string> {
    const { confirm: _confirm, ...args } = ConfirmCreateSchema.parse(input);
    const context = await this.context(walletProvider);
    const prepared = await this.prepare(context, args);
    if (prepared.transactions.length !== 1)
      throw new Error(
        "Exact allowance required; run muchvest_approve_funding, confirm its receipt, then retry creation",
      );
    const currentAllowance = await context.client.readContract({
      address: getAddress(args.token),
      abi: erc20Abi,
      functionName: "allowance",
      args: [context.account, MUCHVEST_FACTORY],
    });
    if (currentAllowance !== BigInt(prepared.amountRaw))
      throw new Error("Factory allowance changed during preparation; prepare again");
    return json(await this.submit(walletProvider, context, prepared.transactions[0]));
  }

  /**
   * Releases claimable tokens to the immutable beneficiary.
   *
   * @param walletProvider - Caller-controlled gas-paying wallet.
   * @param input - Registered plan and explicit authorization.
   * @returns Confirmed receipt or submitted hash for reconciliation.
   */
  @CreateAction({
    name: "muchvest_claim_vesting",
    description:
      "WRITE: claim a registered Much Vest grant using caller-paid DOGE gas. Tokens go only to the immutable beneficiary, which may be a different account. Requires confirmation, registration and a successful simulation. Stop on submitted/unknown receipt and reconcile its hash before retrying.",
    schema: ConfirmClaimSchema,
  })
  async claimVesting(
    walletProvider: EvmWalletProvider,
    input: z.infer<typeof ConfirmClaimSchema>,
  ): Promise<string> {
    const args = ConfirmClaimSchema.parse(input);
    const context = await this.context(walletProvider);
    const prepared = await this.claimPreparation(context, getAddress(args.wallet));
    return json({
      ...(await this.submit(walletProvider, context, prepared.transaction)),
      beneficiary: prepared.beneficiary,
    });
  }

  /**
   * Checks the exact supported chain.
   *
   * @param network - The wallet network.
   * @returns Whether the wallet is on DogeOS Chikyu testnet.
   */
  supportsNetwork(network: Network): boolean {
    return network.protocolFamily === "evm" && network.chainId === String(MUCHVEST_CHAIN_ID);
  }

  /**
   * Checks both wallet metadata and the connected RPC chain, then pins a read block.
   *
   * @param walletProvider - Caller wallet provider.
   * @returns Validated read context.
   */
  private async context(walletProvider: EvmWalletProvider): Promise<Context> {
    if (!this.supportsNetwork(walletProvider.getNetwork()))
      throw new Error("Much Vest supports DogeOS testnet chain 6281971 only");
    const client = walletProvider.getPublicClient();
    if ((await client.getChainId()) !== MUCHVEST_CHAIN_ID)
      throw new Error("RPC chain does not match DogeOS testnet");
    const account = getAddress(AddressSchema.parse(walletProvider.getAddress()));
    const block = await client.getBlock();
    if (block.number === null) throw new Error("RPC returned a pending block");
    const code = await client.getCode({ address: MUCHVEST_FACTORY, blockNumber: block.number });
    if (!code || code === "0x") throw new Error("Much Vest factory is not deployed on this RPC");
    return { client, account, blockNumber: block.number, timestamp: block.timestamp };
  }

  /**
   * Reads only factory-registered wallet contracts.
   *
   * @param context - Validated snapshot.
   * @param wallet - Vesting wallet address.
   * @returns Fixed plan fields and current raw balances.
   */
  private async plan(context: Context, wallet: Address) {
    const { client, blockNumber } = context;
    if (
      !(await client.readContract({
        address: MUCHVEST_FACTORY,
        abi: FACTORY_ABI,
        functionName: "isVesting",
        args: [wallet],
        blockNumber,
      }))
    )
      throw new Error("Wallet is not registered by the Much Vest factory");
    const [token, beneficiary, creator, totalAllocation, start, duration, cliff, end, claimable] =
      await Promise.all([
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "token",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "beneficiary",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "creator",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "totalAllocation",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "start",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "duration",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "cliff",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "end",
          blockNumber,
        }),
        client.readContract({
          address: wallet,
          abi: VESTING_ABI,
          functionName: "claimable",
          blockNumber,
        }),
      ]);
    const released = await client.readContract({
      address: wallet,
      abi: VESTING_ABI,
      functionName: "released",
      args: [token],
      blockNumber,
    });
    return {
      wallet,
      token,
      beneficiary,
      creator,
      totalAllocation,
      start,
      duration,
      cliff,
      end,
      claimable,
      released,
    };
  }

  /**
   * Encodes a zero-value transaction with an explicit signer and chain.
   *
   * @param account - Expected caller.
   * @param to - Pinned or validated contract.
   * @param data - ABI-encoded call.
   * @param purpose - Human-readable action.
   * @returns Unsigned transaction.
   */
  private transaction(
    account: Address,
    to: Address,
    data: Hex,
    purpose: string,
  ): PreparedTransaction {
    return { chainId: MUCHVEST_CHAIN_ID, from: account, to, data, value: "0", purpose };
  }

  /**
   * Validates grant terms and exact token quantities, then prepares ordered steps.
   *
   * @param context - Validated caller and snapshot.
   * @param args - Parsed grant terms.
   * @returns Unsigned grant plan.
   */
  private async prepare(context: Context, args: z.infer<typeof CreateVestingSchema>) {
    const token = getAddress(args.token);
    const beneficiary = getAddress(args.beneficiary);
    if (token.toLowerCase() === NATIVE_DOGE.toLowerCase())
      throw new Error("Native DOGE cannot be vested");
    if (
      BigInt(args.start) <= context.timestamp ||
      args.cliffDuration > args.duration ||
      BigInt(args.start) + BigInt(args.duration) > (1n << 64n) - 1n
    )
      throw new Error("Invalid future start, cliff or duration");
    const code = await context.client.getCode({ address: token, blockNumber: context.blockNumber });
    if (!code || code === "0x") throw new Error("Token must be a deployed ERC20 contract");
    const [decimals, balance, allowance] = await Promise.all([
      context.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber: context.blockNumber,
      }),
      context.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [context.account],
        blockNumber: context.blockNumber,
      }),
      context.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [context.account, MUCHVEST_FACTORY],
        blockNumber: context.blockNumber,
      }),
    ]);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
      throw new Error("Invalid ERC20 decimals");
    if ((args.amount.split(".")[1]?.length ?? 0) > decimals)
      throw new Error("Amount exceeds token decimal precision; rounding is forbidden");
    const amount = parseUnits(args.amount, decimals);
    if (amount <= 0n || amount > maxUint256 || balance < amount)
      throw new Error(
        "Allocation must be positive uint256 and covered by the caller's token balance",
      );
    const transactions: PreparedTransaction[] = [];
    if (allowance !== amount) {
      if (allowance !== 0n)
        transactions.push(
          this.transaction(
            context.account,
            token,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [MUCHVEST_FACTORY, 0n],
            }),
            "Reset existing factory allowance to zero",
          ),
        );
      transactions.push(
        this.transaction(
          context.account,
          token,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [MUCHVEST_FACTORY, amount],
          }),
          "Approve exact allocation to the factory",
        ),
      );
    }
    const createArgs = [
      token,
      beneficiary,
      amount,
      BigInt(args.start),
      BigInt(args.duration),
      BigInt(args.cliffDuration),
    ] as const;
    transactions.push(
      this.transaction(
        context.account,
        MUCHVEST_FACTORY,
        encodeFunctionData({ abi: FACTORY_ABI, functionName: "createVesting", args: createArgs }),
        "Create and atomically fund the irrevocable grant",
      ),
    );
    if (allowance === amount)
      await context.client.simulateContract({
        account: context.account,
        address: MUCHVEST_FACTORY,
        abi: FACTORY_ABI,
        functionName: "createVesting",
        args: createArgs,
      });
    return {
      chainId: MUCHVEST_CHAIN_ID,
      factory: MUCHVEST_FACTORY,
      account: context.account,
      token,
      beneficiary,
      amount: args.amount,
      amountRaw: amount.toString(),
      decimals,
      start: args.start,
      duration: args.duration,
      cliffDuration: args.cliffDuration,
      simulation: allowance === amount ? "passed" : "requires_exact_approval",
      transactions,
      terms: MUCHVEST_TERMS,
    };
  }

  /**
   * Checks the immutable recipient and simulates a claim at the latest block.
   *
   * @param context - Validated caller and snapshot.
   * @param wallet - Registered vesting wallet.
   * @returns Simulated claim details.
   */
  private async claimPreparation(context: Context, wallet: Address) {
    const plan = await this.plan(context, wallet);
    if (plan.claimable <= 0n) throw new Error("No tokens are claimable yet");
    await context.client.simulateContract({
      account: context.account,
      address: wallet,
      abi: VESTING_ABI,
      functionName: "claim",
    });
    return {
      beneficiary: plan.beneficiary,
      token: plan.token,
      claimableRaw: plan.claimable,
      simulation: "passed",
      transaction: this.transaction(
        context.account,
        wallet,
        encodeFunctionData({ abi: VESTING_ABI, functionName: "claim" }),
        "Release vested tokens to the immutable beneficiary",
      ),
    };
  }

  /**
   * Rechecks the wallet immediately before one send and never automatically retries.
   *
   * @param walletProvider - Caller-controlled signer.
   * @param context - Expected caller and chain.
   * @param transaction - Validated ABI transaction.
   * @returns Receipt status including a hash even when receipt confirmation fails.
   */
  private async submit(
    walletProvider: EvmWalletProvider,
    context: Context,
    transaction: PreparedTransaction,
  ) {
    if (
      (await context.client.getChainId()) !== MUCHVEST_CHAIN_ID ||
      !this.supportsNetwork(walletProvider.getNetwork()) ||
      getAddress(walletProvider.getAddress()) !== context.account
    )
      throw new Error("Wallet account or chain changed; prepare the action again");
    const request = {
      chainId: MUCHVEST_CHAIN_ID,
      from: context.account,
      to: transaction.to,
      data: transaction.data,
      value: 0n,
    };
    // WalletProvider implementations bind signing to their configured account/chain.
    // The request carries explicit expectations, while the live checks above remain mandatory.
    const txHash = await walletProvider.sendTransaction(request);
    try {
      const receipt = await walletProvider.waitForTransactionReceipt(txHash);
      if (receipt.status === "success" || receipt.status === 1 || receipt.status === 1n) {
        const confirmedHash: Hex = receipt.transactionHash ?? txHash;
        if (confirmedHash !== txHash) {
          const replacement = await context.client.getTransaction({ hash: confirmedHash });
          if (
            replacement.from.toLowerCase() !== context.account.toLowerCase() ||
            replacement.to?.toLowerCase() !== transaction.to.toLowerCase() ||
            replacement.input.toLowerCase() !== transaction.data.toLowerCase() ||
            replacement.value !== 0n
          ) {
            return {
              status: "replaced",
              txHash,
              replacementHash: confirmedHash,
              retryAutomatically: false,
              instruction:
                "Transaction was replaced with a different call. Inspect both hashes before proceeding.",
            };
          }
        }
        return {
          status: "confirmed",
          txHash: confirmedHash,
          originalTxHash: txHash,
          explorerUrl: `${MUCHVEST_EXPLORER}/tx/${confirmedHash}`,
        };
      }
      if (receipt.status === "reverted" || receipt.status === 0 || receipt.status === 0n)
        return { status: "reverted", txHash, retryAutomatically: false };
      return {
        status: "submitted",
        txHash,
        retryAutomatically: false,
        instruction: "Receipt status unknown. Reconcile this transaction hash before any retry.",
      };
    } catch {
      return {
        status: "submitted",
        txHash,
        retryAutomatically: false,
        instruction:
          "Receipt confirmation failed. Reconcile this transaction hash before any retry.",
      };
    }
  }
}

export const muchvestActionProvider = () => new MuchvestActionProvider();

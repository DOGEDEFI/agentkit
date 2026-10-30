# Much Vest Action Provider

Much Vest creates fixed-recipient, non-revocable ERC20 vesting grants on **DogeOS Chikyu testnet only (6281971)**. The provider directly uses the contract ABI and the caller's injected `EvmWalletProvider`; it does not call a hosted MCP service, accept private keys, or introduce a service wallet.

Pinned factory: `0x141672B2C2cd5E3a18E2b85558F8af3f85C5ea0c`.

```ts
import { AgentKit, muchvestActionProvider } from "@thirdfy/agentkit";
const agentkit = await AgentKit.from({
  walletProvider, // user-authorized EVM wallet on chain 6281971
  actionProviders: [muchvestActionProvider()],
});
```

| Action | Behavior |
| --- | --- |
| `muchvest_list_plans` | Bounded creator/beneficiary registry page; addresses only |
| `muchvest_get_plan` | Exact raw plan values from a single block |
| `muchvest_prepare_create` | Unsigned exact approval steps and grant transaction |
| `muchvest_prepare_claim` | Registered-wallet check and simulated unsigned claim |
| `muchvest_approve_funding` | Separately confirmed exact token approval; resets nonzero different allowance first |
| `muchvest_create_vesting` | Separately confirmed and simulated atomic grant creation; requires exact allowance |
| `muchvest_claim_vesting` | Separately confirmed claim to the immutable recipient |

AgentKit prefixes decorated names with `MuchvestActionProvider_`. Thirdfy's API integration must explicitly map these decorated methods to catalog aliases; this repository export alone does not publish Thirdfy's native catalog.

## Amounts and dates

`amount` is a decimal string in token units, such as `"100.25"`. The adapter reads `decimals` from the token and rejects excess precision, exponent notation, zero, uint256 overflow and insufficient balance. Returned raw amounts are integer strings. `start` is future Unix seconds; `duration` includes the cliff, and `cliffDuration <= duration`. The adapter never converts amounts through floating point.

## Write sequence

1. Prepare the exact grant, inspect the beneficiary/token/amount/schedule and irrevocable terms.
2. With user authorization, call `muchvest_approve_funding` with those same terms and `confirm: true`. This is token spending approval, **not grant creation**.
3. After confirmed approval, call `muchvest_create_vesting` with the confirmed terms. The factory deploys and funds the plan atomically.
4. Read the factory event/registry to discover the resulting wallet.
5. Prepare a claim, inspect its fixed beneficiary, then call `muchvest_claim_vesting` with `confirm: true` if the user authorizes DOGE gas.

The runtime must apply its normal user authorization, account policy, amount limits and idempotency. A boolean parameter is an additional explicit guard; it does not replace host authorization. Contract creation does not have an onchain idempotency key. A retry after ambiguous submission can create a second grant if funded and approved again. The adapter never retries writes and returns submitted hashes when confirmation is uncertain. Reconcile receipts/replacements before retrying. Account and chain are rechecked immediately before every send, and the request includes both expectations. AgentKit wallet providers sign using their own configured account and chain; the host must supply a wallet bound to that account and DogeOS 6281971. The base `TransactionRequest` type does not promise enforcement of a caller-supplied chain override. Receipt failures are never reported as confirmed.

Read and prepare actions never sign. Create only runs if exact allowance is already present and current simulation passes. Approval is separate so one write does not implicitly chain into irreversible funding. On a receipt timeout/cancellation/speed-up ambiguity, execution stops and returns the original hash for reconciliation; it does not infer replacement success.

## Contract limitations

- Beneficiary, allocation, token and schedule are immutable. There is no revoke/admin rescue/upgrade path.
- Vesting accrues from start. The cliff gates claims, then releases the accrued portion.
- Native DOGE cannot be vested; it pays gas. Only standard fixed-balance ERC20 tokens are supported. Transfer-tax, rebasing and malicious tokens are unsupported; simulation is not a token audit.
- Extra token deposits do not increase allocation and cannot be rescued. Never transfer directly to a plan.
- Anyone can trigger a claim; funds always go to the fixed beneficiary.
- Testnet deployment is an experimental application, not an audited mainnet service.

## Native Thirdfy integration

Thirdfy maintainers must add the provider to their runtime instantiation and API action manifest, choose its policy classification/billing, map public aliases and buildTx outputs, and run their normal catalog validation. See `thirdfy-integration.proposal.json` for the explicitly non-live proposed mapping. This does not grant access to a hosted Thirdfy agent. Do not route arbitrary Much Vest calls through Laika's unrelated raw-execution action.

The public AgentKit repository does not include Thirdfy's production DogeOS provider modules or API manifest implementation. `supportsBuildTx` and catalog governance cannot be activated only by modifying this package. Native inclusion remains pending upstream review and API wiring.

## Tests

Unit tests mock the wallet/RPC and cover network/account changes, exact allowance/reset, precision/overflow, contract registration, approval timeout, reverted receipts, simulation failure and fixed-recipient claims. They do not sign or send live transactions.

```sh
cd typescript/agentkit
npx jest --runInBand --runTestsByPath src/action-providers/muchvest/muchvestActionProvider.test.ts --coverage=false
```

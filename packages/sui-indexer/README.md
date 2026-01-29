# Sui Indexer

The Sui Indexer worker is responsible for monitoring the Sui blockchain for nBTC-related events and handling the nBTC redemption process through the Redeem Solver.

## Objectives

- **Event Indexing:** Monitors Sui blockchain for nBTC-related events and polls active packages.
- **Redemption Management:** Handles nBTC redemption requests from users.
- **UTXO Tracking:** Tracks available Bitcoin UTXOs for redemptions.
- **Proposal Generation:** Proposes appropriate UTXO sets for withdrawal transactions.
- **Consistency:** Coordinates with BTCIndexer for consistent state.

## Redemption Flow

```mermaid
flowchart
    User([User])
    SI[[SuiIndexer]]
    Ika[[Ika]]
    Bitcoin[[Bitcoin]]
    subgraph nBTCPkg [nBTCPkg]
      nBTCCtr[nBTC Contract]
      ReedemRequest
    end
    User -- 1. send nBTC request to request redemption --> nBTCCtr
    nBTCCtr -- 2. creates --> ReedemRequest
    SI -- 3. listen --> nBTCCtr
    SI -- 4. propose UTXO set --> ReedemRequest
    SI -- 5 trigger signing --> nBTCCtr
    nBTCCtr -- 6. query signatures --> Ika
    nBTCCtr -- 7. compose the withdraw tx --> Bitcoin
```

## UTXO Management

In Bitcoin all BTC is stored and modeled as UTXO.
Whenever a user makes a deposit to mint nBTC, we receive UTXO that we need to manage.
Whenever a user wants to redeem nBTC for BTC - we need to find best matching UTXO set to satisfy the redeem request. This is a complex problem because:

- We need to optimize for on chain computation (transactions are composed and signed on chain, hence they can't be too big).
- Protocol has to be stable to avoid future updates (if possible).
- Protocol must not have a single point of failure: multiple parties should be able to trigger every step and propose a solution. The best solution should be trustlessly selected and executed.

### Redeem Request UTXO Selection Algorithm

#### v0.1 (current strategy)

We are using a simple strategy: first valid proposal will be served. The smart contracts validates the proposal (check the UTXO limit, amount and validity of the UTXOs).

#### v1.0 (testnet-v3)

Scoring Logic. Let:

- inputs = number of UTXOs in the proposal
- sum = total satoshis of inputs
- change = sum - (withdraw + fee)
- inactive_bonus = bonus per input whose spend_key is in inactive_spend_keys
- exact_spend_bonus = we add a bonus for exact pay and penalties for dust or regular change.

We optimise for: minimizing the change and add bonuses.

### UTXO Lifecycle

The lifecycle of a UTXO flows through the following states, tracked in the `nbtc_utxos` database table.

#### A. Ingestion (Created)

UTXOs are NOT inserted directly by the Bitcoin Indexer. Instead, they are ingested **after** the nBTC minting is confirmed on Sui.

1.  **User Deposit:** User deposits BTC. `BTCIndexer` detects it and calls the Sui nBTC contract to mint.
2.  **Mint Event:** The `NBTC` contract emits a `MintEvent`.
3.  **Indexing:** The `SuiIndexer` picks up this event.
4.  **Storage:** The `SuiIndexer` extracts the Bitcoin `txid`, `vout`, `amount`, and `script_pubkey` from the event and inserts a new record into `nbtc_utxos` with status `AVAILABLE`.

#### B. Availability

Once inserted, the UTXO is in the `AVAILABLE` state.

- It belongs to a specific `dwallet_id`
- It is eligible for selection by the `RedeemSolver` logic (within Sui Indexer) to fulfill redemption requests.

#### C. Locking (Proposed)

When a user requests to redeem nBTC for BTC:

1.  **Selection:** The `SuiIndexer` selects `AVAILABLE` UTXOs to cover the requested amount.
2.  **Locking:** The indexer updates the UTXO status to `LOCKED` and sets a `locked_until` timestamp.
3.  **On-Chain Proposal:** The indexer submits a `ProposeUtxo` transaction to Sui.
4.  **Confirmation:** The `SuiIndexer` listens for the `ProposeUtxoEvent` and confirms the lock in the database (ensuring consistency if multiple workers are running).
    NOTE: if there is another `ProposeUtxoEvent` for the same redeem request (redeem_id), it means our previous proposal has been bested and overwritten, so we can `UNLOCK` those UTXOs.

#### D. Spending (Redemption)

1.  **Signing:** Ika network signs the Bitcoin transaction spending these UTXOs.
2.  **Broadcast:** The `SuiIndexer` (or broadcaster component) broadcasts the transaction to the Bitcoin network.
3.  **Completion:** Once broadcast/confirmed, the UTXOs are `SPENT`.

#### E. Unlocking (Expiry)

If a redemption proposal fails, or times out:

- The `locked_until` timestamp allows the system to treat these UTXOs as `AVAILABLE` again after the lock duration expires.

### Storage & Ownership

UTXOs are stored in the `nbtc_utxos` table in the D1 database.

| Column          | Description                                                                  |
| :-------------- | :--------------------------------------------------------------------------- |
| `nbtc_utxo_id`  | Unique ID assigned by the Sui contract (u64).                                |
| `dwallet_id`    | The Sui object ID of the DWallet that "owns" this UTXO on Bitcoin.           |
| `txid` / `vout` | The Bitcoin outpoint identifiers.                                            |
| `amount`        | Value in satoshis.                                                           |
| `status`        | State: `'available'`, `'locked'`, `'spent'`.                                 |
| `locked_until`  | Epoch timestamp (ms). If `current_time > locked_until`, the lock is expired. |

**Key Concept:** The database acts as a cache of the on-chain state. The `SuiIndexer` ensures this cache stays synchronized with the canonical state on the Sui blockchain.

## IKA Coin Management

We use IKA coins to pay for presign/sign requests. The coin selection logic lives in `packages/lib/src/coin-ops.ts`.

### How it works

1. `fetchAllIkaCoins()` grabs all IKA coins for the signer
2. `selectCoins()` picks coins to hit the target amount (takes first 80, then sorts by balance if needed)
3. `prepareCoin()` merges them if we need multiple coins

### Concurrency

The process is not safe for parallel workload. See the doc comment in  `fetchAllIkaCoins`.

## API

This package exposes [Cloudflare RPC](../../README.md#cloudflare-rpc).

### Setting up Service Binding

To use the RPC interface from another worker, you need to set up a service binding in your `wrangler.jsonc`.
The RPC entrypoint class is `RPC` (implementing `SuiIndexerRpc`).

```jsonc
{
  "services": [
    {
      "binding": "SuiIndexer",
      "service": "sui-indexer",
      "entrypoint": "RPC",
    },
  ],
}
```

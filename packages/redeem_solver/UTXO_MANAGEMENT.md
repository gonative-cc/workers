# UTXO Management

This document outlines how the system manages Bitcoin UTXOs. It covers the lifecycle from deposit ingestion to spending, storage schema, and locking/unlocking.

## 1. UTXO Lifecycle

The lifecycle of a UTXO flows through the following states, tracked in the `nbtc_utxos` database table.

### A. Ingestion (Created)
UTXOs are NOT inserted directly by the Bitcoin Indexer. Instead, they are ingested **after** the nBTC minting is confirmed on Sui.

1.  **User Deposit:** User deposits BTC. `BTCIndexer` detects it and calls the Sui nBTC contract to mint.
2.  **Mint Event:** The `NBTC` contract emits a `MintEvent`.
3.  **Indexing:** The `SuiIndexer` picks up this event.
4.  **Storage:** The `SuiIndexer` extracts the Bitcoin `txid`, `vout`, `amount`, and `script_pubkey` from the event and inserts a new record into `nbtc_utxos` with status `AVAILABLE`.

### B. Availability
Once inserted, the UTXO is in the `AVAILABLE` state.
- It belongs to a specific `dwallet_id`
- It is eligible for selection by the `RedeemSolver` to fulfill redemption requests.

### C. Locking (Proposed)
When a user requests to redeem nBTC for BTC:
1.  **Selection:** The `RedeemSolver` selects `AVAILABLE` UTXOs to cover the requested amount.
2.  **Locking:** The solver updates the UTXO status to `LOCKED` and sets a `locked_until` timestamp.
3.  **On-Chain Proposal:** The solver submits a `ProposeUtxo` transaction to Sui.
4.  **Confirmation:** The `SuiIndexer` listens for the `ProposeUtxoEvent` and confirms the lock in the database (ensuring consistency if multiple workers are running).
NOTE: if there is another `ProposeUtxoEvent` for the same redeem request (redeem_id), it means our previous proposal has been bested and overwritten, so we can `UNLOCK` those UTXOs.

### D. Spending (Redemption)
1.  **Signing:** Ika network signs the Bitcoin transaction spending these UTXOs.
2.  **Broadcast:** The `RedeemSolver` broadcasts the transaction to the Bitcoin network.
3.  **Completion:** Once broadcast/confirmed, the UTXOs are `SPENT`.

### E. Unlocking (Expiry)
If a redemption proposal fails, or times out:
* The `locked_until` timestamp allows the system to treat these UTXOs as `AVAILABLE` again after the lock duration expires.

## 2. Storage & Ownership

UTXOs are stored in the `nbtc_utxos` table in the D1 database (shared across workers).

| Column | Description |
| :--- | :--- |
| `nbtc_utxo_id` | Unique ID assigned by the Sui contract (u64). |
| `dwallet_id` | The Sui object ID of the DWallet that "owns" this UTXO on Bitcoin. |
| `txid` / `vout` | The Bitcoin outpoint identifiers. |
| `amount` | Value in satoshis. |
| `status` | State: `'available'`, `'locked'`, `'spent'`. |
| `locked_until` | Epoch timestamp (ms). If `current_time > locked_until`, the lock is expired. |

**Key Concept:** The database acts as a cache of the on-chain state. The `SuiIndexer` ensures this cache stays synchronized with the canonical state on the Sui blockchain.

## 3. Coin Selection Algorithm

The `RedeemSolver` is responsible for choosing which UTXOs to spend.

**Current Strategy**
For testnet we are using a very simple version of the algorithm, the production algorithm will be more sophisticated.
TODO: update this once we update the algorithm

-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE processed_blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    processed_at INTEGER DEFAULT unixepoch('subsec')
) STRICT;

-- This table tracks the nBTC deposit txs
CREATE TABLE nbtc_txs (
    tx_id TEXT PRIMARY KEY,
    block_hash TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    vout INTEGER NOT NULL,
    sui_recipient TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'broadcasting' | 'confirming' | 'finalized' | 'minting' | 'minted' | 'reorg'
    created_at INTEGER DEFAULT unixepoch('subsec'),
    updated_at INTEGER DEFAULT unixepoch('subsec')
) STRICT;

-- Indexes
CREATE INDEX nbtc_txs_status ON nbtc_txs (status);
CREATE INDEX nbtc_txs_sui_recipient ON nbtc_txs (sui_recipient);
CREATE INDEX processed_blocks_height ON processed_blocks (height);

-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE btc_blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    processed_at REAL DEFAULT (unixepoch('subsec')),
	status TEXT NOT NULL DEFAULT 'new' -- 'new' | 'scanned'
) STRICT;

-- This table tracks the nBTC deposit txs (minting)
CREATE TABLE nbtc_minting (
    tx_id TEXT PRIMARY KEY,
    block_hash TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    vout INTEGER NOT NULL,
    sui_recipient TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'broadcasting' | 'confirming' | 'finalized' | 'minting' | 'minted' | 'reorg'
    created_at REAL DEFAULT (unixepoch('subsec')),
    updated_at REAL DEFAULT (unixepoch('subsec'))
) STRICT;

-- Indexes
CREATE INDEX nbtc_minting_status ON nbtc_minting (status);
CREATE INDEX nbtc_minting_sui_recipient ON nbtc_minting (sui_recipient);
CREATE INDEX btc_blocks_height ON btc_blocks (height);
CREATE INDEX btc_blocks_status ON btc_blocks (status);

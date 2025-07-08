-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE processed_blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- This table tracks the nBTC deposit txs
CREATE TABLE nbtc_txs (
    tx_id TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    height INTEGER NOT NULL,
    vout INTEGER NOT NULL,
    sui_recipient TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'broadcasting' | 'confirming' | 'finalized' | 'minting' | 'minted'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX nbtc_txs_status ON nbtc_txs (status);
CREATE INDEX nbtc_txs_sui_recipient ON nbtc_txs (sui_recipient);

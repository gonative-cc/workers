-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE btc_blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    processed_at INTEGER NOT NULL, -- timestamp_ms
	status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'scanned')) -- 'new' | 'scanned'
) STRICT;

CREATE INDEX btc_blocks_status ON btc_blocks (status);

---------- NBTC Minting and Withdrawal ----------

-- This table tracks the nBTC deposit txs (minting)
CREATE TABLE nbtc_minting (
    tx_id TEXT NOT NULL,
	vout INTEGER NOT NULL,
    block_hash TEXT,
    block_height INTEGER,
    sui_recipient TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'broadcasting' | 'confirming' | 'finalized' | 'minting' | 'minted' | 'reorg'
    created_at INTEGER NOT NULL, -- timestamp_ms
    updated_at INTEGER NOT NULL, -- timestamp_ms
	PRIMARY KEY (tx_id, vout)
) STRICT;

CREATE INDEX nbtc_minting_status ON nbtc_minting (status);
CREATE INDEX nbtc_minting_sui_recipient ON nbtc_minting (sui_recipient, created_at);

-- nbtc_withdrawal table tracks nBTC withdraw transactions from SUI
CREATE TABLE nbtc_withdrawal (
	sui_tx_id TEXT PRIMARY KEY,
	sender TEXT NOT NULL, -- Sui sender
	amount INTEGER NOT NULL, -- amount of nBTC to be burn and withdraw on BTC,
	recipient TEXT NOT NULL, -- the bitcoin address or script that will receive the BTC,
	note TEXT, -- additional note that we can include for the user.
	sent_at INTEGER NOT NULL, -- timestamp_ms
	btc_tx_id TEXT, -- will be set once Bitcoin tx will be broadcasted
	status INTEGER NOT NULL
) STRICT;

CREATE INDEX nbtc_withdraw_sender ON nbtc_withdrawal (sender, recipient, sent_at);

-- nbtc_withdrawal.status:
-- 1 = requested
-- 2 = burn
-- 3 = signing -- Ika signature
-- 4 = signed
-- 5 = broadcasted to bitcoin
-- 6 = confirmations (here user technically already has the funds)

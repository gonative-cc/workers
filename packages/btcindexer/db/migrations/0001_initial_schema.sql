-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE processed_blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    processed_at INTEGER DEFAULT unixepoch('subsec')
) STRICT;

---------- NBTC Minting and Withdrawal ----------

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

CREATE INDEX nbtc_txs_status ON nbtc_txs (status);
CREATE INDEX nbtc_txs_sui_recipient ON nbtc_txs (sui_recipient, created_at);

-- nbtc_withdrawal table tracks nBTC withdraw transactions from SUI
CREATE TABLE nbtc_withdrawal (
	sui_tx_id TEXT PRIMARY KEY,
	sender TEXT NOT NULL, -- sui sender
	amount INTEGER NOT NULL, -- amount of nBTC to be burn and withdraw on BTC,
	recipient TEXT NOT NULL, -- the bitcoin address or script that will recive the BTC,
	note TEXT, -- additional note that we can include for the user. eg. you are sending funds to a collegue, this note will be included (maybe op_return?)
	sent_at INTEGER NOT NULL,
	btc_tx_id TEXT, -- will be set once Bitcoin tx will be broadcasted
	status INTEGER NOT NULL
) STRICT;

CREATE INDEX nbtc_withdraw_sender ON nbtc_withdrawal (sender, recipient, sent_at);

-- nbtc_withdrawal.status:
-- 1 = requested
-- 2 = burn
-- 3 = signing -- ika signature
-- 4 = signed
-- 5 = broadcasted to bitcoin
-- 6 = confirmations (here user technically already has the funds)

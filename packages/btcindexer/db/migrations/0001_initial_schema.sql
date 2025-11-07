-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE IF NOT EXISTS btc_blocks (
  hash TEXT NOT NULL,
  height INTEGER NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'scanned')), -- 'new' | 'scanned'
  processed_at INTEGER,  -- timestamp_ms
  inserted_at INTEGER, -- timestamp_ms
  PRIMARY KEY (height, network)
) STRICT;

CREATE INDEX IF NOT EXISTS btc_blocks_status_height ON btc_blocks (status, height);

---------- NBTC Minting and Withdrawal ----------

-- This table tracks the nBTC deposit txs (minting)
CREATE TABLE IF NOT EXISTS nbtc_minting (
	tx_id TEXT NOT NULL,
	vout INTEGER NOT NULL,
	block_hash TEXT,
	block_height INTEGER,
	sui_recipient TEXT NOT NULL,
	amount_sats INTEGER NOT NULL,
	status TEXT NOT NULL, -- 'broadcasting' | 'confirming' | 'finalized' | 'minting' | 'minted' | 'reorg'
	created_at INTEGER NOT NULL, -- timestamp_ms
	updated_at INTEGER NOT NULL, -- timestamp_ms
  sui_tx_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  nbtc_pkg TEXT NOT NULL,
  sui_network TEXT NOT NULL,
  network TEXT NOT NULL,
	PRIMARY KEY (tx_id, vout)
) STRICT;

CREATE INDEX IF NOT EXISTS nbtc_minting_status ON nbtc_minting (status);
CREATE INDEX IF NOT EXISTS nbtc_minting_sui_recipient ON nbtc_minting (sui_recipient, created_at);

-- nbtc_withdrawal table tracks nBTC withdraw transactions from SUI
CREATE TABLE IF NOT EXISTS nbtc_withdrawal (
	sui_tx_id TEXT PRIMARY KEY,
	sender TEXT NOT NULL, -- Sui sender
	amount INTEGER NOT NULL, -- amount of nBTC to be burn and withdraw on BTC,
	recipient TEXT NOT NULL, -- the bitcoin address or script that will receive the BTC,
	note TEXT, -- additional note that we can include for the user.
	sent_at INTEGER NOT NULL, -- timestamp_ms
	btc_tx_id TEXT, -- will be set once Bitcoin tx will be broadcasted
	status INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS nbtc_withdraw_sender ON nbtc_withdrawal (sender, recipient, sent_at);

-- nbtc_withdrawal.status:
-- 1 = requested
-- 2 = burn
-- 3 = signing -- Ika signature
-- 4 = signed
-- 5 = broadcasted to bitcoin
-- 6 = confirmations (here user technically already has the funds)

-- This table links a Bitcoin transaction ID to its sender addresses.
CREATE TABLE IF NOT EXISTS nbtc_sender_deposits (
    tx_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    PRIMARY KEY (sender, tx_id)
) STRICT;

-- This table holds the deposit addresses for nBTC.
CREATE TABLE IF NOT EXISTS nbtc_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  btc_network TEXT NOT NULL,
  sui_network TEXT NOT NULL,
  nbtc_pkg TEXT NOT NULL,
  btc_address TEXT NOT NULL,
  UNIQUE(btc_address, btc_network)
) STRICT;
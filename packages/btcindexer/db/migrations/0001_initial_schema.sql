-- This table tracks the blocks received from the relayer (queue for cron job)
CREATE TABLE IF NOT EXISTS btc_blocks (
  hash TEXT NOT NULL,
  height INTEGER NOT NULL,
  network TEXT NOT NULL,
  is_scanned INTEGER NOT NULL DEFAULT 0,  -- 0 = not scanned, 1 = scanned
  processed_at INTEGER,  -- timestamp_ms
  inserted_at INTEGER, -- timestamp_ms
  PRIMARY KEY (height, network)
) STRICT;

CREATE INDEX IF NOT EXISTS btc_blocks_is_scanned_height ON btc_blocks (is_scanned, height);

---------- NBTC Minting and Withdrawal ----------

-- This table tracks the nBTC deposit txs (minting)
CREATE TABLE IF NOT EXISTS nbtc_minting (
	tx_id TEXT NOT NULL PRIMARY KEY,
	config_id INTEGER NOT NULL,
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
	FOREIGN KEY (config_id) REFERENCES nbtc_configs(id)
) STRICT;

CREATE INDEX IF NOT EXISTS nbtc_minting_status ON nbtc_minting (config_id, status);
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
CREATE TABLE IF NOT EXISTS nbtc_deposit_senders (
	tx_id TEXT NOT NULL,
	sender TEXT NOT NULL,
	PRIMARY KEY (sender, tx_id),
	FOREIGN KEY (tx_id) REFERENCES nbtc_minting(tx_id) ON DELETE CASCADE
) STRICT;

-- This table holds the config for nBTC.
CREATE TABLE IF NOT EXISTS nbtc_configs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	btc_network TEXT NOT NULL,
	sui_network TEXT NOT NULL,
	nbtc_pkg TEXT NOT NULL,
	deposit_address TEXT NOT NULL,
	is_active INTEGER NOT NULL DEFAULT TRUE,
	UNIQUE(sui_network, btc_network, nbtc_pkg, deposit_address)
) STRICT;

CREATE TABLE IF NOT EXISTS nbtc_utxos ( -- TODO: normalise the database (foreign key to the nbtc_addresses table)
	sui_id TEXT NOT NULL PRIMARY KEY,
	config_id INTEGER NOT NULL,
	dwallet_id TEXT NOT NULL,
	txid TEXT NOT NULL, -- Bitcoin transaction ID
	vout INTEGER NOT NULL,
	amount_sats INTEGER NOT NULL,
	script_pubkey BLOB NOT NULL,
	status TEXT NOT NULL DEFAULT 'available', -- 'available', 'locked', 'spent' TODO: lets remove the 'spent' utxos after some time?
	locked_until INTEGER,
	FOREIGN KEY (config_id) REFERENCES nbtc_configs(id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_utxos_selection ON nbtc_utxos(config_id, status, amount_sats);
CREATE INDEX IF NOT EXISTS idx_nbtc_utxos_txid_vout ON nbtc_utxos(txid, vout);

CREATE TABLE IF NOT EXISTS nbtc_redeem_requests (
	redeem_id TEXT NOT NULL PRIMARY KEY,
	config_id INTEGER NOT NULL,
	redeemer TEXT NOT NULL,
	recipient_script BLOB NOT NULL, -- script pubkey
	amount_sats INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'proposed', 'signed', 'broadcasted'
	FOREIGN KEY (config_id) REFERENCES nbtc_configs(id)
) STRICT;

CREATE TABLE IF NOT EXISTS indexer_state ( -- TODO: maybe we should just use key-value here?
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER
) STRICT;

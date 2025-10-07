-- This table links a Bitcoin transaction ID to its sender addresses.
CREATE TABLE nbtc_deposit_senders (
    tx_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    PRIMARY KEY (sender, tx_id)
);

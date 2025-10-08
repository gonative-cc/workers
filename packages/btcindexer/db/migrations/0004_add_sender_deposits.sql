-- This table links a Bitcoin transaction ID to its sender addresses.
CREATE TABLE nbtc_sender_deposits (
    tx_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    PRIMARY KEY (sender, tx_id)
);

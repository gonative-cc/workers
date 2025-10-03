-- This table links a Bitcoin transaction ID to its sender addresses.
CREATE TABLE nbtc_deposit_senders (
    tx_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    PRIMARY KEY (tx_id, sender)
);

CREATE INDEX idx_sender ON nbtc_deposit_senders (sender);

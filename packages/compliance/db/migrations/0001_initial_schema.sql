CREATE TABLE IF NOT EXISTS sanctioned_addresses (
    address TEXT NOT NULL,
    chain INTEGER NOT NULL,  -- 0 - bitcoin, 1 - sui
	PRIMARY KEY (address, chain)
) STRICT;


CREATE TABLE IF NOT EXISTS nbtc_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  btc_network TEXT NOT NULL,
  sui_network TEXT NOT NULL,
  nbtc_pkg TEXT NOT NULL,
  btc_address TEXT NOT NULL
);

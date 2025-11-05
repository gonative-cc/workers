CREATE TABLE blocks (
  hash TEXT NOT NULL,
  height INTEGER NOT NULL,
  network TEXT NOT NULL,
  kv_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hash, network)
);
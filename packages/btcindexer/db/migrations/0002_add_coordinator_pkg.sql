-- Add coordinator_pkg column to setups table for Ika dWallet coordinator package ID
ALTER TABLE setups
ADD COLUMN coordinator_pkg TEXT;
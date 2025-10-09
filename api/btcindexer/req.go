// Request types

package btcindexer

// PutBlock wraps serialized Bitcoin block (using Bitcoin core encoding) and the block height.
type PutBlock struct {
	Height int64 `msg:"height"`
	// Block is bitcoin core encoding of a Bitcoin block
	Block []byte `msg:"block"`
}

// PutBlocksReq is the type expected by the PUT bitcoin/blocks endpoint
type PutBlocksReq []PutBlock

// LatestHeightResp is the JSON structure for the response from the /bitcoin/latest-height endpoint
type LatestHeightResp struct {
	Height *int64 `json:"height"`
}

// NbtcTxStatusResp is the JSON structure for the response from the /nbtc/:txid endpoint

type NbtcTxStatusResp struct {
	BtcTxID       string  `json:"btc_tx_id"`
	Status        string  `json:"status"`
	SuiTxID       *string `json:"sui_tx_id"`
	BlockHeight   *int64  `json:"block_height"`
	Confirmations int64   `json:"confirmations"`
	SuiRecipient  string  `json:"sui_recipient"`
	AmountSats    int64   `json:"amount_sats"`
}

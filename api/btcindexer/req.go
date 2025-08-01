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

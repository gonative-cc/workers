// Request types

package btcindexer

type PutBlock struct {
	Height int64 `msg:"height"`
	// Block is bitcoin core encoding of a Bitcoin block
	Block []byte `msg:"block"`
}

type PutBlocksReq []PutBlock

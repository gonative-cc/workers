package btcindexer

import (
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"testing"

	"gotest.tools/v3/assert"
)

// The Bitcoin mainnet genesis block. See packages/btcindexer/src/api/put-blocks.test.ts
const blockHex = "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000"

func TestPutBlocks(t *testing.T) {
	data := readSampleBlock(t)

	pbs := new(PutBlocksReq)
	data, err := pbs.UnmarshalMsg(data)
	assert.NilError(t, err)
	assert.Equal(t, len(data), 0)
	assert.Equal(t, len(*pbs), 1)
	pb0 := (*pbs)[0]
	assert.Equal(t, pb0.Height, int64(156))

	gotBlockHex := hex.EncodeToString(pb0.Block)
	assert.Equal(t, blockHex, gotBlockHex)
}

func readSampleBlock(t *testing.T) []byte {
	data, err := os.ReadFile("../../packages/btcindexer/src/api/put_blocks_req_msgpack")
	assert.NilError(t, err)
	assert.Assert(t, len(data) > 10)
	return data
}

func TestPutBlocksInt(t *testing.T) {
	// This is an integration test, requires indexer to be running.
	// TODO: need to add build flag for integration tests.
	t.SkipNow()
	blockBz, err := hex.DecodeString(blockHex)
	assert.NilError(t, err)

	pb := PutBlock{Height: 156, Block: blockBz}

	c := NewClient("http://localhost:8787")
	resp, err := c.PutBlocks(PutBlocksReq{pb})
	assert.NilError(t, err)
	respBody, err := io.ReadAll(resp.Body)
	assert.NilError(t, err)
	fmt.Println(string(respBody))
	assert.Equal(t, resp.StatusCode, 200)
}

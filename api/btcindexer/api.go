package btcindexer

import (
	"bytes"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	baseUrl string
	c       http.Client
}

func NewClient(workerUrl string) Client {
	return Client{
		baseUrl: workerUrl,
		c:       http.Client{Timeout: time.Second * 30},
	}
}

func (c Client) PutBlocks(putBlocks PutBlocksReq) (*http.Response, error) {
	bz, err := putBlocks.MarshalMsg(nil)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPut, fmt.Sprint(c.baseUrl, "/bitcoin/blocks"),
		bytes.NewReader(bz))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/msgpack")
	return c.c.Do(req)
}

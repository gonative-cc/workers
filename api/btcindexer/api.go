package btcindexer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	baseUrl string
	c       http.Client
}

const (
	pathBlocks           = "/bitcoin/blocks"
	pathLatestHeight     = "/bitcoin/height"
	pathDepositsBySender = "/bitcoin/deposits/"
)

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
	req, err := http.NewRequest(http.MethodPut, fmt.Sprint(c.baseUrl, pathBlocks),
		bytes.NewReader(bz))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/msgpack")
	return c.c.Do(req)
}

func (c Client) GetLatestHeight(network string) (int64, error) {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprint(c.baseUrl, pathLatestHeight), nil)
	if err != nil {
		return 0, err
	}

	q := req.URL.Query()
	q.Add("network", network)
	req.URL.RawQuery = q.Encode()

	resp, err := c.c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("indexer returned non-200 status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, fmt.Errorf("failed to read response body: %w", err)
	}

	var respData LatestHeightResp
	if err := json.Unmarshal(body, &respData); err != nil {
		return 0, fmt.Errorf("failed to decode indexer height response: %w", err)
	}

	if respData.Height == nil {
		return 0, nil
	}

	return *respData.Height, nil
}

func (c Client) GetDepositsBySender(senderAddress string, network string) ([]NbtcTxStatusResp, error) {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprint(c.baseUrl, pathDepositsBySender), nil)
	if err != nil {
		return nil, err
	}

	q := req.URL.Query()
	q.Add("sender", senderAddress)
	q.Add("network", network)
	req.URL.RawQuery = q.Encode()

	resp, err := c.c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("indexer returned non-200 status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var respData []NbtcTxStatusResp
	if err := json.Unmarshal(body, &respData); err != nil {
		return nil, fmt.Errorf("failed to decode indexer deposits by sender response: %w", err)
	}

	return respData, nil
}

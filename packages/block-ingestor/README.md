# Block Ingestor

## Key Features

### 1. Block Reception

- Exposes REST API endpoint to receive new Bitcoin blocks
- Uses msgpack encoding for efficient data transmission
- Stores blocks in Cloudflare KV for fast retrieval

### 2. Queue Processing

- Enqueues blocks to Cloudflare Queue for downstream processing
- Implements proper batching for efficient processing
- Records timestamps and metadata for each block

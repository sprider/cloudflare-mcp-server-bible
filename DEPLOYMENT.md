# Deployment Instructions

## Prerequisites

1. Install Wrangler CLI if not already installed:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Get your Bible API key from [https://scripture.api.bible/](https://scripture.api.bible/)

## Deploy to Cloudflare Workers

1. Set your environment variables using Wrangler secrets:
   ```bash
   # Required: Your Scripture API Bible API key
   wrangler secret put BIBLE_API_KEY
   
   # Optional: Bible translation ID (default: KJV)
   wrangler secret put BIBLE_ID
   
   # Optional: API base URL (uses default if not set)
   wrangler secret put BASE_URL
   ```

2. Deploy the worker:
   ```bash
   npm run deploy
   ```
   
   Or for specific environment:
   ```bash
   # Deploy to production
   wrangler deploy --env production
   
   # Deploy to staging
   wrangler deploy --env staging
   ```

3. Test your deployed worker:
   ```bash
   curl https://your-worker-domain.workers.dev/health
   ```

## Environment-specific Deployment

### Production
```bash
wrangler deploy --env production
```

### Staging
```bash
wrangler deploy --env staging
```

### Default (no environment)
```bash
wrangler deploy --env=""
```

## Testing the MCP Server

Once deployed, your Bible MCP server will be available at:
- Health check: `https://your-worker-domain.workers.dev/health`
- MCP endpoint: `https://your-worker-domain.workers.dev/sse` (POST requests)

## Troubleshooting

1. **API Key Issues**: Make sure your Bible API key is valid and set correctly
2. **CORS Issues**: The server includes CORS headers for cross-origin requests
3. **Rate Limits**: The Scripture API has rate limits, check their documentation

## Monitoring

You can monitor your deployed worker in the Cloudflare Workers dashboard at:
https://dash.cloudflare.com/
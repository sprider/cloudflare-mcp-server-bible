# Bible MCP Server for Cloudflare Workers

A Model Context Protocol (MCP) server that provides Bible search and verse retrieval tools, deployed on Cloudflare Workers. This server uses the Scripture API Bible service to provide access to various Bible translations.

## Features

- **Search Verses**: Search for Bible verses containing specific text
- **Get Verse**: Retrieve specific Bible verses (e.g., GEN.1.1)
- **Get Passage**: Get Bible passages (e.g., GEN.1.1-GEN.1.5)
- **Get Chapter**: Get all verses from a specific chapter
- **List Books**: Get a list of all Bible books with their IDs
- **List Chapters**: Get a list of chapters for a specific book

## Configuration

This server is designed to be publicly deployable with user-configurable settings.

### Getting a Bible API Key

1. Go to [https://scripture.api.bible/](https://scripture.api.bible/)
2. Sign up for a free account
3. Get your API key from the dashboard

### Environment Variables

Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
```

Available configuration options:

- `BIBLE_API_KEY`: **Required** - Your Scripture API Bible API key
- `BIBLE_ID`: Bible translation ID (default: "de4e12af7f28f599-02" for KJV)
- `BASE_URL`: Scripture API base URL (default: "https://api.scripture.api.bible/v1")

### For Production Deployment

Use Wrangler secrets to securely set environment variables:

```bash
# Set the Bible API key
wrangler secret put BIBLE_API_KEY

# Set default Bible version
wrangler secret put BIBLE_VERSION

# Set default language
wrangler secret put BIBLE_LANGUAGE
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure your environment variables (see Configuration section above)

3. Test locally:
```bash
npm run dev
```

4. Deploy to Cloudflare Workers:
```bash
npm run deploy
```

## Usage

Once deployed, your MCP server will be available at your Cloudflare Workers domain.

### Available Bible Translations

Common Bible IDs you can use:
- `de4e12af7f28f599-02` - King James Version (KJV)
- `06125adad2d5898a-01` - New International Version (NIV)
- `f72b840c855f362c-04` - English Standard Version (ESV)
- `592420522e16049f-01` - New American Standard Bible (NASB)

### Available Tools

1. **search_verses**
   - Search for Bible verses containing specific text
   - Parameters: `query` (required), `limit` (optional, 1-200, default: 10)

2. **get_verse**
   - Get a specific Bible verse
   - Parameters: `verse_id` (required, e.g., "GEN.1.1"), `include_verse_numbers` (optional, default: true)

3. **get_passage**
   - Get a passage of Bible verses
   - Parameters: `passage_id` (required, e.g., "GEN.1.1-GEN.1.5"), `include_verse_numbers` (optional, default: true)

4. **get_chapter**
   - Get all verses from a specific chapter
   - Parameters: `book_id` (required, e.g., "GEN"), `chapter` (required, number)

5. **list_books**
   - Get a list of all books in the Bible

6. **list_chapters**
   - Get a list of chapters for a specific book
   - Parameters: `book_id` (required, e.g., "GEN")

### Example API Calls

```javascript
// Search for verses containing "love"
{
  "method": "tools/call",
  "params": {
    "name": "search_verses",
    "arguments": {
      "query": "love",
      "limit": 5
    }
  }
}

// Get Genesis 1:1
{
  "method": "tools/call",
  "params": {
    "name": "get_verse",
    "arguments": {
      "verse_id": "GEN.1.1"
    }
  }
}

// Get Genesis 1:1-5 passage
{
  "method": "tools/call",
  "params": {
    "name": "get_passage",
    "arguments": {
      "passage_id": "GEN.1.1-GEN.1.5"
    }
  }
}
```

## Development

- `npm run dev`: Start local development server
- `npm run deploy`: Deploy to Cloudflare Workers

## License

MIT

## Contributing

This is a public MCP server. Feel free to contribute improvements, additional Bible APIs integration, or new features.

## Notes

- This implementation uses the Scripture API Bible service, which provides access to many Bible translations
- The server requires a valid API key from [scripture.api.bible](https://scripture.api.bible/)
- All the MCP tools match the functionality of the original Python server
- The server supports all the same Bible operations: search, verses, passages, chapters, books, and chapter listings

## API Reference

For more information about available Bible translations and API capabilities, visit:

- [Scripture API Bible Documentation](https://scripture.api.bible/livedocs)
- [Available Bible Translations](https://scripture.api.bible/)
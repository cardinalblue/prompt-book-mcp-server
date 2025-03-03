# Prompt Book Server

An MCP server that connects to a Notion database containing GAI prompts and provides tools to list, search, and retrieve prompts from the prompt book.

## Features

- List all prompts in the database with pagination
- Search prompts by title
- Get prompts by tag
- Get prompts by type
- Read the content of a specific prompt

## Configuration

The server requires the following environment variables:

1. `NOTION_TOKEN`: Notion API token with access to the prompts database
2. `NOTION_DATABASE_ID`: ID of the Notion database containing the prompts

```json
{
  "mcpServers": {
    "prompt-book-server": {
      "command": "node",
      "args": [
        "/path/to/prompt-book-server/build/index.js"
      ],
      "env": {
        "NOTION_TOKEN": "your-notion-api-token",
        "NOTION_DATABASE_ID": "your-notion-database-id"
      },
      "disabled": false,
      "alwaysAllow": [
        "list_prompts",
        "search_prompts_by_title",
        "get_prompts_by_tag",
        "get_prompts_by_type",
        "read_prompt"
      ]
    }
  }
}
```

## Available Tools

### list_prompts

Lists all prompts in the database with pagination.

**Parameters:**
- `start_cursor` (optional): Pagination cursor for the next page of results

**Example:**
```json
{
  "start_cursor": "cursor-value"
}
```

### search_prompts_by_title

Searches prompts by title.

**Parameters:**
- `query` (required): Search query for prompt titles

**Example:**
```json
{
  "query": "GPUImage"
}
```

### get_prompts_by_tag

Gets prompts by tag.

**Parameters:**
- `tag` (required): Tag to filter prompts by
- `start_cursor` (optional): Pagination cursor for the next page of results

**Example:**
```json
{
  "tag": "PicCollage",
  "start_cursor": "cursor-value"
}
```

### get_prompts_by_type

Gets prompts by type.

**Parameters:**
- `type` (required): Type to filter prompts by (e.g., "Coding", "Image Generation", "Conversation")
- `start_cursor` (optional): Pagination cursor for the next page of results

**Example:**
```json
{
  "type": "Coding",
  "start_cursor": "cursor-value"
}
```

### read_prompt

Reads the content of a specific prompt.

**Parameters:**
- `prompt_id` (required): ID of the prompt to read

**Example:**
```json
{
  "prompt_id": "1a748be2-b632-8098-8d9b-c5f89918431d"
}
```

### update_prompt

Updates an existing prompt in the database.

**Parameters:**
- `prompt_id` (required): ID of the prompt to update
- `name` (optional): New name for the prompt
- `detailed_prompt` (optional): New detailed content for the prompt
- `type` (optional): New type for the prompt (must be a valid type from the database)
- `tags` (optional): New list of tags for the prompt

**Example:**
```json
{
  "prompt_id": "1a748be2-b632-8098-8d9b-c5f89918431d",
  "name": "Updated Prompt Title",
  "detailed_prompt": "This is the updated content of the prompt.",
  "type": "Coding",
  "tags": ["JavaScript", "React", "Frontend"]
}
```

## Development

### Prerequisites

- Node.js 16+
- TypeScript
- Notion API token

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run the server: `npm start`

### Environment Variables

- `NOTION_TOKEN`: Notion API token with access to the prompts database
- `NOTION_DATABASE_ID`: ID of the Notion database containing the prompts
# Prompt Book Server

An MCP server that connects to a Notion database containing GAI prompts and provides tools to list, search, and retrieve prompts from the prompt book.

## Features

### Configuration Management
- Support for multiple prompt books with only one active at a time
- Add, remove, and activate prompt books
- Configuration stored in `~/.mcp_config/prompt_book.json`

### Prompt Management
- List all prompts in the database with pagination
- Search prompts by title
- Get prompts by tag
- Get prompts by type
- Read the content of a specific prompt
- Add and update prompts

## Configuration

The server reads configuration from `~/.mcp_config/prompt_book.json`. This file contains a list of prompt books, with only one active at a time.

Each prompt book has the following structure:
```json
{
  "promptBooks": [
    {
      "id": "uuid-string",
      "name": "My Prompt Book",
      "notion_token": "your-notion-api-token",
      "notion_database_id": "your-notion-database-id"
    }
  ],
  "activePromptBookId": "uuid-string"
}
```

The MCP server configuration should be:
```json
{
  "mcpServers": {
    "prompt-book-server": {
      "command": "node",
      "args": [
        "/path/to/prompt-book-server/build/index.js"
      ],
      "disabled": false,
      "alwaysAllow": [
        "list_prompt_books",
        "rename_prompt_book",
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

### Configuration Management Tools

### create_prompt_book_config

Adds a new prompt book configuration.

**Parameters:**
- `name` (required): Name of the prompt book
- `notion_token` (required): Notion API token with access to the prompts database
- `notion_database_id` (required): ID of the Notion database containing the prompts

**Example:**
```json
{
  "name": "My Prompt Book",
  "notion_token": "secret_abcdefghijklmnopqrstuvwxyz",
  "notion_database_id": "1a748be2-b632-8098-8d9b-c5f89918431d"
}
```

### remove_prompt_book_config

Removes a prompt book configuration.

**Parameters:**
- `id` (required): ID of the prompt book to remove

**Example:**
```json
{
  "id": "1a748be2-b632-8098-8d9b-c5f89918431d"
}
```

### activate_prompt_book

Sets a prompt book as active.

**Parameters:**
- `id` (required): ID of the prompt book to activate

**Example:**
```json
{
  "id": "1a748be2-b632-8098-8d9b-c5f89918431d"
}
```

### rename_prompt_book

Renames a prompt book configuration.

**Parameters:**
- `id` (required): ID of the prompt book to rename
- `name` (required): New name for the prompt book

**Example:**
```json
{
  "id": "1a748be2-b632-8098-8d9b-c5f89918431d",
  "name": "Updated Prompt Book Name"
}
```

### list_prompt_books

Lists all configured prompt books.

**Parameters:**
- None

### Prompt Management Tools

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

### add_prompt

Adds a new prompt to the database.

**Parameters:**
- `name` (required): Name of the prompt
- `detailed_prompt` (required): The detailed content of the prompt
- `type` (required): Type of the prompt. Use the list_all_types tool to check existing types to use.
- `tags` (optional): List of tags for the prompt
- `allow_new_type` (optional): If true, allows creating a new type if it doesn't exist in the database. Default is false.

**Example:**
```json
{
  "name": "My New Prompt",
  "detailed_prompt": "This is the content of the new prompt.",
  "type": "Coding",
  "tags": ["JavaScript", "React"],
  "allow_new_type": false
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

### Configuration Setup

After installing and building the project, you need to create a configuration file:

1. Create the directory: `mkdir -p ~/.mcp_config`
2. Create a configuration file: `touch ~/.mcp_config/prompt_book.json`
3. Add your prompt book configuration to the file:
```json
{
  "promptBooks": [
    {
      "id": "uuid-string",
      "name": "My Prompt Book",
      "notion_token": "your-notion-api-token",
      "notion_database_id": "your-notion-database-id"
    }
  ],
  "activePromptBookId": "uuid-string"
}
```

You can also use the `create_prompt_book_config` tool to add prompt books to the configuration.
# Prompt Book Server

An MCP server that connects to Notion databases containing AI prompts, allowing you to manage, search, and retrieve prompts efficiently across multiple prompt collections.

## What does prompt book server do?

The Prompt Book Server is a powerful tool that helps you organize and access your AI prompts stored in Notion databases. It provides the following key capabilities:

- **Multiple Prompt Books**: Manage multiple collections of prompts (prompt books) with different Notion databases
- **Prompt Discovery**: Search, filter, and browse prompts by title, type, or tags
- **Prompt Retrieval**: Quickly access the full content of any prompt
- **Prompt Management**: Add new prompts, update existing ones, and copy prompts between books
- **Database Creation**: Create new prompt databases with the proper schema directly in Notion

The server acts as a bridge between your AI tools and your Notion-based prompt collections, making it easy to maintain a centralized library of prompts that can be accessed from various coding and AI tools.

## All the tools

### Configuration Management Tools

| Tool Name | Description |
|-----------|-------------|
| `list_prompt_books` | Lists all configured prompt books |
| `create_prompt_book_config` | Adds a new prompt book configuration |
| `remove_prompt_book_config` | Removes a prompt book configuration |
| `activate_prompt_book` | Sets a prompt book as active |
| `rename_prompt_book` | Renames a prompt book configuration |
| `create_prompt_database` | Creates a new prompt database in Notion and adds it to the configuration |
| `copy_prompt` | Copies a prompt from one book to another |

### Prompt Management Tools

| Tool Name | Description |
|-----------|-------------|
| `list_prompts` | Lists all prompts in the active database |
| `search_prompts_by_title` | Searches prompts by title |
| `get_prompts_by_tag` | Gets prompts filtered by a specific tag |
| `get_prompts_by_type` | Gets prompts filtered by a specific type |
| `read_prompt` | Reads the full content of a specific prompt |
| `list_all_types` | Lists all unique prompt types in the database |
| `list_all_tags` | Lists all unique tags used in the database |
| `add_prompt` | Adds a new prompt to the database |
| `update_prompt` | Updates an existing prompt in the database |

## How to configure it in my coding tool?

### 1. Install the MCP Server

First, ensure you have the prompt-book-mcp-server installed and built:

```bash
git clone https://github.com/your-org/prompt-book-mcp-server.git
cd prompt-book-mcp-server
npm install
npm run build
```

### 2. Add to MCP Configuration

Add the server to your MCP configuration file. The location depends on your coding tool:

#### For VSCode with Roo Cline:
Edit `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`

#### For Claude Desktop:
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following configuration:

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
        "read_prompt",
        "list_all_types",
        "list_all_tags"
      ]
    }
  }
}
```

### 3. Create Configuration Directory

The server stores its configuration in `~/.mcp_config/prompt_book.json`. Create this directory if it doesn't exist:

```bash
mkdir -p ~/.mcp_config
```

The configuration file will be created automatically when you add your first prompt book.

## Example prompts to work with it

Here are some example prompts you can use to interact with the Prompt Book Server:

### Listing and Searching Prompts

```
List all my prompt books.
```

```
Show me all prompts in my active prompt book.
```

```
Search for prompts related to "GPUImage" in my prompt book.
```

```
Show me all prompts with the tag "PicCollage".
```

```
List all prompts of type "Coding".
```

```
What types of prompts are available in my prompt book?
```

### Reading Prompts

```
Show me the content of the prompt with ID "1a748be2-b632-8098-8d9b-c5f89918431d".
```

```
Get the full text of the "GPUImage Filter to KraftShader Porting" prompt.
```

### Managing Prompt Books

```
Activate my "Engineering Shared Prompt Book".
```

```
Copy the "GPUImage Filter to KraftShader Porting" prompt from my Private book to the Engineering book.
```

```
Create a new prompt book called "Team Prompts" connected to my Notion database.
```

### Adding and Updating Prompts

```
Add a new prompt titled "React Component Generator" with type "Coding" and tags ["React", "Frontend"].
```

```
Update the "React Component Generator" prompt to include TypeScript support.
```

## How to add a new prompt book?

You have three main options for adding a new prompt book:

### Option 1: Connect to an Existing Notion Database

If you already have a Notion database with prompts, you can connect it directly:

1. Get your Notion API token from [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Share your Notion database with your integration
3. Get the database ID from the URL (it's the part after the workspace name and before the question mark)
4. Use the `create_prompt_book_config` tool:

```
Add a new prompt book with the following details:
- Name: "My Team Prompts"
- Notion token: "secret_abc123..."
- Notion database ID: "1a748be2b63280988d9bc5f89918431d"
```

### Option 2: Create a New Notion Database

If you want to create a fresh prompt database with the correct schema:

1. Get your Notion API token from [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Find the ID of a Notion page where you want to create the database
3. Use the `create_prompt_database` tool:

```
Create a new prompt database with these details:
- Name: "My New Prompt Book"
- Notion token: "secret_abc123..."
- Page ID: "1a748be2b63280988d9bc5f89918431d"
- Activate: true
```

This will create a new database with the proper schema (Name, Type, Tags) and add it to your configuration.

### Option 3: Manual Configuration

You can also manually edit the configuration file:

1. Edit `~/.mcp_config/prompt_book.json`
2. Add a new entry to the `promptBooks` array:

```json
{
  "promptBooks": [
    {
      "id": "generate-a-uuid-here",
      "name": "My Prompt Book",
      "notion_token": "your-notion-api-token",
      "notion_database_id": "your-notion-database-id"
    }
  ],
  "activePromptBookId": "generate-a-uuid-here"
}
```

### Notion Database Requirements

For optimal functionality, your Notion database should have the following properties:

- **Name** (title): The title of the prompt
- **Type** (select): The category of the prompt (e.g., "Coding", "Image Generation")
- **Tags** (multi-select): Tags for organizing and filtering prompts

The prompt content itself is stored in the page body as blocks of text.

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

### Configuration File Structure

The configuration file at `~/.mcp_config/prompt_book.json` has the following structure:

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
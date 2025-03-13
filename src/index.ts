#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.mcp_config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'prompt_book.json');

// Error messages
const NO_ACTIVE_PROMPT_BOOK = "No active prompt book selected. Use the activate_prompt_book tool to select a prompt book.";
const DATABASE_ERROR_MESSAGE = "Database ID is empty or invalid. Please use the create_prompt_database tool to create a new prompt database.";

// Interfaces for our data structures
interface PromptBook {
  id: string;
  name: string;
  notion_token: string;
  notion_database_id: string;
}

interface PromptBookConfig {
  promptBooks: PromptBook[];
  activePromptBookId?: string;
}

interface PromptListItem {
  id: string;
  title: string;
  type?: string;
  tags?: string[];
  url?: string;
}

interface PromptContent {
  id: string;
  title: string;
  content: string;
  type?: string;
  tags?: string[];
  url?: string;
}

class PromptBookServer {
  private server: Server;
  private notion: Client | null = null;
  private config: PromptBookConfig = { promptBooks: [] };
  private activePromptBook: PromptBook | null = null;

  constructor() {
    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'prompt-book-server',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Load configuration
    this.loadConfig();
    
    // Set up tool handlers
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Load configuration from file
  private loadConfig() {
    try {
      // Check if config directory exists, create if not
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      // Check if config file exists, create empty config if not
      if (!fs.existsSync(CONFIG_FILE)) {
        this.config = { promptBooks: [] };
        this.saveConfig();
        return;
      }

      // Read and parse config file
      const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(configData);

      // Set active prompt book if one is specified
      if (this.config.activePromptBookId) {
        this.setActivePromptBook(this.config.activePromptBookId);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      this.config = { promptBooks: [] };
    }
  }

  // Save configuration to file
  private saveConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving configuration:', error);
    }
  }

  // Set active prompt book by ID
  private setActivePromptBook(promptBookId: string): boolean {
    const promptBook = this.config.promptBooks.find(pb => pb.id === promptBookId);
    
    if (!promptBook) {
      this.activePromptBook = null;
      this.notion = null;
      return false;
    }

    this.activePromptBook = promptBook;
    this.notion = new Client({
      auth: promptBook.notion_token,
    });
    
    // Update config
    this.config.activePromptBookId = promptBookId;
    this.saveConfig();
    
    return true;
  }

  private setupToolHandlers() {
    // List all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Configuration management tools
        {
          name: 'create_prompt_book_config',
          description: 'Add a new prompt book configuration',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the prompt book',
              },
              notion_token: {
                type: 'string',
                description: 'Notion API token with access to the prompts database',
              },
              notion_database_id: {
                type: 'string',
                description: 'ID of the Notion database containing the prompts',
              },
            },
            required: ['name', 'notion_token', 'notion_database_id'],
          },
        },
        {
          name: 'copy_prompt',
          description: 'Copy a prompt from one book to another',
          inputSchema: {
            type: 'object',
            properties: {
              prompt_id: {
                type: 'string',
                description: 'ID of the prompt to copy',
              },
              source_book_id: {
                type: 'string',
                description: 'ID of the source prompt book (optional if using the active book as source)',
              },
              destination_book_id: {
                type: 'string',
                description: 'ID of the destination prompt book to copy the prompt to',
              },
            },
            required: ['prompt_id', 'destination_book_id'],
          },
        },
        {
          name: 'remove_prompt_book_config',
          description: 'Remove a prompt book configuration',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ID of the prompt book to remove',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'activate_prompt_book',
          description: 'Set a prompt book as active',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ID of the prompt book to activate',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'list_prompt_books',
          description: 'List all configured prompt books',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'rename_prompt_book',
          description: 'Rename a prompt book configuration',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ID of the prompt book to rename',
              },
              name: {
                type: 'string',
                description: 'New name for the prompt book',
              },
            },
            required: ['id', 'name'],
          },
        },
        // Existing tools
        {
          name: 'list_prompts',
          description: 'List all prompts in the database',
          inputSchema: {
            type: 'object',
            properties: {
              show_all_fields: {
                type: 'boolean',
                description: 'If true, shows all fields including tags and url. Default is false, showing only id, title, and type.',
              },
            },
          },
        },
        {
          name: 'search_prompts_by_title',
          description: 'Search prompts by title',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for prompt titles',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_prompts_by_tag',
          description: 'Get prompts by tag',
          inputSchema: {
            type: 'object',
            properties: {
              tag: {
                type: 'string',
                description: 'Tag to filter prompts by',
              },
            },
            required: ['tag'],
          },
        },
        {
          name: 'get_prompts_by_type',
          description: 'Get prompts by type',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type to filter prompts by (e.g., "Coding", "Image Generation", "Conversation")',
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'read_prompt',
          description: 'Read the content of a specific prompt',
          inputSchema: {
            type: 'object',
            properties: {
              prompt_id: {
                type: 'string',
                description: 'ID of the prompt to read',
              },
            },
            required: ['prompt_id'],
          },
        },
        {
          name: 'list_all_types',
          description: 'List all unique prompt types in the database',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_all_tags',
          description: 'List all unique tags used in the database',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'create_prompt_database',
          description: 'Create a new prompt database and add it to the configuration',
          inputSchema: {
            type: 'object',
            properties: {
              page_id: {
                type: 'string',
                description: 'ID of the page where the database will be created',
              },
              name: {
                type: 'string',
                description: 'Name of the prompt book to create',
              },
              notion_token: {
                type: 'string',
                description: 'Notion API token with access to the prompts database',
              },
              activate: {
                type: 'boolean',
                description: 'Whether to set the new prompt book as active (default: false)',
              },
            },
            required: ['page_id', 'name', 'notion_token'],
          },
        },
        {
          name: 'add_prompt',
          description: 'Add a new prompt to the database',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the prompt',
              },
              detailed_prompt: {
                type: 'string',
                description: 'The detailed content of the prompt',
              },
              type: {
                type: 'string',
                description: 'Type of the prompt. Use the list_all_types tool to check existing types to use.',
              },
              tags: {
                type: 'array',
                description: 'Optional list of tags for the prompt',
                items: {
                  type: 'string'
                }
              },
            },
            required: ['name', 'detailed_prompt', 'type'],
          },
        },
        {
          name: 'update_prompt',
          description: 'Update an existing prompt in the database',
          inputSchema: {
            type: 'object',
            properties: {
              prompt_id: {
                type: 'string',
                description: 'ID of the prompt to update',
              },
              name: {
                type: 'string',
                description: 'New name for the prompt (optional)',
              },
              detailed_prompt: {
                type: 'string',
                description: 'New detailed content for the prompt (optional)',
              },
              type: {
                type: 'string',
                description: 'New type for the prompt (optional). Use the list_all_types tool to check existing types.',
              },
              tags: {
                type: 'array',
                description: 'New list of tags for the prompt (optional)',
                items: {
                  type: 'string'
                }
              },
            },
            required: ['prompt_id'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Handle configuration management tools
        if (request.params.name === 'create_prompt_book_config') {
          return await this.createPromptBookConfig(request.params.arguments);
        } else if (request.params.name === 'remove_prompt_book_config') {
          return await this.removePromptBookConfig(request.params.arguments);
        } else if (request.params.name === 'activate_prompt_book') {
          return await this.activatePromptBook(request.params.arguments);
        } else if (request.params.name === 'list_prompt_books') {
          return await this.listPromptBooks();
        } else if (request.params.name === 'rename_prompt_book') {
          return await this.renamePromptBook(request.params.arguments);
        } else if (request.params.name === 'copy_prompt') {
          return await this.copyPrompt(request.params.arguments);
        } else if (request.params.name === 'create_prompt_database') {
          // Handle create_prompt_database separately as it now creates a new prompt book
          return await this.createPromptDatabase(request.params.arguments);
        }
        
        // For all other tools, check if active prompt book is set and database ID is valid
        if (!this.activePromptBook || !this.notion) {
          return {
            content: [
              {
                type: 'text',
                text: NO_ACTIVE_PROMPT_BOOK,
              },
            ],
            isError: true,
          };
        }
        
        if (!this.activePromptBook.notion_database_id) {
          return {
            content: [
              {
                type: 'text',
                text: DATABASE_ERROR_MESSAGE,
              },
            ],
            isError: true,
          };
        }
        
        // Handle other tools
        switch (request.params.name) {
          case 'list_prompts':
            return await this.listPrompts(request.params.arguments);
          case 'search_prompts_by_title':
            return await this.searchPromptsByTitle(request.params.arguments);
          case 'get_prompts_by_tag':
            return await this.getPromptsByTag(request.params.arguments);
          case 'get_prompts_by_type':
            return await this.getPromptsByType(request.params.arguments);
          case 'read_prompt':
            return await this.readPrompt(request.params.arguments);
          case 'list_all_types':
            return await this.listAllTypes(request.params.arguments);
          case 'list_all_tags':
            return await this.listAllTags(request.params.arguments);
          case 'add_prompt':
            return await this.addPrompt(request.params.arguments);
          case 'update_prompt':
            return await this.updatePrompt(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        console.error('Error handling tool call:', error);
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  // Create a new prompt book configuration
  private async createPromptBookConfig(args: any): Promise<any> {
    if (!args?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Name is required');
    }
    if (!args?.notion_token) {
      throw new McpError(ErrorCode.InvalidParams, 'Notion token is required');
    }
    if (!args?.notion_database_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Notion database ID is required');
    }

    try {
      // Always reload the configuration from file before adding a new prompt book
      this.loadConfig();
      
      // Create new prompt book
      const newPromptBook: PromptBook = {
        id: uuidv4(),
        name: args.name,
        notion_token: args.notion_token,
        notion_database_id: args.notion_database_id,
      };

      // Add to config
      this.config.promptBooks.push(newPromptBook);
      
      // If this is the first prompt book, set it as active
      if (this.config.promptBooks.length === 1) {
        this.config.activePromptBookId = newPromptBook.id;
        this.setActivePromptBook(newPromptBook.id);
      }
      
      // Save config
      this.saveConfig();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt book configuration created successfully',
              prompt_book_id: newPromptBook.id,
              prompt_book_name: newPromptBook.name,
              is_active: this.config.activePromptBookId === newPromptBook.id,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error creating prompt book configuration:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error creating prompt book configuration: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Remove a prompt book configuration
  private async removePromptBookConfig(args: any): Promise<any> {
    if (!args?.id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt book ID is required');
    }

    try {
      // Always reload the configuration from file before removing a prompt book
      this.loadConfig();
      
      const promptBookId = args.id;
      const promptBookIndex = this.config.promptBooks.findIndex(pb => pb.id === promptBookId);
      
      if (promptBookIndex === -1) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Prompt book with ID "${promptBookId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // Remove prompt book
      this.config.promptBooks.splice(promptBookIndex, 1);
      
      // If the removed prompt book was active, clear active prompt book
      if (this.config.activePromptBookId === promptBookId) {
        this.config.activePromptBookId = undefined;
        this.activePromptBook = null;
        this.notion = null;
      }
      
      // Save config
      this.saveConfig();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt book configuration removed successfully',
              prompt_book_id: promptBookId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error removing prompt book configuration:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error removing prompt book configuration: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Activate a prompt book
  private async activatePromptBook(args: any): Promise<any> {
    if (!args?.id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt book ID is required');
    }

    try {
      // Always reload the configuration from file before activating a prompt book
      this.loadConfig();
      
      const promptBookId = args.id;
      const promptBook = this.config.promptBooks.find(pb => pb.id === promptBookId);
      
      if (!promptBook) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Prompt book with ID "${promptBookId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // Set active prompt book
      if (!this.setActivePromptBook(promptBookId)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Failed to activate prompt book with ID "${promptBookId}".`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt book activated successfully',
              prompt_book_id: promptBookId,
              prompt_book_name: promptBook.name,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error activating prompt book:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error activating prompt book: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // List all prompt books
  private async listPromptBooks(): Promise<any> {
    try {
      // Always reload the configuration from file to get the latest prompt books
      this.loadConfig();
      
      const promptBooks = this.config.promptBooks.map(pb => ({
        id: pb.id,
        name: pb.name,
        is_active: this.config.activePromptBookId === pb.id,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt_books: promptBooks,
              count: promptBooks.length,
              active_prompt_book_id: this.config.activePromptBookId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error listing prompt books:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error listing prompt books: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Rename a prompt book
  private async renamePromptBook(args: any): Promise<any> {
    if (!args?.id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt book ID is required');
    }
    if (!args?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'New name is required');
    }

    try {
      // Always reload the configuration from file before renaming a prompt book
      this.loadConfig();
      
      const promptBookId = args.id;
      const newName = args.name;
      
      // Find the prompt book by ID
      const promptBookIndex = this.config.promptBooks.findIndex(pb => pb.id === promptBookId);
      
      if (promptBookIndex === -1) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Prompt book with ID "${promptBookId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // Store the old name for the response message
      const oldName = this.config.promptBooks[promptBookIndex].name;
      
      // Update the name
      this.config.promptBooks[promptBookIndex].name = newName;
      
      // Save the updated configuration
      this.saveConfig();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt book renamed successfully',
              prompt_book_id: promptBookId,
              old_name: oldName,
              new_name: newName,
              is_active: this.config.activePromptBookId === promptBookId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error renaming prompt book:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error renaming prompt book: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Helper method to fetch all pages of results
  private async fetchAllResults(queryParams: any): Promise<any[]> {
    if (!this.notion) {
      throw new Error('Notion client not initialized');
    }

    let allResults: any[] = [];
    let hasMore = true;
    let cursor: string | undefined = undefined;

    while (hasMore) {
      const response = await this.notion.databases.query({
        ...queryParams,
        page_size: 100,
        start_cursor: cursor,
      });

      allResults = [...allResults, ...response.results];
      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;

      // Safety check to prevent infinite loops
      if (!cursor && hasMore) {
        break;
      }
    }

    return allResults;
  }

  // List all prompts
  private async listPrompts(args: any): Promise<any> {
    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // Check if we should show all fields
      const showAllFields = args?.show_all_fields === true;

      const allResults = await this.fetchAllResults({
        database_id: this.activePromptBook.notion_database_id,
      });

      const prompts = await this.processPromptResults(allResults, showAllFields);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompts,
              count: prompts.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error listing prompts:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error listing prompts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Search prompts by title
  private async searchPromptsByTitle(args: any): Promise<any> {
    if (!args?.query) {
      throw new McpError(ErrorCode.InvalidParams, 'Search query is required');
    }

    const query = args.query;

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      const allResults = await this.fetchAllResults({
        database_id: this.activePromptBook.notion_database_id,
        filter: {
          property: 'Name',
          title: {
            contains: query,
          },
        },
      });

      // For search results, always show all fields
      const prompts = await this.processPromptResults(allResults, true);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompts,
              count: prompts.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error searching prompts by title:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error searching prompts by title: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Get prompts by tag
  private async getPromptsByTag(args: any): Promise<any> {
    if (!args?.tag) {
      throw new McpError(ErrorCode.InvalidParams, 'Tag is required');
    }

    const tag = args.tag;

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      const allResults = await this.fetchAllResults({
        database_id: this.activePromptBook.notion_database_id,
        filter: {
          property: 'Tags',
          multi_select: {
            contains: tag,
          },
        },
      });

      // For tag-filtered results, always show all fields
      const prompts = await this.processPromptResults(allResults, true);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompts,
              count: prompts.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error getting prompts by tag:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error getting prompts by tag: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Get prompts by type
  private async getPromptsByType(args: any): Promise<any> {
    if (!args?.type) {
      throw new McpError(ErrorCode.InvalidParams, 'Type is required');
    }

    const type = args.type;

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      const allResults = await this.fetchAllResults({
        database_id: this.activePromptBook.notion_database_id,
        filter: {
          property: 'Type',
          select: {
            equals: type,
          },
        },
      });

      // For type-filtered results, always show all fields
      const prompts = await this.processPromptResults(allResults, true);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompts,
              count: prompts.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error getting prompts by type:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error getting prompts by type: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Helper method to fetch all blocks for a page
  private async fetchAllBlocks(blockId: string): Promise<any[]> {
    if (!this.notion) {
      throw new Error('Notion client not initialized');
    }

    let allBlocks: any[] = [];
    let hasMore = true;
    let cursor: string | undefined = undefined;

    while (hasMore) {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor,
      });

      allBlocks = [...allBlocks, ...response.results];
      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;

      // Safety check to prevent infinite loops
      if (!cursor && hasMore) {
        break;
      }
    }

    return allBlocks;
  }

  // Read a specific prompt's content
  private async readPrompt(args: any): Promise<any> {
    if (!args?.prompt_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt ID is required');
    }

    const promptId = args.prompt_id;

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // First, get the page metadata
      const pageResponse = await this.notion.pages.retrieve({
        page_id: promptId,
      });

      // Extract basic page info
      const pageInfo = this.extractPageInfo(pageResponse);

      // Then, get all page content (blocks)
      const allBlocks = await this.fetchAllBlocks(promptId);

      // Extract the content as plain text
      const content = await this.extractContentFromBlocks(allBlocks);

      return {
        content: [
          {
            type: 'text',
            text: content,
          },
        ],
      };
    } catch (error) {
      console.error('Error reading prompt:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error reading prompt: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Helper method to process prompt results from Notion API
  private async processPromptResults(results: any[], showAllFields: boolean = false): Promise<PromptListItem[]> {
    return results.map((page) => this.extractPageInfo(page, showAllFields));
  }

  // Helper method to extract page info from Notion API response
  private extractPageInfo(page: any, showAllFields: boolean = false): PromptListItem {
    const id = page.id;
    
    // Extract title
    let title = '';
    if (page.properties?.Name?.title) {
      title = page.properties.Name.title
        .map((titlePart: any) => titlePart.plain_text)
        .join('');
    }

    // Extract type
    let type = undefined;
    if (page.properties?.Type?.select) {
      type = page.properties.Type.select.name;
    }

    // Create the basic result with required fields
    const result: PromptListItem = {
      id,
      title,
      type,
    };

    // Add optional fields only if showAllFields is true
    if (showAllFields) {
      // Extract tags
      if (page.properties?.Tags?.multi_select) {
        result.tags = page.properties.Tags.multi_select.map((tag: any) => tag.name);
      }
      
      // Add URL
      result.url = page.url;
    }

    return result;
  }

  // Helper method to extract content from blocks
  private async extractContentFromBlocks(blocks: any[], listNumbering: { [key: string]: number } = {}, indentLevel: number = 0): Promise<string> {
    let content = '';
    let currentListType: string | null = null;
    let currentListId = '';

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const indent = '  '.repeat(indentLevel);
      
      // Track list context for proper numbering
      const isNumberedList = block.type === 'numbered_list_item';
      const isBulletedList = block.type === 'bulleted_list_item';
      const isList = isNumberedList || isBulletedList;
      
      // Generate a unique ID for the current list context
      const listId = `${indentLevel}-${isNumberedList ? 'numbered' : isBulletedList ? 'bulleted' : 'none'}`;
      
      // Handle list transitions
      if (isList) {
        // If this is a new list or switching list types
        if (currentListType !== block.type || currentListId !== listId) {
          // Reset numbering for new numbered lists
          if (isNumberedList && (currentListType !== block.type || currentListId !== listId)) {
            listNumbering[listId] = 1;
          }
          currentListType = block.type;
          currentListId = listId;
        }
      } else {
        // Not a list item, reset list context
        currentListType = null;
        currentListId = '';
      }

      // Process block based on type
      if (block.type === 'paragraph') {
        const text = block.paragraph.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}${text}\n\n`;
      } else if (block.type === 'heading_1') {
        const text = block.heading_1.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}# ${text}\n\n`;
      } else if (block.type === 'heading_2') {
        const text = block.heading_2.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}## ${text}\n\n`;
      } else if (block.type === 'heading_3') {
        const text = block.heading_3.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}### ${text}\n\n`;
      } else if (block.type === 'bulleted_list_item') {
        const text = block.bulleted_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}• ${text}`;
        
        // Handle child blocks for list items
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel + 1);
          if (childContent.trim()) {
            content += '\n' + childContent;
          }
        }
        content += '\n';
      } else if (block.type === 'numbered_list_item') {
        const text = block.numbered_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        
        // Use sequential numbering
        const number = listNumbering[listId] || 1;
        content += `${indent}${number}. ${text}`;
        
        // Increment the counter for this list
        listNumbering[listId] = number + 1;
        
        // Handle child blocks for list items
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel + 1);
          if (childContent.trim()) {
            content += '\n' + childContent;
          }
        }
        content += '\n';
      } else if (block.type === 'code') {
        const text = block.code.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const language = block.code.language || '';
        // Use HTML code tags for code blocks to avoid markdown formatting issues
        content += `${indent}<pre><code class="${language}">\n${text}\n</code></pre>\n\n`;
      } else if (block.type === 'quote') {
        const text = block.quote.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}> ${text}\n\n`;
      } else if (block.type === 'divider') {
        content += `${indent}---\n\n`;
      } else if (block.type === 'toggle') {
        const text = block.toggle.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}**${text}**\n\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'to_do') {
        const text = block.to_do.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const checked = block.to_do.checked ? 'x' : ' ';
        content += `${indent}- [${checked}] ${text}\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'callout') {
        const text = block.callout.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const emoji = block.callout.icon?.emoji || '';
        content += `${indent}> ${emoji} **Note:** ${text}\n\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'table') {
        if (block.has_children) {
          const tableRows = await this.fetchAllBlocks(block.id);
          content += await this.formatTableContent(tableRows, indent);
        }
      } else if (block.type === 'image') {
        // Handle image blocks
        let imageUrl = '';
        if (block.image.type === 'external') {
          imageUrl = block.image.external.url;
        } else if (block.image.type === 'file') {
          imageUrl = block.image.file.url;
        }
        
        const caption = block.image.caption?.length > 0
          ? block.image.caption.map((c: any) => c.plain_text).join('')
          : 'Image';
          
        content += `${indent}![${caption}](${imageUrl})\n\n`;
      } else if (block.type === 'bookmark') {
        // Handle bookmark blocks
        const url = block.bookmark.url;
        const caption = block.bookmark.caption?.length > 0
          ? block.bookmark.caption.map((c: any) => c.plain_text).join('')
          : url;
          
        content += `${indent}[${caption}](${url})\n\n`;
      } else if (block.type === 'embed' || block.type === 'video' || block.type === 'audio' || block.type === 'file' || block.type === 'pdf') {
        // Handle embed, video, audio, file, and PDF blocks
        let url = '';
        if (block[block.type].type === 'external') {
          url = block[block.type].external.url;
        } else if (block[block.type].type === 'file') {
          url = block[block.type].file.url;
        }
        
        content += `${indent}[${block.type.charAt(0).toUpperCase() + block.type.slice(1)}](${url})\n\n`;
      } else if (block.type === 'equation') {
        // Handle equation blocks
        const expression = block.equation.expression;
        content += `${indent}$$\n${expression}\n$$\n\n`;
      } else if (block.type === 'synced_block') {
        // Handle synced blocks by fetching their children
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocks(block.id);
          const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel);
          content += childContent;
        }
      } else if (block.type === 'template') {
        // Handle template blocks
        const text = block.template.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}*Template:* ${text}\n\n`;
      } else if (block.type === 'link_to_page') {
        // Handle link to page blocks
        let pageId = '';
        if (block.link_to_page.type === 'page_id') {
          pageId = block.link_to_page.page_id;
        } else if (block.link_to_page.type === 'database_id') {
          pageId = block.link_to_page.database_id;
        }
        
        content += `${indent}[Link to page](notion://page/${pageId})\n\n`;
      } else if (block.type === 'column_list' && block.has_children) {
        // Handle column lists by processing each column
        const columns = await this.fetchAllBlocks(block.id);
        for (const column of columns) {
          if (column.type === 'column' && column.has_children) {
            const columnBlocks = await this.fetchAllBlocks(column.id);
            const columnContent = await this.extractContentFromBlocks(columnBlocks, listNumbering, indentLevel);
            content += columnContent;
          }
        }
      } else if (block.has_children && !isList) {
        // For other block types with children that aren't already handled
        const childBlocks = await this.fetchAllBlocks(block.id);
        const childContent = await this.extractContentFromBlocks(childBlocks, listNumbering, indentLevel);
        content += childContent;
      }
    }

    return content;
  }
  
  // Helper method to format table content
  private async formatTableContent(tableRows: any[], indent: string): Promise<string> {
    let tableContent = '';
    let headerRow: string[] = [];
    let hasProcessedHeader = false;
    
    for (const row of tableRows) {
      if (row.type === 'table_row') {
        const cells = row.table_row.cells.map((cell: any[]) =>
          cell.map((textPart: any) => textPart.plain_text).join('')
        );
        
        if (!hasProcessedHeader) {
          // First row is the header
          headerRow = cells;
          hasProcessedHeader = true;
          
          // Add header row
          tableContent += `${indent}| ${cells.join(' | ')} |\n`;
          
          // Add separator row
          tableContent += `${indent}| ${cells.map(() => '---').join(' | ')} |\n`;
        } else {
          // Data rows
          tableContent += `${indent}| ${cells.join(' | ')} |\n`;
        }
      }
    }
    
    return tableContent + '\n';
  }

  // Helper method to split text into chunks that respect Notion's 2000 character limit
  private splitTextIntoChunks(text: string, maxLength: number = 2000): string[] {
    const chunks: string[] = [];
    
    // If text is already within limits, return it as a single chunk
    if (text.length <= maxLength) {
      return [text];
    }
    
    let remainingText = text;
    
    while (remainingText.length > 0) {
      // If remaining text fits in a chunk, add it and break
      if (remainingText.length <= maxLength) {
        chunks.push(remainingText);
        break;
      }
      
      // Find a good breaking point (preferably at a paragraph or sentence)
      let breakPoint = maxLength;
      
      // Try to find paragraph break within the limit
      const paragraphBreak = remainingText.lastIndexOf('\n\n', maxLength);
      if (paragraphBreak > maxLength / 2) {
        breakPoint = paragraphBreak + 2; // Include the newlines
      } else {
        // Try to find sentence break within the limit
        const sentenceBreak = Math.max(
          remainingText.lastIndexOf('. ', maxLength),
          remainingText.lastIndexOf('! ', maxLength),
          remainingText.lastIndexOf('? ', maxLength)
        );
        
        if (sentenceBreak > maxLength / 2) {
          breakPoint = sentenceBreak + 2; // Include the period and space
        } else {
          // If no good break found, try to break at a space
          const spaceBreak = remainingText.lastIndexOf(' ', maxLength);
          if (spaceBreak > maxLength / 2) {
            breakPoint = spaceBreak + 1; // Include the space
          }
          // If no good break found, just break at the max length
        }
      }
      
      // Add the chunk and update remaining text
      chunks.push(remainingText.substring(0, breakPoint));
      remainingText = remainingText.substring(breakPoint);
    }
    
    console.error(`Split text into ${chunks.length} chunks (original length: ${text.length})`);
    return chunks;
  }
  
  // Helper method to create paragraph blocks from text chunks
  private createParagraphBlocksFromText(text: string): any[] {
    const chunks = this.splitTextIntoChunks(text);
    
    return chunks.map(chunk => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: chunk,
            },
          },
        ],
      },
    }));
  }

  // List all unique types in the database
  private async listAllTypes(args: any): Promise<any> {
    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // Retrieve the database schema to get all possible type options
      const databaseResponse = await this.notion.databases.retrieve({
        database_id: this.activePromptBook.notion_database_id,
      });

      // Extract all possible type options from the database schema
      const typeProperty = databaseResponse.properties?.Type as any;
      const typeOptions = typeProperty?.select?.options || [];
      const allTypes = typeOptions.map((option: { name: string }) => option.name);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              types: allTypes,
              count: allTypes.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error listing all types:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error listing all types: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  // Helper method to format page ID with hyphens (8-4-4-4-12)
  private formatPageId(id: string): string {
    // Remove hyphens if they exist
    const cleanId = id.replace(/-/g, '');
    
    // Format with hyphens (8-4-4-4-12)
    if (cleanId.length === 32) {
      return `${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}`;
    }
    
    return id; // Return original if not 32 chars
  }


  // Create a new prompt database
  private async createPromptDatabase(args: any): Promise<any> {
    if (!args?.page_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Page ID is required');
    }
    if (!args?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Name is required');
    }
    if (!args?.notion_token) {
      throw new McpError(ErrorCode.InvalidParams, 'Notion token is required');
    }

    const pageId = args.page_id;
    const name = args.name;
    const notionToken = args.notion_token;
    const activate = args.activate === true; // Default to false if not provided

    try {
      // Always reload the configuration from file before creating a new prompt database
      this.loadConfig();
      
      // Create a temporary Notion client with the provided token
      const tempNotion = new Client({
        auth: notionToken,
      });

      // Create a new database with the same schema as the analyzed database
      const response = await tempNotion.databases.create({
        parent: {
          type: 'page_id',
          page_id: this.formatPageId(pageId),
        },
        title: [
          {
            type: 'text',
            text: {
              content: name, // Use the provided name instead of hardcoded value
            },
          },
        ],
        properties: {
          Name: {
            title: {},
          },
          Type: {
            select: {
              options: [
                {
                  name: 'Coding',
                  color: 'pink',
                },
                {
                  name: 'Image Generation',
                  color: 'green',
                },
                {
                  name: 'Conversation',
                  color: 'brown',
                },
                {
                  name: 'Task',
                  color: 'blue',
                },
                {
                  name: 'Prompting',
                  color: 'purple',
                },
                {
                  name: 'Find Tool',
                  color: 'yellow',
                },
                {
                  name: 'Product Management',
                  color: 'orange',
                },
                {
                  name: 'Technical',
                  color: 'gray',
                },
                {
                  name: 'Evaluation',
                  color: 'red',
                },
                {
                  name: 'Consultant',
                  color: 'green',
                },
                {
                  name: 'Project Setup',
                  color: 'blue',
                },
                {
                  name: 'Quiz',
                  color: 'purple',
                },
                {
                  name: 'Documentation',
                  color: 'yellow',
                },
                {
                  name: 'Writing',
                  color: 'orange',
                },
                {
                  name: 'DevOps',
                  color: 'gray',
                },
                {
                  name: 'Debugging',
                  color: 'red',
                },
                {
                  name: 'Research',
                  color: 'pink',
                },
              ],
            },
          },
          Tags: {
            multi_select: {
              options: [], // We'll leave this empty as per the requirement
            },
          },
        },
      });

      // Create a new prompt book with the newly created database ID
      const newPromptBook: PromptBook = {
        id: uuidv4(),
        name: name,
        notion_token: notionToken,
        notion_database_id: response.id,
      };

      // Add to config
      this.config.promptBooks.push(newPromptBook);
      
      // Set it as active only if activate is true
      if (activate) {
        this.config.activePromptBookId = newPromptBook.id;
        this.setActivePromptBook(newPromptBook.id);
      }
      
      // Save config
      this.saveConfig();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt database created and added to configuration successfully',
              database_id: response.id,
              prompt_book_id: newPromptBook.id,
              prompt_book_name: newPromptBook.name,
              is_active: activate,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error creating prompt database:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error creating prompt database: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Copy a prompt from one book to another
  private async copyPrompt(args: any): Promise<any> {
    // Validate required parameters
    if (!args?.prompt_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt ID is required');
    }
    if (!args?.destination_book_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Destination prompt book ID is required');
    }

    const promptId = args.prompt_id;
    const destinationBookId = args.destination_book_id;
    const sourceBookId = args.source_book_id; // Optional, if not provided, use active book

    try {
      // Always reload the configuration from file before copying a prompt
      this.loadConfig();
      
      // If source_book_id is provided, use it; otherwise use the active book
      let sourceBook: PromptBook | null = null;
      let sourceNotion: Client | null = null;

      if (sourceBookId) {
        // Find the source book by ID
        sourceBook = this.config.promptBooks.find(pb => pb.id === sourceBookId) || null;
        if (!sourceBook) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Source prompt book with ID "${sourceBookId}" not found.`,
              },
            ],
            isError: true,
          };
        }
        
        // Create a Notion client for the source book
        sourceNotion = new Client({
          auth: sourceBook.notion_token,
        });
      } else {
        // Use the active book as source
        if (!this.activePromptBook || !this.notion) {
          return {
            content: [
              {
                type: 'text',
                text: NO_ACTIVE_PROMPT_BOOK,
              },
            ],
            isError: true,
          };
        }
        sourceBook = this.activePromptBook;
        sourceNotion = this.notion;
      }

      // Find the destination book by ID
      const destinationBook = this.config.promptBooks.find(pb => pb.id === destinationBookId);
      if (!destinationBook) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Destination prompt book with ID "${destinationBookId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // Create a Notion client for the destination book
      const destinationNotion = new Client({
        auth: destinationBook.notion_token,
      });

      // 1. Retrieve the source prompt
      const pageResponse = await sourceNotion.pages.retrieve({
        page_id: promptId,
      });

      // Extract prompt metadata
      const promptInfo = this.extractPageInfo(pageResponse, true);
      
      // 2. Get the prompt content (blocks)
      const allBlocks = await this.fetchAllBlocksWithClient(promptId, sourceNotion);
      
      // 3. Extract the content as plain text
      const content = await this.extractContentFromBlocksWithClient(allBlocks, sourceNotion, {}, 0);

      // 4. Create a new prompt in the destination book
      const response = await destinationNotion.pages.create({
        parent: {
          database_id: destinationBook.notion_database_id,
        },
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: promptInfo.title,
                },
              },
            ],
          },
          Type: {
            select: {
              name: promptInfo.type || 'Coding', // Default to 'Coding' if no type is specified
            },
          },
          Tags: {
            multi_select: (promptInfo.tags || []).map((tag: string) => ({ name: tag })),
          },
        },
        children: this.createParagraphBlocksFromText(content),
      });

      // Extract the ID of the newly created prompt
      const newPromptId = response.id;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt copied successfully',
              source: {
                prompt_id: promptId,
                book_id: sourceBook.id,
                book_name: sourceBook.name,
              },
              destination: {
                prompt_id: newPromptId,
                book_id: destinationBook.id,
                book_name: destinationBook.name,
              }
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error copying prompt:', error);
      
      // Check if the error is related to an invalid database or prompt
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database") ||
           error.message.includes("Could not find page"))) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: The prompt or database could not be found. Please check that the prompt ID and book IDs are correct.`,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error copying prompt: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Helper method to fetch all blocks for a page with a specific Notion client
  private async fetchAllBlocksWithClient(blockId: string, notionClient: Client): Promise<any[]> {
    let allBlocks: any[] = [];
    let hasMore = true;
    let cursor: string | undefined = undefined;

    while (hasMore) {
      const response = await notionClient.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor,
      });

      allBlocks = [...allBlocks, ...response.results];
      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;

      // Safety check to prevent infinite loops
      if (!cursor && hasMore) {
        break;
      }
    }

    return allBlocks;
  }

  // Helper method to extract content from blocks with a specific Notion client
  private async extractContentFromBlocksWithClient(blocks: any[], notionClient: Client, listNumbering: { [key: string]: number } = {}, indentLevel: number = 0): Promise<string> {
    let content = '';
    let currentListType: string | null = null;
    let currentListId = '';

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const indent = '  '.repeat(indentLevel);
      
      // Track list context for proper numbering
      const isNumberedList = block.type === 'numbered_list_item';
      const isBulletedList = block.type === 'bulleted_list_item';
      const isList = isNumberedList || isBulletedList;
      
      // Generate a unique ID for the current list context
      const listId = `${indentLevel}-${isNumberedList ? 'numbered' : isBulletedList ? 'bulleted' : 'none'}`;
      
      // Handle list transitions
      if (isList) {
        // If this is a new list or switching list types
        if (currentListType !== block.type || currentListId !== listId) {
          // Reset numbering for new numbered lists
          if (isNumberedList && (currentListType !== block.type || currentListId !== listId)) {
            listNumbering[listId] = 1;
          }
          currentListType = block.type;
          currentListId = listId;
        }
      } else {
        // Not a list item, reset list context
        currentListType = null;
        currentListId = '';
      }

      // Process block based on type
      if (block.type === 'paragraph') {
        const text = block.paragraph.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}${text}\n\n`;
      } else if (block.type === 'heading_1') {
        const text = block.heading_1.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}# ${text}\n\n`;
      } else if (block.type === 'heading_2') {
        const text = block.heading_2.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}## ${text}\n\n`;
      } else if (block.type === 'heading_3') {
        const text = block.heading_3.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}### ${text}\n\n`;
      } else if (block.type === 'bulleted_list_item') {
        const text = block.bulleted_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}• ${text}`;
        
        // Handle child blocks for list items
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel + 1);
          if (childContent.trim()) {
            content += '\n' + childContent;
          }
        }
        content += '\n';
      } else if (block.type === 'numbered_list_item') {
        const text = block.numbered_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        
        // Use sequential numbering
        const number = listNumbering[listId] || 1;
        content += `${indent}${number}. ${text}`;
        
        // Increment the counter for this list
        listNumbering[listId] = number + 1;
        
        // Handle child blocks for list items
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel + 1);
          if (childContent.trim()) {
            content += '\n' + childContent;
          }
        }
        content += '\n';
      } else if (block.type === 'code') {
        const text = block.code.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const language = block.code.language || '';
        // Use HTML code tags for code blocks to avoid markdown formatting issues
        content += `${indent}<pre><code class="${language}">\n${text}\n</code></pre>\n\n`;
      } else if (block.type === 'quote') {
        const text = block.quote.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}> ${text}\n\n`;
      } else if (block.type === 'divider') {
        content += `${indent}---\n\n`;
      } else if (block.type === 'toggle') {
        const text = block.toggle.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}**${text}**\n\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'to_do') {
        const text = block.to_do.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const checked = block.to_do.checked ? 'x' : ' ';
        content += `${indent}- [${checked}] ${text}\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'callout') {
        const text = block.callout.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const emoji = block.callout.icon?.emoji || '';
        content += `${indent}> ${emoji} **Note:** ${text}\n\n`;
        
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel + 1);
          content += childContent;
        }
      } else if (block.type === 'table') {
        if (block.has_children) {
          const tableRows = await this.fetchAllBlocksWithClient(block.id, notionClient);
          content += await this.formatTableContent(tableRows, indent);
        }
      } else if (block.type === 'image') {
        // Handle image blocks
        let imageUrl = '';
        if (block.image.type === 'external') {
          imageUrl = block.image.external.url;
        } else if (block.image.type === 'file') {
          imageUrl = block.image.file.url;
        }
        
        const caption = block.image.caption?.length > 0
          ? block.image.caption.map((c: any) => c.plain_text).join('')
          : 'Image';
          
        content += `${indent}![${caption}](${imageUrl})\n\n`;
      } else if (block.type === 'bookmark') {
        // Handle bookmark blocks
        const url = block.bookmark.url;
        const caption = block.bookmark.caption?.length > 0
          ? block.bookmark.caption.map((c: any) => c.plain_text).join('')
          : url;
          
        content += `${indent}[${caption}](${url})\n\n`;
      } else if (block.type === 'embed' || block.type === 'video' || block.type === 'audio' || block.type === 'file' || block.type === 'pdf') {
        // Handle embed, video, audio, file, and PDF blocks
        let url = '';
        if (block[block.type].type === 'external') {
          url = block[block.type].external.url;
        } else if (block[block.type].type === 'file') {
          url = block[block.type].file.url;
        }
        
        content += `${indent}[${block.type.charAt(0).toUpperCase() + block.type.slice(1)}](${url})\n\n`;
      } else if (block.type === 'equation') {
        // Handle equation blocks
        const expression = block.equation.expression;
        content += `${indent}$$\n${expression}\n$$\n\n`;
      } else if (block.type === 'synced_block') {
        // Handle synced blocks by fetching their children
        if (block.has_children) {
          const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
          const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel);
          content += childContent;
        }
      } else if (block.type === 'template') {
        // Handle template blocks
        const text = block.template.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += `${indent}*Template:* ${text}\n\n`;
      } else if (block.type === 'link_to_page') {
        // Handle link to page blocks
        let pageId = '';
        if (block.link_to_page.type === 'page_id') {
          pageId = block.link_to_page.page_id;
        } else if (block.link_to_page.type === 'database_id') {
          pageId = block.link_to_page.database_id;
        }
        
        content += `${indent}[Link to page](notion://page/${pageId})\n\n`;
      } else if (block.type === 'column_list' && block.has_children) {
        // Handle column lists by processing each column
        const columns = await this.fetchAllBlocksWithClient(block.id, notionClient);
        for (const column of columns) {
          if (column.type === 'column' && column.has_children) {
            const columnBlocks = await this.fetchAllBlocksWithClient(column.id, notionClient);
            const columnContent = await this.extractContentFromBlocksWithClient(columnBlocks, notionClient, listNumbering, indentLevel);
            content += columnContent;
          }
        }
      } else if (block.has_children && !isList) {
        // For other block types with children that aren't already handled
        const childBlocks = await this.fetchAllBlocksWithClient(block.id, notionClient);
        const childContent = await this.extractContentFromBlocksWithClient(childBlocks, notionClient, listNumbering, indentLevel);
        content += childContent;
      }
    }

    return content;
  }

  // List all unique tags in the database
  private async listAllTags(args: any): Promise<any> {
    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // Retrieve the database schema to get all possible tag options
      const databaseResponse = await this.notion.databases.retrieve({
        database_id: this.activePromptBook.notion_database_id,
      });

      // Extract all possible tag options from the database schema
      const tagsProperty = databaseResponse.properties?.Tags as any;
      const tagOptions = tagsProperty?.multi_select?.options || [];
      const allTags = tagOptions.map((option: { name: string }) => option.name);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tags: allTags,
              count: allTags.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error listing all tags:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error listing all tags: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Add a new prompt to the database
  private async addPrompt(args: any): Promise<any> {
    // Validate required parameters
    if (!args?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Name is required');
    }
    if (!args?.detailed_prompt) {
      throw new McpError(ErrorCode.InvalidParams, 'Detailed prompt content is required');
    }
    if (!args?.type) {
      throw new McpError(ErrorCode.InvalidParams, 'Type is required');
    }

    const name = args.name;
    const detailedPrompt = args.detailed_prompt;
    const type = args.type;
    const tags = args.tags || [];
    
    // Log the length of the detailed prompt
    console.error(`Adding prompt with content length: ${detailedPrompt.length}`);

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // Get the database schema and check type options
      const databaseResponse = await this.notion.databases.retrieve({
        database_id: this.activePromptBook.notion_database_id,
      });

      const typeProperty = databaseResponse.properties?.Type as any;
      const typeOptions = typeProperty?.select?.options || [];
      const validTypes = typeOptions.map((option: { name: string }) => option.name);

      // Check if type exists and add it to the database schema if it doesn't
      if (!validTypes.includes(type)) {
          // Always add the new type to the database schema, regardless of allow_new_type parameter
          try {
            console.error(`Adding new type "${type}" to database schema`);
            
            // Create a new options array with the new type added
            const newOptions = [
              ...typeOptions,
              {
                name: type,
                color: 'default' // Default color for new types
              }
            ];
            
            // Update the database schema with the new type option
            await this.notion.databases.update({
              database_id: this.activePromptBook.notion_database_id,
              properties: {
                Type: {
                  select: {
                    options: newOptions
                  }
                }
              }
            });
            
            console.error(`Successfully added new type "${type}" to database schema`);
          } catch (error) {
            console.error(`Error adding new type "${type}" to database schema:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error adding new type "${type}" to database schema: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
      }

      // Create the new page in the database
      const response = await this.notion.pages.create({
        parent: {
          database_id: this.activePromptBook.notion_database_id,
        },
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: name,
                },
              },
            ],
          },
          Type: {
            select: {
              name: type,
            },
          },
          Tags: {
            multi_select: tags.map((tag: string) => ({ name: tag })),
          },
        },
        children: this.createParagraphBlocksFromText(detailedPrompt),
      });

      // Extract the ID of the newly created prompt
      const newPromptId = response.id;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt added successfully',
              prompt_id: newPromptId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error adding prompt:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error adding prompt: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Update an existing prompt in the database
  private async updatePrompt(args: any): Promise<any> {
    // Validate required parameters
    if (!args?.prompt_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt ID is required');
    }

    const promptId = args.prompt_id;
    
    // Check if any update parameters are provided
    const hasUpdates = args.name !== undefined ||
                       args.detailed_prompt !== undefined ||
                       args.type !== undefined ||
                       args.tags !== undefined;
    
    if (!hasUpdates) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one update parameter (name, detailed_prompt, type, or tags) must be provided');
    }
    
    // Log the length of the detailed prompt if provided
    if (args.detailed_prompt !== undefined) {
      console.error(`Updating prompt with content length: ${args.detailed_prompt.length}`);
    }

    try {
      if (!this.activePromptBook || !this.notion) {
        return {
          content: [
            {
              type: 'text',
              text: NO_ACTIVE_PROMPT_BOOK,
            },
          ],
          isError: true,
        };
      }

      // Check if database ID exists and is valid
      if (!this.activePromptBook.notion_database_id) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      // First, verify the prompt exists by retrieving it
      try {
        await this.notion.pages.retrieve({
          page_id: promptId,
        });
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Prompt with ID "${promptId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // If type is provided, verify it's valid
      if (args.type !== undefined) {
        const databaseResponse = await this.notion.databases.retrieve({
          database_id: this.activePromptBook.notion_database_id,
        });

        const typeProperty = databaseResponse.properties?.Type as any;
        const typeOptions = typeProperty?.select?.options || [];
        const validTypes = typeOptions.map((option: { name: string }) => option.name);

        if (!validTypes.includes(args.type)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Invalid type "${args.type}". Valid types are: ${validTypes.join(', ')}. Use the list_all_types tool to see available types.`,
              },
            ],
            isError: true,
          };
        }
      }

      // Prepare properties update
      const properties: any = {};
      
      // Update name if provided
      if (args.name !== undefined) {
        properties.Name = {
          title: [
            {
              text: {
                content: args.name,
              },
            },
          ],
        };
      }
      
      // Update type if provided
      if (args.type !== undefined) {
        properties.Type = {
          select: {
            name: args.type,
          },
        };
      }
      
      // Update tags if provided
      if (args.tags !== undefined) {
        properties.Tags = {
          multi_select: args.tags.map((tag: string) => ({ name: tag })),
        };
      }

      // Update page properties
      if (Object.keys(properties).length > 0) {
        await this.notion.pages.update({
          page_id: promptId,
          properties,
        });
      }

      // Update content if detailed_prompt is provided
      if (args.detailed_prompt !== undefined) {
        // First, get all existing blocks
        const existingBlocks = await this.fetchAllBlocks(promptId);
        
        // Delete all existing blocks
        for (const block of existingBlocks) {
          await this.notion.blocks.delete({
            block_id: block.id,
          });
        }
        
        // Add new content blocks
        await this.notion.blocks.children.append({
          block_id: promptId,
          children: this.createParagraphBlocksFromText(args.detailed_prompt),
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt updated successfully',
              prompt_id: promptId,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error updating prompt:', error);
      
      // Check if the error is related to an invalid database
      if (error instanceof Error &&
          (error.message.includes("Invalid database") ||
           error.message.includes("Could not find database"))) {
        return {
          content: [
            {
              type: 'text',
              text: DATABASE_ERROR_MESSAGE,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error updating prompt: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Start the server
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Prompt Book MCP server running on stdio');
  }
}

// Create and run the server
const server = new PromptBookServer();
server.run().catch(console.error);
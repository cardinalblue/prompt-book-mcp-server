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

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PROMPTS_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Error message for missing or invalid database
const DATABASE_ERROR_MESSAGE = "Database ID is empty or invalid. Please use the create_prompt_database tool to create a new prompt database.";

// Interfaces for our data structures
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
  private notion: Client;
  private databaseId: string;

  constructor() {
    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'prompt-book-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Check if required environment variables are provided
    if (!NOTION_TOKEN) {
      throw new Error('NOTION_TOKEN environment variable is required');
    }
    
    // Store the database ID (may be empty or invalid)
    this.databaseId = PROMPTS_DATABASE_ID || '';

    // Initialize the Notion client
    this.notion = new Client({
      auth: NOTION_TOKEN,
    });

    // Set up tool handlers
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
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
          description: 'Create a new prompt database when none exists',
          inputSchema: {
            type: 'object',
            properties: {
              page_id: {
                type: 'string',
                description: 'ID of the page where the database will be created',
              },
            },
            required: ['page_id'],
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
        // Handle create_prompt_database separately as it doesn't require an existing database
        if (request.params.name === 'create_prompt_database') {
          return await this.createPromptDatabase(request.params.arguments);
        }
        
        // For all other tools, check if database ID is valid
        if (!this.databaseId) {
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

  // Helper method to fetch all pages of results
  private async fetchAllResults(queryParams: any): Promise<any[]> {
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
  private async extractContentFromBlocks(blocks: any[]): Promise<string> {
    let content = '';

    for (const block of blocks) {
      if (block.type === 'paragraph') {
        const text = block.paragraph.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += text + '\n\n';
      } else if (block.type === 'heading_1') {
        const text = block.heading_1.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '# ' + text + '\n\n';
      } else if (block.type === 'heading_2') {
        const text = block.heading_2.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '## ' + text + '\n\n';
      } else if (block.type === 'heading_3') {
        const text = block.heading_3.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '### ' + text + '\n\n';
      } else if (block.type === 'bulleted_list_item') {
        const text = block.bulleted_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '• ' + text + '\n';
      } else if (block.type === 'numbered_list_item') {
        const text = block.numbered_list_item.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '1. ' + text + '\n';
      } else if (block.type === 'code') {
        const text = block.code.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        const language = block.code.language || '';
        content += '```' + language + '\n' + text + '\n```\n\n';
      } else if (block.type === 'quote') {
        const text = block.quote.rich_text
          .map((textPart: any) => textPart.plain_text)
          .join('');
        content += '> ' + text + '\n\n';
      } else if (block.type === 'divider') {
        content += '---\n\n';
      } else if (block.has_children) {
        // Recursively get all content from child blocks
        const allChildBlocks = await this.fetchAllBlocks(block.id);
        const childContent = await this.extractContentFromBlocks(allChildBlocks);
        content += childContent;
      }
    }

    return content;
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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

  // Create a new prompt database
  private async createPromptDatabase(args: any): Promise<any> {
    if (!args?.page_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Page ID is required');
    }

    const pageId = args.page_id;

    try {
      // Create a new database with the same schema as the analyzed database
      const response = await this.notion.databases.create({
        parent: {
          type: 'page_id',
          page_id: pageId,
        },
        title: [
          {
            type: 'text',
            text: {
              content: 'GAI Prompt Book',
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

      // Update the database ID in memory
      this.databaseId = response.id;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Prompt database created successfully',
              database_id: response.id,
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

  // List all unique tags in the database
  private async listAllTags(args: any): Promise<any> {
    try {
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
        database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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

      // Verify that the type exists in the database
      const databaseResponse = await this.notion.databases.retrieve({
        database_id: this.databaseId,
      });

      const typeProperty = databaseResponse.properties?.Type as any;
      const typeOptions = typeProperty?.select?.options || [];
      const validTypes = typeOptions.map((option: { name: string }) => option.name);

      if (!validTypes.includes(type)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Invalid type "${type}". Valid types are: ${validTypes.join(', ')}. Use the list_all_types tool to see available types.`,
            },
          ],
          isError: true,
        };
      }

      // Create the new page in the database
      const response = await this.notion.pages.create({
        parent: {
          database_id: this.databaseId,
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
      // Check if database ID exists and is valid
      if (!this.databaseId) {
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
          database_id: this.databaseId,
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
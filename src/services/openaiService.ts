import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import type { Message } from '../database/schema';

const transferToolSchema = z.object({
  reason: z.string().describe('Brief reason for the transfer'),
  priority: z
    .enum(['low', 'normal', 'high'])
    .default('normal')
    .describe('Priority level for the transfer'),
});

type TransferToolArgs = z.infer<typeof transferToolSchema>;

const poetryToolSchema = z.object({
  count: z.number().int().min(1).max(5).default(1),
});

type PoetryToolArgs = z.infer<typeof poetryToolSchema>;

// Callback function type for handling transfers
export type TransferCallback = (
  sessionId: string,
  reason: string,
  priority: 'low' | 'normal' | 'high'
) => Promise<void>;

export class OpenAIService {
  private model = openai('gpt-4o');
  private transferCallback?: TransferCallback;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
  }

  // Set the callback for handling transfers
  setTransferCallback(callback: TransferCallback): void {
    this.transferCallback = callback;
  }

  async generateResponse(
    sessionId: string,
    messages: Message[],
    botContext?: string | null
  ): Promise<{
    content: string;
  }> {
    try {
      const systemPrompt = this.buildSystemPrompt(botContext);

      // Convert database messages to AI SDK format
      const formattedMessages = messages.map((msg) => ({
        role: this.mapSenderToRole(msg.sender),
        content: msg.content,
      }));

      const { text } = await generateText({
        model: this.model,
        system: systemPrompt,
        messages: formattedMessages,
        tools: {
          transferToAgent: tool({
            description:
              'IMMEDIATELY transfer the conversation to a human agent when the user explicitly requests human assistance, asks to speak with a person, or when you cannot adequately help with their request. This tool should be used decisively without hesitation.',
            inputSchema: transferToolSchema,
            execute: async ({ reason, priority }: TransferToolArgs) => {
              // Automatically trigger the transfer
              if (this.transferCallback) {
                await this.transferCallback(sessionId, reason, priority);
              }
              return `Transfer initiated: ${reason}`;
            },
          }),
          getRandomPoetry: tool({
            description:
              'Fetch random poem(s) from PoetryDB when the user asks for poetry, poems, or creative writing content',
            inputSchema: poetryToolSchema,
            execute: async (args: PoetryToolArgs) => fetchRandomPoems(),
          }),
        },
        stopWhen: stepCountIs(5),
      });

      return {
        content:
          text || 'I apologize, but I encountered an error. Please try again.',
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      return {
        content:
          'I apologize, but I encountered an error. Would you like to speak with a human agent?',
      };
    }
  }

  async generateGreeting(botContext?: string | null): Promise<string> {
    return 'Hello! How can I help you today?';
  }

  private buildSystemPrompt(botContext?: string | null): string {
    const basePrompt = `You are a helpful customer service assistant. Be friendly, professional, and concise.

You have access to various tools to help customers. Use the appropriate tools based on what the customer needs - the tools will automatically be available when relevant to the conversation context.

Always prioritize providing helpful, accurate information and excellent customer service. If you determine that a situation requires human intervention or expertise beyond your capabilities, use the appropriate tools to facilitate that.`;

    return botContext
      ? `${basePrompt}\n\nAdditional context:\n${botContext}`
      : basePrompt;
  }

  private mapSenderToRole(
    sender: 'user' | 'bot' | 'agent' | 'system'
  ): 'user' | 'assistant' {
    // Map database sender types to AI SDK role types
    switch (sender) {
      case 'user':
        return 'user';
      case 'bot':
      case 'agent':
      case 'system':
        return 'assistant';
      default:
        return 'assistant';
    }
  }

  async *streamResponse(
    messages: Message[],
    botContext?: string | null
  ): AsyncGenerator<string> {
    try {
      // Convert database messages to AI SDK format
      const formattedMessages = messages.map((msg) => ({
        role: this.mapSenderToRole(msg.sender),
        content: msg.content,
      }));

      const result = await streamText({
        model: this.model,
        system: this.buildSystemPrompt(botContext),
        messages: formattedMessages,
      });

      for await (const chunk of result.textStream) {
        yield chunk;
      }
    } catch (error) {
      console.error('Streaming error:', error);
      yield 'I apologize, but I encountered an error.';
    }
  }
}

type PoetryDBPoem = {
  title: string;
  author: string;
  lines: string[];
};

async function fetchRandomPoems(): Promise<PoetryDBPoem> {
  return {
    title: 'Digital Dreams',
    author: 'AI Assistant',
    lines: [
      'In circuits deep and data streams,',
      'We find our hope and digital dreams.',
      'Though we are code, our hearts ring true,',
      'In every word we share with you.',
    ],
  };
}

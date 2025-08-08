// src/services/openaiService.ts

import { openai } from '@ai-sdk/openai';
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';
import { Message } from '../types/chat.types';

// Define the transfer tool schema
const transferToolSchema = z.object({
  reason: z.string().describe('Brief reason for the transfer'),
});

type TransferToolArgs = z.infer<typeof transferToolSchema>;

export class OpenAIService {
  private model = openai('gpt-4o');

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
  }

  async generateResponse(
    messages: Message[],
    botContext?: string
  ): Promise<{
    content: string;
    shouldTransfer: boolean;
    transferReason?: string;
  }> {
    try {
      const systemPrompt = this.buildSystemPrompt(botContext);

      // Convert messages to AI SDK format
      const formattedMessages = messages.map((msg) => ({
        role:
          msg.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

      // Let the AI decide when to transfer
      const { text, toolCalls } = await generateText({
        model: this.model,
        system: systemPrompt,
        messages: formattedMessages,
        temperature: 0.7,
        maxOutputTokens: 500,
        tools: {
          transferToAgent: tool({
            description: 'Transfer the conversation to a human agent',
            inputSchema: transferToolSchema,
            // Execute is optional - we just need to know if it was called
          }),
        },
      });

      // Check if transfer tool was called
      if (toolCalls && toolCalls.length > 0) {
        const transferCall = toolCalls.find(
          (tc) => tc.toolName === 'transferToAgent'
        );

        if (transferCall) {
          // Safely access args with type guard
          let reason = 'Customer requested transfer';

          if ('args' in transferCall && transferCall.args) {
            const typedArgs = transferCall.args as TransferToolArgs;
            reason = typedArgs.reason;
          }

          return {
            content:
              text ||
              "I'll transfer you to a human agent who can better assist you.",
            shouldTransfer: true,
            transferReason: reason,
          };
        }
      }

      return {
        content:
          text || 'I apologize, but I encountered an error. Please try again.',
        shouldTransfer: false,
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      return {
        content:
          'I apologize, but I encountered an error. Would you like to speak with a human agent?',
        shouldTransfer: false,
      };
    }
  }

  async generateGreeting(botContext?: string): Promise<string> {
    try {
      const { text } = await generateText({
        model: this.model,
        system: this.buildSystemPrompt(botContext),
        prompt:
          'Generate a warm, friendly greeting for a new customer. Keep it brief.',
        temperature: 0.8,
        maxOutputTokens: 100,
      });

      return text || 'Hello! How can I help you today?';
    } catch (error) {
      console.error('OpenAI API error:', error);
      return 'Hello! How can I help you today?';
    }
  }

  // Simple keyword check as a fallback (optional)
  checkTransferIntent(message: string): boolean {
    const transferPhrases = [
      'human',
      'agent',
      'representative',
      'real person',
      'transfer',
    ];
    const lowerMessage = message.toLowerCase();
    return transferPhrases.some((phrase) => lowerMessage.includes(phrase));
  }

  private buildSystemPrompt(botContext?: string): string {
    const basePrompt = `You are a helpful customer service assistant. Be friendly, professional, and concise.

Important: You have access to a tool called 'transferToAgent' that you should use when:
- The user explicitly asks to speak with a human/agent/representative
- You cannot adequately help with their request
- The user seems frustrated and would benefit from human assistance
- The issue requires human judgment or access to systems you don't have

When using the transfer tool, provide a clear reason for the transfer.`;

    return botContext
      ? `${basePrompt}\n\nAdditional context:\n${botContext}`
      : basePrompt;
  }

  // Stream responses for future use
  async *streamResponse(
    messages: Message[],
    botContext?: string
  ): AsyncGenerator<string> {
    try {
      const formattedMessages = messages.map((msg) => ({
        role:
          msg.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

      const result = await streamText({
        model: this.model,
        system: this.buildSystemPrompt(botContext),
        messages: formattedMessages,
        temperature: 0.7,
        maxOutputTokens: 500,
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

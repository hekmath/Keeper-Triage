import dotenv from 'dotenv';
dotenv.config();
import { z } from 'zod';
import { generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

async function main() {
  const { text, steps, toolCalls } = await generateText({
    model: openai('gpt-5'),
    tools: {
      weather: tool({
        description: 'Get the weather in a location',
        inputSchema: z.object({
          location: z.string().describe('The location to get the weather for'),
        }),
        execute: async ({ location }) => ({
          location,
          temperature: 72 + Math.floor(Math.random() * 21) - 10,
        }),
      }),
    },
    stopWhen: stepCountIs(5), // stop after 5 steps if tools were called
    prompt: 'What is the weather in San Francisco?',
  });

  console.log(text);
}

main();

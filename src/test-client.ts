// src/test-client.ts

import { io, Socket } from 'socket.io-client';
import * as readline from 'readline';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

type Mode = 'menu' | 'customer' | 'agent';
const PROMPTS: Record<Mode, string> = {
  menu: '',
  customer: 'You: ',
  agent: 'Agent: ',
};

class ChatTester {
  private customerSocket: Socket | null = null;
  private agentSocket: Socket | null = null;
  private rl: readline.Interface;
  private currentSessionId: string | null = null;
  private currentMode: Mode = 'menu';

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: PROMPTS[this.currentMode],
    });
  }

  // Print a line ABOVE the current prompt/input and restore input
  private printAbovePrompt(message: string, color: string = colors.white) {
    const line = this.rl.line; // current user input (not submitted yet)
    const prompt = PROMPTS[this.currentMode];

    // Clear the current input line
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    // Print the message
    console.log(`${color}${message}${colors.reset}`);

    // Restore prompt + input
    this.rl.setPrompt(prompt);
    this.rl.prompt(true);
    if (line) this.rl.write(line);
  }

  private log(message: string, color: string = colors.white) {
    this.printAbovePrompt(message, color);
  }

  private logMessage(sender: string, content: string) {
    const senderColors: { [key: string]: string } = {
      user: colors.cyan,
      bot: colors.green,
      agent: colors.magenta,
      system: colors.yellow,
    };
    const color = senderColors[sender] || colors.white;
    this.printAbovePrompt(`[${sender.toUpperCase()}] ${content}`, color);
  }

  private setMode(mode: Mode) {
    this.currentMode = mode;
    this.rl.setPrompt(PROMPTS[mode]);
    this.rl.prompt(true);
  }

  async start() {
    this.showMenu();
  }

  private showMenu() {
    console.clear();
    this.setMode('menu');
    this.log('╔════════════════════════════════════════╗', colors.bright);
    this.log('║     Socket.IO Chat Backend Tester      ║', colors.bright);
    this.log('╚════════════════════════════════════════╝', colors.bright);
    this.log('\nChoose an option:', colors.yellow);
    this.log('1. Test as Customer', colors.green);
    this.log('2. Test as Agent', colors.magenta);
    this.log('3. Run Automated Test Sequence', colors.blue);
    this.log('4. Exit', colors.red);

    this.rl.question('\nEnter choice (1-4): ', (choice) => {
      switch (choice) {
        case '1':
          this.testCustomerFlow();
          break;
        case '2':
          this.testAgentFlow();
          break;
        case '3':
          this.runAutomatedTest();
          break;
        case '4':
          this.exit();
          break;
        default:
          this.log('Invalid choice!', colors.red);
          setTimeout(() => this.showMenu(), 1000);
      }
    });
  }

  private testCustomerFlow() {
    this.setMode('customer');
    this.log('\n🧑 Starting Customer Test...', colors.cyan);

    // Connect as customer
    this.customerSocket = io('http://localhost:3001', { autoConnect: true });

    // Socket lifecycle (customer)
    this.customerSocket.on('connect', () => {
      this.log('✅ Connected to server', colors.green);

      // Start chat with custom context
      this.rl.question(
        '\nEnter bot context (or press Enter for default): ',
        (context) => {
          this.customerSocket!.emit('customer:start_chat', {
            userId: 'test-user-123',
            botContext:
              context ||
              'You are a helpful customer service bot for an e-commerce platform.',
            metadata: { userName: 'Test User' },
          });
        }
      );
    });

    this.customerSocket.on('disconnect', (reason) => {
      this.log(
        `\n🔌 You disconnected (${reason}). Reconnecting…`,
        colors.yellow
      );
    });
    this.customerSocket.io.on('reconnect_attempt', (n) => {
      this.log(`↻ Reconnect attempt ${n}…`, colors.dim);
    });
    this.customerSocket.io.on('reconnect', () => {
      this.log('✅ Reconnected', colors.green);
      if (this.currentSessionId) {
        this.log('Restoring session…', colors.dim);
      }
    });

    // Server events
    this.customerSocket.on('session:created', (data: any) => {
      this.currentSessionId = data.sessionId;
      this.log(`\n✅ Session created: ${data.sessionId}`, colors.green);
      this.log(`Status: ${data.status}`, colors.dim);
      this.startCustomerChat();
    });

    this.customerSocket.on('message:received', (message: any) => {
      this.logMessage(message.sender, message.content);
    });

    this.customerSocket.on('status:changed', (data: any) => {
      this.log(`\n📊 Status changed to: ${data.status}`, colors.yellow);
      if (data.agentName) this.log(`Agent: ${data.agentName}`, colors.magenta);
      if (data.status === 'waiting') {
        this.log('🧷 You are back in the queue. Hang tight.', colors.yellow);
      }
    });

    this.customerSocket.on('session:inactive', () => {
      this.log(
        '\n🕒 You went inactive. We’ll keep the session for a few minutes in case you return.',
        colors.yellow
      );
    });

    this.customerSocket.on('session:closed', () => {
      this.log('\n🔒 Session closed by agent', colors.yellow);
      this.returnToMenu();
    });

    this.customerSocket.on('error', (error: any) => {
      this.log(`\n❌ Error: ${error.message}`, colors.red);
    });
  }

  private startCustomerChat() {
    this.setMode('customer');
    this.log('\n💬 Chat started! Type your messages:', colors.cyan);
    this.log('Commands: /transfer (request human), /quit (exit)', colors.dim);

    const loop = () => {
      this.rl.prompt(true);
      this.rl.once('line', (message) => {
        if (message === '/quit') return this.returnToMenu();

        const payload = {
          sessionId: this.currentSessionId,
          content:
            message === '/transfer'
              ? 'I want to speak with a human agent please'
              : message,
        };

        if (message.trim()) {
          this.customerSocket!.emit('customer:send_message', payload);
        }
        loop();
      });
    };

    loop();
  }

  private testAgentFlow() {
    this.setMode('agent');
    this.log('\n👨‍💼 Starting Agent Test...', colors.magenta);

    this.rl.question('Enter agent name: ', (name) => {
      // Connect as agent
      this.agentSocket = io('http://localhost:3001', { autoConnect: true });

      // Socket lifecycle (agent)
      this.agentSocket.on('connect', () => {
        this.log('✅ Connected as agent', colors.green);
        this.agentSocket!.emit('agent:join', { name });
      });
      this.agentSocket.on('disconnect', (reason) => {
        this.log(
          `\n🔌 Agent socket disconnected (${reason}). Reconnecting…`,
          colors.yellow
        );
      });
      this.agentSocket.io.on('reconnect', () => {
        this.log('\n✅ Agent socket reconnected', colors.green);
      });

      // Server events (agent)
      this.agentSocket.on('agent:joined', (data: any) => {
        this.log(`\n✅ Joined as agent: ${data.agent.name}`, colors.green);
        this.log(`Agent ID: ${data.agentId}`, colors.dim);
        this.startAgentDashboard();
      });

      this.agentSocket.on('system:info', (msg: string) => {
        this.logMessage('system', msg);
      });

      this.agentSocket.on('queue:update', (data: any) => {
        this.log(
          `\n📋 Queue updated: ${data.sessions.length} waiting`,
          colors.yellow
        );
        if (data.sessions.length > 0) {
          this.log('Waiting sessions:', colors.dim);
          data.sessions.forEach((session: any, index: number) => {
            this.log(
              `  ${index + 1}. Session ${session.id} - User: ${session.userId}`,
              colors.dim
            );
          });
        }
      });

      this.agentSocket.on('queue:customer_waiting', (data: any) => {
        this.log(`\n🔔 New customer waiting: ${data.sessionId}`, colors.yellow);
      });

      this.agentSocket.on('session:assigned', (data: any) => {
        this.currentSessionId = data.sessionId;
        this.log(`\n✅ Session assigned: ${data.sessionId}`, colors.green);
        this.log('Chat history:', colors.dim);
        data.session.messages.forEach((msg: any) => {
          this.logMessage(msg.sender, msg.content);
        });
        this.startAgentChat();
      });

      this.agentSocket.on('message:received', (message: any) => {
        // Show all messages to the agent (user/bot/agent/system)
        this.logMessage(message.sender, message.content);
      });

      this.agentSocket.on('status:changed', (data: any) => {
        this.log(`\n📊 Status changed to: ${data.status}`, colors.yellow);
        if (data.status === 'waiting') {
          this.log(
            '🧷 Customer disconnected. Session placed back in queue.',
            colors.yellow
          );
        }
        if (data.agentName) {
          this.log(`Agent: ${data.agentName}`, colors.magenta);
        }
      });

      this.agentSocket.on('session:closed', () => {
        this.log('\n🔒 Session closed', colors.yellow);
      });

      this.agentSocket.on('error', (error: any) => {
        this.log(`\n❌ Error: ${error.message}`, colors.red);
      });
    });
  }

  private startAgentDashboard() {
    this.setMode('agent');
    this.log('\n📊 Agent Dashboard', colors.magenta);
    this.log('Commands:', colors.dim);
    this.log('  /pickup <session-id> - Pick up a session', colors.dim);
    this.log('  /stats - View stats', colors.dim);
    this.log('  /quit - Exit', colors.dim);

    const loop = () => {
      this.rl.prompt(true);
      this.rl.once('line', (command) => {
        const [cmd, ...args] = command.trim().split(' ');

        switch (cmd) {
          case '/pickup':
            if (args[0]) {
              this.agentSocket!.emit('agent:pickup_session', {
                sessionId: args[0],
              });
            } else {
              this.log('Usage: /pickup <session-id>', colors.red);
            }
            break;

          case '/stats':
            this.agentSocket!.emit('admin:get_stats');
            this.agentSocket!.once('stats:update', (stats: any) => {
              this.log('\n📊 System Stats:', colors.yellow);
              this.printAbovePrompt(JSON.stringify(stats, null, 2), colors.dim);
            });
            break;

          case '/quit':
            return this.returnToMenu();

          default:
            // ignore unknown, just redraw
            break;
        }

        loop();
      });
    };

    loop();
  }

  private startAgentChat() {
    this.setMode('agent');
    this.log('\n💬 Chat with customer started!', colors.magenta);
    this.log('Commands: /close (close session), /quit (exit)', colors.dim);

    const loop = () => {
      this.rl.prompt(true);
      this.rl.once('line', (message) => {
        if (message === '/quit') return this.returnToMenu();

        if (message === '/close') {
          this.agentSocket!.emit('agent:close_session', {
            sessionId: this.currentSessionId,
          });
          this.log('\n🔒 Session closed', colors.yellow);
          return this.startAgentDashboard();
        }

        if (message.trim()) {
          this.agentSocket!.emit('agent:send_message', {
            sessionId: this.currentSessionId,
            content: message,
          });
        }

        loop();
      });
    };

    loop();
  }

  private async runAutomatedTest() {
    this.log('\n🤖 Running Automated Test Sequence...', colors.blue);

    // Test 1: Customer connects and sends message
    this.log('\n[TEST 1] Customer Connection', colors.yellow);
    const customerSocket = io('http://localhost:3001', { autoConnect: true });

    await new Promise<void>((resolve) => {
      customerSocket.on('connect', () => {
        this.log('✅ Customer connected', colors.green);
        customerSocket.emit('customer:start_chat', {
          userId: 'auto-test-user',
          botContext: 'You are a test bot. Be brief.',
        });
      });

      customerSocket.on('session:created', async (data: any) => {
        this.log(`✅ Session created: ${data.sessionId}`, colors.green);

        setTimeout(() => {
          customerSocket.emit('customer:send_message', {
            sessionId: data.sessionId,
            content: 'Hello, this is a test message',
          });
        }, 1000);

        setTimeout(() => {
          customerSocket.emit('customer:send_message', {
            sessionId: data.sessionId,
            content: 'I want to speak with a human agent',
          });
        }, 3000);

        setTimeout(() => {
          this.log('\n✅ All automated tests completed!', colors.green);
          customerSocket.disconnect();
          resolve();
        }, 5000);
      });

      customerSocket.on('message:received', (message: any) => {
        this.logMessage(message.sender, message.content);
      });

      customerSocket.on('status:changed', (data: any) => {
        this.log(`Status changed to: ${data.status}`, colors.yellow);
      });
    });

    setTimeout(() => this.returnToMenu(), 6000);
  }

  private returnToMenu() {
    if (this.customerSocket) {
      this.customerSocket.disconnect();
      this.customerSocket = null;
    }
    if (this.agentSocket) {
      this.agentSocket.disconnect();
      this.agentSocket = null;
    }
    this.currentSessionId = null;
    this.setMode('menu');
    setTimeout(() => this.showMenu(), 300);
  }

  private exit() {
    this.log('\n👋 Goodbye!', colors.cyan);
    if (this.customerSocket) this.customerSocket.disconnect();
    if (this.agentSocket) this.agentSocket.disconnect();
    this.rl.close();
    process.exit(0);
  }
}

// Start the tester
const tester = new ChatTester();
tester.start();

import 'dotenv/config';
import { db, checkDatabaseConnection } from '../database/db';
import {
  chatSessions,
  messages,
  agents,
  sessionAnalytics,
} from '../database/schema';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Starting database seed...');

  // Check database connection
  const isConnected = await checkDatabaseConnection();
  if (!isConnected) {
    console.error('❌ Cannot connect to database');
    process.exit(1);
  }

  try {
    // Clear existing data (in development only)
    if (process.env.NODE_ENV === 'development') {
      console.log('🧹 Clearing existing data...');
      await db.delete(sessionAnalytics);
      await db.delete(messages);
      await db.delete(chatSessions);
      await db.delete(agents);
    }

    // Create sample agents
    console.log('👨‍💼 Creating sample agents...');
    const sampleAgents = [
      {
        id: uuidv4(),
        socketId: 'sample-socket-1',
        name: 'Alice Johnson',
        status: 'available' as const,
        metadata: {
          department: 'Technical Support',
          languages: ['English', 'Spanish'],
          expertise: ['billing', 'technical'],
        },
      },
      {
        id: uuidv4(),
        socketId: 'sample-socket-2',
        name: 'Bob Smith',
        status: 'available' as const,
        metadata: {
          department: 'Customer Service',
          languages: ['English', 'French'],
          expertise: ['general', 'billing'],
        },
      },
      {
        id: uuidv4(),
        socketId: 'sample-socket-3',
        name: 'Carol Davis',
        status: 'offline' as const,
        metadata: {
          department: 'Technical Support',
          languages: ['English'],
          expertise: ['technical', 'advanced'],
        },
      },
    ];

    const insertedAgents = await db
      .insert(agents)
      .values(sampleAgents)
      .returning();
    console.log(`✅ Created ${insertedAgents.length} sample agents`);

    // Create sample chat sessions
    console.log('💬 Creating sample chat sessions...');
    const sampleSessions = [
      {
        id: uuidv4(),
        userId: 'user-demo-1',
        status: 'closed' as const,
        botContext: 'You are a helpful customer service bot for TechCorp.',
        metadata: {
          userAgent: 'Mozilla/5.0...',
          referrer: 'https://techcorp.com/contact',
          customerType: 'premium',
        },
      },
      {
        id: uuidv4(),
        userId: 'user-demo-2',
        status: 'bot' as const,
        botContext: 'You are a helpful customer service bot for TechCorp.',
        metadata: {
          userAgent: 'Mozilla/5.0...',
          referrer: 'https://techcorp.com/support',
          customerType: 'standard',
        },
      },
      {
        id: uuidv4(),
        userId: 'user-demo-3',
        status: 'agent' as const,
        assignedAgent: insertedAgents[0].id,
        botContext: 'You are a helpful customer service bot for TechCorp.',
        metadata: {
          userAgent: 'Mozilla/5.0...',
          referrer: 'https://techcorp.com/billing',
          customerType: 'enterprise',
        },
      },
    ];

    const insertedSessions = await db
      .insert(chatSessions)
      .values(sampleSessions)
      .returning();
    console.log(`✅ Created ${insertedSessions.length} sample chat sessions`);

    // Create sample messages
    console.log('📝 Creating sample messages...');
    const sampleMessages = [
      // Session 1 messages (closed session)
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content: 'Hello! How can I help you today?',
        sender: 'bot' as const,
        metadata: { automated: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content: 'Hi, I need help with my billing account.',
        sender: 'user' as const,
        metadata: {},
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content:
          'I can help you with billing questions. Let me transfer you to a human agent for account-specific assistance.',
        sender: 'bot' as const,
        metadata: { transfer_triggered: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content:
          "Hi! I'm Alice from our billing department. I can help you with your account.",
        sender: 'agent' as const,
        metadata: { agentId: insertedAgents[0].id },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content: 'Perfect! I was charged twice for my subscription this month.',
        sender: 'user' as const,
        metadata: {},
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content:
          "I can see the duplicate charge. I've processed a refund that will appear in 3-5 business days. Is there anything else I can help you with?",
        sender: 'agent' as const,
        metadata: { agentId: insertedAgents[0].id, refund_processed: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content: "That's perfect, thank you so much!",
        sender: 'user' as const,
        metadata: {},
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[0].id,
        content: "You're welcome! Have a great day!",
        sender: 'agent' as const,
        metadata: { agentId: insertedAgents[0].id },
      },

      // Session 2 messages (active bot session)
      {
        id: uuidv4(),
        sessionId: insertedSessions[1].id,
        content: 'Welcome to TechCorp support! How can I assist you today?',
        sender: 'bot' as const,
        metadata: { automated: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[1].id,
        content: "I'm having trouble logging into my account.",
        sender: 'user' as const,
        metadata: {},
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[1].id,
        content:
          'I can help you with login issues. Have you tried resetting your password using the "Forgot Password" link?',
        sender: 'bot' as const,
        metadata: {},
      },

      // Session 3 messages (active agent session)
      {
        id: uuidv4(),
        sessionId: insertedSessions[2].id,
        content: 'Hello! How can I help you today?',
        sender: 'bot' as const,
        metadata: { automated: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[2].id,
        content: 'I need technical support for my enterprise account.',
        sender: 'user' as const,
        metadata: {},
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[2].id,
        content: "I'll transfer you to our technical support team right away.",
        sender: 'bot' as const,
        metadata: { transfer_triggered: true },
      },
      {
        id: uuidv4(),
        sessionId: insertedSessions[2].id,
        content:
          "Hello! I'm Alice from technical support. I understand you need help with your enterprise account?",
        sender: 'agent' as const,
        metadata: { agentId: insertedAgents[0].id },
      },
    ];

    const insertedMessages = await db
      .insert(messages)
      .values(sampleMessages)
      .returning();
    console.log(`✅ Created ${insertedMessages.length} sample messages`);

    // Create sample analytics
    console.log('📊 Creating sample analytics...');
    const sampleAnalytics = [
      {
        sessionId: insertedSessions[0].id,
        totalMessages: 8,
        botMessages: 3,
        userMessages: 3,
        agentMessages: 2,
        sessionDuration: 1200, // 20 minutes
        queueWaitTime: 45, // 45 seconds
        agentResponseTime: 30, // 30 seconds average
        wasTransferred: 1,
        transferReason: 'Billing account assistance required',
      },
    ];

    const insertedAnalytics = await db
      .insert(sessionAnalytics)
      .values(sampleAnalytics)
      .returning();
    console.log(
      `✅ Created ${insertedAnalytics.length} sample analytics records`
    );

    console.log('🎉 Database seed completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   • ${insertedAgents.length} agents created`);
    console.log(`   • ${insertedSessions.length} chat sessions created`);
    console.log(`   • ${insertedMessages.length} messages created`);
    console.log(`   • ${insertedAnalytics.length} analytics records created`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

// Run seed if called directly
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Seed script failed:', error);
      process.exit(1);
    });
}

export { seed };

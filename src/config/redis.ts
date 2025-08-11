import Redis from 'ioredis';

// Redis configuration
const redisConfig = {
  // Connection
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),

  // Connection behavior
  connectTimeout: 10000,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4, // 4 (IPv4) or 6 (IPv6)

  // Retry strategy
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`🔄 Redis reconnection attempt ${times}, waiting ${delay}ms`);
    return delay;
  },

  // Connection health
  enableReadyCheck: true,
  maxLoadingTimeout: 10000,
};

// Create Redis instance
export const redis = new Redis(redisConfig);

// Create separate Redis instance for pub/sub if needed
export const redisPubSub = new Redis(redisConfig);

// Redis event handlers
redis.on('connect', () => {
  console.log('🔗 Redis: Connecting...');
});

redis.on('ready', () => {
  console.log('✅ Redis: Connected and ready');
});

redis.on('error', (error) => {
  console.error('❌ Redis Error:', error.message);
});

redis.on('close', () => {
  console.log('🔌 Redis: Connection closed');
});

redis.on('reconnecting', () => {
  console.log(`🔄 Redis: Reconnecting`);
});

redis.on('end', () => {
  console.log('🏁 Redis: Connection ended');
});

// Queue-specific Redis keys
export const REDIS_KEYS = {
  // Queue management
  TRANSFER_QUEUE: 'chat:transfer_queue',
  QUEUE_METADATA: 'chat:queue_metadata',

  // Priority queues
  HIGH_PRIORITY_QUEUE: 'chat:queue:high',
  NORMAL_PRIORITY_QUEUE: 'chat:queue:normal',
  LOW_PRIORITY_QUEUE: 'chat:queue:low',

  // Session management
  ACTIVE_SESSIONS: 'chat:active_sessions',
  SESSION_DATA: (sessionId: string) => `chat:session:${sessionId}`,

  // Agent management
  ACTIVE_AGENTS: 'chat:active_agents',
  AGENT_DATA: (agentId: string) => `chat:agent:${agentId}`,

  // Statistics and monitoring
  QUEUE_STATS: 'chat:queue_stats',
  DAILY_METRICS: (date: string) => `chat:metrics:${date}`,

  // Locks and coordination
  QUEUE_LOCK: 'chat:queue_lock',
  PROCESSING_LOCK: (sessionId: string) => `chat:processing:${sessionId}`,
} as const;

// Helper functions for Redis operations
export class RedisHelper {
  static async healthCheck(): Promise<boolean> {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }

  static async setWithExpiry(
    key: string,
    value: string,
    seconds: number
  ): Promise<void> {
    await redis.setex(key, seconds, value);
  }

  static async getJSON<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Error parsing JSON from Redis key ${key}:`, error);
      return null;
    }
  }

  static async setJSON(key: string, value: any, ttl?: number): Promise<void> {
    const jsonString = JSON.stringify(value);
    if (ttl) {
      await redis.setex(key, ttl, jsonString);
    } else {
      await redis.set(key, jsonString);
    }
  }

  static async deleteKeys(pattern: string): Promise<number> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      return await redis.del(...keys);
    }
    return 0;
  }

  static async acquireLock(key: string, ttl: number = 10): Promise<boolean> {
    const result = await redis.set(key, 'locked', 'EX', ttl, 'NX');
    return result === 'OK';
  }

  static async releaseLock(key: string): Promise<void> {
    await redis.del(key);
  }
}

// Graceful shutdown
export async function closeRedisConnections(): Promise<void> {
  try {
    await Promise.all([redis.disconnect(), redisPubSub.disconnect()]);
    console.log('🔒 Redis connections closed');
  } catch (error) {
    console.error('❌ Error closing Redis connections:', error);
  }
}

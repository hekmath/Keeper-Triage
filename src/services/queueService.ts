import { redis, REDIS_KEYS, RedisHelper } from '../config/redis';
import { db } from '../database/db';
import { transferQueue, chatSessions } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface QueueEntry {
  sessionId: string;
  reason: string;
  priority: 'high' | 'normal' | 'low';
  requestedAt: Date;
  metadata?: Record<string, any>;
}

export interface QueueStatus {
  sessionId: string;
  status: string;
  priority: string;
  waitTime: number; // in seconds
  position: number;
}

export class QueueService {
  // ============= QUEUE OPERATIONS =============

  async addToQueue(
    sessionId: string,
    reason: string,
    priority: 'high' | 'normal' | 'low' = 'normal',
    metadata?: Record<string, any>
  ): Promise<void> {
    const queueEntry: QueueEntry = {
      sessionId,
      reason,
      priority,
      requestedAt: new Date(),
      metadata: metadata || {},
    };

    // Use Redis transaction to ensure atomicity
    const multi = redis.multi();

    // Add to appropriate priority queue
    const queueKey = this.getPriorityQueueKey(priority);
    multi.lpush(queueKey, JSON.stringify(queueEntry));

    // Store queue entry metadata
    multi.hset(
      REDIS_KEYS.QUEUE_METADATA,
      sessionId,
      JSON.stringify({
        ...queueEntry,
        addedAt: new Date().toISOString(),
      })
    );

    // Add to active sessions set
    multi.sadd(REDIS_KEYS.ACTIVE_SESSIONS, sessionId);

    await multi.exec();

    // Also store in database for persistence and analytics
    await db
      .insert(transferQueue)
      .values({
        sessionId,
        reason,
        priority,
        position: await this.getQueuePosition(sessionId),
        requestedAt: new Date(),
        isActive: 1,
      })
      .onConflictDoUpdate({
        target: transferQueue.sessionId,
        set: {
          reason,
          priority,
          requestedAt: new Date(),
          isActive: 1,
        },
      });

    console.log(
      `🔄 Session ${sessionId} added to ${priority} priority queue - Reason: ${reason}`
    );
  }

  async getNextInQueue(): Promise<QueueEntry | null> {
    // Check queues in priority order: high -> normal -> low
    const priorities: Array<'high' | 'normal' | 'low'> = [
      'high',
      'normal',
      'low',
    ];

    for (const priority of priorities) {
      const queueKey = this.getPriorityQueueKey(priority);
      const result = await redis.rpop(queueKey);

      if (result) {
        const queueEntry: QueueEntry = JSON.parse(result);

        // Remove from metadata
        await redis.hdel(REDIS_KEYS.QUEUE_METADATA, queueEntry.sessionId);
        await redis.srem(REDIS_KEYS.ACTIVE_SESSIONS, queueEntry.sessionId);

        // Mark as processed in database
        await db
          .update(transferQueue)
          .set({
            processedAt: new Date(),
            isActive: 0,
          })
          .where(eq(transferQueue.sessionId, queueEntry.sessionId));

        console.log(
          `📤 Retrieved session ${queueEntry.sessionId} from ${priority} queue`
        );
        return queueEntry;
      }
    }

    return null;
  }

  async removeFromQueue(sessionId: string): Promise<boolean> {
    try {
      // Get entry metadata to know which queue it's in
      const metadataStr = await redis.hget(
        REDIS_KEYS.QUEUE_METADATA,
        sessionId
      );
      if (!metadataStr) {
        console.log(`⚠️ Session ${sessionId} not found in queue metadata`);
        return false;
      }

      const metadata = JSON.parse(metadataStr);
      const queueKey = this.getPriorityQueueKey(metadata.priority);

      // Remove from Redis queue (scan through list)
      const queueItems = await redis.lrange(queueKey, 0, -1);
      let removed = false;

      for (let i = 0; i < queueItems.length; i++) {
        const entry: QueueEntry = JSON.parse(queueItems[i]);
        if (entry.sessionId === sessionId) {
          // Remove this specific item
          await redis.lrem(queueKey, 1, queueItems[i]);
          removed = true;
          break;
        }
      }

      // Clean up metadata
      await redis.hdel(REDIS_KEYS.QUEUE_METADATA, sessionId);
      await redis.srem(REDIS_KEYS.ACTIVE_SESSIONS, sessionId);

      // Mark as processed in database
      await db
        .update(transferQueue)
        .set({
          processedAt: new Date(),
          isActive: 0,
        })
        .where(eq(transferQueue.sessionId, sessionId));

      if (removed) {
        console.log(`🗑️ Removed session ${sessionId} from queue`);
      }

      return removed;
    } catch (error) {
      console.error(`Error removing session ${sessionId} from queue:`, error);
      return false;
    }
  }

  async getQueuePosition(sessionId: string): Promise<number> {
    const metadataStr = await redis.hget(REDIS_KEYS.QUEUE_METADATA, sessionId);
    if (!metadataStr) return 0;

    const metadata = JSON.parse(metadataStr);
    const queueKey = this.getPriorityQueueKey(metadata.priority);

    // Get all items in queue and find position
    const queueItems = await redis.lrange(queueKey, 0, -1);

    for (let i = 0; i < queueItems.length; i++) {
      const entry: QueueEntry = JSON.parse(queueItems[i]);
      if (entry.sessionId === sessionId) {
        // Calculate position considering higher priority queues
        let position = queueItems.length - i; // Reverse index (FIFO)

        // Add counts from higher priority queues
        if (metadata.priority === 'normal' || metadata.priority === 'low') {
          position += await redis.llen(REDIS_KEYS.HIGH_PRIORITY_QUEUE);
        }
        if (metadata.priority === 'low') {
          position += await redis.llen(REDIS_KEYS.NORMAL_PRIORITY_QUEUE);
        }

        return position;
      }
    }

    return 0;
  }

  async getQueueLength(): Promise<number> {
    const [highLen, normalLen, lowLen] = await Promise.all([
      redis.llen(REDIS_KEYS.HIGH_PRIORITY_QUEUE),
      redis.llen(REDIS_KEYS.NORMAL_PRIORITY_QUEUE),
      redis.llen(REDIS_KEYS.LOW_PRIORITY_QUEUE),
    ]);

    return highLen + normalLen + lowLen;
  }

  async getWaitingSessions(): Promise<QueueStatus[]> {
    const allMetadata = await redis.hgetall(REDIS_KEYS.QUEUE_METADATA);
    const sessions: QueueStatus[] = [];

    for (const [sessionId, metadataStr] of Object.entries(allMetadata)) {
      const metadata = JSON.parse(metadataStr);
      const position = await this.getQueuePosition(sessionId);
      const waitTime = Math.floor(
        (new Date().getTime() - new Date(metadata.addedAt).getTime()) / 1000
      );

      sessions.push({
        sessionId,
        status: 'waiting',
        priority: metadata.priority,
        waitTime,
        position,
      });
    }

    // Sort by position
    return sessions.sort((a, b) => a.position - b.position);
  }

  // ============= QUEUE MANAGEMENT =============

  async clearQueue(): Promise<number> {
    const queues = [
      REDIS_KEYS.HIGH_PRIORITY_QUEUE,
      REDIS_KEYS.NORMAL_PRIORITY_QUEUE,
      REDIS_KEYS.LOW_PRIORITY_QUEUE,
    ];

    let totalCleared = 0;

    for (const queueKey of queues) {
      const length = await redis.llen(queueKey);
      if (length > 0) {
        await redis.del(queueKey);
        totalCleared += length;
      }
    }

    // Clear metadata
    await redis.del(REDIS_KEYS.QUEUE_METADATA);
    await redis.del(REDIS_KEYS.ACTIVE_SESSIONS);

    // Mark all as processed in database
    await db
      .update(transferQueue)
      .set({
        processedAt: new Date(),
        isActive: 0,
      })
      .where(eq(transferQueue.isActive, 1));

    console.log(`🗑️ Cleared ${totalCleared} items from all queues`);
    return totalCleared;
  }

  async getQueueStats(): Promise<{
    high: number;
    normal: number;
    low: number;
    total: number;
    avgWaitTime: number;
  }> {
    const [highLen, normalLen, lowLen] = await Promise.all([
      redis.llen(REDIS_KEYS.HIGH_PRIORITY_QUEUE),
      redis.llen(REDIS_KEYS.NORMAL_PRIORITY_QUEUE),
      redis.llen(REDIS_KEYS.LOW_PRIORITY_QUEUE),
    ]);

    // Calculate average wait time
    const allMetadata = await redis.hgetall(REDIS_KEYS.QUEUE_METADATA);
    let totalWaitTime = 0;
    let count = 0;

    for (const metadataStr of Object.values(allMetadata)) {
      const metadata = JSON.parse(metadataStr);
      const waitTime =
        new Date().getTime() - new Date(metadata.addedAt).getTime();
      totalWaitTime += waitTime;
      count++;
    }

    const avgWaitTime =
      count > 0 ? Math.floor(totalWaitTime / count / 1000) : 0;

    return {
      high: highLen,
      normal: normalLen,
      low: lowLen,
      total: highLen + normalLen + lowLen,
      avgWaitTime,
    };
  }

  // ============= HELPER METHODS =============

  private getPriorityQueueKey(priority: 'high' | 'normal' | 'low'): string {
    switch (priority) {
      case 'high':
        return REDIS_KEYS.HIGH_PRIORITY_QUEUE;
      case 'normal':
        return REDIS_KEYS.NORMAL_PRIORITY_QUEUE;
      case 'low':
        return REDIS_KEYS.LOW_PRIORITY_QUEUE;
      default:
        return REDIS_KEYS.NORMAL_PRIORITY_QUEUE;
    }
  }

  // ============= HEALTH & MONITORING =============

  async healthCheck(): Promise<{
    redis: boolean;
    queuesAccessible: boolean;
    totalInQueue: number;
  }> {
    try {
      const redisHealthy = await RedisHelper.healthCheck();
      const totalInQueue = await this.getQueueLength();

      return {
        redis: redisHealthy,
        queuesAccessible: true,
        totalInQueue,
      };
    } catch (error) {
      console.error('Queue health check failed:', error);
      return {
        redis: false,
        queuesAccessible: false,
        totalInQueue: 0,
      };
    }
  }

  // ============= DEBUGGING =============

  async debugQueue(): Promise<{
    stats: any;
    waitingSessions: QueueStatus[];
    queueContents: {
      high: QueueEntry[];
      normal: QueueEntry[];
      low: QueueEntry[];
    };
  }> {
    const stats = await this.getQueueStats();
    const waitingSessions = await this.getWaitingSessions();

    // Get actual queue contents
    const [highItems, normalItems, lowItems] = await Promise.all([
      redis.lrange(REDIS_KEYS.HIGH_PRIORITY_QUEUE, 0, -1),
      redis.lrange(REDIS_KEYS.NORMAL_PRIORITY_QUEUE, 0, -1),
      redis.lrange(REDIS_KEYS.LOW_PRIORITY_QUEUE, 0, -1),
    ]);

    const queueContents = {
      high: highItems.map((item) => JSON.parse(item)),
      normal: normalItems.map((item) => JSON.parse(item)),
      low: lowItems.map((item) => JSON.parse(item)),
    };

    return {
      stats,
      waitingSessions,
      queueContents,
    };
  }
}

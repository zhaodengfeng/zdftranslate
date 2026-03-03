/**
 * Token Bucket Rate Limiter
 * 支持突发流量控制和平均速率限制
 */
class TokenBucket {
  constructor(capacity, ratePerSecond) {
    this.capacity = capacity;        // 桶容量（最大突发请求数）
    this.tokens = capacity;          // 当前令牌数
    this.rate = ratePerSecond;       // 每秒补充速率
    this.lastUpdate = Date.now();
  }

  /**
   * 尝试消费指定数量的令牌
   * @param {number} tokens - 需要消费的令牌数，默认 1
   * @returns {Promise<boolean>} - 是否成功消费
   */
  async consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    // 计算需要等待的时间
    const waitMs = Math.ceil((tokens - this.tokens) * 1000 / this.rate);
    await this.sleep(waitMs);
    return this.consume(tokens);
  }

  /**
   * 尝试消费令牌，如果不能立即消费则返回 false（不等待）
   * @param {number} tokens - 需要消费的令牌数
   * @returns {boolean} - 是否成功消费
   */
  tryConsume(tokens = 1) {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  /**
   * 补充令牌
   */
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastUpdate = now;
  }

  /**
   * 获取当前令牌数
   */
  getTokens() {
    this.refill();
    return this.tokens;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 服务限流管理器
 * 为每个翻译服务配置不同的限流策略
 */
class RateLimitManager {
  constructor() {
    // 各服务的限流配置：容量（突发请求数）和速率（每秒请求数）
    this.buckets = {
      // 免费公共服务：限制更严格
      libretranslate: new TokenBucket(3, 4),      // 3突发，每秒4个
      mymemory: new TokenBucket(3, 4),
      
      // 付费 API 服务：可以更激进
      openai: new TokenBucket(10, 20),
      openrouter: new TokenBucket(10, 20),
      kimi: new TokenBucket(8, 15),
      zhipu: new TokenBucket(8, 15),
      deepseek: new TokenBucket(8, 15),
      aliyun: new TokenBucket(8, 15),
      'aliyun-mt': new TokenBucket(8, 15),
      google: new TokenBucket(5, 10),
      deepl: new TokenBucket(5, 10),
      
      // 默认配置
      default: new TokenBucket(5, 8)
    };
  }

  /**
   * 获取指定服务的限流桶
   */
  getBucket(serviceName) {
    return this.buckets[serviceName] || this.buckets.default;
  }

  /**
   * 更新服务配置
   */
  updateConfig(serviceName, capacity, ratePerSecond) {
    this.buckets[serviceName] = new TokenBucket(capacity, ratePerSecond);
  }

  /**
   * 等待指定服务的限流
   */
  async wait(serviceName, tokens = 1) {
    const bucket = this.getBucket(serviceName);
    return await bucket.consume(tokens);
  }
}

// 导出（如果支持模块）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TokenBucket, RateLimitManager };
}

/**
 * In-memory sliding-window rate limiter.
 * Avoids consuming Firestore document write/read quotas on the free Spark tier,
 * provides sub-millisecond overhead, and cleanly prevents abuse.
 */

class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();

    // Clean up expired buckets every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  isRateLimited(key) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Filter out timestamps outside the window
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      return true;
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return false;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }

  reset() {
    this.requests.clear();
  }
}

// 30 requests per guest per minute on guest routes
const guestLimiter = new RateLimiter(60 * 1000, 30);

// 10 requests per minute per IP on /api/redeemReward
const staffLimiter = new RateLimiter(60 * 1000, 10);

function guestRateLimitMiddleware(req, res, next) {
  const guestId = (req.body && req.body.guestId) || req.ip || 'anonymous';
  if (guestLimiter.isRateLimited(guestId)) {
    return res.status(429).json({
      error: 'resource-exhausted',
      message: 'Too many requests. Please slow down.'
    });
  }
  next();
}

function staffRateLimitMiddleware(req, res, next) {
  const ipKey = req.ip || req.connection?.remoteAddress || 'staff-global';
  if (staffLimiter.isRateLimited(ipKey)) {
    return res.status(429).json({
      error: 'resource-exhausted',
      message: 'Too many redemption attempts. Please wait a minute.'
    });
  }
  next();
}

module.exports = {
  guestLimiter,
  staffLimiter,
  guestRateLimitMiddleware,
  staffRateLimitMiddleware
};


'use strict';

const crypto = require('crypto');

const LOGSTASH_URL = process.env.LOGSTASH_URL;

function log(level, event, fields = {}) {
  const record = {
    '@timestamp': new Date().toISOString(),
    level,
    service: 'portfolio-auth-api',
    event,
    ...fields
  };

  const line = JSON.stringify(record);

  // Keep logging to the backend console.
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }

  // Forward the structured log to Logstash when configured.
  if (LOGSTASH_URL) {
    fetch(LOGSTASH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: line,
      signal: AbortSignal.timeout(2000)
    }).catch((err) => {
      console.error(JSON.stringify({
        level: 'warn',
        service: 'portfolio-auth-api',
        event: 'logstash_delivery_failed',
        error: err.message
      }));
    });
  }
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId = crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1e6;

    const level =
      res.statusCode >= 500 ? 'error' :
      res.statusCode >= 400 ? 'warn' :
      'info';

    log(level, 'http_request_completed', {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status_code: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100
    });
  });

  next();
}

module.exports = { log, requestLogger };

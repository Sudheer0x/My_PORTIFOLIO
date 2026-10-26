
'use strict';

const crypto = require('crypto');

const LOGSTASH_URL = process.env.LOGSTASH_URL;
const LOGSTASH_USER = process.env.LOGSTASH_USER;
const LOGSTASH_PASSWORD = process.env.LOGSTASH_PASSWORD;
console.log(JSON.stringify({
  service: 'portfolio-auth-api',
  event: 'logstash_config_check',
  url_configured: Boolean(LOGSTASH_URL),
  username_configured: Boolean(LOGSTASH_USER),
  password_configured: Boolean(LOGSTASH_PASSWORD)
}));
function log(level, event, fields = {}) {
  const record = {
    '@timestamp': new Date().toISOString(),
    level,
    service: 'portfolio-auth-api',
    event,
    ...fields
  };

  const line = JSON.stringify(record);

  // Always keep structured logs in the backend console.
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }

  // Forward logs only when Logstash is configured.
  if (LOGSTASH_URL) {
    const headers = {
      'Content-Type': 'application/json'
    };

    // Add Basic Authentication when credentials are configured.
    if (LOGSTASH_USER && LOGSTASH_PASSWORD) {
      const credentials = Buffer.from(
        `${LOGSTASH_USER}:${LOGSTASH_PASSWORD}`
      ).toString('base64');

      headers.Authorization = `Basic ${credentials}`;
    }

    fetch(LOGSTASH_URL, {
      method: 'POST',
      headers,
      body: line,
      signal: AbortSignal.timeout(2000)
    })
      .then((response) => {
        if (!response.ok) {
          console.error(JSON.stringify({
            level: 'warn',
            service: 'portfolio-auth-api',
            event: 'logstash_delivery_failed',
            status_code: response.status
          }));
        }
      })
      .catch((err) => {
        console.error(JSON.stringify({
          level: 'warn',
          service: 'portfolio-auth-api',
          event: 'logstash_delivery_failed',
          error: err.name === 'TimeoutError'
            ? 'timeout'
            : 'connection_error'
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

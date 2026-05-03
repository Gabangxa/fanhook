const crypto = require('crypto');

/**
 * Verify the signature of an incoming webhook payload.
 *
 * @param {string} provider - 'stripe' | 'github' | 'shopify' | 'linear' | 'pagerduty' | 'clerk' | 'generic'
 * @param {string} rawBody - Raw request body as string
 * @param {object} headers - Request headers object
 * @param {string|null} secret - Signing secret stored on the sink
 * @returns {{ valid: boolean, error: string|null }}
 */
function verifySignature(provider, rawBody, headers, secret) {
  try {
    if (provider === 'stripe') {
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }

      const sigHeader = headers['stripe-signature'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing stripe-signature header' };
      }

      // Parse t= and v1= from header like: t=1234567890,v1=abc123...
      const parts = sigHeader.split(',').reduce((acc, part) => {
        const [key, val] = part.split('=');
        acc[key.trim()] = val ? val.trim() : '';
        return acc;
      }, {});

      const timestamp = parts['t'];
      const v1Sig = parts['v1'];

      if (!timestamp || !v1Sig) {
        return { valid: false, error: 'Invalid stripe-signature format' };
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(signedPayload, 'utf8')
        .digest('hex');

      const valid = crypto.timingSafeEqual(
        Buffer.from(expectedSig, 'hex'),
        Buffer.from(v1Sig, 'hex')
      );

      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'github') {
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }

      const sigHeader = headers['x-hub-signature-256'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing x-hub-signature-256 header' };
      }

      const receivedSig = sigHeader.startsWith('sha256=')
        ? sigHeader.slice(7)
        : sigHeader;

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('hex');

      // Ensure both buffers are same length before timingSafeEqual
      if (expectedSig.length !== receivedSig.length) {
        return { valid: false, error: 'Signature mismatch' };
      }

      const valid = crypto.timingSafeEqual(
        Buffer.from(expectedSig, 'hex'),
        Buffer.from(receivedSig, 'hex')
      );

      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'shopify') {
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }
      const sigHeader = headers['x-shopify-hmac-sha256'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing x-shopify-hmac-sha256 header' };
      }
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');
      const receivedBuf = Buffer.from(String(sigHeader), 'base64');
      const expectedBuf = Buffer.from(expectedSig, 'base64');
      if (receivedBuf.length !== expectedBuf.length || receivedBuf.length === 0) {
        return { valid: false, error: 'Signature mismatch' };
      }
      const valid = crypto.timingSafeEqual(expectedBuf, receivedBuf);
      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'linear') {
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }
      const sigHeader = headers['linear-signature'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing linear-signature header' };
      }
      const received = String(sigHeader).trim();
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('hex');
      if (expectedSig.length !== received.length) {
        return { valid: false, error: 'Signature mismatch' };
      }
      let expectedBuf, receivedBuf;
      try {
        expectedBuf = Buffer.from(expectedSig, 'hex');
        receivedBuf = Buffer.from(received, 'hex');
      } catch (_) {
        return { valid: false, error: 'Invalid linear-signature format' };
      }
      if (expectedBuf.length !== receivedBuf.length) {
        return { valid: false, error: 'Signature mismatch' };
      }
      const valid = crypto.timingSafeEqual(expectedBuf, receivedBuf);
      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'pagerduty') {
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }
      const sigHeader = headers['x-pagerduty-signature'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing x-pagerduty-signature header' };
      }
      // Header form: "v1=hex,v1=hex,..." — multiple sigs may be present
      // during secret rotation. Accept if any v1 candidate matches.
      const candidates = String(sigHeader)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('v1='))
        .map((s) => s.slice(3));
      if (candidates.length === 0) {
        return { valid: false, error: 'Invalid x-pagerduty-signature format' };
      }
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('hex');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      let valid = false;
      for (const cand of candidates) {
        if (cand.length !== expectedSig.length) continue;
        const candBuf = Buffer.from(cand, 'hex');
        if (candBuf.length !== expectedBuf.length) continue;
        if (crypto.timingSafeEqual(expectedBuf, candBuf)) { valid = true; break; }
      }
      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'clerk') {
      // Clerk uses Svix-style signatures.
      if (!secret) {
        return { valid: false, error: 'No webhook_secret configured for this sink' };
      }
      const id = headers['svix-id'];
      const ts = headers['svix-timestamp'];
      const sigHeader = headers['svix-signature'];
      if (!id || !ts || !sigHeader) {
        return { valid: false, error: 'Missing svix-id / svix-timestamp / svix-signature header' };
      }
      // Secret may be prefixed with "whsec_" and is base64-encoded; decode if so.
      const rawSecret = String(secret).startsWith('whsec_')
        ? Buffer.from(String(secret).slice('whsec_'.length), 'base64')
        : Buffer.from(String(secret), 'utf8');
      if (rawSecret.length === 0) {
        return { valid: false, error: 'Invalid clerk webhook secret' };
      }
      const signedPayload = `${id}.${ts}.${rawBody}`;
      const expectedSig = crypto
        .createHmac('sha256', rawSecret)
        .update(signedPayload, 'utf8')
        .digest('base64');
      const candidates = String(sigHeader)
        .split(' ')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('v1,'))
        .map((s) => s.slice(3));
      if (candidates.length === 0) {
        return { valid: false, error: 'Invalid svix-signature format' };
      }
      const expectedBuf = Buffer.from(expectedSig, 'base64');
      let valid = false;
      for (const cand of candidates) {
        const candBuf = Buffer.from(cand, 'base64');
        if (candBuf.length !== expectedBuf.length || candBuf.length === 0) continue;
        if (crypto.timingSafeEqual(expectedBuf, candBuf)) { valid = true; break; }
      }
      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    // generic or unknown — skip verification
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}

module.exports = { verifySignature };

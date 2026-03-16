const crypto = require('crypto');

const DEFAULT_SECRETS = {
  stripe: 'whsec_demo1234567890abcdef',
  github: 'github_demo_secret_xyz',
};

/**
 * Verify the signature of an incoming webhook payload.
 *
 * @param {string} provider - 'stripe' | 'github' | 'generic'
 * @param {string} rawBody - Raw request body as string
 * @param {object} headers - Request headers object
 * @param {string|null} secret - Optional override secret; falls back to defaults
 * @returns {{ valid: boolean, error: string|null }}
 */
function verifySignature(provider, rawBody, headers, secret) {
  try {
    if (provider === 'stripe') {
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

      const signingSecret = secret || DEFAULT_SECRETS.stripe;
      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSig = crypto
        .createHmac('sha256', signingSecret)
        .update(signedPayload, 'utf8')
        .digest('hex');

      const valid = crypto.timingSafeEqual(
        Buffer.from(expectedSig, 'hex'),
        Buffer.from(v1Sig, 'hex')
      );

      return { valid, error: valid ? null : 'Signature mismatch' };
    }

    if (provider === 'github') {
      const sigHeader = headers['x-hub-signature-256'];
      if (!sigHeader) {
        return { valid: false, error: 'Missing x-hub-signature-256 header' };
      }

      const receivedSig = sigHeader.startsWith('sha256=')
        ? sigHeader.slice(7)
        : sigHeader;

      const signingSecret = secret || DEFAULT_SECRETS.github;
      const expectedSig = crypto
        .createHmac('sha256', signingSecret)
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

    // generic or unknown — skip verification
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}

module.exports = { verifySignature };

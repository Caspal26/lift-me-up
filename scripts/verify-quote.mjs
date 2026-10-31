#!/usr/bin/env node
// Usage: node scripts/verify-quote.mjs <source-url> "<exact quote>"
// Runs the same check the server runs before publishing a quote.
import { verifyQuote } from '../server/research/verify.js';

const [url, ...rest] = process.argv.slice(2);
const quote = rest.join(' ');
if (!url || !quote) {
  console.error('Usage: node scripts/verify-quote.mjs <source-url> "<exact quote>"');
  process.exitCode = 2;
} else {
  const result = await verifyQuote(quote, url);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verified ? 0 : 1;
}

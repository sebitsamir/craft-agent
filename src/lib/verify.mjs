/**
 * Thin re-export wrapper.
 *
 * The real implementation now lives in @craft-agent/pack-software.
 * This file exists so that the CLI (src/cli.mjs) continues to import
 * from './lib/verify.mjs' without any change, preserving seed parity.
 *
 * We use a relative path to the compiled pack output because the root
 * package.json must maintain zero production dependencies (F0 rule).
 */
export { verify } from '../../packs/software/dist/index.js';

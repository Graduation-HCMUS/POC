/* eslint-disable no-process-env */
import logger from 'jet-logger';
import { z } from 'zod';

// ========================================================================= //
//                                 CONSTANTS                                 //
// ========================================================================= //

// NOTE: These need to match the names of your ".env" files
export const NodeEnvs = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;
export type NodeEnvs = z.infer<typeof NodeEnvsEnum>;

export const Env = {
  NODE_ENV: (process.env.NODE_ENV ?? 'development').toLowerCase(),
  PORT: Number(process.env.PORT ?? 3000),
} as const;

// ========================================================================= //
//                                   EXEC                                    //
// ========================================================================= //

const NodeEnvsEnum = z.enum(NodeEnvs, 'Not a valid node environment');

const EnvSchema = z.object({
  NODE_ENV: NodeEnvsEnum,
  PORT: z.number().int().min(1).max(65535),
});

// ===================== Validate Environment Variables ==================== //

{
  try {
    EnvSchema.parse(Env);
  } catch (err) {
    logger.err(err);
    throw err;
  }
}

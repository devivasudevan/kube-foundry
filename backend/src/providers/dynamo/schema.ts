import { z } from 'zod';
import { baseDeploymentConfigSchema } from '../types';

/**
 * Dynamo-specific deployment configuration schema
 * Extends the base schema with Dynamo-specific validation
 */
export const dynamoDeploymentConfigSchema = baseDeploymentConfigSchema.extend({
  // Dynamo supports all engines: vllm, sglang, trtllm
  // Each has different disaggregation flags:
  // - vllm: --is-prefill-worker for prefill workers
  // - sglang: --disaggregation-mode prefill|decode
  // - trtllm: --disaggregation-mode prefill|decode
});

export type DynamoDeploymentConfig = z.infer<typeof dynamoDeploymentConfigSchema>;

/**
 * Dynamo manifest schema for validation
 */
export const dynamoManifestSchema = z.object({
  apiVersion: z.literal('dynamo.nvidia.com/v1alpha1'),
  kind: z.literal('DynamoGraphDeployment'),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string()).optional(),
  }),
  spec: z.object({
    Frontend: z.object({
      replicas: z.number().optional(),
      'http-port': z.number().optional(),
      'router-mode': z.enum(['kv', 'round-robin']).optional(),
    }),
  }).passthrough(), // Allow VllmWorker, SglangWorker, TrtllmWorker
});

export type DynamoManifest = z.infer<typeof dynamoManifestSchema>;

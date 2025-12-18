import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { providerRegistry } from '../providers';
import { metricsService } from '../services/metrics';
import { validateGpuFit, formatGpuWarnings } from '../services/gpuValidation';
import models from '../data/models.json';
import logger from '../lib/logger';
import type { DeploymentStatus } from '@kubefoundry/shared';
import {
  namespaceSchema,
  resourceNameSchema,
} from '../lib/validation';

const listDeploymentsQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(100).optional()),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(0).optional()),
});

const deploymentQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
});

const deploymentParamsSchema = z.object({
  name: resourceNameSchema,
});

const deployments = new Hono()
  .get('/', zValidator('query', listDeploymentsQuerySchema), async (c) => {
    try {
      const { namespace, limit, offset } = c.req.valid('query');

      let deploymentsList: DeploymentStatus[] = [];

      if (namespace) {
        // If namespace specified, query that namespace only
        deploymentsList = await kubernetesService.listDeployments(namespace);
      } else {
        // Query all provider namespaces and merge results
        const providerNamespaces = providerRegistry.listProviderIds()
          .map(id => providerRegistry.getProvider(id).defaultNamespace);
        
        // Remove duplicates
        const uniqueNamespaces = [...new Set(providerNamespaces)];
        
        // Query all namespaces in parallel
        const results = await Promise.all(
          uniqueNamespaces.map(ns => kubernetesService.listDeployments(ns))
        );
        
        // Merge and flatten
        for (const result of results) {
          deploymentsList.push(...result);
        }
        
        // Sort by creation time (newest first)
        deploymentsList.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });
      }

      const total = deploymentsList.length;

      // Apply pagination
      if (offset !== undefined || limit !== undefined) {
        const start = offset || 0;
        const end = limit ? start + limit : undefined;
        deploymentsList = deploymentsList.slice(start, end);
      }

      return c.json({
        deployments: deploymentsList || [],
        pagination: {
          total,
          limit: limit || total,
          offset: offset || 0,
          hasMore: (offset || 0) + deploymentsList.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error in GET /deployments');
      return c.json({
        deployments: [],
        pagination: { total: 0, limit: 0, offset: 0, hasMore: false },
      });
    }
  })
  .post('/', async (c) => {
    const body = await c.req.json();

    // Provider is required - no more fallback to active provider
    const providerId = body.provider;
    if (!providerId) {
      throw new HTTPException(400, {
        message: 'The "provider" field is required. Please specify the runtime (dynamo or kuberay).',
      });
    }

    const provider = providerRegistry.getProvider(providerId);
    const validationResult = provider.validateConfig(body);

    if (!validationResult.valid) {
      throw new HTTPException(400, {
        message: `Validation error: ${validationResult.errors.join(', ')}`,
      });
    }

    const config = validationResult.data!;
    // Ensure provider is set on config
    config.provider = providerId;

    // GPU fit validation
    let gpuWarnings: string[] = [];
    try {
      const capacity = await kubernetesService.getClusterGpuCapacity();

      const model = models.models.find((m) => m.id === config.modelId);
      const modelMinGpus = (model as { minGpus?: number })?.minGpus ?? 1;

      const gpuFitResult = validateGpuFit(config, capacity, modelMinGpus);
      if (!gpuFitResult.fits) {
        gpuWarnings = formatGpuWarnings(gpuFitResult);
        logger.warn(
          {
            modelId: config.modelId,
            warnings: gpuWarnings,
            capacity: {
              available: capacity.availableGpus,
              maxContiguous: capacity.maxContiguousAvailable,
            },
          },
          'GPU fit warnings for deployment'
        );
      }
    } catch (gpuError) {
      logger.warn({ error: gpuError }, 'Could not perform GPU fit validation');
    }

    await kubernetesService.createDeployment(config, providerId);

    return c.json(
      {
        message: 'Deployment created successfully',
        name: config.name,
        namespace: config.namespace,
        provider: providerId,
        ...(gpuWarnings.length > 0 && { warnings: gpuWarnings }),
      },
      201
    );
  })
  .get(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace);

      if (!deployment) {
        throw new HTTPException(404, { message: 'Deployment not found' });
      }

      return c.json(deployment);
    }
  )
  .delete(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      await kubernetesService.deleteDeployment(name, resolvedNamespace);

      return c.json({ message: 'Deployment deleted successfully' });
    }
  )
  .get(
    '/:name/pods',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      const pods = await kubernetesService.getDeploymentPods(name, resolvedNamespace);
      return c.json({ pods });
    }
  )
  .get(
    '/:name/metrics',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      // Get deployment to determine its provider
      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace);
      const providerId = deployment?.provider;

      const metricsResponse = await metricsService.getDeploymentMetrics(name, resolvedNamespace, providerId);
      return c.json(metricsResponse);
    }
)
  .get(
    '/:name/pending-reasons',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      try {
        // Get deployment to find pending pods
        const deployment = await kubernetesService.getDeployment(name, resolvedNamespace);

        if (!deployment) {
          throw new HTTPException(404, { message: 'Deployment not found' });
        }

        // Get all pending pods
        const pendingPods = deployment.pods.filter(pod => pod.phase === 'Pending');

        if (pendingPods.length === 0) {
          return c.json({ reasons: [] });
        }

        // Get failure reasons for the first pending pod (they're typically the same)
        const podName = pendingPods[0].name;
        const reasons = await kubernetesService.getPodFailureReasons(podName, resolvedNamespace);

        return c.json({ reasons });
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logger.error({ error, name, namespace: resolvedNamespace }, 'Error getting pending reasons');
        return c.json(
          {
            error: {
              message: error instanceof Error ? error.message : 'Failed to get pending reasons',
              statusCode: 500,
            },
          },
          500
        );
      }
    }
  );

export default deployments;

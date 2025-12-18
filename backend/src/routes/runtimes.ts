import { Hono } from 'hono';
import { kubernetesService } from '../services/kubernetes';
import logger from '../lib/logger';

const runtimes = new Hono()
  .get('/status', async (c) => {
    logger.debug('Fetching runtimes status');
    
    try {
      const runtimesStatus = await kubernetesService.getRuntimesStatus();
      
      return c.json({
        runtimes: runtimesStatus,
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching runtimes status');
      return c.json({
        runtimes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

export default runtimes;

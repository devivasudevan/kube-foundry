# Contributing to KubeFoundry

Thank you for your interest in contributing to KubeFoundry! This guide covers development setup, project structure, and contribution guidelines.

## Development Setup

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh) 1.0+)
- Access to a Kubernetes cluster
- Helm CLI
- kubectl configured with cluster access

### Quick Start

```bash
# Install dependencies
npm install

# Start development servers (frontend + backend)
npm run dev

# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

### Build Commands

```bash
# Build all packages
npm run build

# Build single binary (backend only)
npm run compile

# Lint all packages
npm run lint
```

### Individual Package Commands

**Frontend:**
```bash
npm run dev:frontend    # Start Vite dev server
npm run build:frontend  # Build for production
```

**Backend:**
```bash
npm run dev:backend     # Start with watch mode
npm run build:backend   # Compile TypeScript
```

## Project Structure

```
kubefoundry/
├── frontend/          # React frontend application
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── pages/       # Page components
│   │   ├── hooks/       # React hooks
│   │   └── lib/         # Utilities and API client
│   └── ...
├── backend/           # Express backend API
│   ├── src/
│   │   ├── providers/   # Provider implementations
│   │   │   ├── types.ts      # Provider interface
│   │   │   ├── index.ts      # Provider registry
│   │   │   └── dynamo/       # NVIDIA Dynamo provider
│   │   ├── routes/      # API routes
│   │   ├── services/    # Core services
│   │   │   ├── kubernetes.ts # K8s client
│   │   │   ├── config.ts     # ConfigMap persistence
│   │   │   └── helm.ts       # Helm CLI integration
│   │   └── data/        # Static model catalog
│   └── ...
├── shared/            # Shared TypeScript types
└── docs/              # Documentation
```

## Architecture

### Provider Pattern

KubeFoundry uses a provider abstraction to support multiple inference runtimes:

```typescript
interface Provider {
  id: string;
  name: string;
  getCRDConfig(): CRDConfig;
  generateManifest(config: DeploymentConfig): object;
  parseStatus(resource: object): DeploymentStatus;
  validateConfig(config: DeploymentConfig): ValidationResult;
  checkInstallation(k8s: KubernetesService): Promise<InstallationStatus>;
  getHelmRepos(): HelmRepo[];
  getHelmCharts(): HelmChart[];
}
```

### Configuration Storage

Settings are stored in a Kubernetes ConfigMap (`kubefoundry-config`) in the `kubefoundry` namespace:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubefoundry-config
  namespace: kubefoundry
data:
  config.json: |
    {
      "activeProviderId": "dynamo",
      "providerConfigs": {}
    }
```

## Environment Variables

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
VITE_DEFAULT_NAMESPACE=kubefoundry
VITE_DEFAULT_HF_SECRET=hf-token-secret
```

### Backend (.env)
```env
PORT=3001
DEFAULT_NAMESPACE=kubefoundry
CORS_ORIGIN=http://localhost:5173
```

## Adding a New Provider

1. **Create provider directory:**
   ```
   backend/src/providers/<name>/
   ├── index.ts    # Provider implementation
   └── schema.ts   # Zod validation schema
   ```

2. **Implement the Provider interface:**
   ```typescript
   import { Provider, CRDConfig, ... } from '../types';

   export class MyProvider implements Provider {
     id = 'my-provider';
     name = 'My Provider';
     description = '...';

     getCRDConfig(): CRDConfig { ... }
     generateManifest(config: DeploymentConfig): object { ... }
     parseStatus(resource: object): DeploymentStatus { ... }
     // ... implement all interface methods
   }
   ```

3. **Register the provider:**
   ```typescript
   // backend/src/providers/index.ts
   import { MyProvider } from './my-provider';

   providerRegistry.register(new MyProvider());
   ```

## Adding a New Model

Edit `backend/src/data/models.json`:

```json
{
  "models": [
    {
      "id": "org/model-name",
      "name": "Model Display Name",
      "description": "Brief description",
      "size": "7B",
      "task": "chat",
      "contextLength": 32768,
      "supportedEngines": ["vllm", "sglang"],
      "minGpuMemory": "16GB"
    }
  ]
}
```

## Testing API Endpoints

```bash
# Health check
curl http://localhost:3001/api/health

# Cluster status
curl http://localhost:3001/api/cluster/status

# List models
curl http://localhost:3001/api/models

# List deployments
curl http://localhost:3001/api/deployments

# Create deployment
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-deployment",
    "namespace": "kubefoundry",
    "modelId": "Qwen/Qwen3-0.6B",
    "engine": "vllm",
    "mode": "aggregated",
    "replicas": 1,
    "hfTokenSecret": "hf-token-secret",
    "enforceEager": true
  }'
```

## API Endpoints

### Settings
- `GET /api/settings` - Get current settings and provider list
- `PUT /api/settings` - Update settings

### Installation
- `GET /api/installation/helm/status` - Check Helm CLI availability
- `GET /api/installation/providers/:id/status` - Get provider installation status
- `GET /api/installation/providers/:id/commands` - Get manual installation commands
- `POST /api/installation/providers/:id/install` - Install provider via Helm
- `POST /api/installation/providers/:id/upgrade` - Upgrade provider
- `POST /api/installation/providers/:id/uninstall` - Uninstall provider

### Deployments
- `GET /api/deployments` - List all deployments
- `POST /api/deployments` - Create a new deployment
- `GET /api/deployments/:name` - Get deployment details
- `DELETE /api/deployments/:name` - Delete a deployment

### Models
- `GET /api/models` - Get model catalog

### Health
- `GET /api/health` - Health check
- `GET /api/cluster/status` - Kubernetes cluster status

## Troubleshooting

### Backend can't connect to cluster
- Verify kubectl is configured: `kubectl cluster-info`
- Check KUBECONFIG environment variable
- Ensure proper RBAC permissions

### Provider not detected as installed
- Check CRD exists: `kubectl get crd dynamographdeployments.dynamo.nvidia.com`
- Check operator deployment: `kubectl get deployments -n kubefoundry`

### Frontend can't reach backend
- Check CORS_ORIGIN matches frontend URL
- Verify backend is running on correct port
- Check browser console for errors

## Code Standards

Please refer to [docs/standards.md](docs/standards.md) for coding standards and conventions.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting (`npm run lint`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Questions?

Feel free to open an issue for questions or discussions about contributing.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useConfetti } from '@/components/ui/confetti'
import { useCreateDeployment, type DeploymentConfig } from '@/hooks/useDeployments'
import { useHuggingFaceStatus } from '@/hooks/useHuggingFace'
import { useToast } from '@/hooks/useToast'
import { generateDeploymentName, cn } from '@/lib/utils'
import { type Model, type DetailedClusterCapacity, type AutoscalerDetectionResult, type RuntimeStatus } from '@/lib/api'
import { ChevronDown, AlertCircle, Rocket, CheckCircle2, Sparkles, AlertTriangle, Server } from 'lucide-react'
import { CapacityWarning } from './CapacityWarning'
import { calculateGpuRecommendation } from '@/lib/gpu-recommendations'

interface DeploymentFormProps {
  model: Model
  detailedCapacity?: DetailedClusterCapacity
  autoscaler?: AutoscalerDetectionResult
  runtimes?: RuntimeStatus[]
}

type Engine = 'vllm' | 'sglang' | 'trtllm'
type RouterMode = 'none' | 'kv' | 'round-robin'
type DeploymentMode = 'aggregated' | 'disaggregated'
type RuntimeId = 'dynamo' | 'kuberay'

// Runtime metadata for display
const RUNTIME_INFO: Record<RuntimeId, { name: string; description: string; defaultNamespace: string }> = {
  dynamo: {
    name: 'NVIDIA Dynamo',
    description: 'High-performance inference with KV-cache routing and disaggregated serving',
    defaultNamespace: 'dynamo-system',
  },
  kuberay: {
    name: 'KubeRay',
    description: 'Ray-based serving with autoscaling and distributed inference',
    defaultNamespace: 'kuberay-system',
  },
}

// Engine support by runtime
const RUNTIME_ENGINES: Record<RuntimeId, Engine[]> = {
  dynamo: ['vllm', 'sglang', 'trtllm'],
  kuberay: ['vllm'], // KubeRay only supports vLLM currently
}

export function DeploymentForm({ model, detailedCapacity, autoscaler, runtimes }: DeploymentFormProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const createDeployment = useCreateDeployment()
  const { data: hfStatus } = useHuggingFaceStatus()
  const formRef = useRef<HTMLFormElement>(null)
  const { trigger: triggerConfetti, ConfettiComponent } = useConfetti(2500)

  // Check if this is a gated model and HF is not configured
  const isGatedModel = model.gated === true
  const needsHfAuth = isGatedModel && !hfStatus?.configured

  // Determine default runtime: prefer Dynamo if installed, then KubeRay
  const getDefaultRuntime = (): RuntimeId => {
    if (!runtimes || runtimes.length === 0) return 'dynamo'
    const dynamo = runtimes.find(r => r.id === 'dynamo')
    if (dynamo?.installed) return 'dynamo'
    const kuberay = runtimes.find(r => r.id === 'kuberay')
    if (kuberay?.installed) return 'kuberay'
    return 'dynamo'
  }

  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>(getDefaultRuntime)
  const selectedRuntimeStatus = runtimes?.find(r => r.id === selectedRuntime)
  const isRuntimeInstalled = selectedRuntimeStatus?.installed ?? false

  // Get supported engines for the selected runtime, filtered by model support
  const getAvailableEngines = (): Engine[] => {
    const runtimeEngines = RUNTIME_ENGINES[selectedRuntime]
    return model.supportedEngines.filter(e => runtimeEngines.includes(e))
  }
  const availableEngines = getAvailableEngines()

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [config, setConfig] = useState<DeploymentConfig>({
    name: generateDeploymentName(model.id),
    namespace: RUNTIME_INFO[getDefaultRuntime()].defaultNamespace,
    modelId: model.id,
    servedModelName: model.id,  // Use HuggingFace model ID as served model name
    engine: availableEngines[0] || 'vllm',
    mode: 'aggregated',
    provider: getDefaultRuntime(),
    routerMode: 'none',
    replicas: 1,
    hfTokenSecret: import.meta.env.VITE_DEFAULT_HF_SECRET || 'hf-token-secret',
    enforceEager: true,
    enablePrefixCaching: false,
    trustRemoteCode: false,
    // Disaggregated mode defaults
    prefillReplicas: 1,
    decodeReplicas: 1,
    prefillGpus: 1,
    decodeGpus: 1,
    // GPU resources for aggregated mode
    resources: {
      gpu: 0, // Will be set from recommendation
    },
  })

  // Calculate GPU recommendation based on model characteristics
  const gpuRecommendation = calculateGpuRecommendation(model, detailedCapacity)

  // Set initial GPU value from recommendation when component mounts
  useEffect(() => {
    if (config.resources?.gpu === 0 && gpuRecommendation.recommendedGpus > 0) {
      setConfig(prev => ({
        ...prev,
        resources: {
          ...prev.resources,
          gpu: gpuRecommendation.recommendedGpus
        }
      }))
    }
  }, [gpuRecommendation.recommendedGpus])

  // Handle runtime change - update namespace and engine
  const handleRuntimeChange = (runtime: RuntimeId) => {
    setSelectedRuntime(runtime)
    const newAvailableEngines = model.supportedEngines.filter(e => RUNTIME_ENGINES[runtime].includes(e))
    const currentEngineSupported = newAvailableEngines.includes(config.engine)
    
    setConfig(prev => ({
      ...prev,
      provider: runtime,
      namespace: RUNTIME_INFO[runtime].defaultNamespace,
      // Reset engine if current one isn't supported by new runtime
      engine: currentEngineSupported ? prev.engine : (newAvailableEngines[0] || 'vllm'),
      // Reset router mode if switching away from Dynamo
      routerMode: runtime === 'dynamo' ? prev.routerMode : 'none',
    }))
  }

  // Keyboard shortcut: Cmd/Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!createDeployment.isProcessing && !needsHfAuth) {
          formRef.current?.requestSubmit()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [createDeployment.isProcessing, needsHfAuth])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      await createDeployment.mutateAsync(config)

      // Trigger confetti celebration!
      triggerConfetti()

      toast({
        title: 'Deployment Created',
        description: `${config.name} is being deployed to ${config.namespace}`,
        variant: 'success',
      })

      // Delay navigation slightly to let user see confetti
      setTimeout(() => {
        navigate('/deployments')
      }, 1500)
    } catch (error) {
      toast({
        title: 'Deployment Failed',
        description: error instanceof Error ? error.message : 'Failed to create deployment',
        variant: 'destructive',
      })
    }
  }, [config, createDeployment, navigate, toast, triggerConfetti])

  const updateConfig = <K extends keyof DeploymentConfig>(
    key: K,
    value: DeploymentConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  // Calculate total GPUs needed for the deployment
  const calculateSelectedGpus = (): number => {
    if (config.mode === 'disaggregated') {
      // For disaggregated, calculate total GPUs across all workers
      const prefillTotal = (config.prefillReplicas || 1) * (config.prefillGpus || 1);
      const decodeTotal = (config.decodeReplicas || 1) * (config.decodeGpus || 1);
      return prefillTotal + decodeTotal;
    }
    // For aggregated, multiply GPUs per replica by number of replicas
    const gpusPerReplica = config.resources?.gpu || gpuRecommendation.recommendedGpus || 1;
    const replicas = config.replicas || 1;
    return gpusPerReplica * replicas;
  }

  const selectedGpus = calculateSelectedGpus()

  // Calculate the maximum GPUs per single pod (for node placement constraints)
  const maxGpusPerPod = config.mode === 'disaggregated'
    ? Math.max(config.prefillGpus || 1, config.decodeGpus || 1)
    : (config.resources?.gpu || gpuRecommendation.recommendedGpus || 1);

  // Status-aware button content
  const getButtonContent = () => {
    if (needsHfAuth) {
      return 'HuggingFace Auth Required'
    }

    if (!isRuntimeInstalled) {
      return 'Runtime Not Installed'
    }

    switch (createDeployment.status) {
      case 'validating':
        return 'Validating...'
      case 'submitting':
        return 'Deploying...'
      case 'success':
        return (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Deployed!
          </>
        )
      default:
        return (
          <>
            <Rocket className="h-4 w-4" />
            Deploy Model
            <kbd className="hidden sm:inline-flex ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-primary-foreground/20 rounded">
              ⌘↵
            </kbd>
          </>
        )
    }
  }

  return (
    <>
      <ConfettiComponent count={60} />
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      {/* Gated Model Warning */}
      {needsHfAuth && (
        <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                HuggingFace Authentication Required
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                <strong>{model.name}</strong> is a gated model that requires HuggingFace authentication.
                Please{' '}
                  <a
                    href="/settings"
                  className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100"
                >
                  sign in with HuggingFace
                </a>{' '}
                in Settings before deploying.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Runtime Selection */}
      {runtimes && runtimes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Runtime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={selectedRuntime}
              onValueChange={(value) => handleRuntimeChange(value as RuntimeId)}
              className="grid gap-4 sm:grid-cols-2"
            >
              {runtimes.map((runtime) => {
                const info = RUNTIME_INFO[runtime.id as RuntimeId]
                if (!info) return null
                
                return (
                  <div
                    key={runtime.id}
                    className={cn(
                      "relative flex items-start space-x-3 rounded-lg border p-4 cursor-pointer transition-colors",
                      selectedRuntime === runtime.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50",
                      !runtime.installed && "opacity-75"
                    )}
                    onClick={() => handleRuntimeChange(runtime.id as RuntimeId)}
                  >
                    <RadioGroupItem value={runtime.id} id={`runtime-${runtime.id}`} className="mt-1" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`runtime-${runtime.id}`} className="cursor-pointer font-medium">
                          {info.name}
                        </Label>
                        {runtime.installed ? (
                          <Badge variant="outline" className="text-green-600 border-green-500 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Installed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-500 text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Not Installed
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {info.description}
                      </p>
                      {!runtime.installed && selectedRuntime === runtime.id && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                          <Link to="/installation" className="underline hover:no-underline">
                            Install {info.name}
                          </Link>{' '}
                          before deploying.
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Deployment Name</Label>
              <Input
                id="name"
                value={config.name}
                onChange={(e) => updateConfig('name', e.target.value)}
                placeholder="my-deployment"
                required
                pattern="^[a-z0-9]([-a-z0-9]*[a-z0-9])?$"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Input
                id="namespace"
                value={config.namespace}
                onChange={(e) => updateConfig('namespace', e.target.value)}
                placeholder={RUNTIME_INFO[selectedRuntime].defaultNamespace}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Inference Engine</CardTitle>
        </CardHeader>
        <CardContent>
          {availableEngines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No compatible engines available for this model with {RUNTIME_INFO[selectedRuntime].name}.
            </p>
          ) : (
            <RadioGroup
              value={config.engine}
              onValueChange={(value) => updateConfig('engine', value as Engine)}
              className="grid gap-4 sm:grid-cols-3"
            >
              {availableEngines.map((engine) => (
                <div key={engine} className="flex items-center space-x-2">
                  <RadioGroupItem value={engine} id={engine} />
                  <Label htmlFor={engine} className="cursor-pointer">
                    {engine === 'vllm' && 'vLLM'}
                    {engine === 'sglang' && 'SGLang'}
                    {engine === 'trtllm' && 'TensorRT-LLM'}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      {/* Deployment Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Deployment Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={config.mode}
            onValueChange={(value) => updateConfig('mode', value as DeploymentMode)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="aggregated" id="mode-aggregated" className="mt-1" />
              <div>
                <Label htmlFor="mode-aggregated" className="cursor-pointer font-medium">
                  Aggregated (Standard)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Combined prefill and decode on same workers
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="disaggregated" id="mode-disaggregated" className="mt-1" />
              <div>
                <Label htmlFor="mode-disaggregated" className="cursor-pointer font-medium">
                  Disaggregated (P/D)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Separate prefill and decode workers for better resource utilization
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Deployment Options */}
      <Card>
        <CardHeader>
          <CardTitle>Deployment Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.mode === 'aggregated' ? (
            /* Aggregated mode: single replica count */
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="replicas">Worker Replicas</Label>
                <Input
                  id="replicas"
                  type="number"
                  min={1}
                  max={10}
                  value={config.replicas}
                  onChange={(e) => updateConfig('replicas', parseInt(e.target.value) || 1)}
                />
              </div>

              {/* GPU per Replica with recommendation */}
              <div className="space-y-2">
                <Label htmlFor="gpusPerReplica" className="flex items-center gap-2">
                  GPUs per Replica
                  {config.resources?.gpu === gpuRecommendation.recommendedGpus && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <Sparkles className="h-3 w-3" />
                      Recommended
                    </span>
                  )}
                </Label>
                <Input
                  id="gpusPerReplica"
                  type="number"
                  min={1}
                  max={detailedCapacity?.maxNodeGpuCapacity || 8}
                  value={config.resources?.gpu || gpuRecommendation.recommendedGpus}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1
                    setConfig(prev => ({
                      ...prev,
                      resources: {
                        ...prev.resources,
                        gpu: value
                      }
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {gpuRecommendation.reason}
                  {gpuRecommendation.alternatives && gpuRecommendation.alternatives.length > 0 && (
                    <span className="block mt-1">
                      Consider: {gpuRecommendation.alternatives.join(', ')} GPUs
                    </span>
                  )}
                </p>
              </div>

              {/* Router Mode is only applicable to Dynamo provider */}
              {selectedRuntime === 'dynamo' && (
                <div className="space-y-2">
                  <Label>Router Mode</Label>
                  <RadioGroup
                    value={config.routerMode}
                    onValueChange={(value) => updateConfig('routerMode', value as RouterMode)}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="none" id="router-none" />
                      <Label htmlFor="router-none" className="cursor-pointer">None</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="kv" id="router-kv" />
                      <Label htmlFor="router-kv" className="cursor-pointer">KV-Aware</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="round-robin" id="router-rr" />
                      <Label htmlFor="router-rr" className="cursor-pointer">Round Robin</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </div>
          ) : (
            /* Disaggregated mode: separate prefill/decode configuration */
            <div className="space-y-6">
              {/* Prefill Workers */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Prefill Workers</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prefillReplicas">Replicas</Label>
                    <Input
                      id="prefillReplicas"
                      type="number"
                      min={1}
                      max={10}
                      value={config.prefillReplicas || 1}
                      onChange={(e) => updateConfig('prefillReplicas', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prefillGpus">GPUs per Worker</Label>
                    <Input
                      id="prefillGpus"
                      type="number"
                      min={1}
                      max={8}
                      value={config.prefillGpus || 1}
                      onChange={(e) => updateConfig('prefillGpus', parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>

              {/* Decode Workers */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Decode Workers</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="decodeReplicas">Replicas</Label>
                    <Input
                      id="decodeReplicas"
                      type="number"
                      min={1}
                      max={10}
                      value={config.decodeReplicas || 1}
                      onChange={(e) => updateConfig('decodeReplicas', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="decodeGpus">GPUs per Worker</Label>
                    <Input
                      id="decodeGpus"
                      type="number"
                      min={1}
                      max={8}
                      value={config.decodeGpus || 1}
                      onChange={(e) => updateConfig('decodeGpus', parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced Options */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <div className="flex items-center justify-between">
            <CardTitle>Advanced Options</CardTitle>
              <ChevronDown
              className={cn(
                "h-5 w-5 text-muted-foreground transition-transform duration-200 ease-out",
                showAdvanced && "rotate-180"
                )}
            />
          </div>
        </CardHeader>

        {/* Smooth accordion animation */}
          <div
          className={cn(
            "grid transition-all duration-300 ease-out-expo",
            showAdvanced ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <CardContent className="space-y-4 pt-0">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enforce Eager Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Use eager mode for faster startup
                </p>
              </div>
              <Switch
                checked={config.enforceEager}
                onCheckedChange={(checked) => updateConfig('enforceEager', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Prefix Caching</Label>
                <p className="text-xs text-muted-foreground">
                  Cache common prefixes for faster inference
                </p>
              </div>
              <Switch
                checked={config.enablePrefixCaching}
                onCheckedChange={(checked) => updateConfig('enablePrefixCaching', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Trust Remote Code</Label>
                <p className="text-xs text-muted-foreground">
                  Required for some models with custom code
                </p>
              </div>
              <Switch
                checked={config.trustRemoteCode}
                onCheckedChange={(checked) => updateConfig('trustRemoteCode', checked)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contextLength">Context Length (optional)</Label>
              <Input
                id="contextLength"
                type="number"
                placeholder={model.contextLength?.toString() || 'Default'}
                value={config.contextLength || ''}
                onChange={(e) => updateConfig('contextLength', e.target.value ? parseInt(e.target.value) : undefined)}
              />
            </div>
            </CardContent>
          </div>
        </div>
      </Card>

        {/* Capacity Warning */}
        {detailedCapacity && (
          <CapacityWarning
            selectedGpus={selectedGpus}
            capacity={detailedCapacity}
            autoscaler={autoscaler}
            maxGpusPerPod={maxGpusPerPod}
            deploymentMode={config.mode}
            replicas={config.replicas}
            gpusPerReplica={config.resources?.gpu || gpuRecommendation.recommendedGpus || 1}
          />
        )}

      {/* Submit Button */}
      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/')}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={createDeployment.isProcessing || needsHfAuth || !isRuntimeInstalled}
          loading={createDeployment.isProcessing}
          className={cn(
            "flex-1 gap-2",
            createDeployment.status === 'success' && "bg-green-600 hover:bg-green-600"
          )}
        >
          {getButtonContent()}
        </Button>
      </div>
    </form>
    </>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfetti } from '@/components/ui/confetti'
import { useCreateDeployment, type DeploymentConfig } from '@/hooks/useDeployments'
import { useHuggingFaceStatus, useGgufFiles } from '@/hooks/useHuggingFace'
import { usePremadeModels } from '@/hooks/useAikit'
import { useClusterNodes } from '@/hooks/useClusterStatus'
import { useToast } from '@/hooks/useToast'
import { generateDeploymentName, cn } from '@/lib/utils'
import { type Model, type DetailedClusterCapacity, type AutoscalerDetectionResult, type RuntimeStatus, type PremadeModel, aikitApi, type Engine } from '@/lib/api'
import { ChevronDown, AlertCircle, Rocket, CheckCircle2, Sparkles, AlertTriangle, Server, Cpu, Box, Loader2 } from 'lucide-react'
import { CapacityWarning } from './CapacityWarning'
import { calculateGpuRecommendation } from '@/lib/gpu-recommendations'

interface DeploymentFormProps {
  model: Model
  detailedCapacity?: DetailedClusterCapacity
  autoscaler?: AutoscalerDetectionResult
  runtimes?: RuntimeStatus[]
}

// Subset of Engine type for traditional GPU inference engines (excludes llamacpp which is KAITO-only)
type TraditionalEngine = 'vllm' | 'sglang' | 'trtllm'
type RouterMode = 'none' | 'kv' | 'round-robin'
type DeploymentMode = 'aggregated' | 'disaggregated'
type RuntimeId = 'dynamo' | 'kuberay' | 'kaito'
type KaitoComputeType = 'cpu' | 'gpu'
type GgufRunMode = 'build' | 'direct'

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
  kaito: {
    name: 'KAITO',
    description: 'CPU-capable inference with pre-built GGUF models via llama.cpp',
    defaultNamespace: 'kaito-workspace',
  },
}

// Engine support by runtime (only traditional GPU engines, not llamacpp)
const RUNTIME_ENGINES: Record<RuntimeId, TraditionalEngine[]> = {
  dynamo: ['vllm', 'sglang', 'trtllm'],
  kuberay: ['vllm'], // KubeRay only supports vLLM currently
  kaito: [], // KAITO uses llama.cpp, not traditional engines
}

// Check if a runtime is compatible with a model based on engine support
function isRuntimeCompatible(runtimeId: RuntimeId, modelEngines: Engine[]): boolean {
  // KAITO models (llamacpp engine) are only compatible with KAITO runtime
  if (modelEngines.includes('llamacpp')) {
    return runtimeId === 'kaito';
  }
  // Other models need at least one matching engine with the runtime
  const runtimeEngines = RUNTIME_ENGINES[runtimeId];
  return modelEngines.some(e => runtimeEngines.includes(e as TraditionalEngine));
}

export function DeploymentForm({ model, detailedCapacity, autoscaler, runtimes }: DeploymentFormProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const createDeployment = useCreateDeployment()
  const { data: hfStatus } = useHuggingFaceStatus()
  const { data: premadeModels } = usePremadeModels()
  const formRef = useRef<HTMLFormElement>(null)
  const { trigger: triggerConfetti, ConfettiComponent } = useConfetti(2500)

  // Check if this is a gated model and HF is not configured
  const isGatedModel = model.gated === true
  const needsHfAuth = isGatedModel && !hfStatus?.configured

  // Determine default runtime: prefer compatible and installed runtime
  const getDefaultRuntime = (): RuntimeId => {
    if (!runtimes || runtimes.length === 0) {
      // Fallback based on model engines
      return model.supportedEngines.includes('llamacpp') ? 'kaito' : 'dynamo';
    }
    
    // Find first compatible and installed runtime
    const compatibleRuntimes: RuntimeId[] = ['dynamo', 'kuberay', 'kaito'];
    for (const rtId of compatibleRuntimes) {
      const rt = runtimes.find(r => r.id === rtId);
      if (rt?.installed && isRuntimeCompatible(rtId, model.supportedEngines)) {
        return rtId;
      }
    }
    
    // If no compatible installed runtime, return first compatible one
    for (const rtId of compatibleRuntimes) {
      if (isRuntimeCompatible(rtId, model.supportedEngines)) {
        return rtId;
      }
    }
    
    return 'dynamo';
  }

  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>(getDefaultRuntime)
  const selectedRuntimeStatus = runtimes?.find(r => r.id === selectedRuntime)
  const isRuntimeInstalled = selectedRuntimeStatus?.installed ?? false

  // KAITO-specific state
  const [kaitoComputeType, setKaitoComputeType] = useState<KaitoComputeType>('cpu')
  const [selectedPremadeModel, setSelectedPremadeModel] = useState<PremadeModel | null>(null)
  const [preferredNodes, setPreferredNodes] = useState<string[]>([])
  const [ggufFile, setGgufFile] = useState<string>('')
  const [ggufRunMode, setGgufRunMode] = useState<GgufRunMode>('direct')
  
  // Fetch cluster nodes for KAITO preferred nodes selection
  const { data: clusterNodesData, isLoading: clusterNodesLoading } = useClusterNodes(selectedRuntime === 'kaito');
  const clusterNodes = clusterNodesData?.nodes || [];
  
  // Check if this is a HuggingFace GGUF model (not a premade model)
  // GGUF models have only llamacpp as supported engine and come from HuggingFace
  const isHuggingFaceGgufModel = model.supportedEngines.length === 1 && 
                                  model.supportedEngines[0] === 'llamacpp' &&
                                  !model.id.startsWith('kaito/');

  // Fetch GGUF files from HuggingFace repo when it's a GGUF model and KAITO is selected
  const { data: ggufFilesData, isLoading: ggufFilesLoading } = useGgufFiles(
    model.id,
    isHuggingFaceGgufModel && selectedRuntime === 'kaito'
  );
  const ggufFiles = ggufFilesData?.files || [];

  // Auto-select Q4_K_M file if available, otherwise first file
  useEffect(() => {
    if (ggufFiles.length > 0 && !ggufFile) {
      // Look for Q4_K_M variant (case-insensitive)
      const q4kmFile = ggufFiles.find(f => /q4_k_m/i.test(f));
      if (q4kmFile) {
        setGgufFile(q4kmFile);
      } else {
        // Fallback to first file
        setGgufFile(ggufFiles[0]);
      }
    }
  }, [ggufFiles, ggufFile]);

  // Get supported engines for the selected runtime, filtered by model support
  const getAvailableEngines = (): TraditionalEngine[] => {
    const runtimeEngines = RUNTIME_ENGINES[selectedRuntime]
    // Filter model engines to only those supported by the runtime (excluding llamacpp)
    return model.supportedEngines.filter(
      (e): e is TraditionalEngine => runtimeEngines.includes(e as TraditionalEngine)
    )
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

  // Auto-select matching premade model when navigating with a KAITO model from Models page
  useEffect(() => {
    if (premadeModels && premadeModels.length > 0 && !selectedPremadeModel) {
      // Try to match model.id (e.g., 'kaito/llama3.2-1b') to premade model id (e.g., 'llama3.2:1b')
      const modelIdWithoutPrefix = model.id.replace('kaito/', '').replace('-', ':');
      const matchingPremade = premadeModels.find(pm => pm.id === modelIdWithoutPrefix);
      if (matchingPremade) {
        setSelectedPremadeModel(matchingPremade);
        setConfig(prev => ({
          ...prev,
          name: generateDeploymentName(matchingPremade.id),
          modelId: matchingPremade.id,
          servedModelName: matchingPremade.modelName,
        }));
      }
    }
  }, [premadeModels, model.id, selectedPremadeModel])

  // Handle runtime change - update namespace and engine
  const handleRuntimeChange = (runtime: RuntimeId) => {
    setSelectedRuntime(runtime)
    const newAvailableEngines = model.supportedEngines.filter(
      (e): e is TraditionalEngine => RUNTIME_ENGINES[runtime].includes(e as TraditionalEngine)
    )
    const currentEngineSupported = newAvailableEngines.includes(config.engine as TraditionalEngine)
    
    setConfig(prev => ({
      ...prev,
      provider: runtime,
      namespace: RUNTIME_INFO[runtime].defaultNamespace,
      // Reset engine if current one isn't supported by new runtime
      engine: currentEngineSupported ? prev.engine : (newAvailableEngines[0] || 'vllm'),
      // Reset router mode if switching away from Dynamo
      routerMode: runtime === 'dynamo' ? prev.routerMode : 'none',
    }))

    // Reset KAITO-specific state when switching away from KAITO
    if (runtime !== 'kaito') {
      setSelectedPremadeModel(null)
      setKaitoComputeType('cpu')
      setPreferredNodes([])
    }
  }

  // Handle premade model selection for KAITO (also used in auto-selection useEffect above)
  const handlePremadeModelSelect = useCallback((premadeModel: PremadeModel) => {
    setSelectedPremadeModel(premadeModel)
    setConfig(prev => ({
      ...prev,
      name: generateDeploymentName(premadeModel.id),
      modelId: premadeModel.id,
      servedModelName: premadeModel.modelName,
    }))
  }, [])
  
  // Use the handler to ensure it's not considered unused
  void handlePremadeModelSelect;

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
      // Build the deployment config, adding KAITO-specific fields if needed
      let deployConfig = { ...config }
      
      if (selectedRuntime === 'kaito') {
        if (isHuggingFaceGgufModel) {
          if (ggufRunMode === 'direct') {
            // Direct run mode - no Docker/build required
            // The runner image will download the model at runtime using huggingface:// URI
            deployConfig = {
              ...deployConfig,
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
              ggufRunMode: 'direct',
              computeType: kaitoComputeType,
              ...(preferredNodes.length > 0 && { preferredNodes }),
            }
          } else {
            // Build mode - requires Docker and building an image
            
            // Check if build infrastructure (Docker) is available
            toast({
              title: 'Checking Build Infrastructure',
              description: 'Verifying Docker and build tools are available...',
            })
            
            const infraStatus = await aikitApi.getInfrastructureStatus()
            if (!infraStatus.ready) {
              const errorMsg = infraStatus.error || 
                (!infraStatus.builder.running ? 'Docker is not running. Please start Docker and try again.' : 
                 !infraStatus.registry.ready ? 'Container registry is not available.' : 
                 'Build infrastructure is not ready.')
              throw new Error(errorMsg)
            }
            
            // Build the image first
            toast({
              title: 'Building Image',
              description: `Building GGUF model image for ${model.id}. This may take a few minutes...`,
            })
            
            const buildResult = await aikitApi.build({
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
            })
            
            if (!buildResult.success || !buildResult.imageRef) {
              throw new Error(buildResult.error || 'Failed to build model image')
            }
            
            toast({
              title: 'Image Built Successfully',
              description: `Image: ${buildResult.imageRef}`,
              variant: 'success',
            })
            
            // Use the built image in the deployment config
            deployConfig = {
              ...deployConfig,
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
              ggufRunMode: 'build',
              imageRef: buildResult.imageRef,
              computeType: kaitoComputeType,
              ...(preferredNodes.length > 0 && { preferredNodes }),
            }
          }
        } else {
          // Premade model
          deployConfig = {
            ...deployConfig,
            modelSource: 'premade',
            computeType: kaitoComputeType,
            premadeModel: selectedPremadeModel?.id,
            ...(preferredNodes.length > 0 && { preferredNodes }),
          }
        }
      }

      await createDeployment.mutateAsync(deployConfig)

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
  }, [config, createDeployment, navigate, toast, triggerConfetti, selectedRuntime, kaitoComputeType, selectedPremadeModel, isHuggingFaceGgufModel, model.id, ggufFile, ggufRunMode, preferredNodes])

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

  // Check if KAITO configuration is valid
  // For HuggingFace GGUF models, we need a ggufFile for both direct and build modes
  // For premade, we need a selected model
  const isKaitoConfigValid = selectedRuntime !== 'kaito' || 
    (isHuggingFaceGgufModel 
      ? ggufFile.endsWith('.gguf')
      : selectedPremadeModel !== null)

  // Status-aware button content
  const getButtonContent = () => {
    if (needsHfAuth && selectedRuntime !== 'kaito') {
      return 'HuggingFace Auth Required'
    }

    if (!isRuntimeInstalled) {
      return 'Runtime Not Installed'
    }

    if (selectedRuntime === 'kaito' && !isHuggingFaceGgufModel && !selectedPremadeModel) {
      return 'Select a Model'
    }

    if (selectedRuntime === 'kaito' && isHuggingFaceGgufModel && !ggufFile.endsWith('.gguf')) {
      return 'Select GGUF File'
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
                
                const isCompatible = isRuntimeCompatible(runtime.id as RuntimeId, model.supportedEngines)
                
                return (
                  <label
                    key={runtime.id}
                    htmlFor={`runtime-${runtime.id}`}
                    className={cn(
                      "relative flex items-start space-x-3 rounded-lg border p-4 transition-colors",
                      !isCompatible && "opacity-50 cursor-not-allowed",
                      isCompatible && "cursor-pointer",
                      isCompatible && selectedRuntime === runtime.id
                        ? "border-primary bg-primary/5"
                        : "border-border",
                      isCompatible && selectedRuntime !== runtime.id && "hover:border-muted-foreground/50",
                      isCompatible && !runtime.installed && "opacity-75"
                    )}
                  >
                    <RadioGroupItem 
                      value={runtime.id} 
                      id={`runtime-${runtime.id}`} 
                      className="mt-1" 
                      disabled={!isCompatible}
                    />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Label 
                          htmlFor={`runtime-${runtime.id}`} 
                          className={cn(
                            "font-medium",
                            isCompatible ? "cursor-pointer" : "cursor-not-allowed"
                          )}
                        >
                          {info.name}
                        </Label>
                        {!isCompatible ? (
                          <Badge variant="outline" className="text-muted-foreground border-muted text-xs">
                            Not Compatible
                          </Badge>
                        ) : runtime.installed ? (
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
                      {!isCompatible && (
                        <p className="text-xs text-muted-foreground mt-1">
                          This model requires {model.supportedEngines.includes('llamacpp') ? 'llama.cpp' : model.supportedEngines.join('/')} which is not supported by this runtime.
                        </p>
                      )}
                      {isCompatible && !runtime.installed && selectedRuntime === runtime.id && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                          <Link to="/installation" className="underline hover:no-underline">
                            Install {info.name}
                          </Link>{' '}
                          before deploying.
                        </p>
                      )}
                    </div>
                  </label>
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

      {/* Engine Selection - only show for non-KAITO runtimes */}
      {selectedRuntime !== 'kaito' && (
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
      )}

      {/* KAITO Model Selection - only show for KAITO runtime */}
      {selectedRuntime === 'kaito' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" />
              KAITO Model Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Compute Type Selection */}
            <div className="space-y-3">
              <Label>Compute Type</Label>
              <RadioGroup
                value={kaitoComputeType}
                onValueChange={(value) => setKaitoComputeType(value as KaitoComputeType)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cpu" id="compute-cpu" />
                  <Label htmlFor="compute-cpu" className="cursor-pointer flex items-center gap-1">
                    <Cpu className="h-4 w-4" />
                    CPU
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="gpu" id="compute-gpu" />
                  <Label htmlFor="compute-gpu" className="cursor-pointer flex items-center gap-1">
                    <Server className="h-4 w-4" />
                    GPU
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                {kaitoComputeType === 'cpu' 
                  ? 'Run inference on CPU nodes - slower but no GPU required'
                  : 'Run inference on GPU nodes - faster performance'}
              </p>
            </div>

            {/* Run Mode Selection - only for HuggingFace GGUF models */}
            {isHuggingFaceGgufModel && (
              <div className="space-y-3">
                <Label>Run Mode</Label>
                <RadioGroup
                  value={ggufRunMode}
                  onValueChange={(value) => setGgufRunMode(value as GgufRunMode)}
                  className="grid gap-3"
                >
                  <label
                    htmlFor="run-direct"
                    className={cn(
                      "flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      ggufRunMode === 'direct'
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                  >
                    <RadioGroupItem value="direct" id="run-direct" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Direct Run</span>
                        <Badge variant="secondary" className="text-xs">Recommended</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Downloads model at runtime. No Docker required.
                      </p>
                    </div>
                  </label>
                  <label
                    htmlFor="run-build"
                    className={cn(
                      "flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      ggufRunMode === 'build'
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                  >
                    <RadioGroupItem value="build" id="run-build" className="mt-1" />
                    <div className="flex-1">
                      <span className="font-medium">Build Image</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pre-builds container image. Requires Docker running locally.
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            )}

            {/* Preferred Nodes Selection */}
            <div className="space-y-3">
              <Label>Preferred Nodes (Optional)</Label>
              {clusterNodesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading cluster nodes...
                </div>
              ) : clusterNodes.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {clusterNodes.map((node) => {
                      const isSelected = preferredNodes.includes(node.name)
                      return (
                        <button
                          key={node.name}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setPreferredNodes(preferredNodes.filter(n => n !== node.name))
                            } else {
                              setPreferredNodes([...preferredNodes, node.name])
                            }
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-accent border-input"
                          )}
                        >
                          <span>{node.name}</span>
                          {node.gpuCount > 0 && (
                            <Badge variant="secondary" className="text-xs px-1 py-0">
                              {node.gpuCount} GPU{node.gpuCount > 1 ? 's' : ''}
                            </Badge>
                          )}
                          {!node.ready && (
                            <Badge variant="destructive" className="text-xs px-1 py-0">
                              Not Ready
                            </Badge>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {preferredNodes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreferredNodes([])}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  No schedulable nodes found in the cluster.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Select nodes to prefer for this deployment.
                If none selected, KAITO will schedule on any available node matching the label selector.
              </p>
            </div>

            {/* GGUF File Selection - for HuggingFace GGUF models */}
            {isHuggingFaceGgufModel && (
              <div className="space-y-3">
                <Label htmlFor="ggufFile">GGUF File</Label>
                {ggufFilesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading GGUF files from repository...
                  </div>
                ) : ggufFiles.length > 0 ? (
                  <Select value={ggufFile} onValueChange={setGgufFile}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a GGUF file" />
                    </SelectTrigger>
                    <SelectContent>
                      {ggufFiles.map((file) => (
                        <SelectItem key={file} value={file}>
                          {file}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm text-muted-foreground py-2">
                    No GGUF files found in this repository.
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Select the quantization variant to use. Q4_K_M offers a good balance of quality and size.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deployment Mode - only show for non-KAITO runtimes */}
      {selectedRuntime !== 'kaito' && (
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
      )}

      {/* Deployment Options - only show for non-KAITO runtimes */}
      {selectedRuntime !== 'kaito' && (
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
      )}

      {/* KAITO Deployment Options */}
      {selectedRuntime === 'kaito' && (
        <Card>
          <CardHeader>
            <CardTitle>Deployment Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kaito-replicas">Replicas</Label>
                <Input
                  id="kaito-replicas"
                  type="number"
                  min={1}
                  max={10}
                  value={config.replicas}
                  onChange={(e) => updateConfig('replicas', parseInt(e.target.value) || 1)}
                />
              </div>
              {kaitoComputeType === 'gpu' && (
                <div className="space-y-2">
                  <Label htmlFor="kaito-gpus">GPUs per Replica</Label>
                  <Input
                    id="kaito-gpus"
                    type="number"
                    min={1}
                    max={8}
                    value={config.resources?.gpu || 1}
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
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advanced Options - only show for non-KAITO runtimes */}
      {selectedRuntime !== 'kaito' && (
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
      )}

        {/* Capacity Warning - only show for non-KAITO or KAITO with GPU */}
        {detailedCapacity && (selectedRuntime !== 'kaito' || kaitoComputeType === 'gpu') && (
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
          disabled={createDeployment.isProcessing || (needsHfAuth && selectedRuntime !== 'kaito') || !isRuntimeInstalled || !isKaitoConfigValid}
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

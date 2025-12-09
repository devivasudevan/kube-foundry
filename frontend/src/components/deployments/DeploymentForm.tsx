import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateDeployment, type DeploymentConfig } from '@/hooks/useDeployments'
import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/hooks/useToast'
import { generateDeploymentName } from '@/lib/utils'
import { type Model } from '@/lib/api'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

interface DeploymentFormProps {
  model: Model
}

type Engine = 'vllm' | 'sglang' | 'trtllm'
type RouterMode = 'none' | 'kv' | 'round-robin'
type DeploymentMode = 'aggregated' | 'disaggregated'

export function DeploymentForm({ model }: DeploymentFormProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const createDeployment = useCreateDeployment()
  const { data: settings } = useSettings()

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [config, setConfig] = useState<DeploymentConfig>({
    name: generateDeploymentName(model.id),
    namespace: '',
    modelId: model.id,
    engine: model.supportedEngines[0] || 'vllm',
    mode: 'aggregated',
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
  })

  // Set namespace from active provider when settings load
  useEffect(() => {
    if (settings?.activeProvider?.defaultNamespace && !config.namespace) {
      setConfig(prev => ({
        ...prev,
        namespace: settings.activeProvider?.defaultNamespace || 'default'
      }))
    }
  }, [settings?.activeProvider?.defaultNamespace])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      await createDeployment.mutateAsync(config)
      toast({
        title: 'Deployment Created',
        description: `${config.name} is being deployed to ${config.namespace}`,
        variant: 'success',
      })
      navigate('/deployments')
    } catch (error) {
      toast({
        title: 'Deployment Failed',
        description: error instanceof Error ? error.message : 'Failed to create deployment',
        variant: 'destructive',
      })
    }
  }

  const updateConfig = <K extends keyof DeploymentConfig>(
    key: K,
    value: DeploymentConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
                placeholder={settings?.activeProvider?.defaultNamespace || 'default'}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hfTokenSecret">HuggingFace Token Secret</Label>
            <Input
              id="hfTokenSecret"
              value={config.hfTokenSecret}
              onChange={(e) => updateConfig('hfTokenSecret', e.target.value)}
              placeholder="hf-token-secret"
              required
            />
            <p className="text-xs text-muted-foreground">
              Kubernetes secret containing HF_TOKEN
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Engine Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Inference Engine</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={config.engine}
            onValueChange={(value) => updateConfig('engine', value as Engine)}
            className="grid gap-4 sm:grid-cols-3"
          >
            {model.supportedEngines.map((engine) => (
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

              {/* Router Mode is only applicable to Dynamo provider */}
              {settings?.activeProvider?.id === 'dynamo' && (
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
          className="cursor-pointer"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <div className="flex items-center justify-between">
            <CardTitle>Advanced Options</CardTitle>
            {showAdvanced ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>

        {showAdvanced && (
          <CardContent className="space-y-4">
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
        )}
      </Card>

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
          disabled={createDeployment.isPending}
          className="flex-1"
        >
          {createDeployment.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deploying...
            </>
          ) : (
            'Deploy Model'
          )}
        </Button>
      </div>
    </form>
  )
}

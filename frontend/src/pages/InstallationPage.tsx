import { useState } from 'react'
import { useRuntimesStatus } from '@/hooks/useRuntimes'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import {
  useHelmStatus,
  useProviderInstallationStatus,
  useInstallProvider,
} from '@/hooks/useInstallation'
import { useAutoscalerDetection } from '@/hooks/useAutoscaler'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { AutoscalerGuidance } from '@/components/autoscaler/AutoscalerGuidance'
import { cn } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Terminal,
  Download,
  RefreshCw,
  Copy,
  Server,
  Zap,
} from 'lucide-react'

type RuntimeId = 'dynamo' | 'kuberay'

export function InstallationPage() {
  const { data: runtimesStatus, isLoading: runtimesLoading } = useRuntimesStatus()
  const { data: clusterStatus } = useClusterStatus()
  const { data: helmStatus, isLoading: helmLoading } = useHelmStatus()
  const { data: autoscaler, isLoading: autoscalerLoading } = useAutoscalerDetection()
  const { toast } = useToast()

  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>('dynamo')
  const {
    data: installationStatus,
    isLoading: installationLoading,
    refetch: refetchInstallation,
  } = useProviderInstallationStatus(selectedRuntime)

  const installProvider = useInstallProvider()

  const [isInstalling, setIsInstalling] = useState(false)
  
  const runtimes = runtimesStatus?.runtimes || []

  const handleInstall = async (providerId: RuntimeId) => {
    setIsInstalling(true)
    try {
      const result = await installProvider.mutateAsync(providerId)
      if (result.success) {
        toast({
          title: 'Installation Complete',
          description: result.message,
        })
        refetchInstallation()
      } else {
        toast({
          title: 'Installation Failed',
          description: result.message,
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Installation Error',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      })
    } finally {
      setIsInstalling(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: 'Copied',
      description: 'Command copied to clipboard',
    })
  }

  const copyAllCommands = () => {
    if (installationStatus?.helmCommands) {
      navigator.clipboard.writeText(installationStatus.helmCommands.join('\n'))
      toast({
        title: 'Copied',
        description: 'All commands copied to clipboard',
      })
    }
  }

  const isLoading = helmLoading || installationLoading || runtimesLoading
  const isInstalled = installationStatus?.installed ?? false
  const helmAvailable = helmStatus?.available ?? false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Runtime Installation</h1>
        <p className="text-muted-foreground">
          Install and manage inference runtimes in your Kubernetes cluster.
        </p>
      </div>

      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Prerequisites
          </CardTitle>
          <CardDescription>
            Required components for runtime installation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Kubernetes Cluster</span>
            </div>
            <div className="flex items-center gap-2">
              {clusterStatus?.connected ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-600">Not Connected</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Helm CLI</span>
              {helmStatus?.version && (
                <span className="text-xs text-muted-foreground">({helmStatus.version})</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {helmLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : helmAvailable ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">Available</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-600">Not Found</span>
                </>
              )}
            </div>
          </div>

          {!helmAvailable && helmStatus?.error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              {helmStatus.error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Runtimes Overview - Side by Side Cards */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Available Runtimes</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {runtimes.map((runtime) => (
            <Card 
              key={runtime.id}
              className={cn(
                'transition-all cursor-pointer',
                selectedRuntime === runtime.id 
                  ? 'ring-2 ring-primary' 
                  : 'hover:border-primary/50'
              )}
              onClick={() => setSelectedRuntime(runtime.id as RuntimeId)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>{runtime.name}</span>
                  <Badge variant={runtime.installed ? (runtime.healthy ? 'default' : 'secondary') : 'destructive'}>
                    {runtime.installed ? (runtime.healthy ? 'Healthy' : 'Unhealthy') : 'Not Installed'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {runtime.id === 'dynamo' 
                    ? 'NVIDIA Dynamo for high-performance GPU inference with vLLM, SGLang, and TensorRT-LLM' 
                    : 'KubeRay for distributed Ray-based model serving with vLLM'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">CRD</span>
                    {runtime.installed ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Operator</span>
                    {runtime.healthy ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : runtime.installed ? (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                  {runtime.version && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono text-xs">{runtime.version}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      {/* Cluster Autoscaling Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Cluster Autoscaling
            </div>
            {autoscalerLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : autoscaler?.detected ? (
              <Badge variant={autoscaler.healthy ? 'default' : 'destructive'}>
                {autoscaler.healthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            ) : (
              <Badge variant="secondary">Not Detected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Automatically provision GPU nodes when deployments require more resources
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {autoscalerLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <span>Status</span>
                  <div className="flex items-center gap-2">
                    {autoscaler?.detected ? (
                      <>
                        {autoscaler.healthy ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="font-medium">
                          {autoscaler.type === 'aks-managed' ? 'AKS Managed' : 'Cluster Autoscaler'}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-gray-400" />
                        <span className="text-muted-foreground">Not Detected</span>
                      </>
                    )}
                  </div>
                </div>

                {autoscaler?.detected && autoscaler.nodeGroupCount !== undefined && (
                  <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                    <span>Node Pools</span>
                    <span className="font-medium">{autoscaler.nodeGroupCount}</span>
                  </div>
                )}

                {autoscaler?.message && (
                  <div className={`rounded-lg p-3 text-sm ${autoscaler.healthy
                      ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                      : autoscaler.detected
                        ? 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                    {autoscaler.message}
                  </div>
                )}
              </div>

              {autoscaler && !autoscaler.detected && (
                <AutoscalerGuidance autoscaler={autoscaler} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Selected Runtime Installation Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {installationStatus?.providerName || runtimes.find(r => r.id === selectedRuntime)?.name || 'Runtime'} Installation
            </div>
            <Badge variant={isInstalled ? 'default' : 'destructive'}>
              {isInstalled ? 'Installed' : 'Not Installed'}
            </Badge>
          </CardTitle>
          <CardDescription>
            {installationStatus?.message || 'Checking installation status...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Status Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <span>CRD Installed</span>
                  {installationStatus?.crdFound ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <span>Operator Running</span>
                  {installationStatus?.operatorRunning ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                {!isInstalled && (
                  <Button
                    onClick={() => handleInstall(selectedRuntime)}
                    disabled={isInstalling || !helmAvailable || !clusterStatus?.connected}
                    className="flex items-center gap-2"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Installing...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Install {runtimes.find(r => r.id === selectedRuntime)?.name || 'Runtime'}
                      </>
                    )}
                  </Button>
                )}

                <Button
                  variant="outline"
                  onClick={() => refetchInstallation()}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {/* Warning if Helm not available */}
              {!helmAvailable && (
                <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Helm CLI not available</p>
                    <p className="mt-1">
                      Automatic installation requires Helm. You can install the runtime manually
                      using the commands below.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Manual Installation Commands */}
      {installationStatus?.helmCommands && installationStatus.helmCommands.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Manual Installation Commands for {runtimes.find(r => r.id === selectedRuntime)?.name || 'Runtime'}
              </div>
              <Button variant="outline" size="sm" onClick={copyAllCommands}>
                <Copy className="h-4 w-4 mr-2" />
                Copy All
              </Button>
            </CardTitle>
            <CardDescription>
              Run these commands to install the runtime manually
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {installationStatus.helmCommands.map((command, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg bg-muted p-3"
              >
                <code className="flex-1 text-sm font-mono overflow-x-auto">
                  {command}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(command)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Installation Steps */}
      {installationStatus?.installationSteps && installationStatus.installationSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Installation Steps</CardTitle>
            <CardDescription>
              Detailed steps for installing {installationStatus.providerName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {installationStatus.installationSteps.map((step, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="font-medium">{step.title}</span>
                </div>
                <p className="ml-8 text-sm text-muted-foreground">{step.description}</p>
                {step.command && (
                  <div className="ml-8 flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
                      {step.command}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(step.command!)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

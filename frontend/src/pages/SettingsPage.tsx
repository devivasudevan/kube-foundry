import { useState } from 'react'
import { useSettings, useProviderDetails } from '@/hooks/useSettings'
import { useRuntimesStatus } from '@/hooks/useRuntimes'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import { useHelmStatus } from '@/hooks/useInstallation'
import { useGpuOperatorStatus, useInstallGpuOperator } from '@/hooks/useGpuOperator'
import { useHuggingFaceStatus, useHuggingFaceOAuth, useDeleteHuggingFaceSecret } from '@/hooks/useHuggingFace'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/useToast'
import { CheckCircle, XCircle, AlertCircle, Loader2, Server, Terminal, Cpu, Key, Cog, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'

type SettingsTab = 'general' | 'integrations' | 'advanced'

export function SettingsPage() {
  const { isLoading: settingsLoading } = useSettings()
  const { data: runtimesStatus, isLoading: runtimesLoading } = useRuntimesStatus()
  const { data: clusterStatus, isLoading: clusterLoading } = useClusterStatus()
  const { data: helmStatus } = useHelmStatus()
  const { data: gpuOperatorStatus, isLoading: gpuStatusLoading, refetch: refetchGpuStatus } = useGpuOperatorStatus()
  const { data: hfStatus, isLoading: hfStatusLoading, refetch: refetchHfStatus } = useHuggingFaceStatus()
  const { startOAuth } = useHuggingFaceOAuth()
  const deleteHfSecret = useDeleteHuggingFaceSecret()
  const installGpuOperator = useInstallGpuOperator()
  const { toast } = useToast()

  const [isInstallingGpu, setIsInstallingGpu] = useState(false)
  const [isConnectingHf, setIsConnectingHf] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [selectedRuntimeForDetails, setSelectedRuntimeForDetails] = useState<string>('dynamo')

  const { data: providerDetails } = useProviderDetails(selectedRuntimeForDetails)

  if (settingsLoading || clusterLoading || runtimesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cog className="h-7 w-7 text-muted-foreground" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your inference runtimes and application settings.
          </p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const runtimes = runtimesStatus?.runtimes || []
  const installedCount = runtimes.filter(r => r.installed).length

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Server },
    { id: 'integrations' as const, label: 'Integrations', icon: Key },
    { id: 'advanced' as const, label: 'Advanced', icon: Terminal },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Cog className="h-7 w-7 text-muted-foreground" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure your inference runtimes and application settings.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px rounded-t-md',
              activeTab === tab.id
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <tab.icon className={cn(
              "h-4 w-4 transition-transform duration-200",
              activeTab === tab.id && "scale-110"
            )} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6 animate-fade-in">
          {/* Cluster Status */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Cluster Status
              </CardTitle>
              <CardDescription>
                Current Kubernetes cluster connection status
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Connection</span>
                <div className="flex items-center gap-2">
                  {clusterStatus?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Disconnected</span>
                    </>
                  )}
                </div>
              </div>

              {clusterStatus?.clusterName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cluster</span>
                  <span className="text-sm text-muted-foreground font-mono">{clusterStatus.clusterName}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Runtimes Installed</span>
                <Badge variant={installedCount > 0 ? 'default' : 'secondary'}>
                  {installedCount} of {runtimes.length}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Installed Runtimes */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Installed Runtimes
              </CardTitle>
              <CardDescription>
                Available inference runtimes in your cluster. Select a runtime when deploying models.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {runtimes.length === 0 ? (
                <div className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
                  No runtimes detected. Visit the Installation page to set up a runtime.
                </div>
              ) : (
                <div className="space-y-3">
                  {runtimes.map((runtime) => (
                    <div
                      key={runtime.id}
                      className={cn(
                        'flex items-center justify-between rounded-lg border p-4 transition-colors',
                        runtime.installed
                          ? 'bg-card hover:bg-accent/50'
                          : 'bg-muted/30 opacity-75'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          runtime.installed && runtime.healthy
                            ? 'bg-green-500'
                            : runtime.installed
                            ? 'bg-yellow-500'
                            : 'bg-gray-400'
                        )} />
                        <div>
                          <div className="font-medium">{runtime.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {runtime.id === 'dynamo' ? 'dynamo-system' : 'kuberay-system'} namespace
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {runtime.version && (
                          <span className="text-xs text-muted-foreground font-mono">
                            v{runtime.version}
                          </span>
                        )}
                        <Badge
                          variant={runtime.installed ? (runtime.healthy ? 'default' : 'secondary') : 'destructive'}
                          className="min-w-[90px] justify-center"
                        >
                          {runtime.installed ? (runtime.healthy ? 'Healthy' : 'Unhealthy') : 'Not Installed'}
                        </Badge>
                        {!runtime.installed && (
                          <Link to="/installation">
                            <Button variant="outline" size="sm">
                              Install
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {installedCount === 0 && (
                <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-4 text-sm text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">No runtimes installed</span>
                  </div>
                  <p>
                    Install at least one runtime to deploy models.{' '}
                    <Link to="/installation" className="underline hover:no-underline">
                      Go to Installation page
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6 animate-fade-in">
          {/* GPU Operator */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                NVIDIA GPU Operator
              </CardTitle>
              <CardDescription>
                Install the NVIDIA GPU Operator to enable GPU support in your cluster
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prerequisites check */}
              {(!clusterStatus?.connected || !helmStatus?.available) && (
                <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Prerequisites not met</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    {!clusterStatus?.connected && (
                      <li>Kubernetes cluster not connected</li>
                    )}
                    {!helmStatus?.available && (
                      <li>Helm CLI not available</li>
                    )}
                  </ul>
                </div>
              )}

              {/* GPU Status Display */}
              {gpuStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Checking GPU status...</span>
                </div>
              ) : gpuOperatorStatus?.gpusAvailable ? (
                // GPUs are already available
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">GPU Status</span>
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      GPUs Enabled
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>{gpuOperatorStatus.message}</span>
                    </div>
                    {gpuOperatorStatus.gpuNodes.length > 0 && (
                      <div className="mt-2 text-xs">
                        Nodes: {gpuOperatorStatus.gpuNodes.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : gpuOperatorStatus?.installed ? (
                // Operator installed but no GPUs detected
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">GPU Status</span>
                    <Badge variant="secondary">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Operator Installed
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      <span>{gpuOperatorStatus.message}</span>
                    </div>
                  </div>
                </div>
              ) : (
                // Not installed - show install option
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="gpu-operator-switch">Enable GPU Operator</Label>
                      <p className="text-xs text-muted-foreground">
                        Automatically installs the NVIDIA GPU Operator via Helm
                      </p>
                    </div>
                    <Switch
                      id="gpu-operator-switch"
                      checked={false}
                      disabled={!clusterStatus?.connected || !helmStatus?.available || isInstallingGpu}
                      onCheckedChange={async (checked) => {
                        if (checked) {
                          setIsInstallingGpu(true)
                          try {
                            const result = await installGpuOperator.mutateAsync()
                            if (result.success) {
                              toast({
                                title: 'GPU Operator Installed',
                                description: result.message,
                              })
                              refetchGpuStatus()
                            }
                          } catch (error) {
                            toast({
                              title: 'Installation Failed',
                              description: error instanceof Error ? error.message : 'Unknown error',
                              variant: 'destructive',
                            })
                          } finally {
                            setIsInstallingGpu(false)
                          }
                        }
                      }}
                    />
                  </div>

                  {isInstallingGpu && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Installing GPU Operator... This may take several minutes.</span>
                    </div>
                  )}

                  {/* Manual installation commands */}
                  {gpuOperatorStatus?.helmCommands && gpuOperatorStatus.helmCommands.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Manual Installation</span>
                      <div className="space-y-1">
                        {gpuOperatorStatus.helmCommands.map((cmd, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono">
                              {cmd}
                            </code>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(cmd)
                                toast({
                                  title: 'Copied',
                                  description: 'Command copied to clipboard',
                                })
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* HuggingFace Token */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                HuggingFace Token
              </CardTitle>
              <CardDescription>
                Connect your HuggingFace account to access gated models like Llama
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hfStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Checking HuggingFace connection...</span>
                </div>
              ) : hfStatus?.configured ? (
                // Connected state - token exists in K8s secrets
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {hfStatus.user?.avatarUrl ? (
                        <img
                          src={hfStatus.user.avatarUrl}
                          alt={hfStatus.user.name}
                          className="h-10 w-10 rounded-full"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Key className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        {hfStatus.user ? (
                          <>
                            <div className="font-medium">{hfStatus.user.fullname || hfStatus.user.name}</div>
                            <div className="text-sm text-muted-foreground">@{hfStatus.user.name}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium">HuggingFace Token</div>
                            <div className="text-sm text-muted-foreground">Token configured</div>
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>Token saved in {hfStatus.namespaces.filter(n => n.exists).length} namespace(s)</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await deleteHfSecret.mutateAsync()
                        toast({
                          title: 'Disconnected',
                          description: 'HuggingFace token has been removed',
                        })
                        refetchHfStatus()
                      } catch (error) {
                        toast({
                          title: 'Error',
                          description: error instanceof Error ? error.message : 'Failed to disconnect',
                          variant: 'destructive',
                        })
                      }
                    }}
                    disabled={deleteHfSecret.isPending}
                  >
                    {deleteHfSecret.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      'Disconnect HuggingFace'
                    )}
                  </Button>
                </div>
              ) : (
                // Not connected state
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    Sign in with HuggingFace to automatically configure your token for accessing gated models.
                    The token will be securely stored as a Kubernetes secret.
                  </div>

                  <Button
                    onClick={async () => {
                      setIsConnectingHf(true)
                      try {
                        await startOAuth()
                      } catch (error) {
                        toast({
                          title: 'Error',
                          description: error instanceof Error ? error.message : 'Failed to start OAuth',
                          variant: 'destructive',
                        })
                        setIsConnectingHf(false)
                      }
                    }}
                    disabled={isConnectingHf}
                    className="bg-[#FFD21E] hover:bg-[#FFD21E]/90 text-black"
                  >
                    {isConnectingHf ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <>
                        <svg className="h-5 w-5 mr-2" viewBox="0 0 95 88" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M47.2119 76.5C54.4518 76.5 60.7119 70.24 60.7119 63V50.5H47.2119C39.9719 50.5 33.7119 56.76 33.7119 64C33.7119 70.9 39.6319 76.5 47.2119 76.5Z" fill="currentColor"/>
                          <path d="M47.2119 88C61.5765 88 73.2119 76.3645 73.2119 62C73.2119 47.6355 61.5765 36 47.2119 36C32.8474 36 21.2119 47.6355 21.2119 62C21.2119 76.3645 32.8474 88 47.2119 88Z" fill="currentColor"/>
                          <ellipse cx="35.7119" cy="30" rx="12" ry="12" fill="currentColor"/>
                          <ellipse cx="59.7119" cy="30" rx="12" ry="12" fill="currentColor"/>
                          <ellipse cx="35.7119" cy="30" rx="5" ry="5" fill="white"/>
                          <ellipse cx="59.7119" cy="30" rx="5" ry="5" fill="white"/>
                        </svg>
                        Sign in with Hugging Face
                      </>
                    )}
                  </Button>

                  {hfStatus?.configured && !hfStatus.user && (
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>Token exists but could not be validated. Try reconnecting.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="space-y-6 animate-fade-in">
          {/* Runtime Details */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Runtime Details
              </CardTitle>
              <CardDescription>
                Technical details about the inference runtimes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Runtime selector tabs */}
              <div className="flex gap-1 border-b">
                {runtimes.map((runtime) => (
                  <button
                    key={runtime.id}
                    onClick={() => setSelectedRuntimeForDetails(runtime.id)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium transition-all duration-200 border-b-2 -mb-px rounded-t-md',
                      selectedRuntimeForDetails === runtime.id
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    {runtime.name}
                  </button>
                ))}
              </div>

              {providerDetails && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">API Group</span>
                      <p className="font-mono text-foreground mt-1">{providerDetails.crdConfig.apiGroup}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">API Version</span>
                      <p className="font-mono text-foreground mt-1">{providerDetails.crdConfig.apiVersion}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">CRD Kind</span>
                      <p className="font-mono text-foreground mt-1">{providerDetails.crdConfig.kind}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">Resource Plural</span>
                      <p className="font-mono text-foreground mt-1">{providerDetails.crdConfig.plural}</p>
                    </div>
                  </div>

                  {providerDetails.helmRepos.length > 0 && (
                    <div className="pt-4 border-t">
                      <span className="font-medium text-sm">Helm Repositories</span>
                      <div className="mt-3 space-y-2">
                        {providerDetails.helmRepos.map((repo, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
                            <span className="font-mono font-medium text-primary">{repo.name}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono text-xs text-muted-foreground truncate">{repo.url}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Debug Info */}
          <Card variant="outline">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Debug Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs font-mono text-muted-foreground space-y-1">
                <p>Runtimes: {runtimes.map(r => `${r.id}(${r.installed ? 'installed' : 'not installed'})`).join(', ')}</p>
                <p>Cluster Connected: {clusterStatus?.connected ? 'Yes' : 'No'}</p>
                <p>Helm Available: {helmStatus?.available ? 'Yes' : 'No'}</p>
                <p>GPU Operator: {gpuOperatorStatus?.installed ? 'Installed' : 'Not Installed'}</p>
                <p>HuggingFace: {hfStatus?.configured ? 'Configured' : 'Not Configured'}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

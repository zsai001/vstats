import { useState } from 'react';
import { 
  ChevronRight, Copy, Check, 
  Terminal, Server, Code, Settings, 
  FileCode, Globe, Lock, Activity
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Section = {
  id: string;
  title: string;
  icon: any;
};

const getSections = (t: any): Section[] => [
  { id: 'installation', title: t('documentation.sections.installation'), icon: Terminal },
  { id: 'architecture', title: t('documentation.sections.architecture'), icon: Server },
  { id: 'api', title: t('documentation.sections.api'), icon: Code },
  { id: 'metrics', title: t('documentation.sections.metrics'), icon: Activity },
  { id: 'development', title: t('documentation.sections.development'), icon: FileCode },
  { id: 'management', title: t('documentation.sections.management'), icon: Settings },
];

export default function Documentation() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('installation');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const sections = getSections(t);

  const setCopiedState = (id: string) => {
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="pt-20 min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="lg:w-64 shrink-0">
            <div className="sticky top-24 glass-card rounded-xl p-4">
              <nav className="space-y-2">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => {
                        setActiveSection(section.id);
                        document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                        isActive
                          ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{section.title}</span>
                      <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${isActive ? 'rotate-90' : ''}`} />
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1">
            {/* Installation */}
            <section id="installation" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <Terminal className="w-8 h-8 text-sky-500" />
                {t('documentation.installation.title')}
              </h2>

              <div className="space-y-8">
                {/* Docker Installation */}
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2">
                    <span className="text-2xl">🐳</span>
                    {t('documentation.installation.docker.title')}
                  </h3>
                  <p className="text-slate-500 mb-4">{t('documentation.installation.docker.desc')}</p>
                  <CodeBlock
                    language="bash"
                    code={`# 创建数据目录
mkdir -p data

# 设置目录权限（容器内使用 vstats:vstats 用户，uid/gid 1000:1000）
sudo chown -R 1000:1000 data

# 运行容器
docker run -d \\
  --name vstats-server \\
  -p 3001:3001 \\
  -v $(pwd)/data:/app/data \\
  --restart unless-stopped \\
  zsai001/vstats-server:latest

# 查看日志
docker logs -f vstats-server`}
                    onCopy={() => setCopiedState('docker-dashboard')}
                    copyId="docker-dashboard"
                    copied={copiedCode === 'docker-dashboard'}
                  />
                  <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <strong>{t('documentation.installation.docker.warning')}</strong><code className="px-2 py-1 bg-amber-100 dark:bg-amber-900/40 rounded">http://your-server-ip:3001</code>
                    </p>
                  </div>
                </div>

                {/* Docker Compose Full Deployment */}
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2">
                    <span className="text-2xl">🚀</span>
                    {t('documentation.installation.compose.title')}
                  </h3>
                  <p className="text-slate-500 mb-4">{t('documentation.installation.compose.desc')}</p>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.compose.step1')}</h4>
                      <CodeBlock
                        language="bash"
                        code={`git clone https://github.com/zsai001/vstats.git
cd vstats/docs-site/deploy`}
                        onCopy={() => setCopiedState('compose-clone')}
                        copyId="compose-clone"
                        copied={copiedCode === 'compose-clone'}
                      />
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.compose.step2')}</h4>
                      <CodeBlock
                        language="bash"
                        code="./scripts/deploy.sh setup"
                        onCopy={() => setCopiedState('compose-setup')}
                        copyId="compose-setup"
                        copied={copiedCode === 'compose-setup'}
                      />
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.compose.step3')}</h4>
                      <CodeBlock
                        language="bash"
                        code={`# 编辑 .env 文件，修改以下配置
vim .env

# 必须修改的配置：
# - POSTGRES_PASSWORD: PostgreSQL 密码
# - REDIS_PASSWORD: Redis 密码
# - JWT_SECRET: JWT 密钥
# - SESSION_SECRET: Session 密钥
# - APP_URL: 你的域名 (如 https://vstats.example.com)`}
                        onCopy={() => setCopiedState('compose-env')}
                        copyId="compose-env"
                        copied={copiedCode === 'compose-env'}
                      />
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.compose.step4')}</h4>
                      <CodeBlock
                        language="bash"
                        code={`# 启动所有服务
./scripts/deploy.sh start

# 查看状态
./scripts/deploy.sh status

# 查看日志
./scripts/deploy.sh logs`}
                        onCopy={() => setCopiedState('compose-start')}
                        copyId="compose-start"
                        copied={copiedCode === 'compose-start'}
                      />
                    </div>
                  </div>

                  <div className="mt-4 p-4 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg">
                    <p className="text-sm text-sky-800 dark:text-sky-300">
                      💡 {t('documentation.installation.compose.note')}{' '}
                      <a 
                        href="https://github.com/zsai001/vstats/blob/main/docs-site/deploy/README.md" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="underline hover:text-sky-600 dark:hover:text-sky-200"
                      >
                        {t('documentation.installation.compose.noteLink')}
                      </a>
                    </p>
                  </div>
                </div>

                {/* Manual Installation */}
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.installation.manual.title')}</h3>
                  <CodeBlock
                    language="bash"
                    code="curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash"
                    onCopy={() => setCopiedState('manual-dashboard')}
                    copyId="manual-dashboard"
                    copied={copiedCode === 'manual-dashboard'}
                  />
                </div>

                {/* Agent Installation */}
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.installation.agent.title')}</h3>
                  <p className="text-slate-500 mb-4">{t('documentation.installation.agent.desc')}</p>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.agent.linux')}</h4>
                      <CodeBlock
                        language="bash"
                        code={`curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \\
  --server http://YOUR_DASHBOARD_IP:3001 \\
  --token "your-jwt-token" \\
  --name "$(hostname)" \\
  --location "US" \\
  --provider "Vultr"`}
                        onCopy={() => setCopiedState('agent-linux')}
                        copyId="agent-linux"
                        copied={copiedCode === 'agent-linux'}
                      />
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2 dark:text-white">{t('documentation.installation.agent.windows')}</h4>
                      <CodeBlock
                        language="powershell"
                        code={`irm https://vstats.zsoft.cc/agent.ps1 -OutFile agent.ps1
.\\agent.ps1 -Server "http://YOUR_DASHBOARD_IP:3001" -Token "your-jwt-token"`}
                        onCopy={() => setCopiedState('agent-windows')}
                        copyId="agent-windows"
                        copied={copiedCode === 'agent-windows'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Architecture */}
            <section id="architecture" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <Server className="w-8 h-8 text-sky-500" />
                {t('documentation.architecture.title')}
              </h2>
              <div className="glass-card rounded-xl p-6">
                <pre className="font-mono text-sm text-slate-700 dark:text-slate-300 whitespace-pre overflow-x-auto">
{`┌─────────────────────────────────────────────────────────────┐
│                         Dashboard                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Web UI    │  │  REST API   │  │  WebSocket  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                          │                                  │
│              ┌───────────┴───────────┐                      │
│              │    Go Backend         │                      │
│              │   (Gin + Gorilla)     │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   Agent 1   │ │   Agent 2   │ │   Agent N   │
    └─────────────┘ └─────────────┘ └─────────────┘`}
                </pre>
              </div>
            </section>

            {/* API */}
            <section id="api" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <Code className="w-8 h-8 text-sky-500" />
                {t('documentation.api.title')}
              </h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-emerald-500" />
                    {t('documentation.api.public.title')}
                  </h3>
                  <div className="glass-card rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.endpoint')}</th>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.method')}</th>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.description')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/health</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-sm">GET</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.healthCheck')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/metrics</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-sm">GET</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.getCurrentMetrics')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/servers</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-sm">GET</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.getServerList')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/auth/login</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-sm">POST</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.userLogin')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/auth/verify</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-sm">GET</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.verifyToken')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/ws</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-sm">WebSocket</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.public.realtimeMetrics')}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2">
                    <Lock className="w-5 h-5 text-amber-500" />
                    {t('documentation.api.authenticated.title')}
                  </h3>
                  <div className="glass-card rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.endpoint')}</th>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.method')}</th>
                          <th className="px-4 py-3 text-left font-semibold dark:text-white">{t('documentation.api.public.description')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/servers</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-sm">POST</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.authenticated.addServer')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/servers/{'{id}'}</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm">DELETE</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.authenticated.deleteServer')}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">/api/auth/password</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-sm">POST</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t('documentation.api.authenticated.changePassword')}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* Metrics */}
            <section id="metrics" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <Activity className="w-8 h-8 text-sky-500" />
                {t('documentation.metrics.title')}
              </h2>
              <div className="glass-card rounded-xl p-6">
                <CodeBlock
                  language="typescript"
                  code={`interface SystemMetrics {
  timestamp: string;
  hostname: string;
  os: { 
    name: string;
    version: string;
    kernel: string;
    arch: string;
  };
  cpu: { 
    brand: string;
    cores: number;
    usage: number;
    frequency: number;
    per_core: number[];
  };
  memory: { 
    total: number;
    used: number;
    available: number;
    swap_total: number;
    swap_used: number;
    usage_percent: number;
  };
  disks: Array<{
    name: string;
    mount_point: string;
    fs_type: string;
    total: number;
    used: number;
    available: number;
    usage_percent: number;
  }>;
  network: { 
    interfaces: Array<{
      name: string;
      rx: number;
      tx: number;
    }>;
    total_rx: number;
    total_tx: number;
  };
  uptime: number;
  load_average: { 
    one: number;
    five: number;
    fifteen: number;
  };
}`}
                  onCopy={() => setCopiedState('metrics')}
                  copyId="metrics"
                  copied={copiedCode === 'metrics'}
                />
              </div>
            </section>

            {/* Development */}
            <section id="development" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <FileCode className="w-8 h-8 text-sky-500" />
                {t('documentation.development.title')}
              </h2>
              
              <div className="space-y-6">
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.development.backend.title')}</h3>
                  <CodeBlock
                    language="bash"
                    code={`cd server-go
go run ./cmd/server`}
                    onCopy={() => setCopiedState('dev-backend')}
                    copyId="dev-backend"
                    copied={copiedCode === 'dev-backend'}
                  />
                  <p className="text-slate-500 mt-4 text-sm">{t('documentation.development.backend.desc')} <code className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">http://localhost:3001</code></p>
                </div>

                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.development.frontend.title')}</h3>
                  <CodeBlock
                    language="bash"
                    code={`cd web
npm install
npm run dev`}
                    onCopy={() => setCopiedState('dev-frontend')}
                    copyId="dev-frontend"
                    copied={copiedCode === 'dev-frontend'}
                  />
                  <p className="text-slate-500 mt-4 text-sm">{t('documentation.development.frontend.desc')} <code className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">http://localhost:5173</code></p>
                </div>
              </div>
            </section>

            {/* Management */}
            <section id="management" className="mb-16 scroll-mt-20">
              <h2 className="text-3xl font-bold mb-6 dark:text-white flex items-center gap-3">
                <Settings className="w-8 h-8 text-sky-500" />
                {t('documentation.management.title')}
              </h2>
              
              <div className="space-y-6">
                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.management.linux.title')}</h3>
                  <CodeBlock
                    language="bash"
                    code={`# 查看状态
systemctl status vstats

# 重启服务
systemctl restart vstats

# 查看日志
journalctl -u vstats -f

# 停止服务
systemctl stop vstats`}
                    onCopy={() => setCopiedState('linux-service')}
                    copyId="linux-service"
                    copied={copiedCode === 'linux-service'}
                  />
                </div>

                <div className="glass-card rounded-xl p-6">
                  <h3 className="text-xl font-bold mb-4 dark:text-white">{t('documentation.management.windows.title')}</h3>
                  <CodeBlock
                    language="powershell"
                    code={`# 查看状态
Get-Service vstats-agent

# 重启服务
Restart-Service vstats-agent

# 停止服务
Stop-Service vstats-agent

# 启动服务
Start-Service vstats-agent

# 查看日志
Get-EventLog -LogName Application -Source vstats-agent -Newest 50`}
                    onCopy={() => setCopiedState('windows-service')}
                    copyId="windows-service"
                    copied={copiedCode === 'windows-service'}
                  />
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ 
  code, 
  language: _language, 
  onCopy, 
  copyId: _copyId, 
  copied 
}: { 
  code: string; 
  language: string; 
  onCopy: () => void; 
  copyId: string; 
  copied: boolean;
}) {
  // _language and _copyId are passed for future use but currently unused
  void _language;
  void _copyId;
  const { t } = useTranslation();
  const handleCopy = () => {
    // 直接复制 code 参数的内容，而不是依赖 onCopy 回调
    navigator.clipboard.writeText(code);
    onCopy();
  };

  return (
    <div className="relative group">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              <span>{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-6 overflow-x-auto font-mono text-sm scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

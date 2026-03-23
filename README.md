# MINIBABY Pay

> Web3 AI payment agent on HashKey Chain Testnet

MINIBABY Pay 是一个基于 HashKey Chain 测试网的 AI 支付代理平台。用自然语言输入支付指令，Claude AI 自动解析意图、合规检查、构建 HSP 支付信封并广播到链上。

---

## 功能

- **多类型支付**：单次转账 / 定期付款 / 流式支付 / 跨境换汇（HKD · CNY · EUR → USDC）
- **AI 驱动**：Claude Haiku 解析中英文指令，tool-use 流水线自动编排
- **实时进度**：SSE 推送每步工具执行状态，前端 Pipeline 组件实时展示
- **链上集成**：USDC ERC-20 转账 + HSPSimulator 合约事件（PaymentRequested / Confirmed）
- **合规检查**：KYC/AML mock + 风险评级（大额预警、黑名单地址拦截）
- **定期规则**：Cron 调度器，每分钟扫描到期规则并自动执行
- **仪表盘**：支付历史 / 定期规则 / 系统监控（SSE 延迟、RPC 健康、交易统计）

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 14 · React 18 · TypeScript · TailwindCSS |
| 后端 | Express.js · TypeScript · tsx · Node 22 |
| AI | Anthropic SDK · Claude Haiku (`claude-haiku-4-5-20251001`) |
| 链上 | ethers.js 6 · HashKey Chain Testnet (Chain ID 133) |
| 数据库 | SQLite（Node 内置） |

---

## 快速开始

### 环境要求

- Node.js 22+
- 一个 Anthropic API Key

### 1. 克隆 & 安装

```bash
git clone https://github.com/wjy3452801181-a11y/MINIBABY-Pay-.git
cd MINIBABY-Pay-

cd backend && npm install
cd ../frontend && npm install
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

```env
ANTHROPIC_API_KEY=sk-ant-...

# HashKey Chain Testnet
USDC_CONTRACT=0x47725537961326e4b906558BD208012c6C11aCa2
RPC_URL=https://testnet.hsk.xyz

# 可选：后端演示钱包（用于直接广播交易）
DEMO_PRIVATE_KEY=0x...

# 可选：HSPSimulator 合约（链上事件记录）
HSP_SIMULATOR_ADDRESS=0x...
```

### 3. 启动

```bash
# 后端（:3001）
cd backend && npm run dev

# 前端（:3000）
cd frontend && npm run dev
```

或使用一键脚本：

```bash
./start.sh
```

打开 [http://localhost:3000](http://localhost:3000)

---

## 使用示例

在聊天框输入自然语言指令：

```
转 100 USDC 给 0x742d35Cc6634C0532925a3b8D4C9b2A4d88e1F23
每周给 0x742d...E1F2 转 50 USDC，备注房租
帮我转 500 人民币给 0x742d...E1F2，备注货款
Send 200 EUR to 0x742d...E1F2
```

Claude 自动执行四步流水线：

```
parse_intent → check_compliance → build_hsp_message → (schedule_recurring)
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/intent` | 提交支付指令，返回 streamId |
| GET | `/api/intent/stream/:streamId` | SSE 实时推送工具执行事件 |
| POST | `/api/execute` | 广播 USDC 转账 |
| GET | `/api/execute/history` | 最近 20 条支付记录 |
| GET | `/api/execute/rules` | 活跃定期规则 |
| POST | `/api/execute/cron/trigger` | 手动触发到期规则 |
| GET | `/api/metrics` | 系统监控指标快照 |
| GET | `/health` | 健康检查 |

---

## 项目结构

```
hsp-agent-hub/
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/         # intent.ts · execute.ts
│   │   ├── lib/            # claude.ts · ethers.ts · db.ts · metrics.ts · cronWorker.ts
│   │   └── tools/          # parseIntent · checkCompliance · buildHspMessage · scheduleRecurring
│   └── scripts/bench.ts    # RPC 延迟基准测试
└── frontend/
    ├── pages/index.tsx
    ├── components/         # ChatInput · Pipeline · ConfirmCard · Dashboard · WalletButton
    └── lib/                # useIntentFlow · i18n · types
```

---

## 链上信息

- **网络**：HashKey Chain Testnet
- **Chain ID**：133
- **RPC**：`https://testnet.hsk.xyz`
- **浏览器**：[https://testnet-explorer.hsk.xyz](https://testnet-explorer.hsk.xyz)
- **USDC**：`0x47725537961326e4b906558BD208012c6C11aCa2`

---

## License

MIT

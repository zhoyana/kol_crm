import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const now = new Date();

// 1) Task #5 seedKeywords 前面插入单核人群词，去重
const t = await p.campaignTask.findUnique({ where: { id: 5 }, select: { seedKeywords: true, name: true, platform: true } });
const old = Array.isArray(t.seedKeywords) ? t.seedKeywords : [];
const insert = ['毕业生', '上岸', '应届生'];
const merged = [...new Set([...insert, ...old])];
await p.campaignTask.update({ where: { id: 5 }, data: { seedKeywords: merged } });
console.log(`Task #5 "${t.name}" (platform=${t.platform}) seedKeywords:`);
console.log('  BEFORE:', JSON.stringify(old));
console.log('  AFTER :', JSON.stringify(merged));

// 2) 取消 Run #78：请求取消 + lease 立即过期，让 worker 优雅退出当前 run
const r0 = await p.agentRun.findUnique({ where: { id: 78 }, select: { status: true, stage: true, currentRound: true, completed: true, total: true } });
await p.agentRun.update({ where: { id: 78 }, data: {
  cancelRequestedAt: now,
  leaseExpiresAt: now
}});
console.log(`Run #78 (was ${r0.status}/${r0.stage} round ${r0.currentRound} ${r0.completed}/${r0.total}): cancelRequestedAt + leaseExpired set`);

const r = await p.agentRun.findUnique({ where: { id: 78 }, select: { status: true, stage: true, cancelRequestedAt: true, leaseExpiresAt: true, lastHeartbeatAt: true } });
console.log('Run #78 now:', JSON.stringify({ status: r.status, stage: r.stage, cancelRequestedAt: r.cancelRequestedAt, leaseExpiresAt: r.leaseExpiresAt, lastHeartbeatAt: r.lastHeartbeatAt }));

await p.$disconnect();
console.log('\nDONE. 到 UI 点"重新运行"启动新 run（会用新 seedKeywords 从"毕业生"起步）。');

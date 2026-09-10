import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const runs = await p.agentRun.findMany({
  where: { status: { in: ['running', 'active', 'processing'] } },
  orderBy: { updatedAt: 'desc' },
  take: 3,
  include: {
    campaignTask: {
      include: {
        brandLibrary: { select: { name: true, slug: true } },
        audienceTemplate: { select: { name: true } }
      }
    },
    rounds: { orderBy: { roundNumber: 'desc' }, take: 3 }
  }
});
if (runs.length === 0) {
  console.log('NO_RUNNING_AGENT_RUN');
  const recent = await p.agentRun.findMany({ orderBy: { updatedAt: 'desc' }, take: 3,
    include: { campaignTask: { select: { name: true, platform: true, seedKeywords: true } } } });
  console.log('RECENT_RUNS:');
  for (const r of recent) console.log(`  run#${r.id} status=${r.status} stage=${r.stage} ${r.completed}/${r.total} task="${r.campaignTask.name}" kw=${JSON.stringify(r.campaignTask.seedKeywords)}`);
} else {
  for (const r of runs) {
    const t = r.campaignTask;
    console.log(`=== Run #${r.id} | Task #${t.id} "${t.name}" | brand=${t.brandLibrary?.name}(${t.brandLibrary?.slug}) | platform=${t.platform} ===`);
    console.log(`  stage=${r.stage} status=${r.status} round=${r.currentRound} ${r.completed}/${r.total}`);
    console.log(`  message: ${r.message}`);
    console.log(`  lastHeartbeat: ${r.lastHeartbeatAt?.toISOString()}`);
    console.log(`  started: ${r.startedAt?.toISOString()} | lease: ${r.leaseExpiresAt?.toISOString()}`);
    console.log(`  seedKeywords: ${JSON.stringify(t.seedKeywords)}`);
    console.log(`  excludeKeywords: ${JSON.stringify(t.excludeKeywords)}`);
    console.log(`  audienceTemplate: ${t.audienceTemplate?.name}`);
    for (const rd of r.rounds) {
      console.log(`  Round ${rd.roundNumber}: kw="${rd.keyword}" status=${rd.status} collected=${rd.collectedWorks} candidates=${rd.candidatesFound} started=${rd.startedAt?.toISOString()} finished=${rd.finishedAt?.toISOString()}`);
    }
    // 查这个任务关联的 creator 池状态分布
    const pools = await p.creatorCampaignTask.groupBy({
      by: ['screeningStatus', 'poolStatus'],
      where: { campaignTaskId: t.id },
      _count: true
    });
    console.log(`  creator pools: ${JSON.stringify(pools.map(x=>({ss:x.screeningStatus,ps:x.poolStatus,n:x._count})))}`);
  }
}
await p.$disconnect();

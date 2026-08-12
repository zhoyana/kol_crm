import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const n = (a) => (Array.isArray(a) ? a.length : 0);
const show = (a, k = 5) => (Array.isArray(a) ? a.slice(0, k).join("、") : "");
try {
  const brands = await prisma.brandLibrary.findMany({ select: { id: true, name: true, slug: true } });
  console.log("=== 品牌库 ===");
  for (const b of brands) {
    const taskCount = await prisma.campaignTask.count({ where: { brandLibraryId: b.id } });
    const tplCount = await prisma.creatorAudienceTemplate.count({ where: { brandLibraryId: b.id } });
    console.log(`  [${b.id}] ${b.name} (${b.slug})  任务${taskCount} 模板${tplCount}`);
  }

  const tpls = await prisma.creatorAudienceTemplate.findMany({
    select: { id: true, name: true, version: true, brandLibraryId: true, template: true, examples: true },
  });
  console.log("\n=== 达人模板（真实字段） ===");
  tpls.forEach((t) => {
    const T = t.template || {};
    const d = T.discovery || {}, cs = T.candidateScreen || {}, hr = T.homepageReview || {}, m = T.metricRules || {};
    const ex = t.examples || {};
    console.log(`  [${t.id}] ${t.name} v${t.version} brand=${t.brandLibraryId} tplId=${T.id}`);
    console.log(`      discovery: primary=${n(d.primaryTerms)} support=${n(d.supportTerms)} exclude=${n(d.excludeTerms)}`);
    console.log(`        primary: ${show(d.primaryTerms, 6)}`);
    console.log(`        exclude: ${show(d.excludeTerms, 6)}`);
    console.log(`      candidateScreen: instr=${n(cs.instructions)} identity=${n(cs.identityTerms)} mismatch=${n(cs.obviousMismatchTerms)} hardDrop=${n(cs.hardDropTerms)} minLikes=${cs.minSampleLikes}`);
    console.log(`        identity: ${show(cs.identityTerms, 6)}`);
    console.log(`        hardDrop: ${show(cs.hardDropTerms, 6)}`);
    console.log(`      homepageReview: instr=${n(hr.instructions)} identity=${n(hr.identityTerms)} daily=${n(hr.dailyTerms)} lifestyle=${n(hr.lifestyleTerms)} reject=${n(hr.dominantRejectTerms)}`);
    console.log(`        minSamples=${hr.minSamplesForFeatured} minIdentity=${hr.minIdentityWorks} minDaily=${hr.minDailyWorks} minLifestyle=${hr.minLifestyleWorks} forceFull=${hr.forceFullSample}`);
    console.log(`        reject: ${show(hr.dominantRejectTerms, 6)}`);
    console.log(`      metricRules: avgLikes=${m.requireAvgLikes}/${m.avgLikesThreshold} viral=${m.requireViralWorks}/${m.viralLikesThreshold}x${m.minViralWorks} mode=${m.matchMode}`);
    console.log(`      案例: 正${n(ex.positive)} 边界${n(ex.pending)} 负${n(ex.negative)}`);
  });

  const tasks = await prisma.campaignTask.findMany({
    select: { id: true, name: true, brandLibraryId: true, audienceTemplateId: true, audienceTemplateSnapshot: true },
    orderBy: { id: "asc" },
  });
  console.log("\n=== 任务绑定 ===");
  tasks.forEach((t) => {
    const s = t.audienceTemplateSnapshot;
    console.log(`  [${t.id}] ${t.name}  brand=${t.brandLibraryId} tmpl=${t.audienceTemplateId} snap=${s ? "YES(" + (s.id || "?") + " v" + (s.version ?? "?") + ")" : "NO"}`);
  });
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await prisma.$disconnect();
}

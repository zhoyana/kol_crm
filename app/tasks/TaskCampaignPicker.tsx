"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";
import { BrandTaskPicker } from "@/app/components/BrandTaskPicker";

type TaskCampaignPickerProps = {
  brandLibraries: BrandLibraryItem[];
  campaignTasks: CampaignTaskItem[];
  selectedCampaignTask: CampaignTaskItem | null;
};

export function TaskCampaignPicker({ brandLibraries, campaignTasks, selectedCampaignTask }: TaskCampaignPickerProps) {
  const router = useRouter();

  function changeCampaignTask(taskId: string) {
    router.push(taskId ? `/tasks?campaignTaskId=${encodeURIComponent(taskId)}` : "/tasks");
  }

  return (
    <section className="panel campaign-task-picker workflow-section workflow-primary-section">
      <div>
        <span className="workflow-kicker">01 · 当前品类</span>
        <h2>品类任务</h2>
        <p>选中任务后，建联清单只显示这个任务下的达人精选库。不同品类不会互相混在一起。</p>
      </div>
      <div className="campaign-task-picker-controls">
        <BrandTaskPicker allowAll brandLibraries={brandLibraries} campaignTasks={campaignTasks} onTaskChange={changeCampaignTask} selectedTaskId={selectedCampaignTask ? String(selectedCampaignTask.id) : ""} storageKey="tasks-brand-library" />
        <select hidden onChange={(event) => changeCampaignTask(event.target.value)} value={selectedCampaignTask ? String(selectedCampaignTask.id) : ""}>
          <option value="">全局精选库</option>
          {campaignTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
        <Link className="secondary-link" href="/agent">
          管理品类任务
        </Link>
      </div>
      {selectedCampaignTask ? (
        <div className="campaign-task-summary">
          <div>
            <span>推广产品</span>
            <strong>{selectedCampaignTask.productName}</strong>
          </div>
          <div>
            <span>目标人群</span>
            <strong>{selectedCampaignTask.targetAudience}</strong>
          </div>
          <div>
            <span>建联语气</span>
            <strong>{selectedCampaignTask.outreachTone || "按默认蜀黍家话术"}</strong>
          </div>
          <p>{selectedCampaignTask.targetDescription}</p>
        </div>
      ) : null}
    </section>
  );
}

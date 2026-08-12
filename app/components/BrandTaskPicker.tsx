"use client";

import { useEffect, useMemo, useState } from "react";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";

type Props = {
  brandLibraries: BrandLibraryItem[];
  campaignTasks: CampaignTaskItem[];
  selectedTaskId: string;
  onTaskChange: (taskId: string) => void;
  allowAll?: boolean;
  storageKey?: string;
};

export function BrandTaskPicker({
  brandLibraries,
  campaignTasks,
  selectedTaskId,
  onTaskChange,
  allowAll = false,
  storageKey = "kol-crm:last-campaign-task"
}: Props) {
  const selectedTask = campaignTasks.find((task) => String(task.id) === selectedTaskId) || null;
  const firstBrandWithTask = brandLibraries.find((brand) => campaignTasks.some((task) => task.brandLibraryId === brand.id));
  const [selectedBrandId, setSelectedBrandId] = useState(
    selectedTask?.brandLibraryId ? String(selectedTask.brandLibraryId) : firstBrandWithTask ? String(firstBrandWithTask.id) : ""
  );

  useEffect(() => {
    if (selectedTask?.brandLibraryId) setSelectedBrandId(String(selectedTask.brandLibraryId));
  }, [selectedTask?.brandLibraryId]);

  useEffect(() => {
    if (allowAll || selectedTaskId || !campaignTasks.length) return;
    const remembered = window.localStorage.getItem(storageKey) || "";
    const initial = campaignTasks.find((task) => String(task.id) === remembered) || campaignTasks[0];
    if (initial) onTaskChange(String(initial.id));
  }, [allowAll, campaignTasks, onTaskChange, selectedTaskId, storageKey]);

  const brandTasks = useMemo(
    () => campaignTasks.filter((task) => String(task.brandLibraryId || "") === selectedBrandId),
    [campaignTasks, selectedBrandId]
  );

  function chooseTask(taskId: string) {
    if (taskId) window.localStorage.setItem(storageKey, taskId);
    onTaskChange(taskId);
  }

  function chooseBrand(brandId: string) {
    setSelectedBrandId(brandId);
    const firstTask = campaignTasks.find((task) => String(task.brandLibraryId || "") === brandId);
    chooseTask(firstTask ? String(firstTask.id) : "");
  }

  return (
    <div className="brand-task-picker">
      <div className="brand-picker-tabs" aria-label="选择品牌库">
        {allowAll ? (
          <button className={!selectedTaskId ? "selected" : ""} onClick={() => chooseTask("")} type="button">全部品牌</button>
        ) : null}
        {brandLibraries.map((brand) => {
          const count = campaignTasks.filter((task) => task.brandLibraryId === brand.id).length;
          const selected = selectedBrandId === String(brand.id) && Boolean(selectedTaskId);
          return (
            <button className={selected ? "selected" : ""} key={brand.id} onClick={() => chooseBrand(String(brand.id))} type="button">
              {brand.name}<small>{count || "待配置"}</small>
            </button>
          );
        })}
      </div>
      {selectedTaskId && brandTasks.length > 1 ? (
        <label className="brand-task-select">
          <span>品类任务</span>
          <select onChange={(event) => chooseTask(event.target.value)} value={selectedTaskId}>
            {brandTasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
        </label>
      ) : selectedTaskId && selectedTask ? (
        <span className="brand-single-task">当前任务：{selectedTask.name}</span>
      ) : selectedBrandId && brandTasks.length === 0 ? (
        <span className="brand-single-task muted">该品牌库暂无品类任务</span>
      ) : null}
    </div>
  );
}

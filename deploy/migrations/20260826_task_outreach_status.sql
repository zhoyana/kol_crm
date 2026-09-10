ALTER TABLE `CreatorCampaignTask`
  ADD COLUMN `outreachStatus` VARCHAR(191) NOT NULL DEFAULT '未建联';

UPDATE `CreatorCampaignTask` AS link_row
JOIN `Creator` AS creator ON creator.`id` = link_row.`creatorId`
SET link_row.`outreachStatus` = CASE
  WHEN creator.`outreachStatus` = '已建联' THEN '已建联'
  ELSE '未建联'
END;

CREATE INDEX `CreatorCampaignTask_campaignTaskId_outreachStatus_idx`
  ON `CreatorCampaignTask` (`campaignTaskId`, `outreachStatus`);

ALTER TABLE `OutreachLog`
  ADD COLUMN `campaignTaskId` INTEGER NULL;

CREATE INDEX `OutreachLog_campaignTaskId_idx`
  ON `OutreachLog` (`campaignTaskId`);

ALTER TABLE `OutreachLog`
  ADD CONSTRAINT `OutreachLog_campaignTaskId_fkey`
  FOREIGN KEY (`campaignTaskId`) REFERENCES `CampaignTask`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS `LocalAgentDevice` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `version` VARCHAR(191) NOT NULL,
  `capabilities` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'online',
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `LocalAgentDevice_status_lastSeenAt_idx` (`status`, `lastSeenAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `LocalAgentJob` (
  `id` VARCHAR(191) NOT NULL,
  `agentDeviceId` VARCHAR(191) NOT NULL,
  `pathname` VARCHAR(191) NOT NULL,
  `method` VARCHAR(191) NOT NULL DEFAULT 'GET',
  `requestBody` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `responseBody` JSON NULL,
  `error` TEXT NULL,
  `timeoutMs` INTEGER NOT NULL DEFAULT 300000,
  `claimedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `LocalAgentJob_agentDeviceId_status_createdAt_idx` (`agentDeviceId`, `status`, `createdAt`),
  INDEX `LocalAgentJob_status_leaseExpiresAt_idx` (`status`, `leaseExpiresAt`),
  CONSTRAINT `LocalAgentJob_agentDeviceId_fkey` FOREIGN KEY (`agentDeviceId`) REFERENCES `LocalAgentDevice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AgentRun` ADD COLUMN `agentDeviceId` VARCHAR(191) NULL;
CREATE INDEX `AgentRun_agentDeviceId_idx` ON `AgentRun` (`agentDeviceId`);
ALTER TABLE `AgentRun` ADD CONSTRAINT `AgentRun_agentDeviceId_fkey` FOREIGN KEY (`agentDeviceId`) REFERENCES `LocalAgentDevice` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

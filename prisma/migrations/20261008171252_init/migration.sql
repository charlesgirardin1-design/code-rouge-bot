-- CreateEnum
CREATE TYPE "SecurityLevel" AS ENUM ('NORMAL', 'SURVEILLANCE', 'REINFORCED', 'LOCKDOWN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('BAN', 'UNBAN', 'KICK', 'TIMEOUT', 'UNTIMEOUT', 'WARN', 'CLEAR_WARNINGS', 'CLEAR_MESSAGES', 'SLOWMODE');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('RAID', 'SPAM', 'NUKE', 'PHISHING', 'ALT', 'BOT_ADDED', 'LOCKDOWN', 'UNLOCK', 'LEVEL_CHANGE');

-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('DOMAIN', 'INVITE');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('SUPPORT', 'REPORT', 'PARTNERSHIP', 'QUESTION', 'PURCHASE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLAIMED', 'CLOSED', 'DELETED');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'BOT', 'DASHBOARD', 'SYSTEM');

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "iconHash" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "caseCounter" INTEGER NOT NULL DEFAULT 0,
    "ticketCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "securityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "securityLevel" "SecurityLevel" NOT NULL DEFAULT 'NORMAL',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GuildStatistics" (
    "guildId" TEXT NOT NULL,
    "messagesDeleted" INTEGER NOT NULL DEFAULT 0,
    "spamDetected" INTEGER NOT NULL DEFAULT 0,
    "raidsDetected" INTEGER NOT NULL DEFAULT 0,
    "linksBlocked" INTEGER NOT NULL DEFAULT 0,
    "nukeDetected" INTEGER NOT NULL DEFAULT 0,
    "membersVerified" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildStatistics_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "LockdownState" (
    "guildId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "snapshot" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LockdownState_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatarHash" TEXT,
    "bot" BOOLEAN NOT NULL DEFAULT false,
    "accountCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfile" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "riskReasons" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "clearedAt" TIMESTAMP(3),
    "clearedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "type" "ModerationActionType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTag" TEXT,
    "moderatorId" TEXT NOT NULL,
    "moderatorTag" TEXT,
    "reason" TEXT,
    "durationMs" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "userId" TEXT,
    "executorId" TEXT,
    "scoreDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "level" "SecurityLevel" NOT NULL,
    "actionTaken" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Whitelist" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "ListType" NOT NULL,
    "value" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blacklist" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "ListType" NOT NULL,
    "value" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channelId" TEXT,
    "creatorId" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "subject" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "claimedById" TEXT,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handledBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "closedById" TEXT,
    "closeReason" TEXT,
    "transcript" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorTag" TEXT NOT NULL,
    "authorBot" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "embeds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "embed" JSONB NOT NULL,
    "mention" TEXT,
    "buttonLabel" TEXT,
    "buttonUrl" TEXT,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "reason" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "guildIds" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberProfile_guildId_riskLevel_idx" ON "MemberProfile"("guildId", "riskLevel");

-- CreateIndex
CREATE INDEX "Warning_guildId_userId_active_idx" ON "Warning"("guildId", "userId", "active");

-- CreateIndex
CREATE INDEX "ModerationAction_guildId_targetId_idx" ON "ModerationAction"("guildId", "targetId");

-- CreateIndex
CREATE INDEX "ModerationAction_guildId_createdAt_idx" ON "ModerationAction"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_type_expired_expiresAt_idx" ON "ModerationAction"("type", "expired", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationAction_guildId_caseNumber_key" ON "ModerationAction"("guildId", "caseNumber");

-- CreateIndex
CREATE INDEX "SecurityEvent_guildId_createdAt_idx" ON "SecurityEvent"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_guildId_type_idx" ON "SecurityEvent"("guildId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Whitelist_guildId_type_value_key" ON "Whitelist"("guildId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Blacklist_guildId_type_value_key" ON "Blacklist"("guildId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");

-- CreateIndex
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");

-- CreateIndex
CREATE INDEX "Ticket_guildId_creatorId_status_idx" ON "Ticket"("guildId", "creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket"("guildId", "number");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketMessage_ticketId_messageId_key" ON "TicketMessage"("ticketId", "messageId");

-- CreateIndex
CREATE INDEX "Announcement_status_scheduledAt_idx" ON "Announcement"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Announcement_guildId_createdAt_idx" ON "Announcement"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_action_idx" ON "AuditLog"("guildId", "action");

-- CreateIndex
CREATE INDEX "DashboardSession_userId_idx" ON "DashboardSession"("userId");

-- CreateIndex
CREATE INDEX "DashboardSession_expiresAt_idx" ON "DashboardSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildStatistics" ADD CONSTRAINT "GuildStatistics_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockdownState" ADD CONSTRAINT "LockdownState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Whitelist" ADD CONSTRAINT "Whitelist_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blacklist" ADD CONSTRAINT "Blacklist_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

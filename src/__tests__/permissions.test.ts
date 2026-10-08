import { describe, expect, it } from "vitest";
import { checkHierarchy, computeGuildPermissions, computePermissionLevel, DiscordPerm, PermissionLevel } from "../permissions/levels.js";

const config = { adminRoleIds: ["100000000000000001"], moderatorRoleIds: ["100000000000000002"], supportRoleIds: ["100000000000000003"] };
const base = { userId: "200000000000000001", ownerId: "200000000000000099", permissions: 0n, roleIds: [] as string[], config };

describe("computePermissionLevel", () => {
  it("le propriétaire est OWNER", () => {
    expect(computePermissionLevel({ ...base, userId: base.ownerId })).toBe(PermissionLevel.OWNER);
  });
  it("Administrator ou Gérer le serveur → ADMIN", () => {
    expect(computePermissionLevel({ ...base, permissions: DiscordPerm.Administrator })).toBe(PermissionLevel.ADMIN);
    expect(computePermissionLevel({ ...base, permissions: DiscordPerm.ManageGuild })).toBe(PermissionLevel.ADMIN);
  });
  it("rôle admin configuré → ADMIN", () => {
    expect(computePermissionLevel({ ...base, roleIds: ["100000000000000001"] })).toBe(PermissionLevel.ADMIN);
  });
  it("permissions de modération ou rôle modérateur → MODERATOR", () => {
    expect(computePermissionLevel({ ...base, permissions: DiscordPerm.BanMembers })).toBe(PermissionLevel.MODERATOR);
    expect(computePermissionLevel({ ...base, roleIds: ["100000000000000002"] })).toBe(PermissionLevel.MODERATOR);
  });
  it("rôle support → SUPPORT, sinon MEMBER", () => {
    expect(computePermissionLevel({ ...base, roleIds: ["100000000000000003"] })).toBe(PermissionLevel.SUPPORT);
    expect(computePermissionLevel({ ...base, permissions: DiscordPerm.ManageMessages })).toBe(PermissionLevel.MEMBER);
  });
});

describe("computeGuildPermissions", () => {
  it("cumule @everyone et les rôles du membre uniquement", () => {
    const roles = [
      { id: "g", permissions: "1024" },
      { id: "r1", permissions: (DiscordPerm.KickMembers).toString() },
      { id: "r2", permissions: (DiscordPerm.Administrator).toString() },
    ];
    const perms = computeGuildPermissions(["r1"], roles, "g");
    expect(perms & DiscordPerm.KickMembers).not.toBe(0n);
    expect(perms & DiscordPerm.Administrator).toBe(0n);
    expect(perms & 1024n).toBe(1024n);
  });
});

describe("checkHierarchy", () => {
  const h = { actorId: "a", targetId: "t", ownerId: "o", botId: "b", actorTopPosition: 10, targetTopPosition: 5, botTopPosition: 20 };
  it("autorise une cible inférieure", () => expect(checkHierarchy(h)).toBeNull());
  it("refuse soi-même, le propriétaire et le bot", () => {
    expect(checkHierarchy({ ...h, targetId: "a" })).toBe("TARGET_IS_SELF");
    expect(checkHierarchy({ ...h, targetId: "o" })).toBe("TARGET_IS_OWNER");
    expect(checkHierarchy({ ...h, targetId: "b" })).toBe("TARGET_IS_BOT");
  });
  it("refuse une cible de rang supérieur ou égal", () => {
    expect(checkHierarchy({ ...h, targetTopPosition: 10 })).toBe("TARGET_HIGHER_THAN_ACTOR");
    expect(checkHierarchy({ ...h, actorTopPosition: 30, targetTopPosition: 20 })).toBe("TARGET_HIGHER_THAN_BOT");
  });
  it("le propriétaire peut agir sur n'importe quel rang sous le bot", () => {
    expect(checkHierarchy({ ...h, actorId: "o", actorTopPosition: 1, targetTopPosition: 15 })).toBeNull();
  });
  it("un utilisateur hors serveur peut être banni", () => {
    expect(checkHierarchy({ ...h, targetTopPosition: null })).toBeNull();
  });
});

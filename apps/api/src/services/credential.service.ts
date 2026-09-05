/**
 * Credential management for tenant secrets.
 * Encrypts/decrypts Notion tokens and WordPress passwords stored in the DB.
 */

import type { PrismaClient } from "@prisma/client";
import { encryptJson, decryptJson } from "../lib/encryption.js";

export interface NotionCredentials {
  accessToken: string;
  workspaceId?: string;
}

export interface GeminiCredentials {
  apiKey: string;
}

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export class CredentialService {
  constructor(private prisma: PrismaClient) {}

  async setNotionCredentials(tenantId: string, creds: NotionCredentials) {
    const encrypted = encryptJson(creds as unknown as Record<string, unknown>);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        notionCredentials: encrypted,
        ...(creds.workspaceId !== undefined && { notionWorkspaceId: creds.workspaceId }),
      },
    });
  }

  async getNotionCredentials(tenantId: string): Promise<NotionCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.notionCredentials) return null;
    return decryptJson<NotionCredentials>(tenant.notionCredentials);
  }

  async setWordPressCredentials(tenantId: string, creds: WordPressCredentials) {
    const encrypted = encryptJson(creds as unknown as Record<string, unknown>);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        wordpressCredentials: encrypted,
        wpSiteUrl: creds.siteUrl,
      },
    });
  }

  async getWordPressCredentials(tenantId: string): Promise<WordPressCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.wordpressCredentials) return null;
    return decryptJson<WordPressCredentials>(tenant.wordpressCredentials);
  }

  async setGeminiCredentials(tenantId: string, creds: GeminiCredentials) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { geminiCredentials: encryptJson(creds as unknown as Record<string, unknown>) },
    });
  }

  async getGeminiCredentials(tenantId: string): Promise<GeminiCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.geminiCredentials) return null;
    return decryptJson<GeminiCredentials>(tenant.geminiCredentials);
  }

  async clearGeminiCredentials(tenantId: string) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { geminiCredentials: null },
    });
  }
}

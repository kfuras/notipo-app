// ─── Enums (mirror Prisma schema) ────────────────────────────────────────────

export const PostStatus = {
  SYNCED: "SYNCED",
  IMAGES_PROCESSING: "IMAGES_PROCESSING",
  PUBLISHING: "PUBLISHING",
  PUBLISHED: "PUBLISHED",
  UPDATE_PENDING: "UPDATE_PENDING",
  FAILED: "FAILED",
} as const;
export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus];

export const JobType = {
  NOTION_POLL: "NOTION_POLL",
  SYNC_POST: "SYNC_POST",
  PROCESS_IMAGES: "PROCESS_IMAGES",
  GENERATE_FEATURED_IMAGE: "GENERATE_FEATURED_IMAGE",
  PUBLISH_POST: "PUBLISH_POST",
  UPDATE_POST: "UPDATE_POST",
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

export const JobStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const CodeHighlighter = {
  PRISMATIC: "PRISMATIC",
  WP_CODE: "WP_CODE",
  HIGHLIGHT_JS: "HIGHLIGHT_JS",
  PRISM_JS: "PRISM_JS",
} as const;
export type CodeHighlighter =
  (typeof CodeHighlighter)[keyof typeof CodeHighlighter];

export const Plan = {
  FREE: "FREE",
  PRO: "PRO",
  TRIAL: "TRIAL",
} as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

export const FeaturedImageMode = {
  STANDARD: "STANDARD",
  AI_GENERATED: "AI_GENERATED",
} as const;
export type FeaturedImageMode =
  (typeof FeaturedImageMode)[keyof typeof FeaturedImageMode];

export const AI_IMAGE_STYLES = [
  "comic book",
  "watercolor",
  "3D render",
  "minimalist",
  "photorealistic",
  "cyberpunk",
  "retro",
] as const;
export type AiImageStyle = (typeof AI_IMAGE_STYLES)[number];

export const UserRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// ─── API response types ─────────────────────────────────────────────────────

export interface ApiPost {
  id: string;
  tenantId: string;
  notionPageId: string;
  title: string;
  slug: string | null;
  status: PostStatus;
  wpPostId: number | null;
  wpUrl: string | null;
  wpFeaturedMediaId: number | null;
  featuredImageTitle: string | null;
  categoryId: string | null;
  category: ApiCategory | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCategory {
  id: string;
  tenantId: string;
  name: string;
  wpCategoryId: number | null;
  wpTagIds: number[];
  backgroundImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTag {
  id: string;
  tenantId: string;
  name: string;
  wpTagId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiJob {
  id: string;
  tenantId: string;
  type: JobType;
  status: JobStatus;
  postId: string | null;
  error: string | null;
  step: string | null;
  wpUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: T[];
  total?: number;
}

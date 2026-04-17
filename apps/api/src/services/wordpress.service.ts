/**
 * WordPress REST API client.
 * Ported from n8n workflow Y6O8LzWsujHZz3G5 HTTP Request nodes.
 * Uses Basic Auth with application passwords.
 */

import axios, { type AxiosInstance } from "axios";
import type { WPPostPayload, WPMediaUpload, SeoPayload } from "../types/index.js";
import { logger } from "../lib/logger.js";

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export class WordPressService {
  private client: AxiosInstance;
  private rawClient: AxiosInstance;

  constructor(credentials: WordPressCredentials) {
    const auth = Buffer.from(
      `${credentials.username}:${credentials.appPassword}`,
    ).toString("base64");

    const headers = { Authorization: `Basic ${auth}` };

    this.client = axios.create({ baseURL: credentials.siteUrl, headers });

    // Use ?rest_route= query-string format instead of /wp-json/ pretty URLs.
    // This works on all WordPress installs regardless of server rewrite rules.
    this.client.interceptors.request.use((config) => {
      const path = config.url || "";
      config.url = "/";
      config.params = { ...config.params, rest_route: `/wp/v2${path}` };
      return config;
    });

    // Raw client for non-/wp/v2 REST routes (e.g. plugin-specific endpoints)
    this.rawClient = axios.create({ baseURL: credentials.siteUrl, headers });
    this.rawClient.interceptors.request.use((config) => {
      const path = config.url || "";
      config.url = "/";
      config.params = { ...config.params, rest_route: path };
      return config;
    });
  }

  /** Verify credentials by fetching the authenticated user profile. */
  async testConnection(): Promise<{ id: number; name: string }> {
    const { data } = await this.client.get("/users/me");
    return { id: data.id, name: data.name };
  }

  /** Detect which SEO plugin is installed. Returns "rankmath", "seopress", or null. */
  async detectSeoPlugin(): Promise<string | null> {
    try {
      const { data: plugins } = await this.client.get("/plugins");
      for (const p of plugins) {
        const slug = (p.plugin || "").toLowerCase();
        if (slug.startsWith("seo-by-rank-math/")) return "rankmath";
        if (slug.startsWith("wp-seopress/")) return "seopress";
      }
    } catch {
      // Plugins endpoint may not be available (requires manage_options in some setups)
      logger.debug("Could not list plugins — SEO detection skipped");
    }
    return null;
  }

  /** Create a draft (or scheduled) post. */
  async createDraft(payload: WPPostPayload) {
    const response = await this.client.post("/posts", {
      ...payload,
      status: payload.status || "draft",
    });
    logger.info({ wpStatus: response.status, wpPostId: response.data?.id, wpPostStatus: response.data?.status, wpLink: response.data?.link }, "WP createDraft response");
    return response.data;
  }

  /** Edit an existing post's content. */
  async editPost(wpPostId: number, payload: Partial<WPPostPayload>) {
    const { data } = await this.client.post(`/posts/${wpPostId}`, payload);
    logger.info({ wpPostId, wpPostStatus: data?.status, wpLink: data?.link }, "WP editPost response");
    return data;
  }

  /** Publish a draft post. */
  async publishPost(wpPostId: number) {
    const { data } = await this.client.post(`/posts/${wpPostId}`, {
      status: "publish",
    });
    return data;
  }

  /** Get a post by ID. */
  async getPost(wpPostId: number) {
    try {
      // "edit" context exposes meta fields (SEO plugin focus keywords)
      const { data } = await this.client.get(`/posts/${wpPostId}`, {
        params: { context: "edit" },
      });
      return data;
    } catch (err) {
      logger.warn({ wpPostId, err: err instanceof Error ? err.message : String(err) }, "getPost context=edit failed, falling back to default context (meta fields will not be available)");
      const { data } = await this.client.get(`/posts/${wpPostId}`);
      return data;
    }
  }

  /** Fetch SEO focus keyword for a post via plugin-specific REST APIs. */
  async getSeoFocusKeyword(wpPostId: number, postUrl?: string): Promise<string | undefined> {
    // 1. Rank Math: getHead endpoint — parse keyword from JSON-LD BlogPosting.keywords
    if (postUrl) {
      try {
        const { data } = await this.rawClient.get("/rankmath/v1/getHead", {
          params: { url: postUrl },
        });
        const head = data?.head as string | undefined;
        if (head) {
          const ldMatch = head.match(/<script[^>]*class="rank-math-schema"[^>]*>([\s\S]*?)<\/script>/);
          if (ldMatch) {
            const ld = JSON.parse(ldMatch[1]);
            const graph = ld?.["@graph"] || [];
            for (const node of graph) {
              const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
              if (types.some((t: string) => ["BlogPosting", "Article", "NewsArticle", "WebPage"].includes(t))) {
                if (typeof node.keywords === "string" && node.keywords) {
                  logger.info({ wpPostId, source: "rankmath-getHead" }, "SEO keyword found");
                  return node.keywords;
                }
              }
            }
          }
        }
      } catch {
        // Rank Math getHead not available
      }
    }

    // 2. Rank Math: getHead with shortlink fallback (when postUrl not available)
    if (!postUrl) {
      try {
        const { data } = await this.rawClient.get("/rankmath/v1/getHead", {
          params: { url: `/?p=${wpPostId}` },
        });
        const head = data?.head as string | undefined;
        if (head) {
          const ldMatch = head.match(/<script[^>]*class="rank-math-schema"[^>]*>([\s\S]*?)<\/script>/);
          if (ldMatch) {
            const ld = JSON.parse(ldMatch[1]);
            const graph = ld?.["@graph"] || [];
            for (const node of graph) {
              const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
              if (types.some((t: string) => ["BlogPosting", "Article", "NewsArticle", "WebPage"].includes(t))) {
                if (typeof node.keywords === "string" && node.keywords) {
                  logger.info({ wpPostId, source: "rankmath-getHead-shortlink" }, "SEO keyword found");
                  return node.keywords;
                }
              }
            }
          }
        }
      } catch {
        // Rank Math getHead not available
      }
    }

    // 3. Post meta: context=edit exposes registered meta fields
    try {
      const { data } = await this.client.get(`/posts/${wpPostId}`, {
        params: { context: "edit", _fields: "meta" },
      });
      const meta = data?.meta as Record<string, unknown> | undefined;
      const kw = meta?.rank_math_focus_keyword || meta?.["_yoast_wpseo_focuskw"] || meta?.["_seopress_analysis_target_kw"] || meta?.["_aioseo_keywords"];
      if (typeof kw === "string" && kw) {
        logger.info({ wpPostId, source: "post-meta" }, "SEO keyword found");
        return kw;
      }
    } catch {
      // context=edit may not be available
    }

    // 4. Yoast: getHead endpoint
    try {
      const { data } = await this.rawClient.get("/yoast/v1/get_head", {
        params: { url: postUrl || `/?p=${wpPostId}` },
      });
      const json = typeof data?.json === "object" ? data.json : data;
      const kw = json?.focuskw;
      if (typeof kw === "string" && kw) {
        logger.info({ wpPostId, source: "yoast-getHead" }, "SEO keyword found");
        return kw;
      }
    } catch {
      // Yoast not installed
    }

    // 5. AIOSEO: post meta endpoint
    try {
      const { data } = await this.rawClient.get(`/aioseo/v1/post`, {
        params: { id: wpPostId },
      });
      const kw = data?.keyphrases?.focus?.keyphrase || data?.focus_keyphrase;
      if (typeof kw === "string" && kw) {
        logger.info({ wpPostId, source: "aioseo" }, "SEO keyword found");
        return kw;
      }
    } catch {
      // AIOSEO not installed
    }

    // 6. SEOPress: target keywords endpoint
    try {
      const { data } = await this.rawClient.get(`/seopress/v1/posts/${wpPostId}/target-keywords`);
      const kw = data?._seopress_analysis_target_kw;
      if (typeof kw === "string" && kw) {
        logger.info({ wpPostId, source: "seopress" }, "SEO keyword found");
        return kw;
      }
    } catch {
      // SEOPress not installed
    }

    return undefined;
  }

  /** Upload media to WordPress media library. */
  async uploadMedia(
    imageBuffer: Buffer,
    filename: string,
    mimeType = "image/png",
  ): Promise<WPMediaUpload> {
    const { data } = await this.client.post("/media", imageBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
    return data;
  }

  /** Update media metadata (alt, title, caption). */
  async updateMediaMeta(
    wpMediaId: number,
    meta: { alt_text?: string; title?: string; caption?: string },
  ) {
    const { data } = await this.client.post(`/media/${wpMediaId}`, meta);
    return data;
  }

  /** Attach a media item as the featured image of a post. */
  async attachFeaturedImage(wpPostId: number, wpMediaId: number) {
    const { data } = await this.client.post(`/posts/${wpPostId}`, {
      featured_media: wpMediaId,
    });
    return data;
  }

  /** Resolve tag slugs to WordPress tag IDs, creating missing tags. */
  async resolveTagIds(tagNames: string[]): Promise<number[]> {
    if (tagNames.length === 0) return [];
    const ids: number[] = [];
    for (const name of tagNames) {
      const slug = name.toLowerCase().replace(/\s+/g, "-");
      const { data: found } = await this.client.get<Array<{ id: number }>>("/tags", {
        params: { slug, per_page: 1 },
      });
      if (found.length > 0) {
        ids.push(found[0].id);
      } else {
        const { data: created } = await this.client.post<{ id: number }>("/tags", { name, slug });
        ids.push(created.id);
      }
    }
    return ids;
  }

  /** Permanently delete a media item from the WordPress media library. */
  async deleteMedia(wpMediaId: number) {
    await this.client.delete(`/media/${wpMediaId}`, { params: { force: true } });
  }

  /** Permanently delete a post from WordPress (bypasses trash). */
  async deletePost(wpPostId: number) {
    await this.client.delete(`/posts/${wpPostId}`, { params: { force: true } });
  }

  /** Fetch all categories from the WordPress site. */
  async listCategories(): Promise<Array<{ id: number; name: string; slug: string; count: number }>> {
    const results: Array<{ id: number; name: string; slug: string; count: number }> = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.get("/categories", {
        params: { per_page: 100, page },
      });
      for (const c of data) {
        results.push({ id: c.id, name: c.name, slug: c.slug, count: c.count });
      }
      if (data.length < 100) break;
      page++;
    }
    return results;
  }

  /** Fetch all tags from the WordPress site. */
  async listTags(): Promise<Array<{ id: number; name: string; slug: string; count: number }>> {
    const results: Array<{ id: number; name: string; slug: string; count: number }> = [];
    let page = 1;
    while (true) {
      const { data } = await this.client.get("/tags", {
        params: { per_page: 100, page },
      });
      for (const t of data) {
        results.push({ id: t.id, name: t.name, slug: t.slug, count: t.count });
      }
      if (data.length < 100) break;
      page++;
    }
    return results;
  }

  /** List posts with pagination. Returns posts, total count, and total pages. */
  async listPosts(params?: {
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<{
    posts: Array<{
      id: number;
      title: { rendered: string };
      content: { rendered: string };
      excerpt: { rendered: string };
      status: string;
      slug: string;
      date: string;
      link: string;
      categories: number[];
      tags: number[];
    }>;
    total: number;
    totalPages: number;
  }> {
    // Use "any" internally but filter to standard WP statuses to exclude plugin backup copies
    // (e.g. Surfer SEO's "surfer-backup") that don't represent real content.
    const rawStatus = params?.status ?? "any";
    const status = rawStatus === "any"
      ? "publish,draft,pending,private,future"
      : rawStatus;
    const page = params?.page ?? 1;
    const perPage = params?.perPage ?? 20;

    const response = await this.client.get("/posts", {
      params: { status, page, per_page: perPage },
    });

    return {
      posts: response.data,
      total: Number(response.headers["x-wp-total"] || response.data.length),
      totalPages: Number(response.headers["x-wp-totalpages"] || 1),
    };
  }

  /** Introspect the current application password — returns name, last_used, last_ip. */
  async introspectAppPassword(): Promise<{ name: string; last_used: string | null; last_ip: string | null } | null> {
    try {
      const { data } = await this.client.get("/users/me/application-passwords/introspect");
      return {
        name: data.name ?? "Unknown",
        last_used: data.last_used ?? null,
        last_ip: data.last_ip ?? null,
      };
    } catch {
      return null;
    }
  }

  /** Update SEO meta fields using the detected SEO plugin's native REST API. */
  async updateSeo(wpPostId: number, seo: SeoPayload, seoPlugin: string | null) {
    if (!seoPlugin) {
      logger.debug({ wpPostId }, "No SEO plugin detected — skipping SEO meta");
      return;
    }

    if (seoPlugin === "rankmath") {
      const { data } = await this.rawClient.post("/rankmath/v1/updateMeta", {
        objectID: wpPostId,
        objectType: "post",
        meta: {
          rank_math_focus_keyword: seo.keyword,
          rank_math_title: seo.title,
          rank_math_description: seo.description,
        },
      });
      logger.info({ wpPostId }, "SEO meta updated via Rank Math API");
      return data;
    }

    if (seoPlugin === "seopress") {
      await this.rawClient.put(`/seopress/v1/posts/${wpPostId}/title-description-metas`, {
        _seopress_titles_title: seo.title,
        _seopress_titles_desc: seo.description,
      });
      await this.rawClient.put(`/seopress/v1/posts/${wpPostId}/target-keywords`, {
        _seopress_analysis_target_kw: seo.keyword,
      });
      logger.info({ wpPostId }, "SEO meta updated via SEOPress API");
      return;
    }

    logger.warn({ wpPostId, seoPlugin }, "Unknown SEO plugin — skipping SEO meta");
  }
}

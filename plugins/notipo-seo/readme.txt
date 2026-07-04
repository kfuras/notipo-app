=== Notipo SEO ===
Contributors: kfuras
Tags: seo, rest api, rank math, yoast, seopress
Requires at least: 5.5
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT
License URI: https://opensource.org/licenses/MIT

REST API bridge for SEO metadata. Write focus keyword, SEO title, and description to Rank Math, Yoast, SEOPress, or AIOSEO via the WordPress REST API.

== Description ==

Notipo SEO adds a REST API bridge for SEO metadata that works with any external tool — n8n workflows, AI agents, custom scripts, or the Notipo publishing platform.

Yoast SEO and All in One SEO (AIOSEO) do not expose their metadata via the WordPress REST API. This plugin fills that gap by registering REST-visible meta fields and mapping them to the active SEO plugin whenever a post is saved.

The plugin auto-detects which SEO plugin is active and writes to its native fields — no configuration required.

**Supported SEO plugins:**

* Rank Math
* Yoast SEO
* SEOPress
* All in One SEO (AIOSEO)

**Common use cases:**

* Set SEO metadata from n8n or Zapier workflows
* Publish posts from AI agents (Claude, ChatGPT, Cursor) with SEO already populated
* Bulk-update SEO metadata via custom scripts
* Use with the Notipo publishing platform (https://notipo.com) for Notion → WordPress workflows

**How it works:**

The plugin registers three REST-visible meta fields on posts:

* `notipo_seo_title` — SEO title (used by search engines and social previews)
* `notipo_seo_description` — meta description
* `notipo_seo_keyword` — focus keyword

Any REST client writes to these fields via the standard `POST /wp-json/wp/v2/posts` endpoint. On save, the plugin detects the active SEO plugin and mirrors the values into that plugin's native fields.

**Detection endpoint:**

Query which SEO plugin is active via `GET /wp-json/notipo/v1/seo-status`.

== Installation ==

1. Upload the `notipo-seo` folder to `/wp-content/plugins/`, or install via the WordPress plugin directory.
2. Activate the plugin in **Plugins → Installed Plugins**.
3. Ensure one of the supported SEO plugins (Rank Math, Yoast, SEOPress, or AIOSEO) is active.
4. Write to the meta fields via the REST API — no configuration needed.

== Frequently Asked Questions ==

= What SEO plugin do I need? =

Any one of: Rank Math, Yoast SEO, SEOPress, or All in One SEO (AIOSEO). The plugin auto-detects which is active.

= Do I need Notipo (the SaaS) to use this plugin? =

No. The plugin is fully standalone. Notipo is one use case among many — you can use this plugin with n8n, Zapier, custom scripts, AI agents, or any REST client.

= Why not use Yoast or AIOSEO's own REST API? =

Yoast's REST API is officially read-only (see https://developer.yoast.com/customization/apis/rest-api/). AIOSEO also does not expose write access via REST. This plugin bridges that gap by writing to the plugins' post meta fields directly.

= What if I have Rank Math or SEOPress? =

Both Rank Math and SEOPress expose write access via their own REST endpoints. This plugin still works for consistency (same three field names across all four SEO plugins), which is useful when switching plugins or supporting multiple sites.

= Does it work with the block editor? =

Yes. The meta fields are written during post save regardless of editor (classic, block, or REST-only).

= Trademark and ownership =

"Notipo" is the name of an open-source project maintained by kfuras. The domain notipo.com is verified via DNS TXT record. This plugin ships as a companion to that project and is authored by the same maintainer. All other SEO plugin names (Rank Math, Yoast, SEOPress, AIOSEO) are trademarks of their respective owners and are referenced here only to describe compatibility.

== Changelog ==

= 1.0.0 =
* Initial release.
* REST API bridge for SEO metadata across Rank Math, Yoast SEO, SEOPress, and All in One SEO.
* Auto-detection of active SEO plugin via `notipo_seo_detect_plugin()`.
* GET `/wp-json/notipo/v1/seo-status` endpoint for detection status.

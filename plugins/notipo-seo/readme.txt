=== SEO Meta for REST API ===
Contributors: kfuras
Tags: seo, rest api, yoast, rank math, seopress
Requires at least: 5.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

REST API bridge for SEO metadata. Write focus keyword, SEO title, and description to Rank Math, Yoast, SEOPress, or AIOSEO via the WordPress REST API.

== Description ==

This plugin adds a REST API bridge for SEO metadata that works with any external tool — n8n workflows, AI agents, custom scripts, or the Notipo publishing platform.

Yoast SEO and All in One SEO (AIOSEO) do not expose their metadata for writing via the WordPress REST API. This plugin fills that gap by registering three REST-visible meta fields and copying them into the active SEO plugin's own fields whenever a post is saved.

The plugin auto-detects which SEO plugin is active and writes to its native fields. There are no settings to configure.

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

**The three fields:**

* `notipo_seo_title` — SEO title
* `notipo_seo_description` — meta description
* `notipo_seo_keyword` — focus keyword

They are registered on the `post` post type and are readable and writable through the standard `/wp-json/wp/v2/posts/<id>` endpoint by any user who can edit posts.

== Installation ==

1. Install and activate the plugin.
2. Make sure one of the supported SEO plugins (Rank Math, Yoast SEO, SEOPress, or AIOSEO) is also active.
3. Go to **Tools → SEO Meta for REST API**. The page shows which SEO plugin was detected.

There is nothing else to configure. The plugin has no settings and adds no front-end output.

== How to verify it is working ==

Everything below happens inside wp-admin — no REST client needed.

1. Go to **Tools → SEO Meta for REST API**.
2. Confirm the Status section names your SEO plugin. If it says none was detected, activate Rank Math, Yoast SEO, SEOPress, or AIOSEO first.
3. Under **Try it**, pick a post, type anything into the three fields, and press **Save and copy to SEO plugin**.
4. The **Result** table then reads the values back out of the database, showing this plugin's field name next to the SEO plugin's own field name and the value now stored there.
5. Open that post in the editor and look at the SEO plugin's panel — the same title, description, and focus keyword are there.

Step 4 is the whole plugin: whatever writes those three fields, the values end up in the SEO plugin's native fields on save. The Tools page writes them from a form; n8n, an AI agent, or a script writes them over the REST API. The result is identical.

== Using it from an external client ==

Authenticate with an application password (**Users → Profile → Application Passwords**) and write the fields as post meta:

`curl -X POST https://example.com/wp-json/wp/v2/posts/123 \`
`  -u "USERNAME:APPLICATION_PASSWORD" \`
`  -H "Content-Type: application/json" \`
`  -d '{"meta":{"notipo_seo_title":"Example title","notipo_seo_description":"Example description","notipo_seo_keyword":"example"}}'`

The **Tools → SEO Meta for REST API** page prints this same command with your own site URL already filled in.

To check which SEO plugin is active from outside WordPress, call `GET /wp-json/notipo/v1/seo-status` as a user who can edit posts. It returns the detected plugin and the plugin version.

== Frequently Asked Questions ==

= What SEO plugin do I need? =

Any one of: Rank Math, Yoast SEO, SEOPress, or All in One SEO (AIOSEO). The plugin auto-detects which is active. Without one, the three fields still store their values, but there is nothing to copy them into.

= Do I need Notipo (the SaaS) to use this plugin? =

No. The plugin is fully standalone and has no external dependencies — it makes no outbound requests. Notipo is one use case among many; n8n, Zapier, custom scripts, AI agents, or any REST client work the same way.

= Why not use Yoast or AIOSEO's own REST API? =

Yoast's REST API is officially read-only (see https://developer.yoast.com/customization/apis/rest-api/). AIOSEO does not expose write access via REST either. This plugin bridges that gap by writing to the plugins' post meta directly.

= What if I have Rank Math or SEOPress? =

Both expose write access through their own REST endpoints. This plugin still helps, because the same three field names work across all four SEO plugins — useful when you switch plugins or run several sites on different ones.

= Does it work with the block editor? =

Yes. The copy happens on `save_post`, so it runs for the classic editor, the block editor, and REST-only writes alike.

= Which post types are supported? =

Posts. The meta fields are registered on the `post` type only.

= Trademark and ownership =

"Notipo" is the name of an open-source project maintained by kfuras. The domain notipo.com is verified via DNS TXT record. This plugin ships as a companion to that project and is authored by the same maintainer. All other SEO plugin names (Rank Math, Yoast, SEOPress, AIOSEO) are trademarks of their respective owners and are referenced here only to describe compatibility.

== Changelog ==

= 1.1.0 =
* Added a **Tools → SEO Meta for REST API** screen showing which SEO plugin was detected, a form for writing the three fields to a post, and a table reading the values back out of the SEO plugin's own fields.
* The screen also prints a ready-to-run REST example using the site's own URL.
* Field mapping moved into a single shared function used by both the save hook and the new screen, so the two can no longer disagree.
* Readme: added step-by-step verification instructions and external-client usage.

= 1.0.0 =
* Initial release.
* REST API bridge for SEO metadata across Rank Math, Yoast SEO, SEOPress, and All in One SEO.
* Auto-detection of active SEO plugin via `notipo_seo_detect_plugin()`.
* GET `/wp-json/notipo/v1/seo-status` endpoint for detection status.

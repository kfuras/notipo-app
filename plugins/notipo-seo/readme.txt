=== Notipo SEO ===
Contributors: notipo
Tags: seo, notion, wordpress, rank math, yoast
Requires at least: 5.5
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Enables Notipo to write SEO metadata via the WordPress REST API. Supports Rank Math, Yoast SEO, SEOPress, and All in One SEO.

== Description ==

[Notipo](https://notipo.com) publishes blog posts from Notion to WordPress. This companion plugin allows Notipo to set SEO metadata (title, description, focus keyword) automatically when creating or updating posts.

It works by registering REST API-visible meta fields and mapping them to your active SEO plugin on save.

**Supported SEO plugins:**

* Rank Math
* Yoast SEO
* SEOPress
* All in One SEO (AIOSEO)

No configuration needed — install, activate, and Notipo handles the rest.

== Installation ==

1. Upload the `notipo-seo` folder to `/wp-content/plugins/`.
2. Activate the plugin in WordPress.
3. That's it — Notipo will automatically use it when publishing posts.

== Frequently Asked Questions ==

= Do I need this plugin? =

Only if you use an SEO plugin (Rank Math, Yoast, etc.) and want Notipo to set your SEO title, description, and focus keyword automatically.

= What if I don't have an SEO plugin? =

The plugin does nothing without a supported SEO plugin active. It won't cause any issues.

= How does it work? =

Notipo writes to `notipo_seo_title`, `notipo_seo_description`, and `notipo_seo_keyword` meta fields via the REST API. This plugin maps those to your SEO plugin's native fields when the post is saved.

== Changelog ==

= 1.0.0 =
* Initial release.
* Support for Rank Math, Yoast SEO, SEOPress, and All in One SEO.

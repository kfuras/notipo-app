<?php
/**
 * Plugin Name: Notipo SEO
 * Plugin URI:  https://github.com/kfuras/notipo
 * Description: Enables Notipo to write SEO metadata (title, description, focus keyword) via the WordPress REST API. Supports Rank Math, Yoast SEO, SEOPress, and All in One SEO.
 * Version:     1.0.0
 * Author:      Notipo
 * Author URI:  https://notipo.com
 * License:     MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: notipo-seo
 * Requires at least: 5.5
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register notipo_seo_* meta fields so the REST API can read/write them.
 */
add_action('init', function () {
    $fields = ['notipo_seo_title', 'notipo_seo_description', 'notipo_seo_keyword'];

    foreach ($fields as $key) {
        register_post_meta('post', $key, [
            'show_in_rest' => [
                'schema' => [
                    'type'      => 'string',
                    'maxLength' => 500,
                ],
            ],
            'single'            => true,
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'auth_callback'     => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }
});

/**
 * Detect which SEO plugin is active.
 *
 * @return string|null One of: rankmath, yoast, seopress, aioseo, or null.
 */
function notipo_seo_detect_plugin() {
    if (defined('RANK_MATH_VERSION')) {
        return 'rankmath';
    }
    if (defined('WPSEO_VERSION')) {
        return 'yoast';
    }
    if (defined('SEOPRESS_VERSION')) {
        return 'seopress';
    }
    if (defined('AIOSEO_VERSION')) {
        return 'aioseo';
    }
    return null;
}

/**
 * Map notipo_seo_* meta to the active SEO plugin's meta fields on post save.
 */
add_action('save_post', function ($post_id) {
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }

    if (get_post_type($post_id) !== 'post') {
        return;
    }

    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    $title       = get_post_meta($post_id, 'notipo_seo_title', true);
    $description = get_post_meta($post_id, 'notipo_seo_description', true);
    $keyword     = get_post_meta($post_id, 'notipo_seo_keyword', true);

    if (!$title && !$description && !$keyword) {
        return;
    }

    $plugin = notipo_seo_detect_plugin();

    switch ($plugin) {
        case 'rankmath':
            if ($keyword)     update_post_meta($post_id, 'rank_math_focus_keyword', $keyword);
            if ($title)       update_post_meta($post_id, 'rank_math_title', $title);
            if ($description) update_post_meta($post_id, 'rank_math_description', $description);
            break;

        case 'yoast':
            if ($keyword)     update_post_meta($post_id, '_yoast_wpseo_focuskw', $keyword);
            if ($title)       update_post_meta($post_id, '_yoast_wpseo_title', $title);
            if ($description) update_post_meta($post_id, '_yoast_wpseo_metadesc', $description);
            break;

        case 'seopress':
            if ($keyword)     update_post_meta($post_id, '_seopress_analysis_target_kw', $keyword);
            if ($title)       update_post_meta($post_id, '_seopress_titles_title', $title);
            if ($description) update_post_meta($post_id, '_seopress_titles_desc', $description);
            break;

        case 'aioseo':
            if ($keyword)     update_post_meta($post_id, '_aioseo_keywords', $keyword);
            if ($title)       update_post_meta($post_id, '_aioseo_title', $title);
            if ($description) update_post_meta($post_id, '_aioseo_description', $description);
            break;
    }
}, 10, 1);

/**
 * Expose the detected SEO plugin via REST API so Notipo can check compatibility.
 * GET /wp-json/notipo/v1/seo-status
 */
add_action('rest_api_init', function () {
    register_rest_route('notipo/v1', '/seo-status', [
        'methods'             => 'GET',
        'callback'            => function () {
            return [
                'plugin'  => notipo_seo_detect_plugin(),
                'version' => '1.0.0',
            ];
        },
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
    ]);
});

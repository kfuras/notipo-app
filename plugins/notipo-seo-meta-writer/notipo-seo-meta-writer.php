<?php
/**
 * Plugin Name: Notipo SEO Meta Writer
 * Plugin URI:  https://github.com/kfuras/notipo-app
 * Description: REST API bridge for SEO metadata. Write focus keyword, SEO title, and description to Rank Math, Yoast, SEOPress, or AIOSEO from any REST client (n8n, Zapier, AI agents, custom scripts, or the Notipo publishing platform).
 * Version:     1.1.2
 * Author:      kfuras
 * Author URI:  https://github.com/kfuras
 * License:     MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: notipo-seo-meta-writer
 * Requires at least: 5.5
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The three fields this plugin owns, in the order they are shown to the user.
 */
function notipo_seo_fields() {
    return [
        'notipo_seo_title'       => 'SEO title',
        'notipo_seo_description' => 'Meta description',
        'notipo_seo_keyword'     => 'Focus keyword',
    ];
}

/**
 * Register notipo_seo_* meta fields so the REST API can read/write them.
 */
add_action('init', function () {
    foreach (array_keys(notipo_seo_fields()) as $key) {
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
 * Human-readable name for a detected SEO plugin slug.
 */
function notipo_seo_plugin_label($plugin) {
    $labels = [
        'rankmath' => 'Rank Math',
        'yoast'    => 'Yoast SEO',
        'seopress' => 'SEOPress',
        'aioseo'   => 'All in One SEO',
    ];
    return isset($labels[$plugin]) ? $labels[$plugin] : '';
}

/**
 * Which native meta keys each supported SEO plugin stores its values in.
 *
 * Single source of truth: both the save_post mapper and the Tools screen read
 * this, so the screen can never claim a mapping the mapper does not perform.
 *
 * @return array<string,string> notipo_seo_* key => native meta key, or [].
 */
function notipo_seo_native_keys($plugin) {
    $map = [
        'rankmath' => [
            'notipo_seo_title'       => 'rank_math_title',
            'notipo_seo_description' => 'rank_math_description',
            'notipo_seo_keyword'     => 'rank_math_focus_keyword',
        ],
        'yoast' => [
            'notipo_seo_title'       => '_yoast_wpseo_title',
            'notipo_seo_description' => '_yoast_wpseo_metadesc',
            'notipo_seo_keyword'     => '_yoast_wpseo_focuskw',
        ],
        'seopress' => [
            'notipo_seo_title'       => '_seopress_titles_title',
            'notipo_seo_description' => '_seopress_titles_desc',
            'notipo_seo_keyword'     => '_seopress_analysis_target_kw',
        ],
        'aioseo' => [
            'notipo_seo_title'       => '_aioseo_title',
            'notipo_seo_description' => '_aioseo_description',
            'notipo_seo_keyword'     => '_aioseo_keywords',
        ],
    ];
    return isset($map[$plugin]) ? $map[$plugin] : [];
}

/**
 * Copy this plugin's meta into the active SEO plugin's native fields.
 *
 * @return string|null The SEO plugin that was written to, or null if none.
 */
function notipo_seo_sync_post($post_id) {
    $plugin = notipo_seo_detect_plugin();
    if (!$plugin) {
        return null;
    }

    $wrote = false;
    foreach (notipo_seo_native_keys($plugin) as $ours => $theirs) {
        $value = get_post_meta($post_id, $ours, true);
        if ($value !== '') {
            update_post_meta($post_id, $theirs, $value);
            $wrote = true;
        }
    }

    return $wrote ? $plugin : null;
}

/**
 * Mirror notipo_seo_* meta into the active SEO plugin whenever a post is saved,
 * including saves that arrive over the REST API.
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

    notipo_seo_sync_post($post_id);
}, 10, 1);

/**
 * Expose the detected SEO plugin via REST so an external client can check
 * compatibility before it starts sending posts.
 * GET /wp-json/notipo/v1/seo-status
 */
add_action('rest_api_init', function () {
    register_rest_route('notipo/v1', '/seo-status', [
        'methods'             => 'GET',
        'callback'            => function () {
            return [
                'plugin'  => notipo_seo_detect_plugin(),
                'version' => '1.1.0',
            ];
        },
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
    ]);
});

/* -------------------------------------------------------------------------
 * Tools → Notipo SEO Meta Writer
 *
 * The plugin has no front-end output and no settings, so a fresh install shows
 * nothing anywhere in wp-admin. This screen exists so that anyone — including
 * a reviewer who has never used the REST API — can see what was detected and
 * confirm the mapping works, without leaving WordPress.
 * ---------------------------------------------------------------------- */

add_action('admin_menu', function () {
    add_submenu_page(
        'tools.php',
        esc_html__('Notipo SEO Meta Writer', 'notipo-seo-meta-writer'),
        esc_html__('Notipo SEO Meta Writer', 'notipo-seo-meta-writer'),
        'manage_options',
        'notipo-seo-meta-writer',
        'notipo_seo_render_tools_page'
    );
});

function notipo_seo_render_tools_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to access this page.', 'notipo-seo-meta-writer'));
    }

    $plugin  = notipo_seo_detect_plugin();
    $post_id = 0;
    $notice  = '';

    // Handle the self-test submission.
    if (isset($_POST['notipo_seo_test'])) {
        check_admin_referer('notipo_seo_test');

        $post_id = isset($_POST['post_id']) ? absint($_POST['post_id']) : 0;
        $post    = $post_id ? get_post($post_id) : null;

        if (!$post || $post->post_type !== 'post') {
            $notice = ['error', __('Pick a post to write the test values to.', 'notipo-seo-meta-writer')];
        } elseif (!current_user_can('edit_post', $post_id)) {
            $notice = ['error', __('You cannot edit that post.', 'notipo-seo-meta-writer')];
        } else {
            foreach (array_keys(notipo_seo_fields()) as $key) {
                $value = isset($_POST[$key]) ? sanitize_text_field(wp_unslash($_POST[$key])) : '';
                update_post_meta($post_id, $key, $value);
            }

            $written = notipo_seo_sync_post($post_id);
            $notice  = $written
                ? ['success', sprintf(
                    /* translators: %s: name of the detected SEO plugin. */
                    __('Values saved and copied into %s. The table below reads them back from the database.', 'notipo-seo-meta-writer'),
                    notipo_seo_plugin_label($written)
                )]
                : ['warning', __('Values saved, but no supported SEO plugin is active, so there was nothing to copy them into.', 'notipo-seo-meta-writer')];
        }
    }

    $recent = get_posts([
        'numberposts' => 20,
        'post_type'   => 'post',
        'post_status' => ['publish', 'draft', 'pending', 'future', 'private'],
    ]);

    // On first load nothing has been submitted, so fall back to the newest post.
    // Landing on a blank screen is exactly the problem this page exists to fix.
    if (!$post_id && !empty($recent)) {
        $post_id = $recent[0]->ID;
    }
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('Notipo SEO Meta Writer', 'notipo-seo-meta-writer'); ?></h1>

        <?php if ($notice) : ?>
            <div class="notice notice-<?php echo esc_attr($notice[0]); ?>">
                <p><?php echo esc_html($notice[1]); ?></p>
            </div>
        <?php endif; ?>

        <h2><?php esc_html_e('Status', 'notipo-seo-meta-writer'); ?></h2>
        <?php if ($plugin) : ?>
            <p>
                <?php
                printf(
                    /* translators: %s: name of the detected SEO plugin. */
                    esc_html__('Detected SEO plugin: %s. Values written to the fields below are copied into it automatically whenever a post is saved.', 'notipo-seo-meta-writer'),
                    '<strong>' . esc_html(notipo_seo_plugin_label($plugin)) . '</strong>'
                );
                ?>
            </p>
        <?php else : ?>
            <div class="notice notice-warning inline">
                <p><?php esc_html_e('No supported SEO plugin is active. Activate Rank Math, Yoast SEO, SEOPress, or All in One SEO, then reload this page. The fields below still store their values, but there is nothing to copy them into yet.', 'notipo-seo-meta-writer'); ?></p>
            </div>
        <?php endif; ?>

        <h2><?php esc_html_e('Try it', 'notipo-seo-meta-writer'); ?></h2>
        <p><?php esc_html_e('Write test values to a post and see where they end up. This does the same thing an external REST client does.', 'notipo-seo-meta-writer'); ?></p>

        <?php if (empty($recent)) : ?>
            <p><em><?php esc_html_e('Create a post first — there is nothing to write to yet.', 'notipo-seo-meta-writer'); ?></em></p>
        <?php else : ?>
            <form method="post">
                <?php wp_nonce_field('notipo_seo_test'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="notipo_seo_post"><?php esc_html_e('Post', 'notipo-seo-meta-writer'); ?></label></th>
                        <td>
                            <select name="post_id" id="notipo_seo_post">
                                <?php foreach ($recent as $p) : ?>
                                    <option value="<?php echo esc_attr($p->ID); ?>" <?php selected($post_id, $p->ID); ?>>
                                        <?php echo esc_html($p->post_title !== '' ? $p->post_title : sprintf('#%d', $p->ID)); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <?php foreach (notipo_seo_fields() as $key => $label) : ?>
                        <tr>
                            <th scope="row"><label for="<?php echo esc_attr($key); ?>"><?php echo esc_html($label); ?></label></th>
                            <td>
                                <input type="text" class="regular-text" maxlength="500"
                                       id="<?php echo esc_attr($key); ?>"
                                       name="<?php echo esc_attr($key); ?>"
                                       value="<?php echo esc_attr($post_id ? get_post_meta($post_id, $key, true) : ''); ?>" />
                                <p class="description"><code><?php echo esc_html($key); ?></code></p>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </table>
                <?php submit_button(esc_html__('Save and copy to SEO plugin', 'notipo-seo-meta-writer'), 'primary', 'notipo_seo_test'); ?>
            </form>
        <?php endif; ?>

        <?php if ($post_id && $plugin) : ?>
            <h2><?php esc_html_e('Current values for this post', 'notipo-seo-meta-writer'); ?></h2>
            <p><?php esc_html_e('Read straight from the database, so this is what the SEO plugin actually has:', 'notipo-seo-meta-writer'); ?></p>
            <table class="widefat striped" style="max-width:820px">
                <thead>
                    <tr>
                        <th><?php esc_html_e('This plugin', 'notipo-seo-meta-writer'); ?></th>
                        <th><?php echo esc_html(notipo_seo_plugin_label($plugin)); ?></th>
                        <th><?php esc_html_e('Stored value', 'notipo-seo-meta-writer'); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach (notipo_seo_native_keys($plugin) as $ours => $theirs) : ?>
                    <tr>
                        <td><code><?php echo esc_html($ours); ?></code></td>
                        <td><code><?php echo esc_html($theirs); ?></code></td>
                        <td><?php echo esc_html(get_post_meta($post_id, $theirs, true)); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p class="description">
                <?php esc_html_e('Open the post editor and check the SEO plugin panel — the same values are there.', 'notipo-seo-meta-writer'); ?>
            </p>
        <?php endif; ?>

        <h2><?php esc_html_e('From an external client', 'notipo-seo-meta-writer'); ?></h2>
        <p><?php esc_html_e('The same three fields are writable over the WordPress REST API, which is what n8n, Zapier, AI agents or any script would use. Authenticate with an application password:', 'notipo-seo-meta-writer'); ?></p>
        <pre style="background:#fff;border:1px solid #c3c4c7;padding:12px;overflow:auto"><?php
            echo esc_html(
                "curl -X POST " . esc_url_raw(rest_url('wp/v2/posts/123')) . " \\\n" .
                "  -u \"USERNAME:APPLICATION_PASSWORD\" \\\n" .
                "  -H \"Content-Type: application/json\" \\\n" .
                "  -d '{\"meta\":{\"notipo_seo_title\":\"Example title\"," .
                "\"notipo_seo_description\":\"Example description\"," .
                "\"notipo_seo_keyword\":\"example\"}}'"
            );
        ?></pre>
        <p>
            <?php
            printf(
                /* translators: %s: REST endpoint URL. */
                esc_html__('To check what was detected from outside WordPress, call %s as a logged-in user.', 'notipo-seo-meta-writer'),
                '<code>' . esc_html(rest_url('notipo/v1/seo-status')) . '</code>'
            );
            ?>
        </p>
    </div>
    <?php
}

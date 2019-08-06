import { promises as fs } from 'fs';
import { join } from 'path';
import glob from 'fast-glob';
import { flatten } from './flatten';
import { Theme } from './types';

/**
 * @summary Hacky but functional validation that a directory is the
 *          root of a Magento 2 installation
 */
export async function isMagentoRoot(magentoRoot: string) {
    const EXPECTED_ENTRIES = ['app', 'vendor', 'index.php', 'lib'];
    const entries = await fs.readdir(magentoRoot);
    return EXPECTED_ENTRIES.every(e => entries.includes(e));
}

/**
 * @summary Get a list of all .phtml and .html files in all
 *          app and vendor directories in a Magento installation
 */
export async function collectTemplates(magentoRoot: string) {
    const composerDirs = await composerComponentPaths(magentoRoot);
    const appDirs = 'app/{code,design}/**/*.{phtml,html}';
    const vendorDirs = `vendor/{${composerDirs.join(',')}}/**/*.{phtml,html}`;

    return glob([appDirs, vendorDirs], {
        cwd: magentoRoot,
    });
}

/**
 * @summary Get a list of all composer dirs that are Magento modules or themes
 */
async function composerComponentPaths(magentoRoot: string) {
    const lockfilePath = join(magentoRoot, 'composer.lock');
    const rawLockfile = await fs.readFile(lockfilePath, 'utf8').catch(() => '');
    if (!rawLockfile) {
        // Should possibly just be a warning, but does anyone _not_ use composer with m2?
        throw new Error('Could not find "composer.lock" in Magento root');
    }

    const lockfile = JSON.parse(rawLockfile);
    const paths = [];

    for (const { type, name } of lockfile.packages) {
        if (type === 'magento2-module' || type === 'magento2-theme') {
            paths.push(name);
        }
    }

    return paths;
}

/**
 * @summary Get a list of all _deployed_ frontend and adminhtml themes
 *          for all vendors
 */
export async function getDeployedThemes(magentoRoot: string) {
    const staticRoot = join(magentoRoot, 'pub', 'static');

    const [frontendVendors, adminVendors] = await Promise.all([
        safeReaddir(join(staticRoot, 'frontend')),
        safeReaddir(join(staticRoot, 'adminhtml')),
    ]);

    const pendingFrontendThemes = Promise.all(
        frontendVendors.map(v =>
            getThemesForVendor(magentoRoot, 'frontend', v),
        ),
    );
    const pendingAdminThemes = Promise.all(
        adminVendors.map(v => getThemesForVendor(magentoRoot, 'adminhtml', v)),
    );

    const [frontendThemes, adminThemes] = await Promise.all([
        pendingFrontendThemes,
        pendingAdminThemes,
    ]);

    return {
        frontend: flatten(frontendThemes),
        adminhtml: flatten(adminThemes),
    };
}

async function getLocalesForDeployedTheme(
    magentoRoot: string,
    area: string,
    vendor: string,
    name: string,
) {
    const themeRoot = join(magentoRoot, 'pub', 'static', area, vendor, name);
    const dirs = await safeReaddir(themeRoot);

    // filter out any extra files/folders that aren't locales
    const reLang = /^[a-z]{2}(?:_[a-z]{2})?$/i;
    return dirs.filter(d => reLang.test(d));
}

async function getThemesForVendor(
    magentoRoot: string,
    area: string,
    vendor: string,
): Promise<Theme[]> {
    const vendorPath = join('pub', 'static', area, vendor);
    const themeNames = await safeReaddir(join(magentoRoot, vendorPath));
    // TODO: Filter non-theme dirs (example: hidden dot dirs)
    return Promise.all(
        themeNames.map(async name => ({
            vendor,
            name,
            area,
            locales: await getLocalesForDeployedTheme(
                magentoRoot,
                area,
                vendor,
                name,
            ),
            pathFromStoreRoot: join(vendorPath, name),
        })),
    );
}

const safeReaddir = (path: string) =>
    fs.readdir(path).catch(() => [] as string[]);
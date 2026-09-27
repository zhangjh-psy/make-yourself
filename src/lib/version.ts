/**
 * 项目元信息：版本、作者、仓库地址。
 *
 * ★ 开源前要改的就这几行：
 *    GITHUB_REPO 填好后，设置页的「检查更新」按钮才会出现（指向 Releases 页）。
 *    没填也不会报错，只是那个按钮不显示。
 */

/** 界面里显示的产品名 */
export const APP_NAME = 'Make yourself';

/** 数值版本号（跟 package.json 的 version 保持一致） */
export const APP_VERSION = '0.0.1';

/** 这个版本还处于内测阶段，界面上会标出来 */
export const IS_BETA = true;

/** 作者署名（显示在设置页"关于"里，也是 LICENSE 的版权人） */
export const AUTHOR = 'ZHANG Junhui';

/**
 * GitHub 仓库，格式 `用户名/仓库名`。
 * 留空 = 还没有公开仓库，设置页不会显示"检查更新"。
 */
export const GITHUB_REPO = 'zhangji-psy/make-yourself';

/** Releases 页地址（用来做"检查更新"） */
export function releasesUrl(): string {
  return GITHUB_REPO ? `https://github.com/${GITHUB_REPO}/releases` : '';
}

/** 版本号的展示文案，例如 "0.0.1 内测版" */
export function versionLabel(): string {
  return IS_BETA ? `${APP_VERSION} 内测版` : APP_VERSION;
}

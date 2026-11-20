import { track } from './analytics';
import { getMe, getSession } from './session';

let firstShow = true;

/**
 * Surfaces moderation notices and the publishing restriction prompt once per
 * launch/resume. The notice bookkeeping lives in `session.getMe`, so pages that
 * call it later do not repeat the same prompt.
 */
function refreshMeAlerts(): void {
  if (getSession() === null) {
    return;
  }
  void getMe().catch(() => undefined);
}

App({
  onLaunch(options: WxLaunchOptions) {
    track('app_launch', {
      scene: options.scene ?? 0,
      page: options.path ?? '',
    });
    refreshMeAlerts();
  },

  onShow(options: WxLaunchOptions) {
    // The first onShow follows onLaunch; later ones are resumes from background.
    if (firstShow) {
      firstShow = false;
      return;
    }
    track('app_launch', {
      scene: options.scene ?? 0,
      page: options.path ?? '',
      restored: true,
    });
    refreshMeAlerts();
  },
});
